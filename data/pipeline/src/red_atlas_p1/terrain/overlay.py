"""Capa de superposición de escenario, separada de los rásteres medidos.

Los valores de diseño del entregable (110 TIU y 22° en el WP2, SVF 0,15 en la alcoba del
WP3, sombra de radio en WP2 y WP3) no aparecen en los datos reales. Esta capa los expresa
como zonas alrededor de los nodos y lleva, por píxel y por entidad, un código de
procedencia: 1 = medido, 2 = derivado de datos medidos, 3 = escenario de diseño.
Nunca se escribe sobre un ráster medido.
"""
from __future__ import annotations

import numpy as np

from .. import config
from . import derive
from . import settings as S
from .rasters import Raster

MEASURED, DERIVED, SCENARIO = 1, 2, 3


def _circle(lon: float, lat: float, radius_m: float, n: int = 48) -> list[list[float]]:
    pts = [derive.destination(lon, lat, az, radius_m) for az in np.linspace(0, 360, n, endpoint=False)]
    ring = [[round(float(x), 6), round(float(y), 6)] for x, y in pts]
    return ring + [ring[0]]


def _corridor(a, b, half_m: float) -> list[list[float]]:
    brg = float(derive.bearing_deg(a[0], a[1], b[0], b[1]))
    corners = [derive.destination(*a, brg - 90, half_m), derive.destination(*b, brg - 90, half_m),
               derive.destination(*b, brg + 90, half_m), derive.destination(*a, brg + 90, half_m)]
    ring = [[round(float(x), 6), round(float(y), 6)] for x, y in corners]
    return ring + [ring[0]]


def _dist_to_segment(lons, lats, a, b) -> np.ndarray:
    """Distancia (m) de cada celda al segmento a-b, en plano local."""
    k = config.MARS_RADIUS_M * np.pi / 180.0
    c = np.cos(np.radians((a[1] + b[1]) / 2))
    px, py = (lons - a[0]) * k * c, (lats - a[1]) * k
    bx, by = (b[0] - a[0]) * k * c, (b[1] - a[1]) * k
    t = np.clip((px * bx + py * by) / (bx * bx + by * by), 0, 1)
    return np.hypot(px - t * bx, py - t * by)


def build(route_dem: Raster, slope: np.ndarray, svf: np.ndarray, los: np.ndarray,
          reality: dict) -> tuple[np.ndarray, list[str], list[str], dict]:
    """Devuelve (bandas, nombres, unidades, GeoJSON) de la capa de escenario."""
    nodes = config.scenario_nodes()
    legs = config.scenario_legs()
    zones = S.SCENARIO_ZONES
    lons, lats = np.meshgrid(route_dem.col_lons(), route_dem.row_lats())
    xy = {k: (p["lon_e_deg"], p["lat_pc_deg"]) for k, p in nodes.items()}
    dist = {k: derive.distance_m(lon, lat, lons, lats) for k, (lon, lat) in xy.items()}
    valid = np.isfinite(route_dem.band(0))

    def prov(base_code):
        return np.where(valid, float(base_code), 0.0)

    features = []

    def zone(kind, node, geometry, props):
        features.append({
            "type": "Feature", "id": f"zone_{kind}_{node}",
            "geometry": {"type": "Polygon", "coordinates": [geometry]},
            "properties": {"zone_kind": kind, "node_id": node, "provenance": "escenario",
                           "provenance_code": SCENARIO,
                           "extent_note": "Extensión supuesta por esta capa (E); el entregable "
                                          "solo fija el valor en el nodo.", **props},
        })

    # Pendiente: derivada del DTM CTX, salvo la rampa de diseño del WP2.
    slope_s, slope_p = slope.copy(), prov(DERIVED)
    for n, r in zones["slope_radius_m"].items():
        m = dist[n] <= r
        slope_s[m], slope_p[m] = nodes[n]["slope_local_deg"], SCENARIO
        zone("slope", n, _circle(*xy[n], r), {"slope_deg": nodes[n]["slope_local_deg"], "radius_m": r})

    # SVF: derivado, salvo la alcoba de diseño del WP3.
    svf_s, svf_p = svf.copy(), prov(DERIVED)
    for n, r in zones["svf_radius_m"].items():
        m = dist[n] <= r
        svf_s[m], svf_p[m] = nodes[n]["sky_view_factor"], SCENARIO
        zone("svf", n, _circle(*xy[n], r), {"sky_view_factor": nodes[n]["sky_view_factor"], "radius_m": r})

    # Línea de vista: derivada, salvo las sombras de radio de diseño.
    los_s, los_p = los.copy(), prov(DERIVED)
    for n, r in zones["nlos_radius_m"].items():
        m = dist[n] <= r
        los_s[m], los_p[m] = 0.0, SCENARIO
        zone("nlos", n, _circle(*xy[n], r), {"radio_los_base": False, "radius_m": r})
    if zones["nlos_corridor_leg"]:
        leg = legs[zones["nlos_corridor_leg"]]
        a, b = xy[leg["from"]], xy[leg["to"]]
        half = zones["nlos_corridor_halfwidth_m"]
        m = _dist_to_segment(lons, lats, a, b) <= half
        los_s[m], los_p[m] = 0.0, SCENARIO
        zone("nlos", zones["nlos_corridor_leg"], _corridor(a, b, half),
             {"radio_los_base": False, "halfwidth_m": half})

    # Inercia térmica: no hay producto medido; solo existen las zonas de escenario.
    ti_s = np.full(slope.shape, np.nan)
    ti_p = np.zeros(slope.shape)
    for n, r in sorted(zones["ti_radius_m"].items(), key=lambda kv: -kv[1]):
        m = dist[n] <= r
        ti_s[m], ti_p[m] = nodes[n]["thermal_inertia_tiu"], SCENARIO
        zone("thermal_inertia", n, _circle(*xy[n], r),
             {"thermal_inertia_tiu": nodes[n]["thermal_inertia_tiu"], "radius_m": r})

    for arr in (slope_s, svf_s, los_s):
        arr[~valid] = np.nan
    bands = np.stack([slope_s, slope_p, svf_s, svf_p, los_s, los_p, ti_s, ti_p])
    # Las bandas de procedencia usan 0 = sin dato (no NaN).
    names = ["slope_deg_escenario", "slope_procedencia", "svf_escenario", "svf_procedencia",
             "radio_los_base_escenario", "radio_los_procedencia",
             "thermal_inertia_tiu_escenario", "thermal_inertia_procedencia"]
    units = ["grados", "codigo 0-3", "adimensional 0-1", "codigo 0-3",
             "booleano 0/1", "codigo 0-3", "J m-2 K-1 s-1/2", "codigo 0-3"]

    # Nodos: valor de escenario junto al medido o derivado, cada uno con su procedencia.
    for nid, p in nodes.items():
        real = reality["nodes"][nid]
        features.append({
            "type": "Feature", "id": f"node_{nid}",
            "geometry": {"type": "Point", "coordinates": [p["lon_e_deg"], p["lat_pc_deg"]]},
            "properties": {
                "node_id": nid,
                "elev_mola_m": {
                    "escenario": p["elev_mola_m"],
                    "medido": real["elevation_m"]["ctx_20m"],
                    "fuente_medido": "DTM CTX 20 m",
                    "vigente": real["elevation_m"]["ctx_20m"], "procedencia_vigente": "medido"},
                "slope_local_deg": {
                    "escenario": p["slope_local_deg"],
                    "derivado": real["slope_deg"]["ctx_20m"],
                    "fuente_derivado": "Horn 3×3 sobre DTM CTX 20 m",
                    "vigente": (p["slope_local_deg"] if nid in zones["slope_radius_m"]
                                else real["slope_deg"]["ctx_20m"]),
                    "procedencia_vigente": "escenario" if nid in zones["slope_radius_m"] else "derivado"},
                "sky_view_factor": {
                    "escenario": p["sky_view_factor"],
                    "derivado": real["sky_view_factor"]["derived_ctx_20m"],
                    "fuente_derivado": "Horizonte sobre DTM CTX 20 m + mezcla HRSC+MOLA 200 m",
                    "vigente": (p["sky_view_factor"] if nid in zones["svf_radius_m"]
                                else real["sky_view_factor"]["derived_ctx_20m"]),
                    "procedencia_vigente": "escenario" if nid in zones["svf_radius_m"] else "derivado"},
                "radio_los_base": {
                    "escenario": p["radio_los_base"],
                    "derivado": real["radio_los_base"]["derived_ctx_20m"],
                    "margen_m": real["radio_los_base"]["margin_m"],
                    "vigente": (False if nid in zones["nlos_radius_m"]
                                else real["radio_los_base"]["derived_ctx_20m"]),
                    "procedencia_vigente": "escenario" if nid in zones["nlos_radius_m"] else "derivado"},
                "thermal_inertia_tiu": {
                    "escenario": p["thermal_inertia_tiu"], "medido": None,
                    "nota": "Sin producto cuantitativo de inercia térmica accesible.",
                    "vigente": p["thermal_inertia_tiu"], "procedencia_vigente": "escenario"},
            },
        })

    geojson = {
        "type": "FeatureCollection",
        "name": "scenario_overlay_melas_eva07",
        "crs": {"type": "name", "properties": {
            "name": config.CRS_GEOGRAPHIC,
            "note": "Longitud Este 0-360, latitud planetocéntrica. Orden GeoJSON [lon_E, lat]."}},
        "metadata": {
            "purpose": ("Superposición de escenario de diseño sobre los datos reales. No sustituye "
                        "a ningún ráster medido."),
            "provenance_codes": S.PROV_CODES,
            "zone_assumptions": zones,
            "raster": "build/cog/scenario_overlay_route.tif",
        },
        "features": features,
    }
    return bands, names, units, geojson
