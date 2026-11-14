"""Índices H3 sobre Marte: longitudes, métrica escalada y coordenadas locales.

H3 indexa por latitud y longitud (−180..180) y vale en cualquier esfera, pero sus funciones
métricas (arista, área, distancia) asumen la Tierra. Aquí todas las magnitudes métricas se
escalan con ``config.H3_LENGTH_SCALE`` y ``config.H3_AREA_SCALE``, o se calculan directamente
sobre la esfera de Marte con ``config.haversine_m``.
"""
from __future__ import annotations

import math
from collections.abc import Iterable

import h3
import numpy as np

from .. import config

R = config.MARS_RADIUS_M


def cell_of(lat: float, lon_e: float, res: int) -> int:
    """Celda H3 (entero de 64 bits) del punto (lat planetocéntrica, lon Este 0-360)."""
    return h3.str_to_int(h3.latlng_to_cell(lat, config.lon180(lon_e), res))


def center_of(cell: int) -> tuple[float, float]:
    """Centro de la celda como (lat, lon Este 0-360)."""
    lat, lon = h3.cell_to_latlng(h3.int_to_str(cell))
    return lat, config.lon360(lon)


def mars_edge_length_m(res: int) -> float:
    """Arista media de la resolución en Marte (media de la librería H3 × factor lineal)."""
    return h3.average_hexagon_edge_length(res, unit="m") * config.H3_LENGTH_SCALE


def mars_area_m2(res: int) -> float:
    """Área media de la resolución en Marte (media de la librería H3 × factor de área)."""
    return h3.average_hexagon_area(res, unit="m^2") * config.H3_AREA_SCALE


def mars_cell_area_m2(cell: int) -> float:
    """Área exacta de una celda concreta, escalada a Marte."""
    return h3.cell_area(h3.int_to_str(cell), unit="m^2") * config.H3_AREA_SCALE


def mars_center_distance_m(a: int, b: int) -> float:
    """Distancia de círculo máximo entre centros de celda sobre la esfera de Marte."""
    la, lb = h3.cell_to_latlng(h3.int_to_str(a)), h3.cell_to_latlng(h3.int_to_str(b))
    return h3.great_circle_distance(la, lb, unit="m") * config.H3_LENGTH_SCALE


def cells_in_aoi(aoi: dict, res: int) -> np.ndarray:
    """Celdas cuyo centro cae dentro del rectángulo de la AOI (lon Este 0-360)."""
    lo, hi = config.lon180(aoi["lon_e_min"]), config.lon180(aoi["lon_e_max"])
    ring = [(aoi["lat_min"], lo), (aoi["lat_min"], hi), (aoi["lat_max"], hi), (aoi["lat_max"], lo)]
    cells = h3.h3shape_to_cells(h3.LatLngPoly(ring), res)
    return np.array(sorted(h3.str_to_int(c) for c in cells), dtype=np.uint64)


def centers(cells: Iterable[int]) -> tuple[np.ndarray, np.ndarray]:
    """Latitudes y longitudes Este 0-360 de los centros."""
    ll = np.array([h3.cell_to_latlng(h3.int_to_str(int(c))) for c in cells], dtype=np.float64)
    if ll.size == 0:
        return np.empty(0), np.empty(0)
    return ll[:, 0], np.mod(ll[:, 1], 360.0)


def parents(cells: Iterable[int], res: int) -> np.ndarray:
    return np.array(
        [h3.str_to_int(h3.cell_to_parent(h3.int_to_str(int(c)), res)) for c in cells],
        dtype=np.uint64,
    )


def latlon_to_cells(lat: np.ndarray, lon_e: np.ndarray, res: int) -> np.ndarray:
    return np.array(
        [h3.str_to_int(h3.latlng_to_cell(float(a), config.lon180(float(b)), res))
         for a, b in zip(lat, lon_e)],
        dtype=np.uint64,
    )


def local_en(lat: np.ndarray, lon_e: np.ndarray, lat0: float, lon0_e: float):
    """Coordenadas locales este/norte en metros respecto a (lat0, lon0) sobre la esfera de
    Marte (plano tangente: x = R·Δλ·cos φ0, y = R·Δφ). Error < 0,1 % a 5 km."""
    dlon = (np.asarray(lon_e) - lon0_e + 180.0) % 360.0 - 180.0
    east = R * np.radians(dlon) * math.cos(math.radians(lat0))
    north = R * np.radians(np.asarray(lat) - lat0)
    return east, north


def grid_path(a: int, b: int) -> list[int]:
    """Celdas contiguas de la línea entre dos celdas (h3.grid_path_cells)."""
    return [h3.str_to_int(c) for c in h3.grid_path_cells(h3.int_to_str(a), h3.int_to_str(b))]


def grid_disk(center: int, k: int) -> list[int]:
    return [h3.str_to_int(c) for c in h3.grid_disk(h3.int_to_str(center), k)]
