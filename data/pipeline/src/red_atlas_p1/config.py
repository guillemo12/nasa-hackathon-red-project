"""Configuracion compartida del pipeline P1: rutas, CRS, AOIs y constantes.

Fuente unica de verdad en codigo. Los valores de escenario se leen de los JSON de
``data/mission-scenarios`` y nunca se duplican a mano en otros modulos.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

# --- Rutas -----------------------------------------------------------------
PIPELINE_DIR = Path(__file__).resolve().parents[2]          # data/pipeline
DATA_DIR = PIPELINE_DIR.parent                              # data
REPO_DIR = DATA_DIR.parent
SCENARIO_DIR = DATA_DIR / "mission-scenarios"
LAYERS_DIR = DATA_DIR / "nasa-layers"
BUILD_DIR = PIPELINE_DIR / "build"          # salidas pesadas (COG); ignorado por git
COG_DIR = BUILD_DIR / "cog"

SCENARIO_GEOJSON = SCENARIO_DIR / "triangulo_supervivencia.geojson"
THRESHOLDS_JSON = SCENARIO_DIR / "eva_thresholds.json"
LAYERS_CATALOG_JSON = LAYERS_DIR / "layers_catalog.json"

# --- Marte -----------------------------------------------------------------
MARS_RADIUS_M = 3_396_190.0      # esfera IAU usada por MOLA / IAU_2015:49900
EARTH_RADIUS_M = 6_371_008.8     # radio medio que asume la libreria H3
G_MARS = 3.72076
CRS_GEOGRAPHIC = "IAU_2015:49900"   # Marte (2015) esferico, ocentrico
# Si pyproj no resuelve el codigo IAU, usar esta definicion equivalente:
CRS_GEOGRAPHIC_PROJ4 = "+proj=longlat +R=3396190 +no_defs"

# H3 indexa por lat/lon y es valido en cualquier esfera, pero sus funciones
# metricas (area, arista, distancia) asumen la Tierra. Escalar SIEMPRE:
H3_LENGTH_SCALE = MARS_RADIUS_M / EARTH_RADIUS_M     # ~0.5331
H3_AREA_SCALE = H3_LENGTH_SCALE**2                    # ~0.2842
H3_RES_NAV = 12      # arista ~5 m en Marte: navegacion
H3_RES_THEMIS = 9    # arista ~93 m en Marte: equivale al pixel THEMIS

# --- AOIs (lat planetocentrica, lon Este 0-360) -----------------------------
# AOI fina: la ruta. AOI ancha: horizonte, SVF y linea de vision de radio.
# Emplazamiento reubicado al pie de la pared suroeste de la cuenca (ver
# data/nasa-layers/SITE_REALITY_CHECK.md). AOIs del sitio original, 9,8°S 283,6°E:
# ruta -9.84..-9.78 / 283.58..283.64; horizonte -10.60..-9.00 / 282.80..284.40.
AOI_ROUTE = {"lat_min": -9.95, "lat_max": -9.88, "lon_e_min": 283.36, "lon_e_max": 283.42}
AOI_HORIZON = {"lat_min": -10.70, "lat_max": -9.10, "lon_e_min": 282.60, "lon_e_max": 284.20}


def lon180(lon_e: float) -> float:
    """Longitud Este 0-360 -> -180..180 (convencion de H3, CesiumJS y DuckDB Spatial)."""
    return ((lon_e + 180.0) % 360.0) - 180.0


def lon360(lon: float) -> float:
    """Longitud -180..180 -> Este 0-360 (convencion IAU / PDS)."""
    return lon % 360.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia de circulo maximo sobre la esfera de Marte, en metros."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * MARS_RADIUS_M * math.asin(math.sqrt(h))


@lru_cache(maxsize=None)
def load_scenario() -> dict:
    return json.loads(SCENARIO_GEOJSON.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def load_thresholds() -> dict:
    return json.loads(THRESHOLDS_JSON.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def load_layers_catalog() -> dict:
    return json.loads(LAYERS_CATALOG_JSON.read_text(encoding="utf-8"))


def scenario_nodes() -> dict[str, dict]:
    """Nodos del escenario por id: {'BASE': {...propiedades...}, 'WP1': ...}."""
    return {
        f["id"]: f["properties"]
        for f in load_scenario()["features"]
        if f["geometry"]["type"] == "Point"
    }


def scenario_legs() -> dict[str, dict]:
    return {
        f["id"]: f["properties"]
        for f in load_scenario()["features"]
        if f["geometry"]["type"] == "LineString"
    }
