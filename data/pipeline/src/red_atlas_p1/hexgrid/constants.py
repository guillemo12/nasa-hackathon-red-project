"""Constantes de la malla H3: umbrales, códigos de procedencia, rutas y centinelas.

Los umbrales de color salen de ``data/mission-scenarios/eva_thresholds.json``. Dos umbrales
de bandera no están en ese JSON y solo existen en el contrato de P3
(``src/shared/src/lib.rs``): ``SHELTER_SVF_MAX`` (0,20) e ``ISRU_WATER_MIN_PCT`` (12 %).
Se declaran aquí, con la fuente citada, y un test los contrasta con ``lib.rs`` cuando el
fichero existe.
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
# Solo en lib.rs (P3); no están en eva_thresholds.json.
SHELTER_SVF_MAX = np.float32(0.20)        # lib.rs: SHELTER_SVF_MAX, «<= 0.20»
ISRU_WATER_MIN_PCT = np.float32(12.0)     # lib.rs: ISRU_WATER_MIN_PCT, «>= 12 %»


def _red_limit(threshold_id: str) -> np.float32:
    """Primer número de la cadena «red» de un umbral (p. ej. «>20» -> 20, «<-100 o …» -> -100)."""
    for t in config.load_thresholds()["thresholds"]:
        if t["id"] == threshold_id:
            m = re.search(r"[<>]\s*(-?\d+(?:\.\d+)?)", t["red"])
            if not m:
                raise ValueError(f"No se puede leer el umbral rojo de {threshold_id}: {t['red']}")
            return np.float32(float(m.group(1)))
    raise KeyError(threshold_id)


@cache
def flag_thresholds() -> dict[str, np.float32]:
    """Umbrales de bandera en float32, igual que los compara el motor en Rust."""
    return {
        "slope_red_gt_deg": _red_limit("slope_deg"),               # «>20»
        "tiu_red_lt": _red_limit("thermal_inertia_tiu"),          # «<150»
        "rssi_red_lt_dbm": _red_limit("radio_rssi_dbm"),          # «<-100»
        "svf_shelter_le": SHELTER_SVF_MAX,
        "h2o_isru_ge_pct": ISRU_WATER_MIN_PCT,
    }


# --- Banderas de HexCellState64B (src/shared/src/lib.rs) ---------------------------------
HAZARD_FLAG_SLOPE_CRITICAL = 1 << 0
HAZARD_FLAG_REGOLITH_TRAP = 1 << 1
HAZARD_FLAG_SHELTER = 1 << 2
HAZARD_FLAG_NLOS = 1 << 3
HAZARD_FLAG_ISRU_WATER = 1 << 4

# --- Centinelas del contrato P3 -----------------------------------------------------
# P3 no tiene lector de Parquet ni campos opcionales. Los flotantes sin dato se escriben como
# nulos de Parquet (float32 anulable), no como 0.0 de `Default`: 0 TIU activaría la bandera de
# trampa de regolito y η = 2,1. `horizon_hash_id` = 0 es el valor de `Default`.
HORIZON_HASH_ID_UNSET = 0
PADDING_CRC_ZEROS = bytes(14)
