"""Cronología de EVA-07, Walkback Limit Dual, perfiles de dosis y exportación.

Las potencias de marcha salen del modelo con las pendientes reales del sitio reubicado y no
hay ningún parámetro ajustado al O₂. Los porcentajes de O₂ por hito son una salida propia de
la Persona 1: sus tests son de **regresión** (fijan el resultado actual). El de T+28 se
comprueba además a mano, con la fórmula escrita en el test.
"""
import itertools
import json
import math

import pyarrow.parquet as pq
import pytest

from red_atlas_p1.scenario import constants as K
from red_atlas_p1.scenario import export
from red_atlas_p1.scenario import timeline as tl

O2_TOL_PCT = 0.1      # el canónico da el O₂ con un decimal
DOSE_TOL_MSV = 0.05


@pytest.fixture(scope="module")
def rows():
    return tl.integrate()


def test_series_covers_t_minus_45_to_165(rows):
    assert len(rows) == 211
    assert rows[0]["t_min"] == -45 and rows[-1]["t_min"] == 165
    assert [r["t_min"] for r in rows] == list(range(-45, 166))


def test_phases_are_contiguous():
    ph = tl.phases()
    assert ph[0].t0 == K.T_START and ph[-1].t1 == K.T_END
    for a, b in itertools.pairwise(ph):
        assert a.t1 == b.t0


@pytest.mark.parametrize("t,pct", [(28, 93.3), (75, 87.1), (98, 80.5), (105, 77.5),
                                   (114, 75.3), (165, 71.8)])
def test_o2_checkpoints_regression(rows, t, pct):
    assert tl.row_at(rows, t)["o2_remaining_pct"] == pytest.approx(pct, abs=O2_TOL_PCT)


def test_o2_t28_by_hand(rows):
    """L1: 1.500 m en 28 min, +78 m, η 1,3 (TIU media 365)."""
    w = 170 * 3.72076
    v = 1500 / (28 * 60)
    power = 120 + 1.3 * 0.285 * w * v + w * v * (78 / math.hypot(1500, 78)) / 0.25
    assert power == pytest.approx(446.6, abs=0.1)
    used = power / 335 * 1.429 * 28
    assert tl.row_at(rows, 28)["o2_remaining_pct"] == pytest.approx(
        100 * (800 - used) / 800, abs=1e-3)


@pytest.mark.parametrize("phase_id,watts", [
    ("A2_marcha_L1", 446.6), ("A2_isru_wp1", 250.0), ("A3_marcha_L2", 539.1),
    ("A3_rampa_pico", 1072.9), ("A3_rampa_lenta", 585.0), ("A4_dgs_salida", 593.2),
    ("A4_escape_L3", 412.9), ("A4_entrada_cornisa", 644.9), ("A4_refugio", 130.0),
])
def test_phase_powers_regression(phase_id, watts):
    p = next(p for p in tl.phases() if p.phase_id == phase_id)
    assert p.power_w == pytest.approx(watts, abs=0.1)


def test_no_unsustainable_phase():
    """Ningún tramo seguido por encima del rojo sostenido (585 W) dura más de 5 min."""
    runs = tl.sustained_red_runs()
    assert runs == [(98, 101), (105, 106), (113, 114)]
    assert all(t1 - t0 <= K.SUSTAINED_RED_MAX_MIN for t0, t1 in runs)


def test_leg_eta_rule():
    assert (tl.leg_eta("L1"), tl.leg_eta("L2"), tl.leg_eta("L3")) == (1.3, 1.3, 1.3)


def test_o2_full_before_departure(rows):
    assert tl.row_at(rows, 0)["o2_remaining_pct"] == 100.0


def test_o2_monotonic(rows):
    o2 = [r["o2_remaining_g"] for r in rows]
    assert all(b <= a for a, b in itertools.pairwise(o2))


def test_four_threats_at_t105(rows):
    r = tl.row_at(rows, 105)
    assert r["n_threats"] == 4
    assert tl.row_at(rows, 104)["n_threats"] == 2
    assert tl.row_at(rows, 91)["n_threats"] == 0


def test_walkback_t105_base_blocked_wp3_viable(rows):
    r = tl.row_at(rows, 105)
    assert r["base_route_m"] == pytest.approx(2500.0)
    assert r["base_time_min"] == pytest.approx(48.0)
    assert r["base_dose_proj_env_msv"] == pytest.approx(6.4, abs=1e-6)
    assert r["wp3_route_m"] == pytest.approx(600.0)
    assert r["wp3_time_min"] == pytest.approx(8.0)
    assert r["base_viable"] is False
    assert r["wp3_viable"] is True
    assert r["viable_destination"] == "WP3"
    assert r["base_margin_min"] == pytest.approx(15.0 - 48.0)
    assert r["wp3_margin_min"] == pytest.approx(15.0 - 8.0)   # 7 min: rojo por umbral


def test_base_blocked_under_every_profile():
    comp = export.profile_comparison()
    for name, c in comp.items():
        assert c["base_viable_T105"] is False, name
        assert c["wp3_viable_T105"] is True, name


def test_destination_switches_only_at_spe(rows):
    assert all(r["viable_destination"] == "BASE" for r in rows if r["t_min"] < 105)
    assert all(r["viable_destination"] == "WP3" for r in rows if r["t_min"] >= 105)


def test_escape_dose_calibrated_ramp_0_6(rows):
    assert tl.row_at(rows, 113)["dose_spe_msv"] == pytest.approx(0.6, abs=DOSE_TOL_MSV)
    assert tl.row_at(rows, 114)["dose_spe_msv"] == pytest.approx(0.6, abs=DOSE_TOL_MSV)


def test_escape_dose_other_profiles_do_not_give_0_6(rows):
    r = tl.row_at(rows, 113)
    assert r["dose_spe_env_msv"] == pytest.approx(8.0 * 8 / 60, abs=1e-3)      # 1,07
    assert r["dose_spe_linear_msv"] == pytest.approx(0.5 * 3.2 * 8 / 60, abs=1e-3)  # 0,21


def test_total_dose_below_budget_nominal(rows):
    assert rows[-1]["dose_spe_msv"] < K.SPE_BUDGET_MSV
    assert rows[-1]["dose_spe_msv"] <= 1.6


def test_total_dose_envelope_exceeds_budget(rows):
    """Con la envolvente constante el total (escape 1,07 + refugio 52 min × 1,2) supera la
    regla: el «≤ 1,6 mSv» del entregable mezcla la rampa (0,6) y la envolvente (1,0)."""
    assert rows[-1]["dose_spe_env_msv"] == pytest.approx(8 * 8 / 60 + 1.2 * 52 / 60, abs=1e-3)
    assert rows[-1]["dose_spe_env_msv"] > K.SPE_BUDGET_MSV


def test_wp3_peak_local_rate(rows):
    r = tl.row_at(rows, 125)
    assert r["spe_local_rate_msv_h"] == pytest.approx(1.2, abs=1e-9)
    assert r["class_dose_rate"] == "ROJO"


def test_radio_timeline(rows):
    assert tl.row_at(rows, 91)["radio_class"] == "VERDE"
    assert tl.row_at(rows, 92)["radio_class"] == "ROJO"
    # En WP3 (≈1,6 km de la Base) el NLOS da ≈ −99,3 dBm: ámbar por nivel, rojo por persistencia.
    r157 = tl.row_at(rows, 157)
    assert r157["radio_rssi_dbm"] == pytest.approx(-99.3, abs=0.1)
    assert r157["radio_nlos_s"] > 60 and r157["radio_class"] == "ROJO"
    assert tl.row_at(rows, 158)["radio_los"] is True


def test_gcr_background(rows):
    assert rows[-1]["dose_gcr_msv"] == pytest.approx(0.027 * 165 / 60, abs=1e-6)


def test_export_files(tmp_path, rows):
    paths = export.export_all(tmp_path)
    table = pq.read_table(paths["parquet"])
    assert table.num_rows == 211
    assert set(rows[0]) == set(table.column_names)
    assert table.schema.metadata[b"nominal_dose_profile"] == b"rampa_calibrada"
    text = paths["events"].read_text(encoding="utf-8")
    doc = json.loads(text, parse_constant=lambda c: pytest.fail(f"constante no JSON: {c}"))
    ids = [e["id"] for e in doc["events"]]
    assert "dynamic_goal_switching" in ids and "telemetria_final" in ids
    dgs = next(e for e in doc["events"] if e["id"] == "dynamic_goal_switching")
    assert len(dgs["active_threats"]) == 4
    assert dgs["values"]["viable_destination"] == "WP3"


def test_schema_documents_every_column(tmp_path):
    paths = export.export_all(tmp_path)
    md = paths["schema"].read_text(encoding="utf-8")
    table = pq.read_table(paths["parquet"])
    for f in table.schema:
        assert f"| `{f.name}` | {f.type} |" in md, f.name
    assert "<<" not in md
    for p in tl.phases():
        assert f"`{p.phase_id}`" in md


def test_phase_records_carry_threats_and_rates():
    rec = {p.phase_id: export.phase_record(p) for p in tl.phases()}
    assert set(rec["A4_dgs_salida"]["active_threats"]) == set(tl.THREATS)
    assert rec["A4_refugio_pico"]["spe_ext_rate_cal_t0_msv_h"] == 8.0
    assert rec["A2_marcha_L1"]["active_threats"] == []
    assert rec["A3_marcha_L2"]["threat_states"]["sombra_radio"] == "inactiva"
    assert rec["A4_escape_L3"]["threat_states"]["trampa_regolito"] == "inactiva"


def test_export_deterministic(tmp_path):
    a = export.export_all(tmp_path / "a")
    b = export.export_all(tmp_path / "b")
    assert a["events"].read_bytes() == b["events"].read_bytes()
    assert a["schema"].read_bytes() == b["schema"].read_bytes()
    assert pq.read_table(a["parquet"]).equals(pq.read_table(b["parquet"]))


def test_no_nan_in_series(rows):
    for r in rows:
        for k, v in r.items():
            if isinstance(v, float):
                assert math.isfinite(v), (r["t_min"], k)
