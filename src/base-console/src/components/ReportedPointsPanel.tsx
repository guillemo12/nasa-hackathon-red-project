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
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

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
        text: `${legName(leg)} is unreachable: ${d.reason ?? 'no path'}. The engine does not invent a route: delete the point or choose another destination.`,
      });
    } else if (d.status === 'desviada') {
      const causes = listText(d.caused_by.map((c) => c.label));
      const dt = d.added_time_min ?? 0;
      const timeText = Math.abs(dt) < 0.05 ? 'no added time' : `${signed(dt, 1)} min`;
      out.push({
        level: 'amber',
        text: `${legName(leg)} detours around ${causes || 'the marked hazards'}: ${signed(d.added_length_m, 0)} m, ${timeText}, ${signed(d.added_o2_liters, 2)} L of O₂. Passes ${fmt(d.min_distance_to_hazard_m ?? null)} m from the nearest point (route searched in ${d.search}).`,
      });
    }
  }
  if (out.length === 0 && hazards.length > 0) {
    out.push({ level: 'green', text: `No leg passes within ${fmt(plan.hazard_model?.caution_radius_m ?? null)} m of the marked hazards: the route is unchanged.` });
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
  if (points.length === 0) return <p className="text-sm text-ink-3">No marked points.</p>;
  return (
    <ul className="divide-y divide-line">
      {points.map((p) => (
        <li key={p.id} className="flex items-start gap-3 py-2">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: POINT_COLOR[p.kind] }} aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-ink">
              <span className="font-medium">{p.label}</span>
              <span className="text-ink-3 num"> · {fmtCoords(p.lat, p.lon_e)}{p.t_min !== null ? ` · marked at ${formatT(p.t_min)}` : ''}</span>
            </p>
            <p className="text-ink-2">{p.effect}</p>
            {p.cell && (
              <p className="t-label text-ink-3 num">
                Cell: slope {fmt(p.cell.slope_deg, 1)}°, SVF {fmt(p.cell.sky_view_factor, 2)}
                {p.kind === 'REFUGIO' ? (p.cell.dtm_shelter ? ' (the terrain grid marks it as sheltered)' : ' (the terrain grid marks it as open sky)') : ''}
                {p.kind === 'ISRU' ? `, H₂O ${p.cell.isru_h2o_pct === null ? 'no data in the grid' : `${fmt(p.cell.isru_h2o_pct, 1)}% (scenario value, not measured)`}` : ''}
              </p>
            )}
          </div>
          {onRemove && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(p.id)}
              aria-label={`Delete ${p.label}`}
              title={`Delete ${p.label}`}
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
  const canon = `The evacuation card, voice and timeline follow the canonical scenario: WP3 at ${fmt(canonicalWp3Min, 1)} min.`;
  return { level: decisionLevel(data), text: `With the marked points, at ${formatT(data.decision_t_min)}: ${decisionSentence(data)} ${canon}` };
}

function decisionLevel(data: EmergencyDecision): 'amber' | 'red' {
  const chosen = data.candidates.find((c) => c.chosen);
  return !chosen?.reachable && !data.base_feasible ? 'red' : 'amber';
}

/** Lo que haría el motor en T+105, en una frase. */
function decisionSentence(data: EmergencyDecision): string {
  const chosen = data.candidates.find((c) => c.chosen);
  if (data.dynamic_goal_switched && chosen?.reachable && chosen.escape) {
    return `the engine would go to ${chosen.label}, ${fmt(chosen.escape.time_min, 1)} min escape${chosen.dtm_confirms_shelter ? '' : ' (the grid marks it as open sky: last resort)'}.`;
  }
  const noShelter = !data.candidates.some((c) => c.reachable);
  const base = data.base ? `${fmt(data.base.time_min, 1)} min return` : 'no return route';
  if (noShelter && !data.base_feasible) {
    return `no reachable shelter is left and Base is not viable (${base} versus ${fmt(data.t_vital_min, 1)} min of life-support margin). Delete or review the marked hazards.`;
  }
  if (noShelter) return `no reachable shelter is left; the engine would return to Base (${base}).`;
  return `the engine would return to Base (${base}).`;
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
  if (!data) return <p className="text-sm text-ink-3">Computing the re-decision…</p>;
  if (data.error) return <Notice level="red">The engine could not redo the decision: {data.error}</Notice>;
  const level = decisionLevel(data);
  return (
    <div className="space-y-3 text-sm">
      {level === 'red' ? (
        <Notice level="red" role="alert">
          At {formatT(data.decision_t_min)}, from WP2: {decisionSentence(data)}
        </Notice>
      ) : (
        <p className="text-ink">
          At {formatT(data.decision_t_min)}, from WP2: {decisionSentence(data)} In the canonical scenario, WP3 at {fmt(canonicalWp3Min, 1)} min.
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
                  {c.reported ? ' · marked' : ''}
                </span>
              }
              value={
                c.reachable && c.escape
                  ? `${fmt(c.escape.time_min, 1)} min · ${fmt(c.escape.length_m)} m · SVF ${fmt(c.cell_svf, 2)}${c.dtm_confirms_shelter ? '' : ' (unconfirmed)'}`
                  : c.on_grid
                    ? 'Unreachable'
                    : 'Outside the grid'
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
      Clear points ({count})
    </Button>
  ) : null;
