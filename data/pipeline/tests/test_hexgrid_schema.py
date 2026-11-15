"""Esquema Parquet idéntico al contrato HexCellState64B y tabla completa documentada."""
from __future__ import annotations

import re

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from red_atlas_pipeline.hexgrid import aggregate, geo, synthetic, tables
from red_atlas_pipeline.hexgrid.constants import LIB_RS, contract_table_path, full_table_path
from red_atlas_pipeline.hexgrid.export import write_parquet

RUST_SIZE = {"u64": 8, "u32": 4, "u16": 2, "f32": 4}


def _rust_fields() -> list[tuple[str, str]]:
    src = LIB_RS.read_text(encoding="utf-8")
    body = re.search(r"pub struct HexCellState64B \{(.*?)\n\}", src, re.DOTALL).group(1)
    return [(m.group(1), m.group(2).strip()) for m in
            re.finditer(r"pub (\w+): ([^,]+),", body)]


@pytest.fixture(scope="module")
def synth_full() -> pa.Table:
    L = synthetic.layers(30, 30)
    t, (r, c) = L["elev_m"].transform, L["elev_m"].shape
    m = 2 * abs(t.e)
    aoi = {"lat_min": t.f + r * t.e + m, "lat_max": t.f - m,
           "lon_e_min": t.c + m, "lon_e_max": t.c + c * t.a - m}
    cols = aggregate.build_fine(geo.cells_in_aoi(aoi, 12), L, 12)
    return tables.full_table(cols)


def test_contrato_de_64_bytes():
    off = 0
    for name, rust, arrow, *_ in tables.CONTRACT_FIELDS:
        assert tables.RUST_TO_ARROW[rust] == arrow, name
        off += 14 if rust == "[u8; 14]" else RUST_SIZE[rust]
    assert off == 64


@pytest.mark.skipif(not LIB_RS.exists(), reason="no está src/shared/src/lib.rs")
def test_campos_tipos_y_orden_iguales_a_lib_rs():
    rust = _rust_fields()
    ours = [(n, r) for n, r, *_ in tables.CONTRACT_FIELDS]
    assert ours == rust
    assert [f.name for f in tables.CONTRACT_SCHEMA] == [n for n, _ in rust]
    for f, (_, r) in zip(tables.CONTRACT_SCHEMA, rust):
        assert f.type == tables.RUST_TO_ARROW[r]


def test_tabla_de_contrato_desde_sintetico(synth_full, tmp_path):
    ct = tables.contract_table(synth_full)
    assert ct.schema.equals(tables.CONTRACT_SCHEMA)
    p = tmp_path / "c.parquet"
    write_parquet(ct, p)
    back = pq.read_table(p)
    assert back.schema.remove_metadata().equals(tables.CONTRACT_SCHEMA)
    # Rugosidad y RSSI derivados; TIU sin zona de escenario y coste metabólico -> nulo, no 0.
    assert set(back["roughness_hi"].to_pylist()) == {0.5}
    assert set(back["los_base_rssi_dbm"].to_pylist()) == {-70.0}
    assert back["base_metabolic_cost"].null_count == back.num_rows
    assert back["thermal_inertia_tiu"].null_count == back.num_rows
    assert set(back["horizon_hash_id"].to_pylist()) == {0}
    assert set(back["padding_crc"].to_pylist()) == {bytes(14)}
    assert np.array_equal(back["h3_index"].to_numpy(), synth_full["h3_index"].to_numpy())


def test_tabla_completa_tiene_procedencia_y_resolucion_por_atributo(synth_full):
    assert synth_full.schema.equals(tables.FULL_SCHEMA)
    names = set(synth_full.column_names)
    for v in ("elev", "slope", "aspect", "svf", "horizon", "los", "tiu", "h2o",
              "themis_day", "themis_night"):
        assert f"{v}_src_res_m" in names, v
    for v in ("slope", "svf", "los", "tiu", "h2o"):
        assert f"{v}_effective_prov" in names and f"{v}_scenario_cover_frac" in names
    h = synth_full["h3_index"].to_numpy()
    assert np.all(np.diff(h.astype(np.uint64)) > 0)          # ordenada y sin duplicados
    for c in tables.FULL_COLUMNS:
        if not c.nullable:
            assert synth_full[c.name].null_count == 0, c.name


@pytest.mark.parametrize("res", [12, 9])
def test_parquet_generado_cumple_el_esquema(res):
    fp, cp = full_table_path(res), contract_table_path(res)
    if not (fp.exists() and cp.exists()):
        pytest.skip("Parquet no generado: uv run python -m red_atlas_pipeline.hexgrid")
    assert pq.read_schema(cp).remove_metadata().equals(tables.CONTRACT_SCHEMA)
    assert pq.read_schema(fp).remove_metadata().equals(tables.FULL_SCHEMA)
    assert pq.read_metadata(cp).num_rows == pq.read_metadata(fp).num_rows
    assert b"red_atlas" in pq.read_schema(cp).metadata


def test_parquet_generado_padres_res12_en_res9():
    fp12, fp9 = full_table_path(12), full_table_path(9)
    if not (fp12.exists() and fp9.exists()):
        pytest.skip("Parquet no generado")
    import duckdb
    n = duckdb.sql(
        f"SELECT count(*) FROM read_parquet('{fp12.as_posix()}') a ANTI JOIN "
        f"read_parquet('{fp9.as_posix()}') b ON a.h3_parent_res9 = b.h3_index").fetchall()[0][0]
    assert n == 0


def test_corredor_alrededor_de_los_tramos():
    from red_atlas_pipeline import config
    from red_atlas_pipeline.hexgrid.export import corridor_mask
    nodes = config.scenario_nodes()
    lat0, lon0 = aggregate.base_origin()
    e, n = geo.local_en(np.array([p["lat_pc_deg"] for p in nodes.values()]),
                        np.array([p["lon_e_deg"] for p in nodes.values()]), lat0, lon0)
    assert corridor_mask(e, n, 1.0).all()                  # los nodos siempre entran
    # Punto medio del tramo L3 (WP2 -> WP3) desplazado en perpendicular 100 m y 200 m.
    k = list(nodes)
    (ax, ay), (bx, by) = (e[k.index("WP2")], n[k.index("WP2")]), (e[k.index("WP3")], n[k.index("WP3")])
    mx, my = (ax + bx) / 2, (ay + by) / 2
    ux, uy = -(by - ay), bx - ax
    ux, uy = ux / np.hypot(ux, uy), uy / np.hypot(ux, uy)
    pts_e = np.array([mx + 100 * ux, mx + 5000])
    pts_n = np.array([my + 100 * uy, my + 5000])
    assert corridor_mask(pts_e, pts_n, 150.0).tolist() == [True, False]
    assert corridor_mask(pts_e, pts_n, 50.0).tolist() == [False, False]
