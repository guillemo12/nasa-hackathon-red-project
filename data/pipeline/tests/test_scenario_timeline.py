"""Cronología de EVA-07, Walkback Limit Dual, perfiles de dosis y exportación.

Las potencias de marcha salen del modelo con las pendientes reales del sitio reubicado y no
hay ningún parámetro ajustado al O₂. Los porcentajes de O₂ por hito son una salida propia de
el pipeline: sus tests son de **regresión** (fijan el resultado actual). El de T+28 se
comprueba además a mano, con la fórmula escrita en el test.
"""
import itertools
import json
import math

import pyarrow.parquet as pq
import pytest

from red_atlas_pipeline.scenario import constants as K
from red_atlas_pipeline.scenario import engine_results as eng
from red_atlas_pipeline.scenario import export
from red_atlas_pipeline.scenario import timeline as tl

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
                                   (114, 74.9), (115, 74.7), (165, 71.2)])
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
    ("A3_rampa_pico", 1072.9), ("A3_rampa_lenta", 585.0), ("A4_huida_L3", 547.6),
    ("A4_refugio", 130.0),
])
def test_phase_powers_regression(phase_id, watts):
    p = next(p for p in tl.phases() if p.phase_id == phase_id)
    assert p.power_w == pytest.approx(watts, abs=0.1)


def test_no_unsustainable_phase():
    """Ningún tramo seguido por encima del rojo sostenido (585 W) dura más de 5 min."""
    runs = tl.sustained_red_runs()
    assert runs == [(98, 101)]
    assert all(t1 - t0 <= K.SUSTAINED_RED_MAX_MIN for t0, t1 in runs)


def test_escape_phase_from_planner():
    """Huida T+105–114,45 a 548 W de media, leída de planner_walkback.json."""
    p = next(p for p in tl.phases() if p.phase_id == "A4_huida_L3")
    wp3 = eng.route("wp3")
    assert (p.t0, p.t1) == (105.0, wp3["arrival_t_min"])
    assert p.t1 == pytest.approx(114.45, abs=0.005)
    assert p.power_w == wp3["mean_power_w"] == pytest.approx(547.6, abs=0.05)
    assert p.power_source == "planificador_dstar"
    assert p.dose_factor == 1.0
    assert all(tl.planner_within_caps().values())


def test_escape_o2_matches_planner():
    """El O₂ del motor cuadra con potencia × tiempo / 335 (mismo modelo que la cronología)."""
    for dest in ("wp3", "base"):
        r = eng.route(dest)
        assert r["mean_power_w"] / 335 * r["time_min"] == pytest.approx(r["o2_liters"], rel=1e-4)


def test_o2_integrates_fractional_phase_boundary(rows):
    """De T+114 a T+115: la fracción de huida a 547,6 W y el resto de refugio a 130 W."""
    f = tl.escape_t1() - 114
    g = (f * eng.route("wp3")["mean_power_w"] + (1 - f) * 130) / 335 * 1.429
    assert (tl.row_at(rows, 114)["o2_remaining_g"] - tl.row_at(rows, 115)["o2_remaining_g"]
            == pytest.approx(g, abs=1e-9))


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


def test_walkback_t105_matches_engine(rows):
    """Los dos lados del Walkback en T+105 son exactamente los del planificador del motor."""
    r = tl.row_at(rows, 105)
    for dest in ("base", "wp3"):
        e = eng.route(dest)
        assert r[f"{dest}_route_m"] == pytest.approx(e["length_m"])
        assert r[f"{dest}_time_min"] == pytest.approx(e["time_min"])
        assert r[f"{dest}_dose_proj_msv"] == pytest.approx(e["dose_spe_msv"], abs=1e-9)
        assert r[f"{dest}_o2_need_g"] == pytest.approx(e["o2_liters"] * 1.429, rel=1e-4)
    assert r["base_route_m"] == pytest.approx(2148.2, abs=0.1)
    assert r["base_dose_proj_msv"] == pytest.approx(5.30, abs=0.005)
    assert r["wp3_route_m"] == pytest.approx(595.4, abs=0.1)
    assert r["wp3_dose_proj_msv"] == pytest.approx(0.89, abs=0.005)
    assert r["base_viable"] is False
    assert r["wp3_viable"] is True
    assert r["viable_destination"] == "WP3"
    assert r["wp3_margin_min"] == pytest.approx(15.0 - eng.route("wp3")["time_min"])  # 5,55: rojo


def test_legacy_6_4_is_only_a_reference():
    """6,4 mSv = 8 mSv/h × 48 min a cielo abierto: queda como referencia, no como decisión."""
    dd = export.decision_dose()
    assert dd["legacy_open_sky_48min_msv"] == pytest.approx(6.4)
    assert dd["base"]["dose_spe_msv"] < dd["legacy_open_sky_48min_msv"]
    assert dd["wp3"]["route_mean_svf"] == pytest.approx(0.705, abs=0.005)
    assert dd["base"]["route_mean_svf"] == pytest.approx(0.836, abs=0.005)


def test_engine_json_missing_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(eng, "PLANNER_JSON", tmp_path / "no_existe.json")
    eng.planner.cache_clear()
    try:
        with pytest.raises(eng.EngineResultsError, match="falta"):
            eng.planner()
    finally:
        monkeypatch.undo()
        eng.planner.cache_clear()


@pytest.mark.parametrize("mutate,match", [
    (lambda d: d["wp3"].pop("time_min"), "sin campos"),
    (lambda d: d["wp3"].__setitem__("arrival_t_min", 113.0), "arrival_t_min"),
    (lambda d: d["base"].__setitem__("length_m", 2500.0), "mean_speed_mps"),
    (lambda d: d.__setitem__("base_feasible", True), "decisión"),
])
def test_engine_json_inconsistent_fails(mutate, match):
    d = json.loads(eng.PLANNER_JSON.read_text(encoding="utf-8"))
    mutate(d)
    with pytest.raises(eng.EngineResultsError, match=match):
        eng.validate_planner(d)


def test_chaos_mode_from_engine():
    c = eng.chaos_summary()
    assert c["trials"] == 10000 and c["seed"] == 42
    assert c["safe_with_shelter_pct"] == pytest.approx(96.02)
    assert c["safe_base_only_pct"] == pytest.approx(23.84)
    bad = json.loads(eng.CHAOS_JSON.read_text(encoding="utf-8"))
    bad["report"]["survival_rate_with_shelter_pct"] = 99.4
    with pytest.raises(eng.EngineResultsError):
        eng.validate_chaos(bad)


def test_chaos_milestone_title(tmp_path):
    doc = json.loads(export.export_all(tmp_path)["events"].read_text(encoding="utf-8"))
    title = next(e["title"] for e in doc["events"] if e["id"] == "chaos_mode")
    assert "96,02 %" in title and "23,84 %" in title and "99,4" not in title
    assert doc["chaos_mode"]["trials"] == 10000
    assert doc["decision_dose_T105"]["base"]["dose_spe_msv"] == pytest.approx(5.305, abs=1e-3)


def test_base_blocked_under_every_profile():
    comp = export.profile_comparison()
    for name, c in comp.items():
        assert c["base_viable_T105"] is False, name
        assert c["wp3_viable_T105"] is True, name


def test_destination_switches_only_at_spe(rows):
    assert all(r["viable_destination"] == "BASE" for r in rows if r["t_min"] < 105)
    assert all(r["viable_destination"] == "WP3" for r in rows if r["t_min"] >= 105)


def test_arrival_dose_calibrated_ramp(rows):
    """Dosis acumulada al llegar (rampa calibrada): 0,72 mSv; con 8 min eran 0,58 (T+113)."""
    arrival = export.profile_comparison()["rampa_calibrada"]["dose_escape_msv"]
    assert arrival == pytest.approx(0.72, abs=0.005)
    assert tl.row_at(rows, 113)["dose_spe_msv"] == pytest.approx(0.578, abs=1e-3)


def test_escape_dose_other_profiles(rows):
    c = export.profile_comparison()
    m = tl.escape_t1() - 105
    assert c["envolvente"]["dose_escape_msv"] == pytest.approx(8.0 * m / 60, abs=1e-3)
    assert c["rampa_lineal"]["dose_escape_msv"] == pytest.approx(0.5 * 8.0 * m / 20 * m / 60, abs=1e-3)


def test_total_dose_below_budget_nominal(rows):
    assert rows[-1]["dose_spe_msv"] == pytest.approx(1.522, abs=1e-3)
    assert rows[-1]["dose_spe_msv"] < K.SPE_BUDGET_MSV


def test_total_dose_envelope_exceeds_budget(rows):
    """Con la envolvente constante: huida 9,4 min a 8 mSv/h + refugio 50,6 min a 1,2 mSv/h."""
    m = tl.escape_t1() - 105
    assert rows[-1]["dose_spe_env_msv"] == pytest.approx(8 * m / 60 + 1.2 * (60 - m) / 60, abs=1e-3)
    assert rows[-1]["dose_spe_env_msv"] > K.SPE_BUDGET_MSV


def test_wp3_peak_local_rate(rows):
    r = tl.row_at(rows, 125)
    assert r["spe_local_rate_msv_h"] == pytest.approx(1.2, abs=1e-9)
    assert r["class_dose_rate"] == "ROJO"


def test_radio_timeline(rows):
    assert tl.row_at(rows, 91)["radio_class"] == "VERDE"
    assert tl.row_at(rows, 92)["radio_class"] == "ROJO"
    # En WP3 (≈1,6 km de la Base) el NLOS del enlace primario en banda S da ≈ −104,1 dBm:
    # rojo por nivel y por persistencia.
    r157 = tl.row_at(rows, 157)
    assert r157["radio_rssi_dbm"] == pytest.approx(-104.1, abs=0.1)
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
    assert set(rec["A4_huida_L3"]["active_threats"]) == set(tl.THREATS)
    assert rec["A4_refugio_pico"]["spe_ext_rate_cal_t0_msv_h"] == 8.0
    assert rec["A2_marcha_L1"]["active_threats"] == []
    assert rec["A3_marcha_L2"]["threat_states"]["sombra_radio"] == "inactiva"
    assert rec["A4_huida_L3"]["threat_states"]["trampa_regolito"] == "se_desactiva"
    assert rec["A4_refugio"]["threat_states"]["trampa_regolito"] == "inactiva"


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
