"""Textura orbital del gemelo 3D: mosaico CTX de 6 m co-registrado con el DTM de trabajo.

`uv run python -m red_atlas_p1.terrain.ortho_texture` (después de `-m red_atlas_p1.terrain`).

Por qué esta fuente (medido, ver `data/nasa-layers/ortho_ctx_6m_route.json`):

- El DTM de trabajo (par estéreo CTX P18/P20, 20 m, alineado a MOLA) es la geometría de la
  escena: relieve, waypoints y malla H3 salen de él.
- Su ortoimagen pareada encaja por construcción, pero es de 20 m.
- El mosaico CTX controlado de Robbins et al. (6 m, MC-18) cubre el 100 % de la ruta, pero está
  controlado contra otra base y aparece desplazado decenas de metros respecto al DTM. El
  desplazamiento es una traslación pura (igual en los cuatro cuadrantes), así que se corrige
  moviendo sus límites, sin remuestrear la imagen.
- HiRISE (RDR sin control, ±100 m) se deforma de un cuadrante a otro: una traslación no lo
  alinea y no se usa.
- Mars Trek solo ofrece aquí el mosaico CTX global sin control (Caltech beta01, JPEG con
  pérdida, 8 bits) y los globales Viking (232 m) y MOLA (463 m).

La traslación se mide por correlación de fase entre el mosaico y la ortoimagen pareada del DTM,
remuestreados a una malla común de 5 m y filtrados paso alto; el pico se afina con un ajuste
parabólico. Se declara en el JSON junto con la consistencia por cuadrantes y el residuo.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import warnings

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject
from rasterio.windows import from_bounds as window_from_bounds
from scipy.ndimage import gaussian_filter

from .. import config

COG = config.COG_DIR
SRC_NAME = "ortho_ctx_6m_route.tif"
REF_NAME = "ortho_ctx_pair_20m_route.tif"
OUT_PNG = config.LAYERS_DIR / "ortho_ctx_6m_route.png"
OUT_JSON = config.LAYERS_DIR / "ortho_ctx_6m_route.json"
MANIFEST = config.LAYERS_DIR / "sources_manifest.json"

#: Malla común de la correlación, m.
MATCH_STEP_M = 5.0
#: Recorte de la correlación: interior de la AOI de ruta (evita bordes sin dato), grados.
MATCH_MARGIN_DEG = 0.004
#: Paso alto: se resta un desenfoque gaussiano de este sigma (en píxeles de la malla común).
HIGHPASS_SIGMA_PX = 8.0
#: Estiramiento de I/F a 8 bits por percentiles.
STRETCH_PCT = (0.5, 99.5)
#: Si la traslación medida en los cuadrantes discrepa más que esto, no es una traslación pura.
MAX_QUADRANT_SPREAD_M = 15.0

M_PER_DEG = config.MARS_RADIUS_M * np.pi / 180.0


def _say(msg: str) -> None:
    print(f"[ortho_texture] {msg}", flush=True)


def _working_pair_ortho_url() -> tuple[str, str]:
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    pid = man["working_dem"]["id"]
    prod = next(p for p in man["products"] if p.get("id") == pid)
    return pid, prod["orthoimage_url"]


def _ensure_reference(aoi: dict) -> rasterio.io.DatasetReader:
    """Recorta (una vez) la ortoimagen pareada del DTM de trabajo a la AOI de ruta."""
    path = COG / REF_NAME
    if not path.exists():
        pid, url = _working_pair_ortho_url()
        _say(f"descargando por ventana la ortoimagen del par {pid}")
        with rasterio.open("/vsicurl/" + url) as src:
            r = config.MARS_RADIUS_M
            pad = 0.01
            x0 = np.radians(config.lon180(aoi["lon_e_min"] - pad)) * r
            x1 = np.radians(config.lon180(aoi["lon_e_max"] + pad)) * r
            y0 = np.radians(aoi["lat_min"] - pad) * r
            y1 = np.radians(aoi["lat_max"] + pad) * r
            win = window_from_bounds(x0, y0, x1, y1, src.transform).round_offsets().round_lengths()
            data = src.read(1, window=win)
            t = src.window_transform(win)
            # Geotransformación reescrita a grados, longitud Este 0-360 (como el resto de COGs).
            lon0 = config.lon360(np.degrees(t.c / r))
            lat0 = np.degrees(t.f / r)
            dlon = np.degrees(t.a / r)
            dlat = np.degrees(t.e / r)
            prof = {
                "driver": "GTiff", "dtype": data.dtype, "count": 1,
                "width": data.shape[1], "height": data.shape[0],
                "crs": rasterio.open(COG / SRC_NAME).crs, "nodata": src.nodata,
                "transform": rasterio.Affine(dlon, 0, lon0, 0, dlat, lat0),
                "compress": "deflate",
            }
            with rasterio.open(path, "w", **prof) as dst:
                dst.write(data, 1)
                dst.update_tags(SOURCE_ID=pid, SOURCE_URL=url, PROVENANCE="medido",
                                LON_CONVENTION="Este positiva 0-360; latitud planetocentrica",
                                PROCESSING="Recorte por ventana sin remuestreo; referencia de "
                                           "co-registro de la textura CTX 6 m.")
    return rasterio.open(path)


def _resample(src, bounds, w, h) -> np.ndarray:
    out = np.full((h, w), np.nan, np.float32)
    reproject(
        rasterio.band(src, 1), out,
        src_nodata=src.nodata, dst_transform=from_bounds(*bounds, w, h),
        dst_crs=src.crs, dst_nodata=np.nan, resampling=Resampling.average,
    )
    return out


def _highpass(a: np.ndarray) -> np.ndarray:
    m = np.isfinite(a)
    a = np.where(m, a, np.nanmean(a))
    a = a - gaussian_filter(a, HIGHPASS_SIGMA_PX)
    a = (a - a[m].mean()) / a[m].std()
    a[~m] = 0.0
    return a * np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))


def _parabolic(cm1: float, c0: float, cp1: float) -> float:
    den = cm1 - 2 * c0 + cp1
    return 0.0 if den == 0 else 0.5 * (cm1 - cp1) / den


def phase_shift(ref: np.ndarray, img: np.ndarray) -> tuple[float, float, float]:
    """Desplazamiento (filas, columnas) que hay que aplicar a `img` para que case con `ref`,
    con afinado subpíxel, y el pico de la correlación en desviaciones típicas."""
    a = np.fft.fft2(_highpass(ref))
    b = np.fft.fft2(_highpass(img))
    x = a * np.conj(b)
    x /= np.abs(x) + 1e-12
    c = np.fft.ifft2(x).real
    h, w = c.shape
    i, j = np.unravel_index(np.argmax(c), c.shape)
    di = i + _parabolic(c[(i - 1) % h, j], c[i, j], c[(i + 1) % h, j])
    dj = j + _parabolic(c[i, (j - 1) % w], c[i, j], c[i, (j + 1) % w])
    if di > h / 2:
        di -= h
    if dj > w / 2:
        dj -= w
    return float(di), float(dj), float(c[i, j] / c.std())


def measure_offset(src, ref, aoi: dict) -> dict:
    """Traslación (m al este, m al norte) que hay que sumar a los límites del mosaico."""
    m = MATCH_MARGIN_DEG
    lon0, lon1 = aoi["lon_e_min"] + m, aoi["lon_e_max"] - m
    lat0, lat1 = aoi["lat_min"] + m, aoi["lat_max"] - m
    step = MATCH_STEP_M / M_PER_DEG
    w = int((lon1 - lon0) / step)
    h = int((lat1 - lat0) / step)
    bounds = (lon0, lat0, lon1, lat1)
    a = _resample(ref, bounds, w, h)
    b = _resample(src, bounds, w, h)
    di, dj, peak = phase_shift(a, b)
    # Filas crecen hacia el sur: desplazar `di` filas es mover di·step m hacia el sur.
    east, north = dj * MATCH_STEP_M, -di * MATCH_STEP_M
    quads = []
    h2, w2 = h // 2, w // 2
    for r0, c0 in [(0, 0), (0, w2), (h2, 0), (h2, w2)]:
        qi, qj, qp = phase_shift(a[r0:r0 + h2, c0:c0 + w2], b[r0:r0 + h2, c0:c0 + w2])
        quads.append({"east_m": round(qj * MATCH_STEP_M, 1), "north_m": round(-qi * MATCH_STEP_M, 1),
                      "peak_sigma": round(qp, 1)})
    spread = max(
        np.hypot(q["east_m"] - east, q["north_m"] - north) for q in quads
    )
    return {"east_m": east, "north_m": north, "peak_sigma": peak, "quadrants": quads,
            "quadrant_spread_m": float(spread), "grid": (bounds, w, h)}


def residual_after(src, ref, aoi: dict, east: float, north: float) -> float:
    """Desplazamiento que queda tras aplicar la corrección (m), medido igual."""
    m = MATCH_MARGIN_DEG
    lon0, lon1 = aoi["lon_e_min"] + m, aoi["lon_e_max"] - m
    lat0, lat1 = aoi["lat_min"] + m, aoi["lat_max"] - m
    step = MATCH_STEP_M / M_PER_DEG
    w = int((lon1 - lon0) / step)
    h = int((lat1 - lat0) / step)
    a = _resample(ref, (lon0, lat0, lon1, lat1), w, h)
    # Leer el mosaico en la ventana desplazada equivale a desplazar sus límites.
    dlon = east / (M_PER_DEG * np.cos(np.radians(0.5 * (lat0 + lat1))))
    dlat = north / M_PER_DEG
    b = _resample(src, (lon0 - dlon, lat0 - dlat, lon1 - dlon, lat1 - dlat), w, h)
    di, dj, _ = phase_shift(a, b)
    return float(np.hypot(di, dj) * MATCH_STEP_M)


def main(argv=None) -> int:
    os.environ.setdefault("GDAL_PAM_ENABLED", "NO")
    aoi = config.AOI_ROUTE
    src_path = COG / SRC_NAME
    if not src_path.exists():
        _say(f"falta {src_path}: ejecuta antes `uv run python -m red_atlas_p1.terrain`")
        return 1
    src = rasterio.open(src_path)
    ref = _ensure_reference(aoi)
    tags = src.tags()

    off = measure_offset(src, ref, aoi)
    if off["quadrant_spread_m"] > MAX_QUADRANT_SPREAD_M:
        _say(f"los cuadrantes discrepan {off['quadrant_spread_m']:.1f} m: no es una traslación pura")
        return 2
    lat_mid = 0.5 * (aoi["lat_min"] + aoi["lat_max"])
    dlon = off["east_m"] / (M_PER_DEG * np.cos(np.radians(lat_mid)))
    dlat = off["north_m"] / M_PER_DEG
    resid = residual_after(src, ref, aoi, off["east_m"], off["north_m"])
    # HiRISE (1 m, sin control): la misma medida, para dejar constancia de por qué no se usa.
    hirise_path = COG / "ortho_hirise_1m_route.tif"
    hirise = None
    if hirise_path.exists():
        with rasterio.open(hirise_path) as h:
            ho = measure_offset(h, ref, aoi)
            hirise = {"id": h.tags().get("SOURCE_ID"), "east_m": round(ho["east_m"], 1),
                      "north_m": round(ho["north_m"], 1), "quadrants": ho["quadrants"],
                      "quadrant_spread_m": round(ho["quadrant_spread_m"], 1)}
        _say(f"HiRISE: {hirise['east_m']:+.1f} m E, {hirise['north_m']:+.1f} m N, "
             f"cuadrantes ±{hirise['quadrant_spread_m']:.1f} m")
    _say(f"traslación {off['east_m']:+.1f} m E, {off['north_m']:+.1f} m N "
         f"(pico {off['peak_sigma']:.0f} σ, cuadrantes ±{off['quadrant_spread_m']:.1f} m, "
         f"residuo {resid:.1f} m)")

    dn = src.read(1).astype(np.float64)
    valid = dn != src.nodata if src.nodata is not None else np.isfinite(dn)
    scale = float(tags.get("VALUE_SCALE", 1.0))
    offset = float(tags.get("VALUE_OFFSET", 0.0))
    i_f = dn * scale + offset
    lo, hi = np.percentile(i_f[valid], STRETCH_PCT)
    img = np.clip((i_f - lo) / (hi - lo), 0, 1) * 255.0
    img = np.where(valid, np.round(img), 0).astype(np.uint8)
    alpha = np.where(valid, 255, 0).astype(np.uint8)

    b = src.bounds
    west, east = b.left + dlon, b.right + dlon
    south, north = b.bottom + dlat, b.top + dlat
    warnings.filterwarnings("ignore", category=rasterio.errors.NotGeoreferencedWarning)
    with rasterio.open(
        OUT_PNG, "w", driver="PNG", width=src.width, height=src.height, count=2, dtype="uint8"
    ) as dst:
        dst.write(img, 1)
        dst.write(alpha, 2)

    res_m = float(tags.get("SOURCE_RESOLUTION_M", 6.0))
    meta = {
        "schema_version": "1.0",
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "uv run python -m red_atlas_p1.terrain.ortho_texture",
        "image": OUT_PNG.name,
        "format": "PNG gris + alfa, 8 bits; fila 0 = borde norte; columnas hacia el este",
        "width": src.width,
        "height": src.height,
        "bounds": {"lat_min": south, "lat_max": north, "lon_e_min": west, "lon_e_max": east},
        "lon_convention": "Este positiva 0-360; latitud planetocéntrica (IAU_2015:49900)",
        "pixel_deg": src.res[0],
        "resolution_m": res_m,
        "mission": tags.get("SOURCE_MISSION"),
        "instrument": "Context Camera (CTX)",
        "product": tags.get("SOURCE_PRODUCT_TYPE"),
        "source_id": tags.get("SOURCE_ID"),
        "source_url": tags.get("SOURCE_URL"),
        "citation": tags.get("SOURCE_CITATION"),
        "license": tags.get("SOURCE_LICENSE"),
        "credit": "NASA/JPL/MSSS; mosaico USGS Astrogeology (Robbins et al., 2023)",
        "band": "Banda ancha roja de CTX (≈ 500–800 nm): la imagen es en grises; no lleva color añadido.",
        "stretch": {
            "quantity": "DN·VALUE_SCALE + VALUE_OFFSET (escala radiométrica del fichero de origen)",
            "black": lo,
            "white": hi,
            "percentiles": list(STRETCH_PCT),
        },
        "coregistration": {
            "method": "Traslación rígida medida por correlación de fase (paso alto, malla común "
                      f"de {MATCH_STEP_M:.0f} m, afinado parabólico) contra la ortoimagen del par "
                      "estéreo del DTM de trabajo; se aplica moviendo los límites, sin remuestrear.",
            "reference": f"build/cog/{REF_NAME}",
            "reference_product": _working_pair_ortho_url()[0],
            "shift_east_m": round(off["east_m"], 1),
            "shift_north_m": round(off["north_m"], 1),
            "peak_sigma": round(off["peak_sigma"], 1),
            "quadrants": off["quadrants"],
            "quadrant_spread_m": round(off["quadrant_spread_m"], 1),
            "residual_m": round(resid, 1),
            "uncertainty_m": "≈ un píxel de la malla común (5 m) más la dispersión entre cuadrantes",
        },
        "alternatives_rejected": [
            {"source": "Ortoimagen del par estéreo del DTM (USGS, ASP)", "resolution_m": 20.0,
             "reason": "Encaja por construcción con el relieve, pero a 20 m; se usa como referencia de co-registro."},
            {"source": "HiRISE PSP_008735_1700_RED (RDR sin control)", "resolution_m": 1.0,
             "reason": "Sin control (±100 m) y deformado: la traslación medida cambia entre cuadrantes "
                       f"más que el límite de {MAX_QUADRANT_SPREAD_M:.0f} m, así que una traslación no lo alinea.",
             "measured": hirise},
            {"source": "Mars Trek: MRO CTX Mosaic Global Uncontrolled (Caltech beta01)", "resolution_m": 5.0,
             "reason": "Sin control, JPEG con pérdida a 8 bits; no mejora al mosaico controlado de 6 m."},
            {"source": "Mars Trek: Viking MDIM 2.1 / MOLA sombreado", "resolution_m": 232.0,
             "reason": "Globales: un píxel es mayor que un tramo de la ruta."},
        ],
        "provenance": "medido",
    }
    OUT_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _say(f"escrito {OUT_PNG.relative_to(config.REPO_DIR)} y {OUT_JSON.relative_to(config.REPO_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
