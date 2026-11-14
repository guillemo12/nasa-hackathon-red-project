"""Construcción y escritura de las tablas Parquet de la malla H3 de la ruta."""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from .. import config
from . import aggregate, geo, layers, tables
from .constants import (
    CORRIDOR_HALFWIDTH_M,
    HEXGRID_BUILD_DIR,
    MAX_REPO_PARQUET_BYTES,
    PARQUET_COMPRESSION,
    PARQUET_COMPRESSION_LEVEL,
    RES_COARSE,
    RES_NAV,
    contract_table_path,
    full_table_path,
)


@dataclass
class Output:
    res: int
    full: pa.Table
    contract: pa.Table
    full_path: Path
    contract_path: Path
    full_bytes: int
    contract_bytes: int
    corridor_only: bool = False
    complete_path: Path | None = None
    complete_rows: int = 0


def _metadata(res: int, view: str, extra: dict | None = None) -> dict:
    to = layers.terrain_outputs()
    meta = {
        "producer": "red_atlas_p1.hexgrid (Persona 1)",
        "regenerate_with": "cd data/pipeline && uv run python -m red_atlas_p1.hexgrid",
        "generated_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "view": view,
        "h3_res": res,
        "h3_library": "h3 4.x (índices reales); longitud −180..180 vía config.lon180",
        "mars_radius_m": config.MARS_RADIUS_M,
        "h3_length_scale": config.H3_LENGTH_SCALE,
        "h3_area_scale": config.H3_AREA_SCALE,
        "mean_edge_m_mars": geo.mars_edge_length_m(res),
        "mean_area_m2_mars": geo.mars_area_m2(res),
        "aoi": config.AOI_ROUTE,
        "working_dem": to["working_dem"],
        "inputs": layers.REQUIRED_FILES,
        "provenance_codes": {"0": "sin_dato", "1": "medido", "2": "derivado", "3": "escenario"},
        "schema_doc": "data/nasa-layers/SCHEMA_HEXGRID.md",
    }
    if extra:
        meta.update(extra)
    return {b"red_atlas": json.dumps(meta, ensure_ascii=False).encode("utf-8")}


def write_parquet(table: pa.Table, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path, compression=PARQUET_COMPRESSION,
                   compression_level=PARQUET_COMPRESSION_LEVEL, row_group_size=65_536,
                   write_statistics=True)
    return path.stat().st_size


def node_cells(res: int) -> dict[str, int]:
    return {k: geo.cell_of(p["lat_pc_deg"], p["lon_e_deg"], res)
            for k, p in config.scenario_nodes().items()}


def corridor_mask(east: np.ndarray, north: np.ndarray, halfwidth_m: float) -> np.ndarray:
    """Celdas a menos de ``halfwidth_m`` de algún tramo (incluidos los nodos)."""
    nodes = config.scenario_nodes()
    lat0, lon0 = aggregate.base_origin()
    xy = {k: geo.local_en(np.array([p["lat_pc_deg"]]), np.array([p["lon_e_deg"]]), lat0, lon0)
          for k, p in nodes.items()}
    keep = np.zeros(east.shape, dtype=bool)
    for leg in config.scenario_legs().values():
        (ax, ay), (bx, by) = xy[leg["from"]], xy[leg["to"]]
        ax, ay, bx, by = float(ax[0]), float(ay[0]), float(bx[0]), float(by[0])
        dx, dy = bx - ax, by - ay
        t = np.clip(((east - ax) * dx + (north - ay) * dy) / (dx * dx + dy * dy), 0.0, 1.0)
        d = np.hypot(east - (ax + t * dx), north - (ay + t * dy))
        keep |= d <= halfwidth_m
    return keep


def build(res_list=(RES_NAV, RES_COARSE)) -> list[Output]:
    missing = layers.missing_inputs()
    if missing:
        raise FileNotFoundError(
            "Faltan COG de terreno; ejecuta antes `uv run python -m red_atlas_p1.terrain`: "
            + ", ".join(missing))
    L = layers.load_all()
    outs = []
    fine_parents = None
    for res in sorted(res_list, reverse=True):          # primero la fina: sus padres van a la gruesa
        if geo.mars_edge_length_m(res) < L["elev_m"].src_res_m:
            cols = aggregate.build_fine(geo.cells_in_aoi(config.AOI_ROUTE, res), L, res)
            fine_parents = np.unique(cols["h3_parent_res9"])
        else:
            include = fine_parents if res == RES_COARSE else None
            cols = aggregate.build_coarse(L, res, include=include)
        full = tables.full_table(cols, _metadata(res, "completa"))
        fpath, cpath = full_table_path(res), contract_table_path(res)
        out = Output(res, full, None, fpath, cpath, 0, 0)
        nbytes = write_parquet(full, fpath)
        if nbytes > MAX_REPO_PARQUET_BYTES:
            # Completa a build/ y en el repositorio solo el corredor de la ruta.
            out.complete_path = HEXGRID_BUILD_DIR / fpath.name
            out.complete_rows = full.num_rows
            write_parquet(full, out.complete_path)
            keep = corridor_mask(full["east_m"].to_numpy(), full["north_m"].to_numpy(),
                                 CORRIDOR_HALFWIDTH_M)
            full = full.filter(pa.array(keep)).replace_schema_metadata(_metadata(
                res, f"corredor de {CORRIDOR_HALFWIDTH_M:.0f} m alrededor de la ruta",
                {"complete_table": str(out.complete_path.relative_to(config.PIPELINE_DIR))}))
            out.full, out.corridor_only = full, True
            nbytes = write_parquet(full, fpath)
        out.full_bytes = nbytes
        out.contract = tables.contract_table(
            out.full, _metadata(res, "HexCellState64B (src/shared/src/lib.rs)"))
        out.contract_bytes = write_parquet(out.contract, cpath)
        outs.append(out)
    return outs
