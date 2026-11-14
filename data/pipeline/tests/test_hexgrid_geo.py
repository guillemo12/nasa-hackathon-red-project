"""Índices H3 sobre coordenadas conocidas y escalado métrico a Marte (sin red)."""
from __future__ import annotations

import math

import h3
import pytest

from red_atlas_p1 import config
from red_atlas_p1.hexgrid import geo

NODES = config.scenario_nodes()
LEGS = config.scenario_legs()
EDGE12 = geo.mars_edge_length_m(12)


def _node_cell(node: str, res: int = 12) -> int:
    p = NODES[node]
    return geo.cell_of(p["lat_pc_deg"], p["lon_e_deg"], res)


def test_indice_de_coordenada_conocida():
    # Coordenadas literales (Base del escenario en noviembre de 2026: −9,89646 N, 283,3892 E
    # = −76,6108 en −180..180), para que el test no dependa de que el sitio se recoloque.
    assert h3.int_to_str(geo.cell_of(-9.89646, 283.3892, 12)) == "8c8f591152cb1ff"
    assert h3.int_to_str(geo.cell_of(-9.89646, 283.3892, 9)) == "898f591152fffff"
    # cell_of recibe lon Este 0-360 y la pasa a −180..180 antes de indexar.
    assert geo.cell_of(-9.89646, 283.3892, 12) == h3.str_to_int(
        h3.latlng_to_cell(-9.89646, -76.6108, 12))
    _lat, lon = geo.center_of(geo.cell_of(-9.89646, 283.3892, 12))
    assert 0.0 <= lon < 360.0 and lon == pytest.approx(283.3892, abs=1e-4)


def test_los_cuatro_nodos_caen_en_celdas_distintas_a_res_12():
    cells = {n: _node_cell(n) for n in NODES}
    assert len(set(cells.values())) == 4


@pytest.mark.parametrize("node", ["BASE", "WP1", "WP2", "WP3"])
def test_el_centro_de_la_celda_esta_a_menos_de_una_arista_del_nodo(node):
    p = NODES[node]
    lat, lon = geo.center_of(_node_cell(node))
    d = config.haversine_m(p["lat_pc_deg"], p["lon_e_deg"], lat, lon)
    # El radio circunscrito de un hexágono es su arista; margen del 25 % por la variación
    # de tamaño de las celdas H3.
    assert d <= 1.25 * EDGE12
    assert geo.cell_of(lat, lon, 12) == _node_cell(node)


@pytest.mark.parametrize("leg", ["L1", "L2", "L3", "L4", "R1"])
def test_distancia_entre_centros_coincide_con_el_tramo_dentro_de_una_celda(leg):
    """Cada nodo está a menos de un radio (≈ arista) del centro de su celda, así que la
    distancia entre centros difiere de la del tramo en menos de un diámetro (2 aristas)."""
    lg = LEGS[leg]
    a, b = NODES[lg["from"]], NODES[lg["to"]]
    real = config.haversine_m(a["lat_pc_deg"], a["lon_e_deg"], b["lat_pc_deg"], b["lon_e_deg"])
    centers = geo.mars_center_distance_m(_node_cell(lg["from"]), _node_cell(lg["to"]))
    tol = 2 * 1.25 * EDGE12
    assert abs(centers - real) <= tol
    assert abs(centers - lg["distance_m"]) <= tol


def test_escalado_metrico_a_marte():
    k = config.H3_LENGTH_SCALE
    assert k == pytest.approx(3396.19 / 6371.0088, rel=1e-9)
    assert config.H3_AREA_SCALE == pytest.approx(k * k)
    assert geo.mars_edge_length_m(12) == pytest.approx(
        h3.average_hexagon_edge_length(12, "m") * k)
    assert geo.mars_edge_length_m(12) == pytest.approx(5.77, abs=0.01)
    assert geo.mars_edge_length_m(9) == pytest.approx(107.0, abs=0.1)
    assert geo.mars_area_m2(12) == pytest.approx(87.3, abs=0.1)
    assert geo.mars_area_m2(9) == pytest.approx(29_932, rel=1e-3)
    # Sin escalar, la distancia de la librería sería la de la Tierra (×1,876).
    a, b = _node_cell("WP2"), _node_cell("WP3")
    earth = h3.great_circle_distance(h3.cell_to_latlng(h3.int_to_str(a)),
                                     h3.cell_to_latlng(h3.int_to_str(b)), unit="m")
    assert geo.mars_center_distance_m(a, b) == pytest.approx(earth * k)
    assert earth / geo.mars_center_distance_m(a, b) == pytest.approx(1.876, abs=0.001)


def test_distancia_escalada_igual_a_haversine_en_marte():
    a, b = _node_cell("BASE"), _node_cell("WP2")
    la, lb = geo.center_of(a), geo.center_of(b)
    # H3 usa R = 6.371,0072 km y config 6.371,0088 km: diferencia relativa de 2,6e-7.
    assert geo.mars_center_distance_m(a, b) == pytest.approx(
        config.haversine_m(*la, *lb), rel=1e-6)


def test_vecinos_a_distancia_marciana():
    c = _node_cell("WP3")
    for n in geo.grid_disk(c, 1):
        if n == c:
            continue
        d = geo.mars_center_distance_m(c, n)
        # Entre centros vecinos: √3 · arista (≈10 m en Marte; ≈18,8 m en la Tierra).
        assert d == pytest.approx(math.sqrt(3) * EDGE12, rel=0.15)


def test_coordenadas_locales_respecto_a_la_base():
    b, w = NODES["BASE"], NODES["WP2"]
    e, n = geo.local_en(w["lat_pc_deg"], w["lon_e_deg"], b["lat_pc_deg"], b["lon_e_deg"])
    d = config.haversine_m(b["lat_pc_deg"], b["lon_e_deg"], w["lat_pc_deg"], w["lon_e_deg"])
    assert math.hypot(e, n) == pytest.approx(d, rel=1e-3)
    assert n < 0 and e < 0            # el WP2 está al sur y un poco al oeste de la Base
