"""Capas de entrada: COG de terreno descritos en ``terrain_outputs.json`` y zonas de escenario.

Cada capa es una matriz 2D en ``float64`` con NaN donde no hay dato, su geotransformación en
grados (lon Este 0-360, origen en la esquina superior izquierda, píxel como área), la
resolución de la fuente y el código de procedencia.

Regla de honestidad: los valores medidos y derivados se leen solo de sus COG propios
(``dem``, ``slope_aspect``, ``svf``, ``radio_los``, THEMIS). De ``scenario_overlay_route.tif``
se toman exclusivamente los píxeles cuya banda de procedencia vale 3 (escenario); sus bandas
mezcladas nunca alimentan una columna medida o derivada.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from shapely import contains_xy
from shapely.geometry import shape

from .. import config
from .constants import (
    PROV_DERIVED,
    PROV_MEASURED,
    PROV_SCENARIO,
    SCENARIO_OVERLAY_GEOJSON,
    TERRAIN_OUTPUTS_JSON,
)


@dataclass
class Layer:
    """Variable sobre una malla geográfica regular."""

    name: str
    values: np.ndarray            # (filas, columnas), float64, NaN = sin dato
    transform: Affine             # grados, lon Este 0-360
    src_res_m: float              # resolución de la fuente (paso N-S del píxel)
    prov: int                     # código de procedencia
    source: str = ""              # fichero y banda, o descripción de la zona
    note: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return self.values.shape

    def pixel_centers(self) -> tuple[np.ndarray, np.ndarray]:
        """Latitud y longitud Este de los centros de píxel, en mallas 2D."""
        rows, cols = self.shape
        t = self.transform
        lons = t.c + (np.arange(cols) + 0.5) * t.a
        lats = t.f + (np.arange(rows) + 0.5) * t.e
        lon2, lat2 = np.meshgrid(lons, lats)
        return lat2, lon2

    def rowcol(self, lat: np.ndarray, lon_e: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Fila y columna del píxel que contiene cada punto, y máscara de dentro de la malla."""
        t = self.transform
        lon_e = np.asarray(lon_e, dtype=np.float64)
        lat = np.asarray(lat, dtype=np.float64)
        dlon = (lon_e - t.c + 180.0) % 360.0 - 180.0
        col = np.floor(dlon / t.a).astype(np.int64)
        row = np.floor((lat - t.f) / t.e).astype(np.int64)
        rows, cols = self.shape
        inside = (row >= 0) & (row < rows) & (col >= 0) & (col < cols)
        return row, col, inside

    def sample(self, lat: np.ndarray, lon_e: np.ndarray) -> np.ndarray:
        """Valor del píxel que contiene cada punto (vecino más próximo, sin interpolar)."""
        row, col, inside = self.rowcol(lat, lon_e)
        out = np.full(np.shape(lat), np.nan, dtype=np.float64)
        out[inside] = self.values[row[inside], col[inside]]
        return out


# --- Lectura ------------------------------------------------------------------------
@cache
def terrain_outputs() -> dict:
    return json.loads(TERRAIN_OUTPUTS_JSON.read_text(encoding="utf-8"))


def file_spec(rel_path: str) -> dict:
    for f in terrain_outputs()["files"]:
        if f["path"] == rel_path:
            return f
    raise KeyError(rel_path)


def band_index(spec: dict, band_name: str) -> int:
    for b in spec["bands"]:
        if b["name"] == band_name:
            return b["index"]
    raise KeyError(f"{spec['path']}: banda {band_name}")


def cog_path(rel_path: str) -> Path:
    return config.PIPELINE_DIR / rel_path


def _read_band(rel_path: str, band_name: str) -> tuple[np.ndarray, Affine, dict]:
    spec = file_spec(rel_path)
    idx = band_index(spec, band_name)
    with rasterio.open(cog_path(rel_path)) as ds:
        arr = ds.read(idx).astype(np.float64)
        nodata = ds.nodata if ds.nodata is not None else spec.get("nodata")
        transform = ds.transform
    if nodata is not None:
        arr[arr == nodata] = np.nan
    scale, offset = spec.get("value_scale_offset", [1.0, 0.0])
    if (scale, offset) != (1.0, 0.0) and spec["layer"] != "ortho":
        arr = arr * scale + offset
    return arr, transform, spec


def _src_res(spec: dict) -> float:
    return float(spec["pixel_size_m"][1])


def load_layer(name: str, rel_path: str, band_name: str, prov: int | None = None,
               note: str = "") -> Layer:
    arr, transform, spec = _read_band(rel_path, band_name)
    if prov is None:
        prov = PROV_MEASURED if spec["provenance"] == "medido" else PROV_DERIVED
    return Layer(name, arr, transform, _src_res(spec), prov, f"{rel_path}#{band_name}",
                 note or spec.get("note", ""))


# Ficheros del contrato de entrada (terrain_outputs.json)
F_DEM = "build/cog/dem_ctx_20m_route.tif"
F_SLOPE = "build/cog/slope_aspect_ctx_20m_route.tif"
F_HORIZON = "build/cog/horizon_ctx20_hrscmola200_route.tif"
F_SVF = "build/cog/svf_ctx20_hrscmola200_route.tif"
F_LOS = "build/cog/radio_los_base_ctx_20m_route.tif"
F_OVERLAY = "build/cog/scenario_overlay_route.tif"
F_THEMIS_DAY = "build/cog/themis_day_ir_100m_horizon.tif"
F_THEMIS_NIGHT = "build/cog/themis_night_ir_100m_horizon.tif"

REQUIRED_FILES = [F_DEM, F_SLOPE, F_HORIZON, F_SVF, F_LOS, F_OVERLAY, F_THEMIS_DAY,
                  F_THEMIS_NIGHT]


def missing_inputs() -> list[str]:
    return [f for f in REQUIRED_FILES if not cog_path(f).exists()]


def _horizon_layers() -> tuple[Layer, Layer]:
    spec = file_spec(F_HORIZON)
    with rasterio.open(cog_path(F_HORIZON)) as ds:
        cube = ds.read().astype(np.float64)
        transform = ds.transform
    cube[cube == spec["nodata"]] = np.nan
    valid = np.isfinite(cube).all(axis=0)
    hmax = np.where(valid, np.nanmax(np.where(np.isfinite(cube), cube, -np.inf), axis=0), np.nan)
    az = np.where(valid, np.argmax(np.where(np.isfinite(cube), cube, -np.inf), axis=0) * 10.0,
                  np.nan)
    res = _src_res(spec)
    note = spec["note"]
    return (
        Layer("horizon_max_deg", hmax, transform, res, PROV_DERIVED,
              f"{F_HORIZON}#max(horizon_deg_az000..350)", note),
        Layer("horizon_max_az_deg", az, transform, res, PROV_DERIVED,
              f"{F_HORIZON}#argmax(horizon_deg_az000..350)·10°", note),
    )


def _scenario_band(name: str, value_band: str, prov_band: str) -> Layer:
    values, transform, spec = _read_band(F_OVERLAY, value_band)
    prov, _, _ = _read_band(F_OVERLAY, prov_band)
    values = np.where(prov == PROV_SCENARIO, values, np.nan)
    return Layer(name, values, transform, _src_res(spec), PROV_SCENARIO,
                 f"{F_OVERLAY}#{value_band} donde {prov_band} = 3",
                 "Zona vectorial de escenario rasterizada a 20 m por el módulo terrain.")


@cache
def scenario_overlay() -> dict:
    return json.loads(SCENARIO_OVERLAY_GEOJSON.read_text(encoding="utf-8"))


def hydration_zone():
    """Zona supuesta del depósito hidratado del WP1 (escenario).

    El escenario solo fija 12 % de H₂O en el nodo WP1 y no define extensión. Se toma como
    extensión del depósito la zona de escenario de inercia térmica del WP1 ya publicada en
    ``scenario_overlay.geojson`` (disco de 100 m): es un supuesto de esta capa (E), no un dato.
    """
    for f in scenario_overlay()["features"]:
        p = f["properties"]
        if (f["geometry"]["type"] == "Polygon" and p.get("zone_kind") == "thermal_inertia"
                and p.get("node_id") == "WP1"):
            return shape(f["geometry"]), float(p["radius_m"])
    raise KeyError("No hay zona de inercia térmica del WP1 en scenario_overlay.geojson")


def hydration_layer(ref: Layer) -> Layer:
    """Capa de escenario de H₂O sobre la malla de referencia (centros de píxel en la zona)."""
    node = config.scenario_nodes()["WP1"]
    value = node["h2o_wt_pct"]
    zone, radius = hydration_zone()
    lat, lon = ref.pixel_centers()
    inside = contains_xy(zone, lon, lat)
    vals = np.where(inside, float(value), np.nan)
    return Layer("h2o_wt_pct_scenario", vals, ref.transform, ref.src_res_m, PROV_SCENARIO,
                 f"triangulo_supervivencia.geojson#WP1.h2o_wt_pct en disco de {radius:.0f} m",
                 "Extensión supuesta: la zona de inercia térmica de escenario del WP1.")


def load_all() -> dict[str, Layer]:
    """Todas las capas que consume la malla, por nombre de variable."""
    L: dict[str, Layer] = {}
    L["elev_m"] = load_layer("elev_m", F_DEM, "elevation_m")
    L["slope_deg"] = load_layer("slope_deg", F_SLOPE, "slope_deg")
    L["aspect_deg"] = load_layer("aspect_deg", F_SLOPE, "aspect_deg")
    L["horizon_max_deg"], L["horizon_max_az_deg"] = _horizon_layers()
    L["sky_view_factor"] = load_layer("sky_view_factor", F_SVF, "sky_view_factor")
    L["radio_los_base"] = load_layer("radio_los_base", F_LOS, "radio_los_base")
    L["los_margin_m"] = load_layer("los_margin_m", F_LOS, "los_margin_m")
    L["themis_day_dn"] = load_layer("themis_day_dn", F_THEMIS_DAY, "themis_day_ir_dn")
    L["themis_night_dn"] = load_layer("themis_night_dn", F_THEMIS_NIGHT, "themis_night_ir_dn")
    L["slope_deg_scenario"] = _scenario_band("slope_deg_scenario", "slope_deg_escenario",
                                             "slope_procedencia")
    L["sky_view_factor_scenario"] = _scenario_band("sky_view_factor_scenario", "svf_escenario",
                                                   "svf_procedencia")
    L["radio_los_base_scenario"] = _scenario_band("radio_los_base_scenario",
                                                  "radio_los_base_escenario",
                                                  "radio_los_procedencia")
    L["thermal_inertia_tiu_scenario"] = _scenario_band(
        "thermal_inertia_tiu_scenario", "thermal_inertia_tiu_escenario",
        "thermal_inertia_procedencia")
    L["h2o_wt_pct_scenario"] = hydration_layer(L["elev_m"])
    _check_same_grid(L, ["elev_m", "slope_deg", "aspect_deg", "horizon_max_deg",
                         "sky_view_factor", "radio_los_base", "los_margin_m",
                         "slope_deg_scenario", "sky_view_factor_scenario",
                         "radio_los_base_scenario", "thermal_inertia_tiu_scenario"])
    return L


def _check_same_grid(L: dict[str, Layer], names: list[str]) -> None:
    ref = L[names[0]]
    for n in names[1:]:
        lay = L[n]
        if lay.shape != ref.shape or not lay.transform.almost_equals(ref.transform, 1e-12):
            raise ValueError(f"{n} no comparte la malla de referencia de {names[0]}")


def pixel_area_m2(ref: Layer) -> np.ndarray:
    """Área de cada píxel de la malla de referencia sobre la esfera de Marte."""
    lat, _ = ref.pixel_centers()
    R = config.MARS_RADIUS_M
    t = ref.transform
    return (R * math.radians(abs(t.e))) * (R * math.radians(t.a) * np.cos(np.radians(lat)))
