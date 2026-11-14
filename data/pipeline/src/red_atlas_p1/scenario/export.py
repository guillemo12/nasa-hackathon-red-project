"""Exportación de la EVA-07: Parquet minuto a minuto, JSON de hitos y ``SCHEMA_EVA07.md``.

Salida determinista (sin marcas de tiempo; mismo contenido en cada ejecución) y sin NaN ni
infinitos en el JSON.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from red_atlas_p1 import config
from red_atlas_p1.scenario import constants as K
from red_atlas_p1.scenario import metabolic as met
from red_atlas_p1.scenario import radiation as rad
from red_atlas_p1.scenario import radio, schema_doc
from red_atlas_p1.scenario import timeline as tl

TIMELINE_PARQUET = config.SCENARIO_DIR / "eva07_timeline.parquet"
EVENTS_JSON = config.SCENARIO_DIR / "eva07_events.json"
SCHEMA_MD = config.SCENARIO_DIR / "SCHEMA_EVA07.md"
SCHEMA_VERSION = "1.0"

# (t, id, título, amenaza principal o None)
MILESTONES: tuple[tuple[int, str, str, str | None], ...] = (
    (-45, "spyglass", "Inspección Spyglass de 3 sectores en la consola", None),
    (-30, "chaos_mode", "Chaos Mode: 10.000 simulaciones, 99,4 % de supervivencia", None),
    (-10, "zenoh_sync", "Sincronización de la sub-malla h3o al traje por Zenoh", None),
    (0, "salida", f"Salida de la Base con rumbo {config.scenario_legs()['L1']['bearing_deg']:.0f}°",
     None),
    (28, "llegada_wp1", "Llegada a WP1 (ISRU)", None),
    (75, "salida_wp1", "Objetivo ISRU cumplido; salida hacia WP2", None),
    (92, "nlos", "Amenaza 1: sombra de radio (NLOS) tras el espolón", "sombra_radio"),
    (98, "regolito", "Amenaza 2: regolito suelto en rampa de 22° (pico 3,2 L/min)", "trampa_regolito"),
    (105, "spe_polvo", "Amenazas 3 y 4: alerta SPE y frente de polvo; 4 amenazas activas", "spe"),
    (105, "dynamic_goal_switching", "Dynamic Goal Switching: destino Base → WP3", "spe"),
    (113, "llegada_wp3", "Llegada a WP3 tras 8 min de escape", "spe"),
    (114, "refugio_activo", "Bajo la cornisa: refugio activo", "spe"),
    (125, "pico_spe", "Pico del SPE: 8 mSv/h fuera, 1,2 mSv/h en la alcoba", "spe"),
    (140, "remite_spe", "Remite el pico del SPE", "spe"),
    (158, "zenoh_restablecido", "Enlace Zenoh restablecido por el repetidor del rover", "sombra_radio"),
    (165, "telemetria_final", "Telemetría final recibida en la consola", None),
)

_EVENT_FIELDS = (
    "o2_remaining_pct", "o2_remaining_g", "metabolic_power_w", "o2_l_min",
    "spe_ext_rate_cal_msv_h", "spe_local_rate_msv_h", "dose_spe_msv", "dose_spe_env_msv",
    "dose_spe_linear_msv", "dose_gcr_msv", "radio_rssi_dbm", "radio_class", "dust_tau",
    "base_time_min", "base_dose_proj_env_msv", "base_dose_proj_ramp_msv", "base_viable",
    "wp3_time_min", "wp3_dose_proj_env_msv", "wp3_dose_proj_ramp_msv", "wp3_viable",
    "viable_destination",
)


def _clean(v):
    if isinstance(v, float):
        if not math.isfinite(v):
            return None
        return round(v, 4)
    return v


def timeline_table(rows: list[dict]) -> pa.Table:
    table = pa.Table.from_pylist(rows)
    consts = config.load_thresholds()["constants"]
    meta = {
        "schema_version": SCHEMA_VERSION,
        "mission": "EVA-07",
        "time_unit": "min terrestres desde la salida (T+0 = 14:45 LMST)",
        "nominal_dose_profile": K.NOMINAL_PROFILE,
        "projection_dose_profile": K.PROJECTION_PROFILE,
        "spe_profiles_knots": json.dumps({k: list(map(list, v)) for k, v in K.SPE_PROFILES.items()}),
        "constants": json.dumps(consts, sort_keys=True),
        "doc": "data/mission-scenarios/SCHEMA_EVA07.md",
    }
    return table.replace_schema_metadata({k: str(v) for k, v in meta.items()})


def profile_comparison() -> dict:
    """Cifras clave de la radiación con los tres perfiles, para dejar a la vista la
    incoherencia del canónico (0,6 mSv con rampa frente a 6,4 mSv con envolvente)."""
    out = {}
    for name in K.SPE_PROFILES:
        fn = rad.profile(name)
        escape = rad.integrate_dose_msv(fn, 105, 113, K.OPEN_SKY_DOSE_FACTOR)
        entry = rad.integrate_dose_msv(fn, 113, 114, 0.15)
        refuge = rad.integrate_dose_msv(fn, 114, 165, 0.15)
        base = rad.integrate_dose_msv(fn, 105, 105 + K.SAFE_RETURN_TIME_MIN, K.OPEN_SKY_DOSE_FACTOR)
        out[name] = {
            "knots_t_min_msv_h": [list(k) for k in K.SPE_PROFILES[name]],
            "dose_escape_T105_T113_msv": round(escape, 4),
            "mean_rate_escape_msv_h": round(escape / (8 / 60), 4),
            "dose_arrival_T114_msv": round(escape + entry, 4),
            "dose_refuge_T114_T165_msv": round(refuge, 4),
            "dose_total_spe_msv": round(escape + entry + refuge, 4),
            "dose_return_base_48min_msv": round(base, 4),
            "base_viable_T105": base <= K.SPE_BUDGET_MSV,
            "wp3_viable_T105": escape <= K.SPE_BUDGET_MSV,
        }
    return out


def phase_record(p: tl.Phase) -> dict:
    """Fase como datos: intervalo, potencia y su origen, SVF, factor de dosis, tasa SPE
    externa (nominal y envolvente) al inicio y en el último minuto, y estado de cada amenaza."""
    nominal = rad.profile(K.NOMINAL_PROFILE)
    env = rad.profile(K.PROJECTION_PROFILE)
    return {
        "phase_id": p.phase_id, "t0": p.t0, "t1": p.t1, "act": p.act,
        "description": p.description, "location": p.location, "goal": p.goal,
        "power_w": round(p.power_w, 2), "power_source": p.power_source,
        "o2_l_min": round(met.o2_l_min(p.power_w), 4),
        "svf_geo": p.svf_geo, "dose_factor": p.dose_factor,
        "spe_ext_rate_cal_t0_msv_h": round(nominal(p.t0), 4),
        "spe_ext_rate_cal_last_msv_h": round(nominal(p.t1 - 1), 4),
        "spe_ext_rate_env_t0_msv_h": round(env(p.t0), 4),
        "active_threats": tl.phase_threats(p),
        "threat_states": tl.phase_threat_states(p),
    }


def _md_table(header: list[str], body: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join(lines)


def _es(x: float, nd: int = 2) -> str:
    """Número con coma decimal y punto de millar (convención del entregable)."""
    txt = f"{x:,.{nd}f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return txt


def schema_markdown(table: pa.Table) -> str:
    """Genera ``SCHEMA_EVA07.md`` a partir de la plantilla, del esquema Arrow y de los datos."""
    missing = [c for c in table.column_names if c not in schema_doc.COLUMN_DOCS]
    if missing:
        raise KeyError(f"columnas sin documentar en schema_doc.COLUMN_DOCS: {missing}")
    columns = _md_table(
        ["Columna", "Tipo", "Unidad", "Descripción"],
        [[f"`{f.name}`", str(f.type), *schema_doc.COLUMN_DOCS[f.name]] for f in table.schema],
    )
    phases_md = _md_table(
        ["Fase", "T", "Potencia (W)", "Origen", "Factor de dosis", "Tasa SPE nominal (mSv/h)",
         "Amenazas activas"],
        [[f"`{p.phase_id}`", f"{p.t0} → {p.t1}", _es(p.power_w, 1), f"`{p.power_source}`",
          _es(p.dose_factor), (f"{_es(r['spe_ext_rate_cal_t0_msv_h'])} → "
          f"{_es(r['spe_ext_rate_cal_last_msv_h'])}"),
          ", ".join(r["active_threats"]) or "—"]
         for p in tl.phases() for r in [phase_record(p)]],
    )
    sources = "\n".join(f"- `{k}`: {v}." for k, v in tl.POWER_SOURCES.items())
    comp = profile_comparison()
    profiles_md = _md_table(
        ["Perfil", "Nudos (T, mSv/h)", "Escape T+105–113 (mSv)", "Tasa media del escape (mSv/h)",
         "Dosis al llegar, T+114 (mSv)", "Refugio T+114–165 (mSv)", "Total SPE (mSv)",
         "Base en 48 min (mSv)"],
        [[f"`{name}`" + (" (nominal)" if name == K.NOMINAL_PROFILE else ""),
          " ".join(f"({int(t)}, {_es(v, 0)})" for t, v in c["knots_t_min_msv_h"]),
          _es(c["dose_escape_T105_T113_msv"]), _es(c["mean_rate_escape_msv_h"]),
          _es(c["dose_arrival_T114_msv"]), _es(c["dose_refuge_T114_T165_msv"]),
          f"**{_es(c['dose_total_spe_msv'])}**", _es(c["dose_return_base_48min_msv"])]
         for name, c in comp.items()],
    )
    return (schema_doc.TEMPLATE.replace("<<COLUMNS>>", columns)
            .replace("<<PHASES>>", phases_md)
            .replace("<<POWER_SOURCES>>", sources)
            .replace("<<PROFILES>>", profiles_md))


def events_document(rows: list[dict]) -> dict:
    events = []
    for t, eid, title, threat in MILESTONES:
        r = tl.row_at(rows, t)
        events.append({
            "t_min": t,
            "lmst": r["lmst"],
            "id": eid,
            "title": title,
            "threat": threat,
            "active_threats": [n for n in tl.THREATS if r[f"threat_{n}"]],
            "phase_id": r["phase_id"],
            "values": {k: _clean(r[k]) for k in _EVENT_FIELDS},
        })
    last = rows[-1]
    return {
        "schema_version": SCHEMA_VERSION,
        "mission": "EVA-07",
        "generator": "uv run python -m red_atlas_p1.scenario",
        "doc": "data/mission-scenarios/SCHEMA_EVA07.md",
        "time_unit": "min terrestres desde la salida (T+0 = 14:45 LMST)",
        "nominal_dose_profile": K.NOMINAL_PROFILE,
        "projection_dose_profile": K.PROJECTION_PROFILE,
        "events": events,
        "threat_windows_t_min": {k: list(v) for k, v in tl.THREAT_WINDOWS.items()},
        "power_sources": tl.POWER_SOURCES,
        "phases": [phase_record(p) for p in tl.phases()],
        "reference_figures": {
            "flat_1ms_w": round(met.metabolic_power_w(K.FLAT_SPEED_M_S), 2),
            "ramp10_w": round(met.metabolic_power_w(K.RAMP10_SPEED_M_S, 10.0), 2),
            "ramp20_w": round(met.metabolic_power_w(K.RAMP20_SPEED_M_S, 20.0), 2),
            "wp2_peak_w": round(met.metabolic_power_w(
                K.WP2_SPEED_M_S, K.WP2_SLOPE_DEG, met.eta_from_tiu(K.WP2_TIU), K.WP2_SLIP), 2),
            "fspl_2500m_db": round(radio.fspl_db(2500.0), 2),
            "rssi_los_2500m_dbm": round(radio.received_dbm(2500.0), 2),
            "rssi_nlos_2500m_dbm": round(radio.received_dbm(2500.0, los=False), 2),
            "diffraction_db_used": K.RADIO_DIFFRACTION_DB,
            "open_sky_window_min": round(rad.time_to_budget_min(K.SPE_PEAK_MSV_H), 2),
            "wp3_rate_msv_h": round(rad.local_dose_rate_msv_h(K.SPE_PEAK_MSV_H, 0.15), 3),
        },
        "spe_profile_comparison": profile_comparison(),
        "final": {
            "o2_remaining_pct": _clean(last["o2_remaining_pct"]),
            "dose_spe_msv": _clean(last["dose_spe_msv"]),
            "dose_spe_env_msv": _clean(last["dose_spe_env_msv"]),
            "dose_gcr_msv": _clean(last["dose_gcr_msv"]),
        },
    }


def export_all(out_dir: Path | None = None) -> dict[str, Path]:
    """Genera el Parquet, el JSON y el esquema en ``out_dir`` (por defecto
    ``data/mission-scenarios``)."""
    out_dir = Path(out_dir) if out_dir else config.SCENARIO_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = tl.integrate()
    parquet_path = out_dir / TIMELINE_PARQUET.name
    json_path = out_dir / EVENTS_JSON.name
    table = timeline_table(rows)
    pq.write_table(table, parquet_path, compression="zstd")
    schema_path = out_dir / SCHEMA_MD.name
    schema_path.write_text(schema_markdown(table), encoding="utf-8")
    doc = events_document(rows)
    json_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                         encoding="utf-8")
    return {"parquet": parquet_path, "events": json_path, "schema": schema_path}
