// Clasificador Verde/Ámbar/Rojo leído de `data/mission-scenarios/eva_thresholds.json` (P1).
// Los límites no se repiten en los componentes: se piden aquí por identificador.
import { EVA_THRESHOLDS } from '@/data/missionData';

export type Level = 'green' | 'amber' | 'red' | 'none';

export type ThresholdId =
  | 'slope_deg'
  | 'metabolic_rate_w'
  | 'o2_consumption_l_min'
  | 'thermal_inertia_tiu'
  | 'dust_tau_880nm'
  | 'wind_speed_m_s'
  | 'dose_rate_msv_h'
  | 'eva_spe_dose_budget_msv'
  | 'radio_rssi_dbm'
  | 'suit_pressure_kpa'
  | 'o2_primary_pct'
  | 'cooling_water_pct'
  | 'battery_pct'
  | 'walkback_margin_min'
  | 'shelter_sky_view_factor'
  | 'isru_h2o_wt_pct';

interface Band {
  /** Límite entre verde y ámbar. */
  amber: number;
  /** Límite entre ámbar y rojo. */
  red: number;
  /** `up`: cuanto mayor, peor. `down`: cuanto menor, peor. */
  worse: 'up' | 'down';
  unit: string;
}

const numbers = (text: string): number[] =>
  (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));

function parseBand(entry: { green: string; amber: string; unit: string }): Band | null {
  // El ámbar es siempre un intervalo «a-b» o «a a b»; los dos primeros números son sus extremos.
  const pair = entry.amber.match(/(-?\d+(?:\.\d+)?)\s*(?:-|a)\s*(-?\d+(?:\.\d+)?)/);
  if (!pair) return null;
  const lo = Math.min(Number(pair[1]), Number(pair[2]));
  const hi = Math.max(Number(pair[1]), Number(pair[2]));
  const green = entry.green.trim();
  // Verde «<x»: crece hacia el rojo. Verde «>x» o intervalo alto («28.0-30.5»): decrece.
  const worse: Band['worse'] = green.startsWith('<') || numbers(green)[0] < lo ? 'up' : 'down';
  return worse === 'up'
    ? { amber: lo, red: hi, worse, unit: entry.unit }
    : { amber: hi, red: lo, worse, unit: entry.unit };
}

const BANDS = new Map<string, Band>();
for (const entry of EVA_THRESHOLDS.thresholds) {
  const band = parseBand(entry);
  if (band) BANDS.set(entry.id, band);
}

/** Criterios binarios de P1 (verde cerrado; ámbar y rojo coinciden: «no apto»). */
const shelterEntry = EVA_THRESHOLDS.thresholds.find((t) => t.id === 'shelter_sky_view_factor');
const isruEntry = EVA_THRESHOLDS.thresholds.find((t) => t.id === 'isru_h2o_wt_pct');
const closedRange = (text: string): [number, number] => {
  const m = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
};
export const SHELTER_SVF_MAX: number = closedRange(shelterEntry?.green ?? '')[1];
export const ISRU_H2O_MIN_PCT: number = closedRange(isruEntry?.green ?? '')[0];

export function band(id: ThresholdId): Band | undefined {
  return BANDS.get(id);
}

/** Límite ámbar y rojo de un umbral, para rotular (`limits('slope_deg').red` = 20). */
export function limits(id: ThresholdId): { amber: number; red: number } {
  const b = BANDS.get(id);
  return { amber: b?.amber ?? NaN, red: b?.red ?? NaN };
}

/** Clase del valor según P1. Los valores frontera son ámbar, como en el JSON. */
export function classify(id: ThresholdId, value: number | null | undefined): Level {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'none';
  if (id === 'shelter_sky_view_factor') return value <= SHELTER_SVF_MAX ? 'green' : 'amber';
  if (id === 'isru_h2o_wt_pct') return value >= ISRU_H2O_MIN_PCT ? 'green' : 'amber';
  const b = BANDS.get(id);
  if (!b) return 'none';
  if (b.worse === 'up') {
    if (value < b.amber) return 'green';
    return value <= b.red ? 'amber' : 'red';
  }
  if (value > b.amber) return 'green';
  return value >= b.red ? 'amber' : 'red';
}

export const P1_CONSTANTS = EVA_THRESHOLDS.constants;

/**
 * Factor de terreno η(TIU) del modelo metabólico de P1 (`DATOS_CANONICOS_P1.md` §3,
 * `red_atlas_shared::TERRAIN_ETA_BY_TIU_BAND`). Los cortes 400 y 150 salen del umbral de TIU;
 * el corte intermedio (250) y los cuatro valores solo existen en el documento y en el motor.
 */
export function terrainEta(tiu: number | null | undefined): number | null {
  if (tiu === null || tiu === undefined || !Number.isFinite(tiu)) return null;
  const { amber, red } = limits('thermal_inertia_tiu');
  if (tiu > amber) return 1.0;
  if (tiu >= 250) return 1.3;
  if (tiu >= red) return 1.6;
  return 2.1;
}
