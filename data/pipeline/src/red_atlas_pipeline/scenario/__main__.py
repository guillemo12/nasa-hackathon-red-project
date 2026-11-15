"""Punto de entrada: ``uv run python -m red_atlas_pipeline.scenario [directorio_salida]``.

Genera ``eva07_timeline.parquet``, ``eva07_events.json`` y ``SCHEMA_EVA07.md`` (por defecto en
``data/mission-scenarios``) e imprime un resumen de validación.
"""
from __future__ import annotations

import sys

from red_atlas_pipeline.scenario import export
from red_atlas_pipeline.scenario import timeline as tl


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    paths = export.export_all(argv[0] if argv else None)
    rows = tl.integrate()
    print(f"Parquet: {paths['parquet']} ({len(rows)} filas)")
    print(f"Eventos: {paths['events']}")
    print(f"Esquema: {paths['schema']}")
    for t in (28, 75, 98, 105, 114, 115, 165):
        r = tl.row_at(rows, t)
        print(f"  T{t:+d}: O2 {r['o2_remaining_pct']:.1f} %  dosis SPE {r['dose_spe_msv']:.2f} mSv"
              f"  destino viable {r['viable_destination']}")
    for name, c in export.profile_comparison().items():
        print(f"  perfil {name}: huida {c['dose_escape_msv']:.2f} mSv, total acumulado "
              f"{c['dose_total_spe_msv']:.2f} mSv")
    dd = export.decision_dose()
    print(f"  dosis de decisión (motor): WP3 {dd['wp3']['dose_spe_msv']:.2f} mSv, "
          f"Base {dd['base']['dose_spe_msv']:.2f} mSv")
    ch = export.eng.chaos_summary()
    print(f"  Chaos Mode: {ch['safe_with_shelter_pct']} % con refugio, {ch['safe_base_only_pct']} % solo Base")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
