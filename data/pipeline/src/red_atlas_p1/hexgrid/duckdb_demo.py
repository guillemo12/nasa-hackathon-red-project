"""Demostración de consultas DuckDB sobre la malla H3 (sin extensiones ni red).

Consultas del tipo de la Lupa Spyglass y perfiles de ruta:

* **Celda:** todos los atributos de una celda por ``h3_index``.
* **Vecindario Spyglass:** celdas en un radio métrico alrededor de un centro, repartidas en
  tres sectores de 120° por rumbo desde el centro, como en ``SpyglassTriSectorSlice`` de P3:
  norte (300°-60°) hidratación; derecha (60°-180°) inercia térmica; izquierda (180°-300°)
  pendiente, Sky View Factor y LOS. El radio se calcula en SQL con ``east_m``/``north_m``
  (metros reales en Marte). Variante topológica: anillo ``h3.grid_disk`` calculado en Python
  y pasado a SQL, porque la extensión H3 de DuckDB necesitaría red para instalarse.
* **Perfil de tramo:** celdas de ``h3.grid_path_cells`` entre los nodos del tramo, unidas a
  la tabla en el orden del recorrido.

Los tiempos se miden con ``time.perf_counter``: «en frío» = conexión nueva, vista y primera
consulta; «en caliente» = mediana y percentil 95 de N repeticiones sobre la misma conexión.
"""
from __future__ import annotations

import platform
import statistics
import time
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa

from .. import config
from . import geo
from .constants import RES_NAV, full_table_path

SECTORS = {
    "norte_hidratacion": "(bearing >= 300 OR bearing < 60)",
    "derecha_inercia_termica": "(bearing >= 60 AND bearing < 180)",
    "izquierda_pendiente_svf": "(bearing >= 180 AND bearing < 300)",
}

SECTOR_SQL = """
WITH c AS (SELECT east_m AS e0, north_m AS n0 FROM cells WHERE h3_index = $center),
nb AS (
  SELECT cells.*,
         sqrt((east_m - e0)^2 + (north_m - n0)^2) AS dist_m,
         (degrees(atan2(east_m - e0, north_m - n0)) + 360) % 360 AS bearing
  FROM cells, c
  WHERE east_m BETWEEN e0 - $r AND e0 + $r AND north_m BETWEEN n0 - $r AND n0 + $r
)
SELECT
  CASE WHEN bearing >= 300 OR bearing < 60 THEN 'norte_hidratacion'
       WHEN bearing < 180 THEN 'derecha_inercia_termica'
       ELSE 'izquierda_pendiente_svf' END AS sector,
  count(*) AS n_celdas,
  max(h2o_effective) AS h2o_max_pct,
  avg(CASE WHEN h2o_effective IS NOT NULL THEN 1.0 ELSE 0.0 END) AS h2o_cobertura,
  min(tiu_effective) AS tiu_min,
  avg(CASE WHEN tiu_effective IS NOT NULL THEN 1.0 ELSE 0.0 END) AS tiu_cobertura,
  avg(themis_night_dn) AS themis_noche_dn_media,
  max(slope_deg_effective) AS pendiente_max_deg,
  avg(slope_deg_effective) AS pendiente_media_deg,
  min(svf_effective) AS svf_min,
  avg(svf_effective) AS svf_medio,
  avg(los_base_effective) AS fraccion_con_los,
  bit_or(hazard_bitmask) AS banderas
FROM nb WHERE dist_m <= $r
GROUP BY sector ORDER BY sector
"""

CELLS_SQL = """
WITH c AS (SELECT east_m AS e0, north_m AS n0 FROM cells WHERE h3_index = $center),
nb AS (
  SELECT h3_index, h2o_effective, tiu_effective, slope_deg_effective, svf_effective,
         los_base_effective,
         sqrt((east_m - e0)^2 + (north_m - n0)^2) AS dist_m,
         (degrees(atan2(east_m - e0, north_m - n0)) + 360) % 360 AS bearing
  FROM cells, c
  WHERE east_m BETWEEN e0 - $r AND e0 + $r AND north_m BETWEEN n0 - $r AND n0 + $r
)
SELECT h3_index, bearing, h2o_effective, tiu_effective, slope_deg_effective, svf_effective,
       los_base_effective
FROM nb WHERE dist_m <= $r ORDER BY h3_index
"""

KRING_SQL = """
SELECT count(*) AS n_celdas, max(h2o_effective) AS h2o_max_pct, min(tiu_effective) AS tiu_min,
       max(slope_deg_effective) AS pendiente_max_deg, min(svf_effective) AS svf_min,
       bit_or(hazard_bitmask) AS banderas
FROM cells WHERE h3_index IN (SELECT unnest($ring::UBIGINT[]))
"""

PROFILE_SQL = """
SELECT p.i, c.h3_index, c.east_m, c.north_m, c.elev_m, c.slope_deg_effective,
       c.svf_effective, c.los_base_effective, c.los_margin_min_m, c.tiu_effective,
       c.hazard_bitmask
FROM path p LEFT JOIN cells c USING (h3_index) ORDER BY p.i
"""


def connect(parquet: Path) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute(f"CREATE VIEW cells AS SELECT * FROM read_parquet('{parquet.as_posix()}')")
    return con


def cell(con, h3_index: int) -> dict | None:
    cur = con.execute("SELECT * FROM cells WHERE h3_index = ?", [h3_index])
    rows = cur.fetchall()
    return dict(zip([d[0] for d in cur.description], rows[0])) if rows else None


def spyglass(con, center: int, radius_m: float) -> list[dict]:
    cur = con.execute(SECTOR_SQL, {"center": center, "r": radius_m})
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def spyglass_cells(con, center: int, radius_m: float) -> dict:
    """Listas por celda con la forma de ``SpyglassTriSectorSlice`` de P3, repartidas por
    sector de 120°: norte ``(h3, h2o)``, derecha ``(h3, tiu)``, izquierda
    ``(h3, pendiente, svf, los)``. P3 lleva RSSI en dBm en la cuarta posición; aquí va la LOS
    geométrica 0/1, porque P1 no tiene RSSI."""
    rows = con.execute(CELLS_SQL, {"center": center, "r": radius_m}).fetchall()
    out = {"center_h3": center, "crism_water_cells": [], "themis_trap_cells": [],
           "mola_slope_svf_cells": []}
    for h, b, h2o, tiu, slope, svf, los in rows:
        if b >= 300 or b < 60:
            out["crism_water_cells"].append((h, h2o))
        elif b < 180:
            out["themis_trap_cells"].append((h, tiu))
        else:
            out["mola_slope_svf_cells"].append((h, slope, svf, los))
    return out


def spyglass_kring(con, center: int, k: int) -> dict:
    ring = geo.grid_disk(center, k)
    cur = con.execute(KRING_SQL, {"ring": ring})
    return dict(zip([d[0] for d in cur.description], cur.fetchall()[0]))


def leg_profile(con, leg_id: str, res: int = RES_NAV) -> dict:
    """Perfil a lo largo de un tramo: filas en orden y resumen."""
    leg = config.scenario_legs()[leg_id]
    nodes = config.scenario_nodes()
    a, b = (geo.cell_of(nodes[k]["lat_pc_deg"], nodes[k]["lon_e_deg"], res)
            for k in (leg["from"], leg["to"]))
    path = geo.grid_path(a, b)
    con.register("path", pa.table({"i": pa.array(range(len(path)), pa.int32()),
                                   "h3_index": pa.array(path, pa.uint64())}))
    rows = con.sql(PROFILE_SQL).to_arrow_table()
    con.unregister("path")
    e, n = rows["east_m"].to_numpy(zero_copy_only=False), rows["north_m"].to_numpy(zero_copy_only=False)
    step = np.hypot(np.diff(e), np.diff(n))
    dist = np.concatenate([[0.0], np.cumsum(step)])
    z = rows["elev_m"].to_numpy(zero_copy_only=False)
    los = rows["los_base_effective"].to_numpy(zero_copy_only=False)
    slope = rows["slope_deg_effective"].to_numpy(zero_copy_only=False)
    return {
        "leg_id": leg_id,
        "n_celdas": rows.num_rows,
        "longitud_recta_m": float(np.hypot(e[-1] - e[0], n[-1] - n[0])),
        "longitud_camino_celdas_m": float(dist[-1]),
        "distancia_geojson_m": leg["distance_m"],
        "desnivel_m": float(z[-1] - z[0]),
        "desnivel_geojson_m": leg["delta_elev_m"],
        "pendiente_max_deg": float(np.nanmax(slope)),
        "pendiente_max_geojson_deg": leg["slope_max_deg"],
        "fraccion_sin_los": float(np.nanmean(los == 0)),
        "margen_los_min_m": float(np.nanmin(rows["los_margin_min_m"].to_numpy(
            zero_copy_only=False))),
        "celdas_sin_dato": int(np.isnan(z).sum()),
        "dist_m": dist,
        "rows": rows,
    }


def _timeit(fn, n: int) -> dict:
    ts = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t) * 1000.0)
    ts.sort()
    return {"n": n, "mediana_ms": round(statistics.median(ts), 3),
            "p95_ms": round(ts[min(n - 1, int(0.95 * n))], 3), "max_ms": round(ts[-1], 3)}


def benchmark(parquet: Path | None = None, res: int = RES_NAV, radius_m: float = 100.0,
              k: int = 10, n: int = 50) -> dict:
    parquet = parquet or full_table_path(res)
    nodes = config.scenario_nodes()
    centers = {k_: geo.cell_of(p["lat_pc_deg"], p["lon_e_deg"], res) for k_, p in nodes.items()}

    # «En frío» = conexión nueva; el Parquet suele estar ya en la caché del sistema
    # operativo (se acaba de escribir), así que no mide una lectura desde disco.
    t = time.perf_counter()
    con = connect(parquet)
    first = cell(con, centers["WP2"])
    cold_ms = (time.perf_counter() - t) * 1000.0
    n_rows = con.execute("SELECT count(*) FROM cells").fetchall()[0][0]

    out = {
        "parquet": str(parquet.relative_to(config.REPO_DIR)),
        "filas": n_rows,
        "duckdb": duckdb.__version__,
        "maquina": f"{platform.system()} {platform.machine()}, Python {platform.python_version()}",
        "frio_conexion_y_primera_celda_ms": round(cold_ms, 2),
        "celda_por_indice": _timeit(lambda: cell(con, centers["WP2"]), n * 4),
        "spyglass_radio": {"radio_m": radius_m,
                           **_timeit(lambda: spyglass(con, centers["WP3"], radius_m), n)},
        "spyglass_celdas": {"radio_m": radius_m,
                            **_timeit(lambda: spyglass_cells(con, centers["WP3"], radius_m), n)},
        "spyglass_kring": {"k": k, **_timeit(lambda: spyglass_kring(con, centers["WP3"], k), n)},
        "perfil_tramo": {leg: _timeit(lambda leg=leg: leg_profile(con, leg, res), max(5, n // 5))
                         for leg in config.scenario_legs()},
        "ejemplo_celda_wp2": {k_: first[k_] for k_ in (
            "h3_index", "elev_m", "slope_deg_effective", "tiu_effective", "tiu_effective_prov",
            "svf_effective", "los_base_effective", "hazard_bitmask")} if first else None,
        "ejemplo_spyglass_wp3": spyglass(con, centers["WP3"], radius_m),
        "ejemplo_spyglass_wp1": spyglass(con, centers["WP1"], radius_m),
        "perfiles": {leg: {k_: v for k_, v in leg_profile(con, leg, res).items()
                           if k_ not in ("rows", "dist_m")} for leg in config.scenario_legs()},
    }
    sc = spyglass_cells(con, centers["WP3"], radius_m)
    out["ejemplo_spyglass_celdas_wp3"] = {k_: len(v) for k_, v in sc.items() if k_ != "center_h3"}
    con.close()
    return out
