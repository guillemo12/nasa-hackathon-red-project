"""Agregación a H3 sobre rásteres sintéticos con resultado conocido (sin red)."""
from __future__ import annotations

import numpy as np
import pytest

from red_atlas_p1 import config
from red_atlas_p1.hexgrid import aggregate, geo, synthetic
from red_atlas_p1.hexgrid import layers as hl
from red_atlas_p1.hexgrid.constants import PROV_DERIVED, PROV_NONE, PROV_SCENARIO

N = 40


def _aoi_of(L) -> dict:
    """AOI algo menor que la malla sintética, para que todo centro tenga píxel."""
    t, (rows, cols) = L["elev_m"].transform, L["elev_m"].shape
    m = 2 * abs(t.e)
    return {"lat_min": t.f + rows * t.e + m, "lat_max": t.f - m,
            "lon_e_min": t.c + m, "lon_e_max": t.c + cols * t.a - m}


def _fine(L):
    return aggregate.build_fine(geo.cells_in_aoi(_aoi_of(L), 12), L, 12)


def test_res12_toma_el_pixel_que_contiene_el_centro_sin_interpolar():
    L = synthetic.layers(N, N)
    c = _fine(L)
    assert len(c["h3_index"]) > 1000
    # elev_m es el identificador del píxel: debe coincidir con ref_pixel_id exactamente.
    assert np.array_equal(c["elev_m"], c["ref_pixel_id"].astype(float))
    # Comprobación independiente: fila y columna a partir de la geotransformación.
    t = L["elev_m"].transform
    col = np.floor((c["lon_e_deg"] - t.c) / t.a).astype(int)
    row = np.floor((c["lat_deg"] - t.f) / t.e).astype(int)
    assert np.array_equal(c["ref_pixel_id"], row * N + col)
    # Valores enteros: no hay interpolación.
    assert np.all(c["elev_m"] == np.round(c["elev_m"]))
    # ~4-5 celdas por píxel de 20 m.
    per_pixel = len(c["h3_index"]) / len(np.unique(c["ref_pixel_id"]))
    assert 3.0 < per_pixel < 6.5


def test_res12_escenario_en_columna_aparte_y_efectiva():
    svf_s = np.full((N, N), np.nan)
    svf_s[:N // 2, :] = 0.15                         # mitad norte: alcoba de escenario
    L = synthetic.layers(N, N, sky_view_factor_scenario=svf_s)
    c = _fine(L)
    north = c["svf_scenario_cover_frac"] == 1.0
    assert north.any() and (~north).any()
    assert np.all(c["svf_mean"] == 0.8)               # el derivado no se toca
    assert np.all(c["svf_effective"][north] == 0.15)
    assert np.all(c["svf_effective_prov"][north] == PROV_SCENARIO)
    assert np.all(c["svf_effective"][~north] == 0.8)
    assert np.all(c["svf_effective_prov"][~north] == PROV_DERIVED)
    assert np.all(np.isnan(c["svf_scenario"][~north]))


def test_tiu_sin_dato_queda_nula_y_sin_bandera():
    L = synthetic.layers(N, N)
    c = _fine(L)
    assert np.all(np.isnan(c["tiu_effective"]))
    assert np.all(c["tiu_effective_prov"] == PROV_NONE)
    assert not np.any(c["hazard_bitmask"] & 0x02)


def test_res9_agrupa_pixeles_con_la_estadistica_documentada():
    rng = np.random.default_rng(7)
    slope = rng.uniform(0, 30, (N, N))
    dem = np.arange(N * N, dtype=float).reshape(N, N)
    dem[3, 4] = np.nan                                # nodata: no entra en la media
    L = synthetic.layers(N, N, slope_deg=slope, elev_m=dem)
    c = aggregate.build_coarse(L, 9)

    # Agrupación independiente: celda de cada centro de píxel.
    plat, plon = L["elev_m"].pixel_centers()
    pc = geo.latlon_to_cells(plat.ravel(), plon.ravel(), 9)
    assert set(np.unique(pc)) == set(c["h3_index"].tolist())
    assert c["n_pixels"].sum() == N * N
    for i, h in enumerate(c["h3_index"]):
        m = pc == h
        z, s = dem.ravel()[m], slope.ravel()[m]
        assert c["n_pixels"][i] == m.sum()
        assert c["elev_m"][i] == pytest.approx(np.nanmean(z))
        assert c["elev_min_m"][i] == pytest.approx(np.nanmin(z))
        assert c["slope_deg_p90"][i] == pytest.approx(np.percentile(s, 90))
        assert c["slope_deg_max"][i] == pytest.approx(s.max())
        assert c["valid_fraction"][i] == pytest.approx(np.isfinite(z).mean())
    # La pendiente que usa el motor a res 9 es el p90.
    assert np.allclose(c["slope_deg_effective"], c["slope_deg_p90"])
    # THEMIS constante en otra malla: media 100.
    assert np.allclose(c["themis_night_dn"], 100.0)


def test_res9_escenario_conservador_con_cobertura():
    tiu = np.full((N, N), np.nan)
    tiu[18:22, 18:22] = 110.0
    tiu[18:20, 18:20] = 320.0
    L = synthetic.layers(N, N, thermal_inertia_tiu_scenario=tiu)
    c = aggregate.build_coarse(L, 9)
    hit = c["tiu_scenario_cover_frac"] > 0
    assert hit.any()
    # Si una celda contiene 110 y 320, manda el mínimo; la bandera de trampa se activa.
    assert np.nanmin(c["tiu_effective"][hit]) == 110.0
    assert np.all(c["hazard_bitmask"][c["tiu_effective"] == 110.0] & 0x02)
    assert np.all(np.isnan(c["tiu_effective"][~hit]))
    assert np.all(c["tiu_scenario_cover_frac"][hit] <= 16 / c["n_pixels"][hit] + 1e-6)


def test_media_circular_de_la_orientacion():
    m, r = aggregate.circular_mean_deg(np.array([350.0, 10.0]))
    assert m == pytest.approx(0.0, abs=1e-9) or m == pytest.approx(360.0, abs=1e-9)
    assert r == pytest.approx(np.cos(np.radians(10)))
    m, r = aggregate.circular_mean_deg(np.array([90.0, 270.0]))
    assert r == pytest.approx(0.0, abs=1e-12)
    assert np.isnan(aggregate.circular_mean_deg(np.array([np.nan]))[0])


def test_los_res9_exige_todos_los_pixeles():
    los = np.ones((N, N))
    los[10, 10] = 0.0
    margin = np.full((N, N), 10.0)
    margin[10, 10] = -3.0
    L = synthetic.layers(N, N, radio_los_base=los, los_margin_m=margin)
    c = aggregate.build_coarse(L, 9)
    bad = c["los_margin_min_m"] == -3.0
    assert bad.sum() == 1
    assert c["los_base"][bad][0] == 0.0
    assert c["los_fraction"][bad][0] < 1.0
    assert c["los_indeterminate"][bad][0]            # |−3| < 5 m: dentro del ruido
    assert c["hazard_bitmask"][bad][0] & 0x08
    assert np.all(c["los_base"][~bad] == 1.0)


# --- con los COG reales, si existen ------------------------------------------------------
needs_cogs = pytest.mark.skipif(bool(hl.missing_inputs()), reason="faltan los COG de build/cog")


@needs_cogs
def test_nodos_reales_reproducen_los_valores_de_terreno():
    L = hl.load_all()
    nodes = config.scenario_nodes()
    cells = np.array([geo.cell_of(p["lat_pc_deg"], p["lon_e_deg"], 12) for p in nodes.values()],
                     dtype=np.uint64)
    c = aggregate.build_fine(cells, L, 12)
    for i, (k, p) in enumerate(nodes.items()):
        assert c["slope_deg_mean"][i] == pytest.approx(p["slope_local_deg"], abs=0.1)
        assert c["svf_mean"][i] == pytest.approx(p["sky_view_factor_dem"], abs=0.01)
        assert c["elev_m"][i] == pytest.approx(p["elev_mola_m"], abs=2.0)
        assert c["tiu_effective"][i] == p["thermal_inertia_tiu"]
        assert c["svf_effective"][i] == pytest.approx(p["sky_view_factor"], abs=0.01)
    # WP2: trampa (110 TIU, escenario) y sin LOS (derivado); 19,4° no supera los 20°.
    wp2 = list(nodes).index("WP2")
    assert c["hazard_bitmask"][wp2] == 0x02 | 0x08
    assert c["slope_deg_effective"][wp2] < 20.0
    wp3 = list(nodes).index("WP3")
    assert c["hazard_bitmask"][wp3] & 0x04
    assert c["svf_mean"][wp3] > 0.7              # el SVF derivado se conserva junto al 0,15
    wp1 = list(nodes).index("WP1")
    assert c["hazard_bitmask"][wp1] & 0x10


def test_res9_incluye_padres_sin_pixeles():
    L = synthetic.layers(N, N)
    lejos = geo.cell_of(-9.0, 283.0, 9)            # celda sin ningún píxel de la malla
    c = aggregate.build_coarse(L, 9, include=[lejos])
    i = int(np.where(c["h3_index"] == lejos)[0][0])
    assert c["n_pixels"][i] == 0
    assert np.isnan(c["elev_m"][i]) and c["coverage_fraction"][i] == 0
    assert c["hazard_bitmask"][i] == 0


def test_todo_padre_de_res12_existe_en_res9():
    L = synthetic.layers(N, N)
    fine = _fine(L)
    coarse = aggregate.build_coarse(L, 9, include=np.unique(fine["h3_parent_res9"]))
    assert set(fine["h3_parent_res9"].tolist()) <= set(coarse["h3_index"].tolist())
