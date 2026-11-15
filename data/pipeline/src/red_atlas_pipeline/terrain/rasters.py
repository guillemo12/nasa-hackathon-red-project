"""Lectura por ventana de productos remotos y escritura de COG con procedencia.

Convención de todas las mallas de este módulo: geográficas sobre la esfera de Marte
(`IAU_2015:49900`), latitud planetocéntrica, longitud Este 0-360 y píxel como área.

Los productos de USGS vienen en equirrectangular con `lat_ts=0` sobre la misma esfera
(x = R·λ, y = R·φ), así que pasar a grados es reescribir la geotransformación: no se
remuestrea ningún píxel.
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.io import MemoryFile
from rasterio.windows import Window
from rio_cogeo.cogeo import cog_translate, cog_validate
from rio_cogeo.profiles import cog_profiles

from .. import config
from .settings import NODATA_F32

R = config.MARS_RADIUS_M
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GTIFF_DIRECT_IO": "YES",            # lectura parcial de tiras sin comprimir
    "CPL_VSIL_CURL_CHUNK_SIZE": "16384",
    "GDAL_HTTP_TIMEOUT": "60",
    "GDAL_HTTP_MAX_RETRY": "3",
    "GDAL_HTTP_RETRY_DELAY": "2",
}


@dataclass
class Raster:
    """Ráster en memoria sobre malla geográfica (grados, lon Este 0-360)."""

    data: np.ndarray                 # (bandas, filas, columnas)
    transform: Affine                # grados; origen en la esquina superior izquierda
    nodata: float | None = None
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.data.ndim == 2:
            self.data = self.data[np.newaxis]

    # -- geometría ---------------------------------------------------------
    @property
    def shape(self) -> tuple[int, int]:
        return self.data.shape[1], self.data.shape[2]

    @property
    def dlon(self) -> float:
        return self.transform.a

    @property
    def dlat(self) -> float:
        return -self.transform.e

    @property
    def bounds(self) -> dict:
        rows, cols = self.shape
        return {
            "lon_e_min": self.transform.c,
            "lon_e_max": self.transform.c + cols * self.dlon,
            "lat_min": self.transform.f - rows * self.dlat,
            "lat_max": self.transform.f,
        }

    def row_lats(self) -> np.ndarray:
        """Latitud del centro de cada fila."""
        return self.transform.f - (np.arange(self.shape[0]) + 0.5) * self.dlat

    def col_lons(self) -> np.ndarray:
        """Longitud Este (0-360) del centro de cada columna."""
        return self.transform.c + (np.arange(self.shape[1]) + 0.5) * self.dlon

    @property
    def dy_m(self) -> float:
        """Paso norte-sur en metros reales."""
        return R * math.radians(self.dlat)

    def dx_m(self) -> np.ndarray:
        """Paso este-oeste en metros reales, por fila (se estrecha con cos(lat))."""
        return R * math.radians(self.dlon) * np.cos(np.radians(self.row_lats()))

    @property
    def pixel_m(self) -> float:
        """Tamaño medio de píxel en metros (media geométrica de los dos pasos)."""
        return float(math.sqrt(self.dy_m * float(np.mean(self.dx_m()))))

    # -- valores -----------------------------------------------------------
    def band(self, i: int = 0) -> np.ndarray:
        """Banda como float64 con NaN donde no hay dato."""
        a = self.data[i].astype("float64")
        if self.nodata is not None:
            a[self.data[i] == self.nodata] = np.nan
        a[~np.isfinite(a)] = np.nan
        return a

    def valid_fraction(self, i: int = 0) -> float:
        return float(np.isfinite(self.band(i)).mean()) if self.data[i].size else 0.0

    def index(self, lon_e, lat) -> tuple[np.ndarray, np.ndarray]:
        """Fila y columna fraccionarias (0,0 = centro del primer píxel)."""
        col = (np.asarray(lon_e, dtype="float64") - self.transform.c) / self.dlon - 0.5
        row = (self.transform.f - np.asarray(lat, dtype="float64")) / self.dlat - 0.5
        return row, col

    def crop(self, aoi: dict) -> "Raster":
        """Subventana alineada a píxel que cubre la AOI (sin remuestrear)."""
        rows, cols = self.shape
        c0 = max(0, math.floor((aoi["lon_e_min"] - self.transform.c) / self.dlon + 1e-9))
        c1 = min(cols, math.ceil((aoi["lon_e_max"] - self.transform.c) / self.dlon - 1e-9))
        r0 = max(0, math.floor((self.transform.f - aoi["lat_max"]) / self.dlat + 1e-9))
        r1 = min(rows, math.ceil((self.transform.f - aoi["lat_min"]) / self.dlat - 1e-9))
        t = self.transform @ Affine.translation(c0, r0)
        out = Raster(self.data[:, r0:r1, c0:c1].copy(), t, self.nodata, dict(self.meta))
        out.meta["crop_offset"] = (r0, c0)
        return out


def aoi_coverage(r: Raster, aoi: dict, band: int = 0) -> float:
    """Fracción de la AOI con dato válido (cuenta como vacío lo que queda fuera del ráster)."""
    if r.data.size == 0:
        return 0.0
    b = r.bounds
    w = max(0.0, min(b["lon_e_max"], aoi["lon_e_max"]) - max(b["lon_e_min"], aoi["lon_e_min"]))
    h = max(0.0, min(b["lat_max"], aoi["lat_max"]) - max(b["lat_min"], aoi["lat_min"]))
    inside = (w * h) / ((aoi["lon_e_max"] - aoi["lon_e_min"]) * (aoi["lat_max"] - aoi["lat_min"]))
    return round(min(1.0, inside) * r.valid_fraction(band), 4)


def sample(a: np.ndarray, row, col, bilinear: bool = True) -> np.ndarray:
    """Muestrea una matriz 2D (NaN = sin dato) en índices fraccionarios.

    Fuera de la matriz devuelve NaN. En bilineal, si alguno de los cuatro vecinos es NaN,
    recurre al vecino más próximo.
    """
    row = np.asarray(row, dtype="float64")
    col = np.asarray(col, dtype="float64")
    nr, nc = a.shape
    rn = np.rint(row).astype("int64")
    cn = np.rint(col).astype("int64")
    inside = (rn >= 0) & (rn < nr) & (cn >= 0) & (cn < nc)
    near = np.full(row.shape, np.nan)
    near[inside] = a[rn[inside], cn[inside]]
    if not bilinear:
        return near
    r0 = np.floor(row).astype("int64")
    c0 = np.floor(col).astype("int64")
    ok = (r0 >= 0) & (r0 < nr - 1) & (c0 >= 0) & (c0 < nc - 1)
    out = near.copy()
    if ok.any():
        fr = row[ok] - r0[ok]
        fc = col[ok] - c0[ok]
        r, c = r0[ok], c0[ok]
        v = (a[r, c] * (1 - fr) * (1 - fc) + a[r, c + 1] * (1 - fr) * fc
             + a[r + 1, c] * fr * (1 - fc) + a[r + 1, c + 1] * fr * fc)
        out[ok] = np.where(np.isfinite(v), v, near[ok])
    return out


def sample_raster(r: Raster, lon_e, lat, band: int = 0, bilinear: bool = True) -> np.ndarray:
    row, col = r.index(lon_e, lat)
    return sample(r.band(band), row, col, bilinear)


# ---------------------------------------------------------------------------
# Lectura remota
# ---------------------------------------------------------------------------
def _source_lon(ds, lon_e: float) -> float:
    """Longitud Este 0-360 -> coordenada x del CRS de la fuente."""
    crs = ds.crs.to_dict()
    if ds.crs.is_geographic:
        left = ds.bounds.left
        return lon_e - 360.0 if (left < 0 and lon_e > 180.0) else lon_e
    lon_0 = float(crs.get("lon_0", 0.0))
    return R * math.radians(((lon_e - lon_0 + 180.0) % 360.0) - 180.0)


def _check_source_crs(ds) -> None:
    crs = ds.crs.to_dict()
    if ds.crs.is_geographic:
        return
    if crs.get("proj") != "eqc" or float(crs.get("lat_ts", 0.0)) != 0.0:
        raise ValueError(f"CRS de origen no admitido sin remuestreo: {ds.crs.to_proj4()}")
    radius = float(crs.get("R", crs.get("a", 0.0)))
    if abs(radius - R) > 1.0:
        raise ValueError(f"La esfera de la fuente (R={radius}) no es la de IAU_2015:49900")


def read_window(url: str, aoi: dict, *, decimate: int = 1, max_size: int | None = None) -> Raster:
    """Lee solo la ventana de `aoi` de un GeoTIFF remoto (o local) y la devuelve en grados.

    `decimate` > 1 lee una vista reducida (usa las vistas internas del COG si existen).
    `max_size` limita el lado mayor de la salida (para medir cobertura sin bajar el dato).
    """
    path = url if not url.startswith("http") else "/vsicurl/" + url
    with warnings.catch_warnings(), rasterio.Env(**GDAL_ENV):
        warnings.simplefilter("ignore")
        with rasterio.open(path) as ds:
            _check_source_crs(ds)
            geographic = ds.crs.is_geographic
            x0, x1 = _source_lon(ds, aoi["lon_e_min"]), _source_lon(ds, aoi["lon_e_max"])
            if geographic:
                y0, y1 = aoi["lat_min"], aoi["lat_max"]
            else:
                y0, y1 = R * math.radians(aoi["lat_min"]), R * math.radians(aoi["lat_max"])
            t = ds.transform
            c0 = max(0, math.floor((x0 - t.c) / t.a + 1e-9))
            c1 = min(ds.width, math.ceil((x1 - t.c) / t.a - 1e-9))
            r0 = max(0, math.floor((t.f - y1) / -t.e + 1e-9))
            r1 = min(ds.height, math.ceil((t.f - y0) / -t.e - 1e-9))
            meta = {
                "source_url": url,
                "source_crs": ds.crs.to_proj4(),
                "source_res": float(t.a),
                "source_res_unit": "grados" if geographic else "m",
                "source_dtype": ds.dtypes[0],
                "source_nodata": ds.nodata,
                "source_scale": float(ds.scales[0]),
                "source_offset": float(ds.offsets[0]),
                "decimate": 1,
            }
            if c1 <= c0 or r1 <= r0:
                empty = np.zeros((ds.count, 0, 0), dtype=ds.dtypes[0])
                return Raster(empty, Affine(1, 0, aoi["lon_e_min"], 0, -1, aoi["lat_max"]),
                              ds.nodata, meta)
            win = Window(c0, r0, c1 - c0, r1 - r0)
            h, w = r1 - r0, c1 - c0
            if max_size is not None:
                decimate = max(decimate, math.ceil(max(h, w) / max_size))
            if decimate > 1:
                out_shape = (ds.count, max(1, round(h / decimate)), max(1, round(w / decimate)))
                data = ds.read(window=win, out_shape=out_shape)
                meta["decimate"] = decimate
            else:
                data = ds.read(window=win)
            # Geotransformación en grados, longitud Este 0-360.
            if geographic:
                left = (t.c + c0 * t.a) % 360.0
                top = t.f + r0 * t.e
                px_lon, px_lat = t.a, -t.e
            else:
                lon_0 = float(ds.crs.to_dict().get("lon_0", 0.0))
                left = (math.degrees((t.c + c0 * t.a) / R) + lon_0) % 360.0
                top = math.degrees((t.f + r0 * t.e) / R)
                px_lon = math.degrees(t.a / R)
                px_lat = math.degrees(-t.e / R)
            sx, sy = w / data.shape[2], h / data.shape[1]
            out_t = Affine(px_lon * sx, 0.0, left, 0.0, -px_lat * sy, top)
            return Raster(data, out_t, ds.nodata, meta)


def to_float32(r: Raster, *, apply_scale: bool = False) -> Raster:
    """Copia en float32 con nodata uniforme (`NODATA_F32`)."""
    out = np.full(r.data.shape, NODATA_F32, dtype="float32")
    for i in range(r.data.shape[0]):
        b = r.band(i)
        if apply_scale:
            b = b * r.meta.get("source_scale", 1.0) + r.meta.get("source_offset", 0.0)
        out[i] = np.where(np.isfinite(b), b, NODATA_F32)
    return Raster(out, r.transform, NODATA_F32, dict(r.meta))


def from_array(a: np.ndarray, like: Raster, meta: dict | None = None) -> Raster:
    """Empaqueta matrices float (NaN = sin dato) en un Raster float32 alineado con `like`."""
    a = np.asarray(a, dtype="float64")
    if a.ndim == 2:
        a = a[np.newaxis]
    out = np.where(np.isfinite(a), a, NODATA_F32).astype("float32")
    return Raster(out, like.transform, NODATA_F32, dict(meta or {}))


# ---------------------------------------------------------------------------
# Escritura COG
# ---------------------------------------------------------------------------
def _crs():
    try:
        return rasterio.crs.CRS.from_string(config.CRS_GEOGRAPHIC)
    except Exception:  # pragma: no cover - depende de la base de datos PROJ instalada
        return rasterio.crs.CRS.from_string(config.CRS_GEOGRAPHIC_PROJ4)


def write_cog(
    path: Path,
    r: Raster,
    *,
    band_names: list[str],
    band_units: list[str],
    tags: dict,
    resampling: str = "average",
) -> dict:
    """Escribe `r` como COG (deflate, teselas de 512) con etiquetas de procedencia.

    Devuelve un resumen apto para el contrato de salida. Valida el resultado y lanza
    `ValueError` si no es un COG válido.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bands, rows, cols = r.data.shape
    if len(band_names) != bands or len(band_units) != bands:
        raise ValueError("Número de nombres o unidades distinto del número de bandas")
    profile = {
        "driver": "GTiff", "dtype": r.data.dtype.name, "count": bands,
        "height": rows, "width": cols, "crs": _crs(), "transform": r.transform,
        "nodata": r.nodata,
    }
    all_tags = {k: (v if isinstance(v, str) else str(v)) for k, v in tags.items()}
    all_tags.setdefault("LON_CONVENTION", "Este positiva 0-360; latitud planetocentrica")
    all_tags.setdefault("AREA_OR_POINT", "Area")
    for i, (name, unit) in enumerate(zip(band_names, band_units), start=1):
        all_tags[f"BAND_{i}_NAME"], all_tags[f"BAND_{i}_UNIT"] = name, unit
    cog = dict(cog_profiles.get("deflate"))
    cog.update(blockxsize=512, blockysize=512)
    if r.data.dtype.kind == "f":
        cog["predictor"] = 3
    elif r.data.dtype.itemsize > 1:
        cog["predictor"] = 2
    with warnings.catch_warnings(), MemoryFile() as mem:
        warnings.simplefilter("ignore")
        with mem.open(**profile) as tmp:
            tmp.write(r.data)
            for i, (name, unit) in enumerate(zip(band_names, band_units), start=1):
                tmp.set_band_description(i, name)
                tmp.set_band_unit(i, unit)
        with mem.open() as src:
            cog_translate(
                src, str(path), cog, in_memory=True, quiet=True,
                overview_resampling=resampling, additional_cog_metadata=all_tags,
                forward_band_tags=True, use_cog_driver=False,
            )
        ok, errors, cog_warnings = cog_validate(str(path), quiet=True)
    if not ok:
        raise ValueError(f"COG no válido {path.name}: {errors}")
    b = r.bounds
    return {
        "path": str(path.relative_to(config.PIPELINE_DIR)),
        "format": "COG (GeoTIFF, deflate, teselas 512)",
        "dtype": r.data.dtype.name,
        "nodata": r.nodata,
        "crs": config.CRS_GEOGRAPHIC,
        "lon_convention": "Este 0-360 (usar config.lon180 para H3, CesiumJS y DuckDB Spatial)",
        "width": cols, "height": rows,
        "pixel_size_deg": [r.dlon, r.dlat],
        "pixel_size_m": [round(float(np.mean(r.dx_m())), 3), round(r.dy_m, 3)],
        "bounds": {k: round(v, 8) for k, v in b.items()},
        "bands": [
            {"index": i + 1, "name": n, "unit": u}
            for i, (n, u) in enumerate(zip(band_names, band_units))
        ],
        "cog_valid": True,
        "cog_warnings": list(cog_warnings),
    }


def read_cog(path: Path) -> Raster:
    """Lee un COG local escrito por `write_cog`."""
    with rasterio.open(path) as ds:
        r = Raster(ds.read(), ds.transform, ds.nodata, dict(ds.tags()))
        r.meta["band_names"] = list(ds.descriptions)
        return r
