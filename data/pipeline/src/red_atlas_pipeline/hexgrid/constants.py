"""Constantes de la malla H3: umbrales, códigos de procedencia, rutas y centinelas.

Todos los umbrales de bandera salen de ``data/mission-scenarios/eva_thresholds.json``,
incluidos el refugio (SVF <= 0,20) y el ISRU (H₂O >= 12 %), que antes solo existían en
``src/shared/src/lib.rs``. Un test los contrasta con ``lib.rs`` cuando el fichero existe.
"""
from __future__ import annotations

import re
from functools import cache
from pathlib import Path

import numpy as np

from .. import config

# --- Resoluciones -------------------------------------------------------------------
RES_NAV = config.H3_RES_NAV          # 12
RES_COARSE = config.H3_RES_THEMIS    # 9

# --- Procedencia (mismos códigos que terrain_outputs.json) ------------------------------
PROV_NONE, PROV_MEASURED, PROV_DERIVED, PROV_SCENARIO = 0, 1, 2, 3
PROV_NAMES = {0: "sin_dato", 1: "medido", 2: "derivado", 3: "escenario"}

# --- Rutas de salida ----------------------------------------------------------------
TERRAIN_OUTPUTS_JSON = config.LAYERS_DIR / "terrain_outputs.json"
SCENARIO_OVERLAY_GEOJSON = config.LAYERS_DIR / "scenario_overlay.geojson"
SCHEMA_MD = config.LAYERS_DIR / "SCHEMA_HEXGRID.md"
BENCHMARK_JSON = config.LAYERS_DIR / "hexgrid_duckdb_benchmark.json"
HEXGRID_BUILD_DIR = config.BUILD_DIR / "hexgrid"
LIB_RS = config.REPO_DIR / "src" / "shared" / "src" / "lib.rs"

# Si la tabla completa de resolución 12 supera este tamaño, en el repositorio queda solo un
# corredor alrededor de la ruta y la completa va a build/.
MAX_REPO_PARQUET_BYTES = 20_000_000
CORRIDOR_HALFWIDTH_M = 150.0

PARQUET_COMPRESSION = "zstd"
PARQUET_COMPRESSION_LEVEL = 9


def full_table_path(res: int) -> Path:
    return config.LAYERS_DIR / f"hexgrid_route_res{res}.parquet"


def contract_table_path(res: int) -> Path:
    return config.LAYERS_DIR / f"hexgrid_route_res{res}_hexcell64b.parquet"


# --- Umbrales de bandera ------------------------------------------------------------
# Todos salen de eva_thresholds.json. Refugio e ISRU son criterios binarios: se toman los
# extremos del rango verde, que es cerrado («0-0.20» -> SVF <= 0,20; «12-100» -> H2O >= 12).


def _spec(threshold_id: str) -> dict:
    for t in config.load_thresholds()["thresholds"]:
        if t["id"] == threshold_id:
            return t
    raise KeyError(f"{threshold_id} no está en eva_thresholds.json")


def _red_limit(threshold_id: str) -> np.float32:
    """Primer número de la cadena «red» de un umbral (p. ej. «>20» -> 20, «<-100 o …» -> -100)."""
    t = _spec(threshold_id)
    m = re.search(r"[<>]\s*(-?\d+(?:\.\d+)?)", t["red"])
    if not m:
        raise ValueError(f"No se puede leer el umbral rojo de {threshold_id}: {t['red']}")
    return np.float32(float(m.group(1)))


def _green_range(threshold_id: str) -> tuple[np.float32, np.float32]:
    """Extremos del rango verde cerrado «a-b»."""
    t = _spec(threshold_id)
    m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*", t["green"])
    if not m:
        raise ValueError(f"El verde de {threshold_id} no es un rango cerrado: {t['green']}")
    a, b = sorted((float(m.group(1)), float(m.group(2))))
    return np.float32(a), np.float32(b)


@cache
def flag_thresholds() -> dict[str, np.float32]:
    """Umbrales de bandera en float32, igual que los compara el motor en Rust."""
    return {
        "slope_red_gt_deg": _red_limit("slope_deg"),                    # «>20»
        "tiu_red_lt": _red_limit("thermal_inertia_tiu"),               # «<150»
        "rssi_red_lt_dbm": _red_limit("radio_rssi_dbm"),               # «<-100»
        "svf_shelter_le": _green_range("shelter_sky_view_factor")[1],  # «0-0.20»
        "h2o_isru_ge_pct": _green_range("isru_h2o_wt_pct")[0],         # «12-100»
    }


# --- Banderas de HexCellState64B (src/shared/src/lib.rs) ---------------------------------
HAZARD_FLAG_SLOPE_CRITICAL = 1 << 0
HAZARD_FLAG_REGOLITH_TRAP = 1 << 1
HAZARD_FLAG_SHELTER = 1 << 2
HAZARD_FLAG_NLOS = 1 << 3
HAZARD_FLAG_ISRU_WATER = 1 << 4

# --- Centinelas del contrato con el motor Rust -----------------------------------------------------
# El contrato del motor no tiene campos opcionales. Los flotantes sin dato se escriben como
# nulos de Parquet (float32 anulable), no como 0.0 de `Default`: 0 TIU activaría la bandera de
# trampa de regolito y η = 2,1. `horizon_hash_id` = 0 es el valor de `Default`.
HORIZON_HASH_ID_UNSET = 0
PADDING_CRC_ZEROS = bytes(14)
