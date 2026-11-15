"""Presión superficial y columna de CO₂ en un nodo, con la fórmula del proyecto.

    P = 610 Pa · exp(−z / 11,1 km)          columna = P / g     (1 kg/m² = 0,1 g/cm²)

Es la fórmula que reproducía los 724 Pa y 19,5 g/cm² del sitio original (−1.905 m). Con la
Base reubicada a −1.660 m (DTM CTX 20 m) da ≈708 Pa y ≈19,0 g/cm².
"""
from __future__ import annotations

import math

from red_atlas_pipeline import config
from red_atlas_pipeline.scenario import constants as K


def surface_pressure_pa(elev_m: float) -> float:
    """Presión superficial (Pa) a la cota ``elev_m`` sobre el areoide."""
    return K.SCALE_PRESSURE_PA * math.exp(-elev_m / K.SCALE_HEIGHT_M)


def column_g_cm2(pressure_pa: float) -> float:
    """Columna atmosférica (≈ CO₂) en g/cm² para una presión superficial en Pa."""
    g = float(config.load_thresholds()["constants"]["g_mars_m_s2"])
    return pressure_pa / g / 10.0


def node_atmosphere(node_id: str) -> tuple[float, float]:
    """(presión en Pa, columna en g/cm²) en un nodo del GeoJSON."""
    p = surface_pressure_pa(float(config.scenario_nodes()[node_id]["elev_mola_m"]))
    return p, column_g_cm2(p)
