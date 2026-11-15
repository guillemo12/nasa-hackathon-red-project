"""Banderas de peligro de ``HexCellState64B`` a partir de los umbrales canónicos.

Las comparaciones se hacen en ``float32`` por los dos lados, igual que el motor en Rust
(``h3_mars_grid.rs``): con ``float64`` en un lado, 0,20 en ``float32`` (0,200000003) no
cumpliría ``<= 0.2``. Un valor nulo (NaN) nunca activa una bandera.

=========================  ==============================  ==================================
Bandera                    Condición                       Fuente del umbral
=========================  ==============================  ==================================
SLOPE_CRITICAL (0x01)      pendiente efectiva > 20°        eva_thresholds.json slope_deg.red
REGOLITH_TRAP (0x02)       TIU efectiva < 150              thermal_inertia_tiu.red
SHELTER (0x04)             SVF efectivo <= 0,20            shelter_sky_view_factor.green
NLOS (0x08)                sin LOS geométrica con la Base, radio_rssi_dbm.red (<−100 dBm)
                           o RSSI < −100 dBm               + LOS geométrica (terrain)
ISRU_WATER (0x10)          H₂O efectiva >= 12 %            isru_h2o_wt_pct.green
=========================  ==============================  ==================================
"""
from __future__ import annotations

import numpy as np

from .constants import (
    HAZARD_FLAG_ISRU_WATER,
    HAZARD_FLAG_NLOS,
    HAZARD_FLAG_REGOLITH_TRAP,
    HAZARD_FLAG_SHELTER,
    HAZARD_FLAG_SLOPE_CRITICAL,
    flag_thresholds,
)


def _f32(x) -> np.ndarray:
    return np.asarray(x, dtype=np.float64).astype(np.float32)


def hazard_bitmask(*, slope_deg, tiu, svf, los_base, rssi_dbm, h2o_pct) -> np.ndarray:
    th = flag_thresholds()
    slope, tiu, svf = _f32(slope_deg), _f32(tiu), _f32(svf)
    los, rssi, h2o = _f32(los_base), _f32(rssi_dbm), _f32(h2o_pct)
    with np.errstate(invalid="ignore"):
        m = np.zeros(slope.shape, dtype=np.uint16)
        m |= np.where(slope > th["slope_red_gt_deg"], HAZARD_FLAG_SLOPE_CRITICAL, 0).astype(np.uint16)
        m |= np.where(tiu < th["tiu_red_lt"], HAZARD_FLAG_REGOLITH_TRAP, 0).astype(np.uint16)
        m |= np.where(svf <= th["svf_shelter_le"], HAZARD_FLAG_SHELTER, 0).astype(np.uint16)
        nlos = (los == np.float32(0.0)) | (rssi < th["rssi_red_lt_dbm"])
        m |= np.where(nlos, HAZARD_FLAG_NLOS, 0).astype(np.uint16)
        m |= np.where(h2o >= th["h2o_isru_ge_pct"], HAZARD_FLAG_ISRU_WATER, 0).astype(np.uint16)
    return m
