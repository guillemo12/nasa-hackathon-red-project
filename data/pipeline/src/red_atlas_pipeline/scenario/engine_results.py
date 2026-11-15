"""Resultados exportados por el motor Rust (``src/core-engine``), leídos en vez de copiados.

Se regeneran con ``cargo run --release --bin export_mission_results`` en ``src/core-engine``:

- ``data/mission-scenarios/planner_walkback.json``: Walkback Limit Dual en T+105 del
  planificador D* Lite sobre la malla H3 res. 12 real (longitud de camino, tiempo, velocidad y
  potencia medias, O₂ y dosis SPE de decisión de cada destino, T_vital, ventana a cielo abierto).
- ``data/mission-scenarios/chaos_mode_results.json``: Chaos Mode (Monte Carlo, semilla fija).

Modelo de dosis de decisión del motor: tasa de la envolvente medida en la alerta (8 mSv/h,
constante) × SVF de cada celda recorrida (sin SVF = cielo abierto). Es la **proyección** que usa
el Walkback; la dosis **acumulada** de la cronología sigue su perfil temporal (ver timeline).
"""
from __future__ import annotations

import json
import math
from functools import cache
from pathlib import Path

from red_atlas_pipeline import config

PLANNER_JSON = config.SCENARIO_DIR / "planner_walkback.json"
CHAOS_JSON = config.SCENARIO_DIR / "chaos_mode_results.json"

ROUTE_FIELDS = ("length_m", "time_min", "arrival_t_min", "mean_speed_mps", "mean_power_w",
                "o2_liters", "dose_spe_msv")
TOP_FIELDS = ("decision_t_min", "spe_rate_envelope_msv_h", "open_sky_window_min", "t_vital_min",
              "dose_budget_msv", "base_feasible", "active_target", "wp3", "base")


class EngineResultsError(RuntimeError):
    """Falta el JSON del motor o sus campos no cuadran con lo que usa la cronología."""


def _read(path: Path) -> dict:
    if not path.is_file():
        raise EngineResultsError(
            f"falta {path}; regenéralo con `cargo run --release --bin export_mission_results` "
            "en src/core-engine")
    return json.loads(path.read_text(encoding="utf-8"))


def validate_planner(d: dict) -> dict:
    """Comprueba que el JSON del planificador tiene todo lo que usa la cronología y que sus
    cifras son coherentes entre sí. Devuelve ``d`` o lanza ``EngineResultsError``."""
    missing = [k for k in TOP_FIELDS if k not in d]
    for dest in ("wp3", "base"):
        missing += [f"{dest}.{k}" for k in ROUTE_FIELDS if k not in d.get(dest, {})]
    if missing:
        raise EngineResultsError(f"planner_walkback.json sin campos: {', '.join(missing)}")
    t0 = float(d["decision_t_min"])
    for dest in ("wp3", "base"):
        r = d[dest]
        checks = {
            "arrival_t_min = decision_t_min + time_min":
                math.isclose(r["arrival_t_min"], t0 + r["time_min"], abs_tol=1e-6),
            "mean_speed_mps = length_m / time_min":
                math.isclose(r["mean_speed_mps"], r["length_m"] / (r["time_min"] * 60), rel_tol=1e-6),
            "valores positivos":
                all(float(r[k]) > 0 for k in ROUTE_FIELDS),
        }
        bad = [name for name, ok in checks.items() if not ok]
        if bad:
            raise EngineResultsError(f"planner_walkback.json, {dest}: no cuadra {', '.join(bad)}")
    if d["active_target"] != "WP3" or d["base_feasible"] is not False:
        raise EngineResultsError("planner_walkback.json: la decisión en T+105 no es «WP3, Base no viable»")
    return d


@cache
def planner() -> dict:
    """``planner_walkback.json`` validado."""
    return validate_planner(_read(PLANNER_JSON))


def route(dest: str) -> dict:
    """Ruta del planificador a ``"wp3"`` o ``"base"``."""
    return planner()[dest]


def route_mean_svf(dest: str) -> float:
    """SVF medio efectivo de la ruta en el modelo del motor: dosis / (envolvente × tiempo)."""
    r, d = route(dest), planner()
    return r["dose_spe_msv"] / (d["spe_rate_envelope_msv_h"] * r["time_min"] / 60.0)


def validate_chaos(d: dict) -> dict:
    rep = d.get("report", {})
    need = ("trials", "survival_rate_with_shelter_pct", "survival_rate_base_only_pct",
            "survived_with_wp3_shelter", "survived_base_only")
    missing = [k for k in need if k not in rep] + [k for k in ("seed", "limitations") if k not in d]
    if missing:
        raise EngineResultsError(f"chaos_mode_results.json sin campos: {', '.join(missing)}")
    for count, pct in (("survived_with_wp3_shelter", "survival_rate_with_shelter_pct"),
                       ("survived_base_only", "survival_rate_base_only_pct")):
        if not math.isclose(100 * rep[count] / rep["trials"], rep[pct], abs_tol=0.005):
            raise EngineResultsError(f"chaos_mode_results.json: {pct} no cuadra con {count}")
    return d


@cache
def chaos() -> dict:
    """``chaos_mode_results.json`` validado."""
    return validate_chaos(_read(CHAOS_JSON))


def chaos_summary() -> dict:
    """Resumen del Chaos Mode para las exportaciones."""
    d = chaos()
    rep = d["report"]
    return {
        "source": "data/mission-scenarios/chaos_mode_results.json",
        "generator": d.get("generator"),
        "seed": d["seed"],
        "trials": rep["trials"],
        "safe_with_shelter_pct": rep["survival_rate_with_shelter_pct"],
        "safe_base_only_pct": rep["survival_rate_base_only_pct"],
        "safe_with_shelter": rep["survived_with_wp3_shelter"],
        "safe_base_only": rep["survived_base_only"],
        "corridor": d.get("corridor"),
        "criterion": d.get("criterion"),
        "limitations": d["limitations"],
    }
