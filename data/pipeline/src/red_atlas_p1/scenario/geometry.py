"""Geometría de los tramos del Triángulo de Supervivencia sobre la esfera de Marte.

Distancias en metros (círculo máximo, R = 3.396.190 m), rumbos en grados desde el norte
en sentido horario (0–360), desniveles en metros y pendientes medias en grados.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from red_atlas_p1 import config


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Rumbo inicial de círculo máximo de 1 a 2, en grados 0–360 (norte = 0, horario)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlon)
    return math.degrees(math.atan2(x, y)) % 360.0


def mean_slope_deg(delta_elev_m: float, distance_m: float) -> float:
    """Pendiente media de un tramo: atan(Δz / distancia horizontal), con signo, en grados."""
    return math.degrees(math.atan2(delta_elev_m, distance_m))


def interpolate_latlon(
    lat1: float, lon1: float, lat2: float, lon2: float, f: float
) -> tuple[float, float]:
    """Punto a fracción ``f`` (0–1) del segmento. Lineal en grados: error < 1 m a esta escala."""
    return lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f


@dataclass(frozen=True)
class LegGeometry:
    leg_id: str
    origin: str
    dest: str
    distance_m: float          # calculada (haversine)
    delta_elev_m: float        # calculado (cotas MOLA de los nodos)
    bearing_deg: float         # calculado (rumbo inicial)
    slope_deg: float           # calculada (pendiente media)
    declared_distance_m: float
    declared_delta_elev_m: float
    declared_bearing_deg: float


def node_coords(node_id: str) -> tuple[float, float, float]:
    """(lat, lon_E, cota MOLA en m) de un nodo del GeoJSON."""
    p = config.scenario_nodes()[node_id]
    return p["lat_pc_deg"], p["lon_e_deg"], float(p["elev_mola_m"])


def leg_geometry(leg_id: str) -> LegGeometry:
    """Calcula la geometría de un tramo y la empareja con las propiedades declaradas."""
    props = config.scenario_legs()[leg_id]
    la1, lo1, z1 = node_coords(props["from"])
    la2, lo2, z2 = node_coords(props["to"])
    d = config.haversine_m(la1, lo1, la2, lo2)
    dz = z2 - z1
    return LegGeometry(
        leg_id=leg_id,
        origin=props["from"],
        dest=props["to"],
        distance_m=d,
        delta_elev_m=dz,
        bearing_deg=initial_bearing_deg(la1, lo1, la2, lo2),
        slope_deg=mean_slope_deg(dz, d),
        declared_distance_m=float(props["distance_m"]),
        declared_delta_elev_m=float(props["delta_elev_m"]),
        declared_bearing_deg=float(props["bearing_deg"]),
    )


def all_legs() -> dict[str, LegGeometry]:
    return {leg_id: leg_geometry(leg_id) for leg_id in config.scenario_legs()}


def perimeter_m(order: tuple[str, ...] = ("L1", "L2", "L3", "L4")) -> float:
    """Perímetro calculado del triángulo (suma de distancias haversine de los tramos)."""
    return sum(leg_geometry(leg).distance_m for leg in order)


def bearing_error_deg(a: float, b: float) -> float:
    """Diferencia angular mínima entre dos rumbos, en grados (0–180)."""
    return abs((a - b + 180.0) % 360.0 - 180.0)
