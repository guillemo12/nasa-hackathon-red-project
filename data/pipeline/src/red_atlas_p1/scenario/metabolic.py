"""Modelo metabólico paramétrico del canónico (entregable, sección 3.1).

    M = 120 + η · 0,285 · W · v + W · v · sen θ / (0,25 · (1 − s))      [W]

W = peso con traje en N (masa × g de ``eva_thresholds.json``), v en m/s, θ en grados,
s = fracción de deslizamiento (0–1), η = factor de terreno derivado de la inercia térmica.
Conversión: 1 L O₂/min = 335 W; densidad del O₂ 1,429 g/L (STPD).

El término de pendiente no se acredita en bajada (θ < 0 → 0): el modelo no contempla
trabajo negativo y quitarlo sería optimista. Las cifras del canónico son todas en subida.
"""
from __future__ import annotations

import math

from red_atlas_p1 import config
from red_atlas_p1.scenario import constants as K


def _const(key: str) -> float:
    return float(config.load_thresholds()["constants"][key])


def suited_weight_n() -> float:
    """Peso en Marte de la masa con traje, en N (170 kg × 3,72076 m/s² ≈ 632,5 N)."""
    return _const("suited_mass_kg") * _const("g_mars_m_s2")


def w_per_l_min() -> float:
    """Equivalente energético del O₂: W por cada L/min (335)."""
    return _const("o2_energy_equiv_w_per_l_min")


def o2_density_g_l() -> float:
    """Densidad del O₂ en g/L STPD (1,429)."""
    return _const("o2_density_g_per_l_stpd")


def eta_from_tiu(tiu: float) -> float:
    """Factor de terreno η a partir de la inercia térmica THEMIS (TIU).

    >400 → 1,0 · 250–400 → 1,3 · 150–250 → 1,6 · <150 → 2,1. En las fronteras exactas
    (400, 250, 150) se toma el tramo inferior, coherente con «>400» y «<150» del canónico.
    """
    for lower, eta in K.ETA_TIU_BREAKS:
        if tiu > lower:
            return eta
    if tiu >= 150.0:
        return K.ETA_TIU_BREAKS[-1][1]
    return K.ETA_LOOSE


def metabolic_power_w(
    speed_m_s: float, slope_deg: float = 0.0, eta: float = 1.0, slip: float = 0.0
) -> float:
    """Potencia metabólica en W según el modelo del canónico."""
    if not 0.0 <= slip < 1.0:
        raise ValueError("la fracción de deslizamiento debe estar en [0, 1)")
    w = suited_weight_n()
    horizontal = eta * K.HORIZONTAL_COEF * w * speed_m_s
    grade = w * speed_m_s * max(math.sin(math.radians(slope_deg)), 0.0)
    return K.BASAL_POWER_W + horizontal + grade / (K.MUSCLE_EFFICIENCY * (1.0 - slip))


def o2_l_min(power_w: float) -> float:
    """Consumo de O₂ en L/min STPD para una potencia metabólica en W."""
    return power_w / w_per_l_min()


def o2_g_min(power_w: float) -> float:
    """Consumo de O₂ en g/min para una potencia metabólica en W."""
    return o2_l_min(power_w) * o2_density_g_l()


def speed_for_power_m_s(
    power_w: float, slope_deg: float = 0.0, eta: float = 1.0, slip: float = 0.0
) -> float:
    """Inversa del modelo: velocidad (m/s) que produce ``power_w``. Útil para reconstruir
    las «velocidades reducidas» que el canónico no publica."""
    per_speed = metabolic_power_w(1.0, slope_deg, eta, slip) - K.BASAL_POWER_W
    return (power_w - K.BASAL_POWER_W) / per_speed
