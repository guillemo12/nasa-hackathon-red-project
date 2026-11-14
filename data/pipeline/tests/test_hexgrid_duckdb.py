"""Consultas DuckDB tipo Spyglass y perfiles de tramo (sin red ni extensiones)."""
from __future__ import annotations

import numpy as np
import pytest

from red_atlas_p1 import config
from red_atlas_p1.hexgrid import aggregate, duckdb_demo, geo, synthetic, tables
from red_atlas_p1.hexgrid.constants import full_table_path
from red_atlas_p1.hexgrid.export import write_parquet

N = 40


@pytest.fixture(scope="module")
def synth(tmp_path_factory):
    h2o = np.full((N, N), np.nan)
    h2o[: N // 2, :] = 12.0                  # mitad norte hidratada
    L = synthetic.layers(N, N, h2o_wt_pct_scenario=h2o)
    t = L["elev_m"].transform
    m = 2 * abs(t.e)
    aoi = {"lat_min": t.f + N * t.e + m, "lat_max": t.f - m,
           "lon_e_min": t.c + m, "lon_e_max": t.c + N * t.a - m}
    cols = aggregate.build_fine(geo.cells_in_aoi(aoi, 12), L, 12)
    full = tables.full_table(cols)
    p = tmp_path_factory.mktemp("hex") / "synth.parquet"
    write_parquet(full, p)
    return p, full


def _base_cell() -> int:
    b = config.scenario_nodes()["BASE"]
    return geo.cell_of(b["lat_pc_deg"], b["lon_e_deg"], 12)


def test_consulta_por_celda(synth):
    p, full = synth
    con = duckdb_demo.connect(p)
    h = int(full["h3_index"][100].as_py())
    row = duckdb_demo.cell(con, h)
    assert row["h3_index"] == h
    assert row["elev_m"] == full["elev_m"][100].as_py()
    assert duckdb_demo.cell(con, 1) is None


def test_spyglass_tres_sectores_coincide_con_numpy(synth):
    p, full = synth
    con = duckdb_demo.connect(p)
    center, r = _base_cell(), 80.0
    res = {s["sector"]: s for s in duckdb_demo.spyglass(con, center, r)}
    assert set(res) == set(duckdb_demo.SECTORS)
    e, n = full["east_m"].to_numpy().astype(float), full["north_m"].to_numpy().astype(float)
    i0 = int(np.where(full["h3_index"].to_numpy() == center)[0][0])
    de, dn = e - e[i0], n - n[i0]
    inside = np.hypot(de, dn) <= r
    bearing = (np.degrees(np.arctan2(de, dn)) + 360) % 360
    north = inside & ((bearing >= 300) | (bearing < 60))
    right = inside & (bearing >= 60) & (bearing < 180)
    left = inside & (bearing >= 180) & (bearing < 300)
    assert res["norte_hidratacion"]["n_celdas"] == north.sum()
    assert res["derecha_inercia_termica"]["n_celdas"] == right.sum()
    assert res["izquierda_pendiente_svf"]["n_celdas"] == left.sum()
    # ~π·80²/87 m² ≈ 230 celdas: el radio está en metros de Marte, no de la Tierra.
    assert 150 < inside.sum() < 320
    assert res["norte_hidratacion"]["h2o_max_pct"] == 12.0
    assert res["norte_hidratacion"]["banderas"] & 0x10
    assert res["izquierda_pendiente_svf"]["svf_min"] == pytest.approx(0.8)


def test_spyglass_anillo_h3(synth):
    p, _ = synth
    con = duckdb_demo.connect(p)
    r = duckdb_demo.spyglass_kring(con, _base_cell(), 5)
    assert r["n_celdas"] == 1 + 3 * 5 * 6          # 91 celdas en un anillo k = 5
    assert r["pendiente_max_deg"] == pytest.approx(5.0)


def test_medicion_de_tiempos(synth):
    p, _ = synth
    con = duckdb_demo.connect(p)
    t = duckdb_demo._timeit(lambda: duckdb_demo.spyglass(con, _base_cell(), 50.0), 5)
    assert t["n"] == 5 and 0 < t["mediana_ms"] <= t["p95_ms"] <= t["max_ms"]


@pytest.mark.skipif(not full_table_path(12).exists(), reason="Parquet de res 12 no generado")
@pytest.mark.parametrize("leg", ["L1", "L2", "L3", "L4", "R1"])
def test_perfil_de_tramo_real(leg):
    con = duckdb_demo.connect(full_table_path(12))
    p = duckdb_demo.leg_profile(con, leg)
    lg = config.scenario_legs()[leg]
    assert p["celdas_sin_dato"] == 0
    assert np.all(np.diff(p["dist_m"]) > 0)
    edge = geo.mars_edge_length_m(12)
    assert p["longitud_recta_m"] == pytest.approx(lg["distance_m"], abs=2.5 * edge)
    assert p["desnivel_m"] == pytest.approx(lg["delta_elev_m"], abs=3.0)
    assert p["pendiente_max_deg"] == pytest.approx(lg["slope_max_deg"], abs=0.2)


def test_spyglass_por_celda_con_forma_de_p3(synth):
    p, _ = synth
    con = duckdb_demo.connect(p)
    agg = {s["sector"]: s for s in duckdb_demo.spyglass(con, _base_cell(), 60.0)}
    cells = duckdb_demo.spyglass_cells(con, _base_cell(), 60.0)
    assert cells["center_h3"] == _base_cell()
    assert len(cells["crism_water_cells"]) == agg["norte_hidratacion"]["n_celdas"]
    assert len(cells["themis_trap_cells"]) == agg["derecha_inercia_termica"]["n_celdas"]
    assert len(cells["mola_slope_svf_cells"]) == agg["izquierda_pendiente_svf"]["n_celdas"]
    _h, slope, svf, los = cells["mola_slope_svf_cells"][0]
    assert slope == pytest.approx(5.0) and svf == pytest.approx(0.8) and los == 1.0
    assert all(v == 12.0 for _, v in cells["crism_water_cells"] if v is not None)
