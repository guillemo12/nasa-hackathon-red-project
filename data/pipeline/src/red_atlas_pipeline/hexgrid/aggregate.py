"""Agregación de las capas de terreno y escenario a celdas H3.

Dos regímenes, según la relación entre la celda y el píxel CTX de ~20 m:

* **Resolución 12** (arista media ≈5,8 m en Marte, área ≈87 m²): la celda es más fina que
  el DTM. Cada píxel de 20 m contiene ~4-5 celdas. No se interpola: cada celda toma el valor
  del píxel que contiene su centro (``ref_pixel_id`` dice cuál), y las celdas que comparten
  píxel comparten valor. La resolución de la fuente va en ``*_src_res_m``.
* **Resolución 9** (arista media ≈107 m, área ≈29.900 m²): cada celda agrupa los píxeles de
  la malla de referencia cuyo centro cae dentro (~75 de media; ~89 en esta latitud, donde
  las celdas de resolución 9 son algo mayores que la media). Estadísticas:

  ========================  =====================================================
  cota                      media (y mínimo y máximo)
  pendiente                 percentil 90 como valor de navegación (y media y máximo)
  orientación               media circular y longitud del vector resultante
  SVF                       media (y mínimo y máximo)
  horizonte                 máximo
  línea de vista            todos los píxeles con LOS; fracción con LOS; margen mínimo
  THEMIS DN                 media de los valores THEMIS muestreados en cada píxel CTX
  rugosidad                 media (y máximo)
  nivel recibido (RSSI)     mínimo (peor caso; también media); difracción: máximo
  escenario                 conservador: TIU mínima, SVF mínimo, pendiente máxima,
                            LOS mínima, H₂O máxima; con fracción de cobertura
  ========================  =====================================================

Columna efectiva = valor de escenario si la celda tiene escenario; si no, el medido o
derivado. Las columnas medidas y derivadas nunca se sobrescriben.
"""
from __future__ import annotations

import numpy as np

from .. import config
from . import geo
from .constants import PROV_DERIVED, PROV_MEASURED, PROV_NONE, PROV_SCENARIO, RES_COARSE
from .flags import hazard_bitmask
from .layers import Layer, pixel_area_m2

LOS_NOISE_M = 5.0     # |margen| < 5 m: indeterminado por el ruido del DTM (terrain_outputs.json)

# Variable de escenario -> (capa de escenario, estadística conservadora a resolución 9)
SCENARIO_VARS = {
    "slope": ("slope_deg_scenario", "max"),
    "svf": ("sky_view_factor_scenario", "min"),
    "los": ("radio_los_base_scenario", "min"),
    "tiu": ("thermal_inertia_tiu_scenario", "min"),
    "h2o": ("h2o_wt_pct_scenario", "max"),
}


def base_origin() -> tuple[float, float]:
    b = config.scenario_nodes()["BASE"]
    return b["lat_pc_deg"], b["lon_e_deg"]


# --- utilidades ---------------------------------------------------------------------
def _nan_stat(x: np.ndarray, stat: str) -> float:
    x = x[np.isfinite(x)]
    if x.size == 0:
        return np.nan
    if stat == "mean":
        return float(x.mean())
    if stat == "min":
        return float(x.min())
    if stat == "max":
        return float(x.max())
    if stat == "p90":
        return float(np.percentile(x, 90))
    raise ValueError(stat)


def circular_mean_deg(x: np.ndarray) -> tuple[float, float]:
    """Media circular (grados 0-360) y longitud del vector resultante (0-1)."""
    x = x[np.isfinite(x)]
    if x.size == 0:
        return np.nan, np.nan
    r = np.radians(x)
    s, c = np.sin(r).mean(), np.cos(r).mean()
    return float(np.degrees(np.arctan2(s, c)) % 360.0), float(np.hypot(s, c))


def _effective(scenario: np.ndarray, base: np.ndarray, base_prov: int):
    has_s = np.isfinite(scenario)
    eff = np.where(has_s, scenario, base)
    prov = np.where(has_s, PROV_SCENARIO, np.where(np.isfinite(base), base_prov, PROV_NONE))
    return eff, prov.astype(np.uint8)


def _finish(cols: dict, layers: dict[str, Layer]) -> dict:
    """Columnas comunes: procedencias, resoluciones de fuente, efectivas y banderas."""
    n = len(cols["h3_index"])

    def const(v, dtype):
        return np.full(n, v, dtype=dtype)

    cols["elev_prov"] = np.where(np.isfinite(cols["elev_m"]), PROV_MEASURED, PROV_NONE).astype(np.uint8)
    cols["elev_src_res_m"] = const(layers["elev_m"].src_res_m, np.float32)
    for v, lay in (("slope", "slope_deg"), ("aspect", "aspect_deg"), ("svf", "sky_view_factor"),
                   ("horizon", "horizon_max_deg"), ("los", "radio_los_base")):
        key = {"slope": "slope_deg_p90", "aspect": "aspect_deg", "svf": "svf_mean",
               "horizon": "horizon_max_deg", "los": "los_fraction"}[v]
        cols[f"{v}_prov"] = np.where(np.isfinite(cols[key]), PROV_DERIVED, PROV_NONE).astype(np.uint8)
        cols[f"{v}_src_res_m"] = const(layers[lay].src_res_m, np.float32)
    for v, key, lay in (("roughness", "roughness_m", "roughness_m"),
                        ("rssi", "rssi_dbm", "rssi_dbm")):
        cols[f"{v}_prov"] = np.where(np.isfinite(cols[key]), PROV_DERIVED, PROV_NONE).astype(np.uint8)
        cols[f"{v}_src_res_m"] = const(layers[lay].src_res_m, np.float32)
    for v, lay in (("themis_day", "themis_day_dn"), ("themis_night", "themis_night_dn")):
        cols[f"{v}_prov"] = np.where(np.isfinite(cols[f"{v}_dn"]), PROV_MEASURED, PROV_NONE).astype(np.uint8)
        cols[f"{v}_src_res_m"] = const(layers[lay].src_res_m, np.float32)

    # No hay inercia térmica medida (THEMIS cuantitativo no disponible: terrain_outputs.json).
    cols["tiu_measured"] = const(np.nan, np.float64)
    cols["tiu_src_res_m"] = const(layers["thermal_inertia_tiu_scenario"].src_res_m, np.float32)
    cols["h2o_measured"] = const(np.nan, np.float64)
    cols["h2o_src_res_m"] = const(layers["h2o_wt_pct_scenario"].src_res_m, np.float32)

    cols["slope_deg_effective"], cols["slope_effective_prov"] = _effective(
        cols["slope_deg_scenario"], cols["slope_deg_p90"], PROV_DERIVED)
    cols["svf_effective"], cols["svf_effective_prov"] = _effective(
        cols["svf_scenario"], cols["svf_mean"], PROV_DERIVED)
    los_base = np.where(np.isfinite(cols["los_fraction"]),
                        (cols["los_fraction"] >= 1.0).astype(np.float64), np.nan)
    cols["los_base"] = los_base
    cols["los_base_effective"], cols["los_effective_prov"] = _effective(
        cols["los_base_scenario"], los_base, PROV_DERIVED)
    cols["tiu_effective"], cols["tiu_effective_prov"] = _effective(
        cols["tiu_scenario"], cols["tiu_measured"], PROV_MEASURED)
    cols["h2o_effective"], cols["h2o_effective_prov"] = _effective(
        cols["h2o_scenario"], cols["h2o_measured"], PROV_MEASURED)
    cols["los_indeterminate"] = np.where(
        np.isfinite(cols["los_margin_min_m"]), np.abs(cols["los_margin_min_m"]) < LOS_NOISE_M,
        False)

    cols["hazard_bitmask"] = hazard_bitmask(
        slope_deg=cols["slope_deg_effective"], tiu=cols["tiu_effective"],
        svf=cols["svf_effective"], los_base=cols["los_base_effective"],
        rssi_dbm=cols["rssi_dbm"], h2o_pct=cols["h2o_effective"])
    return cols


def _geometry_cols(cells: np.ndarray, res: int) -> dict:
    lat, lon = geo.centers(cells)
    lat0, lon0 = base_origin()
    east, north = geo.local_en(lat, lon, lat0, lon0)
    return {
        "h3_index": cells.astype(np.uint64),
        "h3_res": np.full(len(cells), res, dtype=np.uint8),
        "h3_parent_res9": geo.parents(cells, RES_COARSE) if res > RES_COARSE else cells.astype(np.uint64),
        "lat_deg": lat,
        "lon_e_deg": lon,
        "lon180_deg": (lon + 180.0) % 360.0 - 180.0,
        "east_m": east,
        "north_m": north,
        "cell_area_m2": np.array([geo.mars_cell_area_m2(int(c)) for c in cells]),
    }


# --- resolución fina: muestreo del píxel que contiene el centro --------------------------
def build_fine(cells: np.ndarray, layers: dict[str, Layer], res: int) -> dict:
    """Tabla de una resolución más fina que el DTM (12): valor del píxel del centro."""
    cols = _geometry_cols(cells, res)
    lat, lon = cols["lat_deg"], cols["lon_e_deg"]
    ref = layers["elev_m"]
    row, col, inside = ref.rowcol(lat, lon)
    cols["ref_pixel_id"] = np.where(inside, row * ref.shape[1] + col, -1).astype(np.int32)
    s = {k: lay.sample(lat, lon) for k, lay in layers.items()}
    n = len(cells)
    cols["n_pixels"] = inside.astype(np.uint16)
    cols["valid_fraction"] = np.isfinite(s["elev_m"]).astype(np.float32)
    cols["coverage_fraction"] = np.full(n, np.nan, dtype=np.float32)   # no aplica: celda < píxel
    cols["elev_m"] = s["elev_m"]
    cols["elev_min_m"] = s["elev_m"]
    cols["elev_max_m"] = s["elev_m"]
    for k in ("slope_deg_mean", "slope_deg_p90", "slope_deg_max"):
        cols[k] = s["slope_deg"]
    cols["aspect_deg"] = s["aspect_deg"]
    cols["aspect_resultant"] = np.where(np.isfinite(s["aspect_deg"]), 1.0, np.nan)
    for k in ("svf_mean", "svf_min", "svf_max"):
        cols[k] = s["sky_view_factor"]
    cols["horizon_max_deg"] = s["horizon_max_deg"]
    cols["horizon_max_az_deg"] = s["horizon_max_az_deg"]
    cols["los_fraction"] = s["radio_los_base"]
    cols["los_margin_min_m"] = s["los_margin_m"]
    cols["themis_day_dn"] = s["themis_day_dn"]
    cols["themis_night_dn"] = s["themis_night_dn"]
    cols["roughness_m"] = s["roughness_m"]
    cols["roughness_m_max"] = s["roughness_m"]
    cols["rssi_dbm"] = s["rssi_dbm"]
    cols["rssi_dbm_mean"] = s["rssi_dbm"]
    cols["rssi_dbm_low"] = s["rssi_dbm_low"]
    cols["rssi_dbm_high"] = s["rssi_dbm_high"]
    cols["diffraction_db"] = s["diffraction_db"]
    cols["rssi_uhf_dbm"] = s["rssi_uhf_dbm"]
    cols["diffraction_uhf_db"] = s["diffraction_uhf_db"]
    for v, (lay, _) in SCENARIO_VARS.items():
        val = s[lay]
        cols[f"{_scen_col(v)}"] = val
        cols[f"{v}_scenario_cover_frac"] = np.isfinite(val).astype(np.float32)
    return _finish(cols, layers)


def _scen_col(v: str) -> str:
    return {"slope": "slope_deg_scenario", "svf": "svf_scenario", "los": "los_base_scenario",
            "tiu": "tiu_scenario", "h2o": "h2o_scenario"}[v]


# --- resolución gruesa: agrupación de píxeles -------------------------------------------
def build_coarse(layers: dict[str, Layer], res: int, include=None) -> dict:
    """Tabla de una resolución más gruesa que el DTM (9): agrupa los píxeles por celda.

    ``include``: celdas que deben aparecer aunque no contengan ningún centro de píxel (los
    padres de las celdas de la resolución fina); salen con ``n_pixels`` = 0 y sin dato.
    """
    ref = layers["elev_m"]
    plat, plon = ref.pixel_centers()
    plat, plon = plat.ravel(), plon.ravel()
    pcell = geo.latlon_to_cells(plat, plon, res)
    parea = pixel_area_m2(ref).ravel()
    # Valores por píxel de referencia. Las capas de otra malla (THEMIS) se muestrean en el
    # centro de cada píxel CTX: su media es la media ponderada por área de solape.
    pv = {}
    for k, lay in layers.items():
        if lay.shape == ref.shape and lay.transform.almost_equals(ref.transform, 1e-12):
            pv[k] = lay.values.ravel()
        else:
            pv[k] = lay.sample(plat, plon)

    order = np.argsort(pcell, kind="stable")
    sc = pcell[order]
    cells = np.unique(sc)
    if include is not None:
        # Padres de las celdas finas que no contienen ningún centro de píxel (solo rozan la
        # malla): se incluyen sin dato para que todo h3_parent_res9 exista en esta tabla.
        cells = np.union1d(cells, np.asarray(include, dtype=np.uint64))
    start = np.searchsorted(sc, cells, side="left")
    stop = np.searchsorted(sc, cells, side="right")
    cols = _geometry_cols(cells, res)
    n = len(cells)
    out = {k: np.full(n, np.nan) for k in (
        "elev_m", "elev_min_m", "elev_max_m", "slope_deg_mean", "slope_deg_p90",
        "slope_deg_max", "aspect_deg", "aspect_resultant", "svf_mean", "svf_min", "svf_max",
        "horizon_max_deg", "horizon_max_az_deg", "los_fraction", "los_margin_min_m",
        "themis_day_dn", "themis_night_dn", "roughness_m", "roughness_m_max", "rssi_dbm",
        "rssi_dbm_mean", "rssi_dbm_low", "rssi_dbm_high", "diffraction_db", "rssi_uhf_dbm",
        "diffraction_uhf_db")}
    for v in SCENARIO_VARS:
        out[_scen_col(v)] = np.full(n, np.nan)
        out[f"{v}_scenario_cover_frac"] = np.zeros(n, dtype=np.float32)
    n_pix = np.zeros(n, dtype=np.uint16)
    valid = np.zeros(n, dtype=np.float32)
    cover = np.zeros(n, dtype=np.float32)

    for i in range(n):
        idx = order[start[i]:stop[i]]
        n_pix[i] = idx.size
        if idx.size == 0:
            continue
        g = {k: a[idx] for k, a in pv.items()}
        ok = np.isfinite(g["elev_m"])
        valid[i] = ok.mean()
        cover[i] = parea[idx][ok].sum() / cols["cell_area_m2"][i]
        out["elev_m"][i] = _nan_stat(g["elev_m"], "mean")
        out["elev_min_m"][i] = _nan_stat(g["elev_m"], "min")
        out["elev_max_m"][i] = _nan_stat(g["elev_m"], "max")
        out["slope_deg_mean"][i] = _nan_stat(g["slope_deg"], "mean")
        out["slope_deg_p90"][i] = _nan_stat(g["slope_deg"], "p90")
        out["slope_deg_max"][i] = _nan_stat(g["slope_deg"], "max")
        out["aspect_deg"][i], out["aspect_resultant"][i] = circular_mean_deg(g["aspect_deg"])
        out["svf_mean"][i] = _nan_stat(g["sky_view_factor"], "mean")
        out["svf_min"][i] = _nan_stat(g["sky_view_factor"], "min")
        out["svf_max"][i] = _nan_stat(g["sky_view_factor"], "max")
        h = g["horizon_max_deg"]
        if np.isfinite(h).any():
            j = int(np.nanargmax(h))
            out["horizon_max_deg"][i] = h[j]
            out["horizon_max_az_deg"][i] = g["horizon_max_az_deg"][j]
        out["los_fraction"][i] = _nan_stat(g["radio_los_base"], "mean")
        out["los_margin_min_m"][i] = _nan_stat(g["los_margin_m"], "min")
        out["themis_day_dn"][i] = _nan_stat(g["themis_day_dn"], "mean")
        out["themis_night_dn"][i] = _nan_stat(g["themis_night_dn"], "mean")
        out["roughness_m"][i] = _nan_stat(g["roughness_m"], "mean")
        out["roughness_m_max"][i] = _nan_stat(g["roughness_m"], "max")
        out["rssi_dbm"][i] = _nan_stat(g["rssi_dbm"], "min")
        out["rssi_dbm_mean"][i] = _nan_stat(g["rssi_dbm"], "mean")
        out["rssi_dbm_low"][i] = _nan_stat(g["rssi_dbm_low"], "min")
        out["rssi_dbm_high"][i] = _nan_stat(g["rssi_dbm_high"], "min")
        out["diffraction_db"][i] = _nan_stat(g["diffraction_db"], "max")
        out["rssi_uhf_dbm"][i] = _nan_stat(g["rssi_uhf_dbm"], "min")
        out["diffraction_uhf_db"][i] = _nan_stat(g["diffraction_uhf_db"], "max")
        for v, (lay, stat) in SCENARIO_VARS.items():
            sv = g[lay]
            fin = np.isfinite(sv)
            out[f"{v}_scenario_cover_frac"][i] = fin.mean()
            out[_scen_col(v)][i] = _nan_stat(sv, stat)

    cols["ref_pixel_id"] = np.full(n, -1, dtype=np.int32)
    cols["n_pixels"] = n_pix
    cols["valid_fraction"] = valid
    cols["coverage_fraction"] = cover
    cols.update(out)
    return _finish(cols, layers)
