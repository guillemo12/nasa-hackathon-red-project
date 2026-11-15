"""Intérprete de ``eva_thresholds.json`` y clasificador Verde / Ámbar / Rojo."""
import math

import pytest

from red_atlas_pipeline import config
from red_atlas_pipeline.scenario import thresholds as thr
from red_atlas_pipeline.scenario.thresholds import AMBER, GREEN, RED


def test_all_thresholds_parse():
    specs = thr.load_specs()
    ids = {t["id"] for t in config.load_thresholds()["thresholds"]}
    assert set(specs) == ids


def test_parse_negative_range_with_a():
    r = thr.parse_range("-85 a -100")
    assert (r.interval.lo, r.interval.hi) == (-100.0, -85.0)
    assert r.interval.lo_closed and r.interval.hi_closed


def test_parse_sustained_peak():
    r = thr.parse_range(">585 sostenido; pico 1072")
    assert r.sustained and r.peak == 1072.0 and r.interval.lo == 585.0


def test_parse_extra_condition():
    r = thr.parse_range("<-100 o NLOS >60 s")
    assert r.interval.hi == -100.0
    assert r.extras[0].kwarg == "nlos_s" and r.extras[0].value == 60.0


def test_parse_rejects_garbage():
    with pytest.raises(ValueError):
        thr.parse_range("mucho")


@pytest.mark.parametrize("tid,value,expected", [
    ("slope_deg", 9.9, GREEN), ("slope_deg", 10.0, AMBER), ("slope_deg", 20.0, AMBER),
    ("slope_deg", 22.0, RED),
    ("metabolic_rate_w", 300.0, GREEN), ("metabolic_rate_w", 450.0, AMBER),
    ("metabolic_rate_w", 592.0, RED), ("metabolic_rate_w", 1072.9, RED),
    ("o2_consumption_l_min", 0.90, GREEN), ("o2_consumption_l_min", 3.2, RED),
    ("thermal_inertia_tiu", 620, GREEN), ("thermal_inertia_tiu", 400, AMBER),
    ("thermal_inertia_tiu", 150, AMBER), ("thermal_inertia_tiu", 110, RED),
    ("dust_tau_880nm", 0.7, GREEN), ("dust_tau_880nm", 2.4, RED),
    ("dose_rate_msv_h", 0.027, GREEN), ("dose_rate_msv_h", 1.0, AMBER),
    ("dose_rate_msv_h", 1.2, RED), ("dose_rate_msv_h", 8.0, RED),
    ("eva_spe_dose_budget_msv", 0.6, AMBER), ("eva_spe_dose_budget_msv", 2.0, AMBER),
    ("eva_spe_dose_budget_msv", 6.4, RED),
    ("radio_rssi_dbm", -63.2, GREEN), ("radio_rssi_dbm", -85.0, AMBER),
    ("radio_rssi_dbm", -100.0, AMBER), ("radio_rssi_dbm", -103.2, RED),
    ("o2_primary_pct", 75.0, GREEN), ("o2_primary_pct", 50.0, AMBER),
    ("walkback_margin_min", 7.0, RED), ("walkback_margin_min", 10.0, AMBER),
    ("suit_pressure_kpa", 29.6, GREEN), ("suit_pressure_kpa", 23.9, RED),
])
def test_classify(tid, value, expected):
    assert thr.classify(tid, value) == expected


def test_nlos_persistence_turns_red():
    assert thr.classify("radio_rssi_dbm", -90.0) == AMBER
    assert thr.classify("radio_rssi_dbm", -90.0, nlos_s=60.0) == AMBER
    assert thr.classify("radio_rssi_dbm", -90.0, nlos_s=61.0) == RED


def test_transient_peak_is_amber_unless_above_peak():
    assert thr.classify("metabolic_rate_w", 1072.9, sustained=False) == AMBER   # truncado 1.072
    assert thr.classify("o2_consumption_l_min", 3.203, sustained=False) == AMBER
    assert thr.classify("metabolic_rate_w", 1200.0, sustained=False) == RED


def test_eta_gaps_resolve_to_worse_neighbour():
    assert thr.classify("terrain_factor_eta", 1.0) == GREEN
    assert thr.classify("terrain_factor_eta", 1.15) == AMBER
    assert thr.classify("terrain_factor_eta", 1.3) == AMBER
    assert thr.classify("terrain_factor_eta", 1.8) == RED
    assert thr.classify("terrain_factor_eta", 2.1) == RED
    assert thr.classify("terrain_factor_eta", 0.9) == GREEN


def test_pressure_band_edges():
    assert thr.classify("suit_pressure_kpa", 28.0) == AMBER     # en dos clases → la peor
    assert thr.classify("suit_pressure_kpa", 30.5) == GREEN
    assert thr.classify("suit_pressure_kpa", 31.0) == AMBER     # sin clase en el JSON


def test_numeric_table_schema():
    rows = {r["threshold_id"]: r for r in thr.numeric_table()}
    assert rows["slope_deg"]["sense"] == "creciente"
    assert rows["slope_deg"]["green_limit"] == 10.0 and rows["slope_deg"]["red_limit"] == 20.0
    assert rows["thermal_inertia_tiu"]["sense"] == "decreciente"
    assert rows["suit_pressure_kpa"]["sense"] == "banda"
    assert rows["suit_pressure_kpa"]["green_upper_limit"] == 30.5
    assert rows["metabolic_rate_w"]["peak_value"] == 1072.0
    assert rows["radio_rssi_dbm"]["persistence_s"] == 60
    assert rows["radio_rssi_dbm"]["red_limit"] == -100.0
    for r in rows.values():
        assert math.isfinite(r["green_limit"]) and math.isfinite(r["red_limit"])
