// Lo que el motor hace con los puntos que marca la astronauta: desvíos de la ruta, tramos
// inalcanzables y la redecisión de emergencia con los refugios marcados. Lo usan las tres
// pantallas; todas las cifras vienen del motor Rust.
import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Notice, Row } from '@/components/ui';
import { fetchEmergency } from '@/engine/apiClient';
import { fmt, fmtCoords, nodeLabel } from '@/engine/geo';
import { formatT } from '@/engine/evaModel';
import { PALETTE } from '@/theme';
import type { EmergencyDecision, PlannedLeg, ReportedKind, ReportedPoint, RoutePlan } from '@/types/mission';

export const POINT_COLOR: Record<ReportedKind, string> = {
  PELIGRO: PALETTE.red,
  REFUGIO: PALETTE.green,
  ISRU: PALETTE.cyan,
};

const signed = (v: number | undefined, decimals: number) =>
  v === undefined ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, decimals)}`;

const legName = (l: PlannedLeg) => `${l.leg_id} (${nodeLabel(l.from)} → ${nodeLabel(l.to)})`;

const listText = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;

/** Una frase por tramo afectado. `null` si no hay puntos. */
export function routeImpactLines(plan: RoutePlan | null): Array<{ level: 'amber' | 'red' | 'green' | 'none'; text: string }> | null {
  if (!plan?.reported_points?.length) return null;
  const hazards = plan.reported_points.filter((p) => p.kind === 'PELIGRO');
  const out: Array<{ level: 'amber' | 'red' | 'green' | 'none'; text: string }> = [];
  for (const leg of plan.legs) {
    const d = leg.deviation;
    if (!d) continue;
    if (d.status === 'inalcanzable') {
      out.push({
        level: 'red',
        text: `${legName(leg)} es inalcanzable: ${d.reason ?? 'no hay camino'}. El motor no inventa una ruta: hay que borrar el punto o decidir otro destino.`,
      });
    } else if (d.status === 'desviada') {
      const causes = listText(d.caused_by.map((c) => c.label));
      const dt = d.added_time_min ?? 0;
      const timeText = Math.abs(dt) < 0.05 ? 'sin tiempo añadido' : `${signed(dt, 1)} min`;
      out.push({
        level: 'amber',
        text: `${legName(leg)} se desvía por ${causes || 'los peligros marcados'}: ${signed(d.added_length_m, 0)} m, ${timeText}, ${signed(d.added_o2_liters, 2)} L de O₂. Pasa a ${fmt(d.min_distance_to_hazard_m ?? null)} m del punto más cercano (ruta buscada en ${d.search}).`,
      });
    }
  }
  if (out.length === 0 && hazards.length > 0) {
    out.push({ level: 'green', text: `Ningún tramo pasa a menos de ${fmt(plan.hazard_model?.caution_radius_m ?? null)} m de los peligros marcados: la ruta no cambia.` });
  }
  return out;
}

/** Avisos del efecto de los puntos sobre la ruta. */
export const RouteImpact: React.FC<{ plan: RoutePlan | null; className?: string }> = ({ plan, className }) => {
  const lines = routeImpactLines(plan);
  if (!lines || lines.length === 0) return null;
  return (
    <div className={`space-y-2 ${className ?? ''}`} aria-live="polite">
      {lines.map((l, i) => (
        <Notice key={i} level={l.level} role={l.level === 'red' ? 'alert' : 'status'}>
          {l.text}
        </Notice>
      ))}
    </div>
  );
};

/** Lista de puntos marcados con lo que el motor hace con cada uno. */
export const PointList: React.FC<{ points: ReportedPoint[]; onRemove?: (id: number) => void; busy?: boolean }> = ({ points, onRemove, busy }) => {
  if (points.length === 0) return <p className="text-sm text-ink-3">Sin puntos marcados.</p>;
  return (
    <ul className="divide-y divide-line">
      {points.map((p) => (
        <li key={p.id} className="flex items-start gap-3 py-2">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: POINT_COLOR[p.kind] }} aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-ink">
              <span className="font-medium">{p.label}</span>
              <span className="text-ink-3 num"> · {fmtCoords(p.lat, p.lon_e)}{p.t_min !== null ? ` · marcado en ${formatT(p.t_min)}` : ''}</span>
            </p>
            <p className="text-ink-2">{p.effect}</p>
            {p.cell && (
              <p className="t-label text-ink-3 num">
                Celda: pendiente {fmt(p.cell.slope_deg, 1)}°, SVF {fmt(p.cell.sky_view_factor, 2)}
                {p.kind === 'REFUGIO' ? (p.cell.dtm_shelter ? ' (la malla del terreno lo da como abrigo)' : ' (la malla del terreno lo da a cielo abierto)') : ''}
                {p.kind === 'ISRU' ? `, H₂O ${p.cell.isru_h2o_pct === null ? 'sin dato en la malla' : `${fmt(p.cell.isru_h2o_pct, 1)} % (valor de escenario de P1, no medido)`}` : ''}
              </p>
            )}
          </div>
          {onRemove && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(p.id)}
              aria-label={`Borrar ${p.label}`}
              title={`Borrar ${p.label}`}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
};

/**
 * Frase para cuando la redecisión del motor con los puntos marcados no coincide con el escenario
 * canónico (refugio WP3 a `canonicalWp3Min`), o `null` si coincide.
 */
export function redecisionDiffers(
  data: EmergencyDecision | null,
  canonicalWp3Min: number
): { level: 'amber' | 'red'; text: string } | null {
  if (!data || data.error) return null;
  const chosen = data.candidates.find((c) => c.chosen);
  const sameTarget = data.dynamic_goal_switched && data.chosen_id === 'WP3' && Boolean(chosen?.reachable);
  const t = chosen?.escape?.time_min;
  if (sameTarget && t !== undefined && Math.abs(t - canonicalWp3Min) < 0.05) return null;
  const canon = `La tarjeta de evacuación, la voz y la cronología siguen el escenario canónico: WP3 a ${fmt(canonicalWp3Min, 1)} min.`;
  return { level: decisionLevel(data), text: `Con los puntos marcados, en ${formatT(data.decision_t_min)}: ${decisionSentence(data)} ${canon}` };
}

function decisionLevel(data: EmergencyDecision): 'amber' | 'red' {
  const chosen = data.candidates.find((c) => c.chosen);
  return !chosen?.reachable && !data.base_feasible ? 'red' : 'amber';
}

/** Lo que haría el motor en T+105, en una frase. */
function decisionSentence(data: EmergencyDecision): string {
  const chosen = data.candidates.find((c) => c.chosen);
  if (data.dynamic_goal_switched && chosen?.reachable && chosen.escape) {
    return `el motor iría a ${chosen.label}, ${fmt(chosen.escape.time_min, 1)} min de escape${chosen.dtm_confirms_shelter ? '' : ' (la malla lo da a cielo abierto: es el último recurso)'}.`;
  }
  const noShelter = !data.candidates.some((c) => c.reachable);
  const base = data.base ? `${fmt(data.base.time_min, 1)} min de retorno` : 'sin ruta de retorno';
  if (noShelter && !data.base_feasible) {
    return `no queda ningún refugio alcanzable y la Base no es viable (${base} frente a ${fmt(data.t_vital_min, 1)} min de margen vital). Hay que borrar o revisar los peligros marcados.`;
  }
  if (noShelter) return `no queda ningún refugio alcanzable; el motor volvería a la Base (${base}).`;
  return `el motor volvería a la Base (${base}).`;
}

/** Redecisión de emergencia (T+105) del motor con los puntos marcados. */
export function useEmergency(version: number, enabled: boolean): EmergencyDecision | null {
  const [data, setData] = useState<EmergencyDecision | null>(null);
  useEffect(() => {
    if (!enabled || version < 0) {
      setData(null);
      return;
    }
    let active = true;
    fetchEmergency(version)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null));
    return () => {
      active = false;
    };
  }, [version, enabled]);
  return data;
}

export const EmergencyRedecision: React.FC<{ data: EmergencyDecision | null; canonicalWp3Min: number }> = ({ data, canonicalWp3Min }) => {
  if (!data) return <p className="text-sm text-ink-3">Calculando la redecisión…</p>;
  if (data.error) return <Notice level="red">El motor no ha podido rehacer la decisión: {data.error}</Notice>;
  const level = decisionLevel(data);
  return (
    <div className="space-y-3 text-sm">
      {level === 'red' ? (
        <Notice level="red" role="alert">
          En {formatT(data.decision_t_min)}, desde WP2: {decisionSentence(data)}
        </Notice>
      ) : (
        <p className="text-ink">
          En {formatT(data.decision_t_min)}, desde WP2: {decisionSentence(data)} En el escenario canónico, WP3 a {fmt(canonicalWp3Min, 1)} min.
        </p>
      )}
      <ul className="divide-y divide-line">
        {data.candidates.map((c) => (
          <li key={c.id} className="py-1.5">
            <Row
              label={
                <span>
                  {c.chosen ? '● ' : ''}
                  {c.label}
                  {c.reported ? ' · marcado' : ''}
                </span>
              }
              value={
                c.reachable && c.escape
                  ? `${fmt(c.escape.time_min, 1)} min · ${fmt(c.escape.length_m)} m · SVF ${fmt(c.cell_svf, 2)}${c.dtm_confirms_shelter ? '' : ' (sin confirmar)'}`
                  : c.on_grid
                    ? 'Inalcanzable'
                    : 'Fuera de la malla'
              }
              level={c.reachable ? (c.dtm_confirms_shelter ? 'green' : 'amber') : 'red'}
            />
          </li>
        ))}
      </ul>
      <p className="t-label text-ink-3">{data.rule}</p>
      <p className="t-label text-ink-3">{data.canonical_note}</p>
    </div>
  );
};

export const ClearPointsButton: React.FC<{ count: number; onClear: () => void; busy?: boolean }> = ({ count, onClear, busy }) =>
  count > 0 ? (
    <Button size="sm" variant="quiet" onClick={onClear} disabled={busy}>
      <Trash2 className="w-4 h-4" aria-hidden />
      Borrar puntos ({count})
    </Button>
  ) : null;
