"""Radiación SPE: tasa local según el Sky View Factor, perfiles temporales y dosis.

Tasa local (mSv/h) = tasa externa a cielo abierto (mSv/h) × factor de exposición.
El factor de exposición es el SVF en la alcoba de WP3 (0,15) y 1,0 en marcha, que es el
convenio del canónico («cielo abierto»; ver ``constants.OPEN_SKY_DOSE_FACTOR``).

Los perfiles de tasa externa son funciones lineales a trozos definidas por nudos
``(minuto T, mSv/h)`` en ``constants.SPE_PROFILES``.
"""
from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np

from red_atlas_pipeline.scenario import constants as K

Knots = Sequence[tuple[float, float]]


def local_dose_rate_msv_h(external_msv_h: float, svf: float) -> float:
    """Tasa de dosis local bajo un cielo visible ``svf`` (0–1), en mSv/h."""
    if not 0.0 <= svf <= 1.0:
        raise ValueError("el SVF debe estar en [0, 1]")
    return external_msv_h * svf


def shielding_reduction(svf: float) -> float:
    """Fracción de la dosis bloqueada por la topografía (1 − SVF). WP3: 0,85."""
    return 1.0 - svf


def dose_msv(rate_msv_h: float, minutes: float) -> float:
    """Dosis acumulada a tasa constante, en mSv."""
    return rate_msv_h * minutes / 60.0


def time_to_budget_min(rate_msv_h: float, budget_msv: float = K.SPE_BUDGET_MSV,
                       already_msv: float = 0.0) -> float:
    """Minutos hasta agotar el presupuesto de dosis SPE a tasa constante (inf si tasa 0)."""
    if rate_msv_h <= 0.0:
        return float("inf")
    return max(budget_msv - already_msv, 0.0) / rate_msv_h * 60.0


def profile_rate(knots: Knots, t_min: float) -> float:
    """Tasa externa (mSv/h) del perfil en el minuto ``t_min``: 0 antes del primer nudo,
    interpolación lineal entre nudos y último valor mantenido después del último."""
    ts = [k[0] for k in knots]
    if t_min < ts[0]:
        return 0.0
    vs = [k[1] for k in knots]
    return float(np.interp(t_min, ts, vs))


def profile(name: str) -> Callable[[float], float]:
    knots = K.SPE_PROFILES[name]
    return lambda t: profile_rate(knots, t)


def integrate_dose_msv(rate_fn: Callable[[float], float], t0: float, t1: float,
                       factor: float = 1.0, step_min: float = 0.05) -> float:
    """Dosis (mSv) entre ``t0`` y ``t1`` (minutos) con la regla del punto medio. Es exacta en
    los perfiles lineales a trozos cuando los nudos caen en la rejilla (minutos enteros) y no
    muestrea los extremos, así que un escalón en ``t1`` (inicio de la envolvente) no se cuela
    en el intervalo anterior."""
    if t1 <= t0:
        return 0.0
    n = max(round((t1 - t0) / step_min), 1)
    h = (t1 - t0) / n
    ts = t0 + h * (np.arange(n) + 0.5)
    rates = np.array([rate_fn(t) for t in ts]) * factor
    return float(rates.sum() * h / 60.0)
