// Criterio de certificación del Chaos Mode en la consola.
//
// DECISIÓN PENDIENTE DE CONFIRMAR (H-16/H-17): los documentos de UX piden un estado de
// certificación que dependa del resultado («¿Ruta cumple requisitos?») pero ningún documento
// fija el requisito numérico. Se usa este, que no fuerza ningún resultado:
//   1. la pasada la ha ejecutado el motor Rust y ha terminado todas las simulaciones;
//   2. el cambio automático al refugio no empeora el retorno directo a la Base;
//   3. el resultado con refugio es compatible (3 σ de error de muestreo) con la referencia
//      exportada por P1 (`chaos_mode_results.json`).
import { CHAOS_REFERENCE } from '@/data/missionData';
import type { ChaosRun, ChaosState } from '@/types/mission';

export const CHAOS_VISIBLE_TRIALS = 100;

export interface Certification {
  authorized: boolean;
  completed: boolean;
  shelterPct: number;
  basePct: number;
  /** Error típico de muestreo del porcentaje con refugio, en puntos porcentuales. */
  sigmaPct: number;
  referencePct: number;
  consistentWithReference: boolean;
  shelterNotWorse: boolean;
  reason: string;
}

export function sigmaPct(pct: number, trials: number): number {
  const p = pct / 100;
  return 100 * Math.sqrt(Math.max(0, p * (1 - p)) / Math.max(1, trials));
}

export function certify(run: ChaosRun): Certification {
  const r = run.report;
  const shelterPct = r.survival_rate_with_shelter_pct;
  const basePct = r.survival_rate_base_only_pct;
  const referencePct = CHAOS_REFERENCE.report.survival_rate_with_shelter_pct;
  // El error se toma con la proporción de referencia (hipótesis nula: mismo modelo).
  const sigma = sigmaPct(referencePct, r.trials);
  const consistentWithReference = Math.abs(shelterPct - referencePct) <= 3 * sigma + 1e-9;
  const shelterNotWorse = r.survived_with_wp3_shelter >= r.survived_base_only;
  const completed = r.trials === run.trials && r.trials > 0;
  const authorized = completed && shelterNotWorse && consistentWithReference;
  let reason = 'Ruta autorizada: el cambio al refugio protege la misión y la pasada cuadra con la referencia de P1.';
  if (!completed) reason = 'La pasada no ha terminado todas las simulaciones.';
  else if (!shelterNotWorse) reason = 'El cambio al refugio da peor resultado que volver a la Base: hay que volver al trazado.';
  else if (!consistentWithReference)
    reason = 'La pasada se aparta de la referencia de P1 más de 3 σ: hay que revisar el trazado o repetirla.';
  return {
    authorized,
    completed,
    shelterPct,
    basePct,
    sigmaPct: sigma,
    referencePct,
    consistentWithReference,
    shelterNotWorse,
    reason,
  };
}

export function isCertified(chaos: ChaosState): boolean {
  return chaos.status === 'done' && chaos.run !== null && certify(chaos.run).authorized;
}
