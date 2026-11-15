"""Punto de entrada: ``uv run python -m red_atlas_pipeline.hexgrid``.

Lee los COG de ``build/cog`` (generados por ``red_atlas_pipeline.terrain``), escribe las tablas
Parquet de resolución 12 y 9 en ``data/nasa-layers``, mide las consultas DuckDB y escribe
``SCHEMA_HEXGRID.md`` y ``hexgrid_duckdb_benchmark.json``.
"""
from __future__ import annotations

import json

from .. import config
from . import duckdb_demo, export, schema_doc
from .constants import BENCHMARK_JSON, RES_NAV, SCHEMA_MD


def main() -> None:
    outs = export.build()
    for o in outs:
        print(f"res {o.res}: {o.full.num_rows} celdas -> {o.full_path.name} "
              f"({o.full_bytes / 1e6:.2f} MB), {o.contract_path.name} "
              f"({o.contract_bytes / 1e6:.2f} MB){' [corredor]' if o.corridor_only else ''}")
    nav = next(o for o in outs if o.res == RES_NAV)
    bench = duckdb_demo.benchmark(nav.full_path)
    BENCHMARK_JSON.write_text(json.dumps(bench, ensure_ascii=False, indent=2, default=str) + "\n",
                              encoding="utf-8")
    SCHEMA_MD.write_text(schema_doc.render(outs, bench), encoding="utf-8")
    print(f"DuckDB: celda {bench['celda_por_indice']['mediana_ms']} ms, Spyglass "
          f"{bench['spyglass_radio']['mediana_ms']} ms (medianas)")
    for p in (BENCHMARK_JSON, SCHEMA_MD):
        print(f"escrito {p.relative_to(config.REPO_DIR)}")


if __name__ == "__main__":
    main()
