"""Capas sintéticas con resultado conocido, para los tests (sin red ni COG reales).

La malla imita la de referencia (píxel de 0,000338° ≈ 20 m) y se centra en la Base del
escenario, de modo que las coordenadas locales y los nodos son los de verdad.
"""
from __future__ import annotations

import numpy as np
from affine import Affine

from .. import config
from .constants import PROV_DERIVED, PROV_MEASURED, PROV_SCENARIO
from .layers import Layer

PIXEL_DEG = 0.0003381091347308497


def grid_transform(n_rows: int, n_cols: int, center=None, pixel_deg: float = PIXEL_DEG) -> Affine:
    if center is None:
        b = config.scenario_nodes()["BASE"]
        center = (b["lat_pc_deg"], b["lon_e_deg"])
    lat0, lon0 = center
    return Affine(pixel_deg, 0.0, lon0 - n_cols / 2 * pixel_deg,
                  0.0, -pixel_deg, lat0 + n_rows / 2 * pixel_deg)


def layers(n_rows: int = 40, n_cols: int = 40, center=None, **overrides) -> dict[str, Layer]:
    """Capas con valores sencillos sobre una malla común.

    * ``elev_m`` = identificador del píxel (fila·n_cols + columna): permite comprobar qué
      píxel alimenta cada celda.
    * ``slope_deg`` = 5°, ``aspect_deg`` = 90°, ``sky_view_factor`` = 0,8, LOS = 1 con margen
      de 10 m, horizonte de 15° a 120°, THEMIS = 100 (en otra malla de 100 m), rugosidad
      0,5 m y RSSI −70 dBm (−72 a −68).
    * Escenario vacío (NaN) salvo lo que se pase en ``overrides`` como matriz.
    """
    t = grid_transform(n_rows, n_cols, center)
    shape = (n_rows, n_cols)
    ident = np.arange(n_rows * n_cols, dtype=np.float64).reshape(shape)

    def lay(name, values, prov, res=20.041):
        return Layer(name, np.array(values, dtype=np.float64), t, res, prov, "sintético")

    full = lambda v: np.full(shape, v, dtype=np.float64)
    L = {
        "elev_m": lay("elev_m", ident, PROV_MEASURED),
        "slope_deg": lay("slope_deg", full(5.0), PROV_DERIVED),
        "aspect_deg": lay("aspect_deg", full(90.0), PROV_DERIVED),
        "horizon_max_deg": lay("horizon_max_deg", full(15.0), PROV_DERIVED),
        "horizon_max_az_deg": lay("horizon_max_az_deg", full(120.0), PROV_DERIVED),
        "sky_view_factor": lay("sky_view_factor", full(0.8), PROV_DERIVED),
        "radio_los_base": lay("radio_los_base", full(1.0), PROV_DERIVED),
        "los_margin_m": lay("los_margin_m", full(10.0), PROV_DERIVED),
        "slope_deg_scenario": lay("slope_deg_scenario", full(np.nan), PROV_SCENARIO),
        "sky_view_factor_scenario": lay("sky_view_factor_scenario", full(np.nan), PROV_SCENARIO),
        "radio_los_base_scenario": lay("radio_los_base_scenario", full(np.nan), PROV_SCENARIO),
        "thermal_inertia_tiu_scenario": lay("thermal_inertia_tiu_scenario", full(np.nan),
                                            PROV_SCENARIO),
        "h2o_wt_pct_scenario": lay("h2o_wt_pct_scenario", full(np.nan), PROV_SCENARIO),
        "roughness_m": lay("roughness_m", full(0.5), PROV_DERIVED),
        "rssi_dbm": lay("rssi_dbm", full(-70.0), PROV_DERIVED),
        "rssi_dbm_low": lay("rssi_dbm_low", full(-72.0), PROV_DERIVED),
        "rssi_dbm_high": lay("rssi_dbm_high", full(-68.0), PROV_DERIVED),
        "diffraction_db": lay("diffraction_db", full(0.0), PROV_DERIVED),
        "rssi_uhf_dbm": lay("rssi_uhf_dbm", full(-55.0), PROV_DERIVED),
        "diffraction_uhf_db": lay("diffraction_uhf_db", full(0.0), PROV_DERIVED),
    }
    for k, v in overrides.items():
        L[k].values = np.array(v, dtype=np.float64)
    # THEMIS en una malla propia de ~100 m que cubre la anterior.
    tt = Affine(5 * PIXEL_DEG, 0.0, t.c - 5 * PIXEL_DEG, 0.0, -5 * PIXEL_DEG, t.f + 5 * PIXEL_DEG)
    nt = (n_rows // 5 + 3, n_cols // 5 + 3)
    for name in ("themis_day_dn", "themis_night_dn"):
        L[name] = Layer(name, np.full(nt, 100.0), tt, 100.0, PROV_MEASURED, "sintético")
    return L
