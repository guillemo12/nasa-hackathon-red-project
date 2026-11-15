"""Banderas de peligro en los casos límite de los umbrales (sin red)."""
from __future__ import annotations

import re

import numpy as np
import pytest

from red_atlas_p1.hexgrid import constants as C
from red_atlas_p1.hexgrid.flags import hazard_bitmask

NAN = np.nan


def _one(**kw) -> int:
    base = {"slope_deg": NAN, "tiu": NAN, "svf": NAN, "los_base": NAN, "rssi_dbm": NAN, "h2o_pct": NAN}
    base.update(kw)
    return int(hazard_bitmask(**{k: np.array([v]) for k, v in base.items()})[0])


def test_umbrales_leidos_de_eva_thresholds():
    th = C.flag_thresholds()
    assert th["slope_red_gt_deg"] == np.float32(20.0)
    assert th["tiu_red_lt"] == np.float32(150.0)
    assert th["rssi_red_lt_dbm"] == np.float32(-100.0)
    assert th["svf_shelter_le"] == np.float32(0.20)
    assert th["h2o_isru_ge_pct"] == np.float32(12.0)
    assert all(isinstance(v, np.float32) for v in th.values())


def test_todo_nulo_no_activa_nada():
    assert _one() == 0


@pytest.mark.parametrize("slope,flag", [(20.0, 0), (np.nextafter(np.float32(20), np.float32(30)), 1),
                                        (19.99, 0), (20.01, 1), (35.0, 1)])
def test_pendiente_critica_estricta(slope, flag):
    assert _one(slope_deg=slope) == flag * C.HAZARD_FLAG_SLOPE_CRITICAL


@pytest.mark.parametrize("tiu,flag", [(150.0, 0), (149.99, 1), (110.0, 1), (400.0, 0), (0.0, 1)])
def test_trampa_de_regolito_estricta(tiu, flag):
    assert _one(tiu=tiu) == flag * C.HAZARD_FLAG_REGOLITH_TRAP


@pytest.mark.parametrize("svf,flag", [(0.20, 1), (np.float32(0.2), 1), (0.15, 1),
                                      (0.2001, 0), (0.8, 0)])
def test_refugio_incluye_el_limite_en_float32(svf, flag):
    # 0,2 en float32 es 0,200000003: comparado con 0,2 en float64 daría falso.
    assert _one(svf=svf) == flag * C.HAZARD_FLAG_SHELTER


@pytest.mark.parametrize("los,rssi,flag", [(0.0, NAN, 1), (1.0, NAN, 0), (NAN, NAN, 0),
                                           (1.0, -100.0, 0), (1.0, -100.01, 1), (NAN, -120.0, 1)])
def test_nlos_por_geometria_o_rssi(los, rssi, flag):
    assert _one(los_base=los, rssi_dbm=rssi) == flag * C.HAZARD_FLAG_NLOS


@pytest.mark.parametrize("h2o,flag", [(12.0, 1), (11.99, 0), (14.2, 1), (NAN, 0)])
def test_isru_incluye_el_limite(h2o, flag):
    assert _one(h2o_pct=h2o) == flag * C.HAZARD_FLAG_ISRU_WATER


def test_combinacion_wp2_y_wp3():
    assert _one(slope_deg=19.4, tiu=110, svf=0.84, los_base=0) == 0x02 | 0x08
    assert _one(slope_deg=22.0, tiu=620, svf=0.15, los_base=0) == 0x01 | 0x04 | 0x08


@pytest.mark.skipif(not C.LIB_RS.exists(), reason="no está src/shared/src/lib.rs")
def test_constantes_coinciden_con_lib_rs():
    src = C.LIB_RS.read_text(encoding="utf-8")

    def const(name):
        m = re.search(rf"pub const {name}: \w+ = ([^;]+);", src)
        assert m, name
        return m.group(1).strip()

    th = C.flag_thresholds()
    assert np.float32(float(const("CRITICAL_SLOPE_DEG"))) == th["slope_red_gt_deg"]
    assert np.float32(float(const("LOW_TIU_TRAP_THRESHOLD"))) == th["tiu_red_lt"]
    assert np.float32(float(const("NLOS_RSSI_THRESHOLD_DBM"))) == th["rssi_red_lt_dbm"]
    assert np.float32(float(const("SHELTER_SVF_MAX"))) == th["svf_shelter_le"]
    assert np.float32(float(const("ISRU_WATER_MIN_PCT"))) == th["h2o_isru_ge_pct"]
    for name in ("SLOPE_CRITICAL", "REGOLITH_TRAP", "SHELTER", "NLOS", "ISRU_WATER"):
        m = re.search(rf"pub const HAZARD_FLAG_{name}: u16\s*= 1 << (\d+);", src)
        assert m, name
        assert getattr(C, f"HAZARD_FLAG_{name}") == 1 << int(m.group(1))
