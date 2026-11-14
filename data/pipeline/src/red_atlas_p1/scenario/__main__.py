"""Punto de entrada: ``uv run python -m red_atlas_p1.scenario [directorio_salida]``.

Genera ``eva07_timeline.parquet``, ``eva07_events.json`` y ``SCHEMA_EVA07.md`` (por defecto en
``data/mission-scenarios``) e imprime un resumen de validación.
"""
from __future__ import annotations

import sys

from red_atlas_p1.scenario import export
from red_atlas_p1.scenario import timeline as tl


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    paths = export.export_all(argv[0] if argv else None)
    rows = tl.integrate()
    print(f"Parquet: {paths['parquet']} ({len(rows)} filas)")
    print(f"Eventos: {paths['events']}")
    print(f"Esquema: {paths['schema']}")
    for t in (28, 75, 98, 105, 114, 165):
        r = tl.row_at(rows, t)
        print(f"  T{t:+d}: O2 {r['o2_remaining_pct']:.1f} %  dosis SPE {r['dose_spe_msv']:.2f} mSv"
              f"  destino viable {r['viable_destination']}")
    for name, c in export.profile_comparison().items():
        print(f"  perfil {name}: escape {c['dose_escape_T105_T113_msv']:.2f} mSv, total "
              f"{c['dose_total_spe_msv']:.2f} mSv, Base 48 min {c['dose_return_base_48min_msv']:.2f} mSv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
