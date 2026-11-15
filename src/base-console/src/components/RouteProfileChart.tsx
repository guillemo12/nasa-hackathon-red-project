import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CANONICAL_WAYPOINTS, PLANNED_LEGS, SUIT_SCENARIO, EVA07_EVENTS, waypoint } from '@/data/missionData';
import { P1_CONSTANTS, classify, limits, terrainEta } from '@/engine/thresholds';
import type { Level } from '@/engine/thresholds';
import { fmt, nodeLabel } from '@/engine/geo';
import { LEVEL_COLOR, PALETTE } from '@/theme';
import { Disclosure } from '@/components/ui';
import type { NodeId, RoutePlan, RouteSample } from '@/types/mission';

interface Props {
  plan: RoutePlan | null;
  selectedId?: NodeId;
  onSelect?: (id: NodeId) => void;
  /** Solo el perfil de cotas (panel inferior de Cartografía). */
  compact?: boolean;
}

interface Pt extends RouteSample {
  x: number; // distancia acumulada por la ruta, m
  leg: string;
  o2Pct: number;
  batPct: number;
}

const PAD_R = 16;
const TEXT = 12;

const SUIT_O2_G = EVA07_EVENTS[0].values.o2_remaining_g;

/** Tinte de una celda según su nivel: solo ámbar y rojo llevan color. */
const levelTint = (level: Level) =>
  level === 'amber' || level === 'red'
    ? { fill: LEVEL_COLOR[level], fillOpacity: 0.16 }
    : { fill: PALETTE.border, fillOpacity: 0.6 };

/**
 * Perfil de la ruta Base → WP1 → WP2 → WP3 → Base.
 * Con el motor de cálculo: camino real del planificador (cota, pendiente, potencia, O₂ y radio
 * celda a celda). Sin él: solo los cuatro nodos guardados, y se dice.
 *
 * El gráfico se dibuja al ancho real del contenedor para que el texto mida siempre 12 px.
 */
export const RouteProfileChart: React.FC<Props> = ({ plan, selectedId, onSelect, compact = false }) => {
  const [hover, setHover] = useState<Pt | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const w = Math.round(el.clientWidth);
      if (w > 0) setW(Math.max(260, w));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { pts, legSpans, total, fromPlan } = useMemo(() => {
    const out: Pt[] = [];
    const spans: Array<{ id: string; x0: number; x1: number }> = [];
    let offset = 0;
    let o2UsedG = 0;
    let whUsed = 0;
    const planned = plan
      ? PLANNED_LEGS.map((l) => plan.legs.find((p) => p.leg_id === l.id && !p.error))
      : [];
    const ok = plan !== null && planned.every(Boolean);
    if (ok) {
      for (const leg of planned) {
        if (!leg) continue;
        let prevT = 0;
        for (const smp of leg.profile) {
          const dt = smp.t_min - prevT;
          prevT = smp.t_min;
          if (smp.power_w !== null && dt > 0) {
            o2UsedG += (smp.power_w / P1_CONSTANTS.o2_energy_equiv_w_per_l_min) * dt * P1_CONSTANTS.o2_density_g_per_l_stpd;
            whUsed += (SUIT_SCENARIO.batteryDrawW * dt) / 60;
          }
          out.push({
            ...smp,
            x: offset + smp.d_m,
            leg: leg.leg_id,
            o2Pct: 100 - (100 * o2UsedG) / SUIT_O2_G,
            batPct: 100 - (100 * whUsed) / SUIT_SCENARIO.batteryWh,
          });
        }
        spans.push({ id: leg.leg_id, x0: offset, x1: offset + leg.length_m });
        offset += leg.length_m;
      }
    } else {
      for (const leg of PLANNED_LEGS) {
        const a = waypoint(leg.from);
        const b = waypoint(leg.to);
        if (!a || !b) continue;
        const mk = (w: typeof a, d: number): Pt => ({
          d_m: d, t_min: 0, elev_m: w.elevMolaM, grade_deg: null, speed_mps: null, power_w: null,
          tiu: w.tiu, svf: w.svfScenario, rssi_dbm: null, lat: w.lat, lon_e: w.lonE,
          x: offset + d, leg: leg.id, o2Pct: NaN, batPct: NaN,
        });
        if (out.length === 0) out.push(mk(a, 0));
        out.push(mk(b, leg.distanceM));
        spans.push({ id: leg.id, x0: offset, x1: offset + leg.distanceM });
        offset += leg.distanceM;
      }
    }
    return { pts: out, legSpans: spans, total: offset, fromPlan: ok };
  }, [plan]);

  const narrow = W < 560;
  const PAD_L = narrow ? 54 : 68;
  const plotW = W - PAD_L - PAD_R;

  const elevs = pts.map((p) => p.elev_m).filter((v): v is number => v !== null);
  const eMin = Math.floor(Math.min(...elevs) / 50) * 50;
  const eMax = Math.ceil(Math.max(...elevs) / 50) * 50;
  const X = (m: number) => PAD_L + (m / total) * plotW;

  // Gráfico principal: cotas con los nodos y, debajo, las filas de pendiente y terreno.
  const ELEV = { y: 24, h: compact ? 96 : 130 };
  const AXIS_Y = ELEV.y + ELEV.h + 16;
  const ROWS_Y = AXIS_Y + 12;
  const H = compact ? AXIS_Y + 8 : ROWS_Y + 48;
  const yE = (z: number) => ELEV.y + ELEV.h - ((z - eMin) / (eMax - eMin)) * ELEV.h;

  // Gráfico de detalle: potencia, consumibles y radio, con la misma escala horizontal.
  const POWER = { y: 24, h: 70 };
  const CONS = { y: POWER.y + POWER.h + 34, h: 60 };
  const RADIO_Y = CONS.y + CONS.h + 22;
  const H2 = RADIO_Y + 20;
  const powerMax = Math.max(P1_CONSTANTS.escape_power_cap_w, ...pts.map((p) => p.power_w ?? 0));
  const yP = (w: number) => POWER.y + POWER.h - (w / powerMax) * POWER.h;
  const yC = (pct: number) => CONS.y + CONS.h - ((pct - 80) / 20) * CONS.h;

  const line = (get: (p: Pt) => number | null) =>
    pts
      .filter((p) => get(p) !== null && Number.isFinite(get(p) as number))
      .map((p) => `${X(p.x).toFixed(1)},${(get(p) as number).toFixed(1)}`)
      .join(' ');

  const elevPath = line((p) => (p.elev_m === null ? null : yE(p.elev_m)));
  const nodeXs: Array<{ id: NodeId; x: number; elev: number; end?: boolean }> = [];
  PLANNED_LEGS.forEach((leg, i) => {
    const w = waypoint(leg.from);
    if (w) nodeXs.push({ id: leg.from, x: legSpans[i]?.x0 ?? 0, elev: w.elevMolaM });
  });
  const base = CANONICAL_WAYPOINTS[0];
  nodeXs.push({ id: base.id, x: total, elev: base.elevMolaM, end: true });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const m = ((px - PAD_L) / plotW) * total;
    if (m < 0 || m > total) return setHover(null);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - m) < Math.abs(best.x - m)) best = p;
    setHover(best);
  };

  const tickStep = (plotW / total) * 500 < 48 ? 1000 : 500;
  const kmTicks = Array.from({ length: Math.floor(total / tickStep) + 1 }, (_, i) => i * tickStep).filter(
    (m) => X(total) - X(m) > 40,
  );

  const axisText = { fill: PALETTE.muted, fontSize: TEXT } as const;
  const summary = `Route profile, ${fmt(total / 1000, 2)} km: elevation ${fmt(eMin)} to ${fmt(eMax)} metres${
    fromPlan ? '' : ' (only the four route points, no compute engine)'
  }`;

  const cursor = (y1: number, y2: number) =>
    hover && <line x1={X(hover.x)} x2={X(hover.x)} y1={y1} y2={y2} stroke={PALETTE.text} strokeOpacity="0.6" />;

  const radio = limits('radio_rssi_dbm');

  return (
    <div ref={wrapRef} className="w-full min-w-0 space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto select-none"
        role={onSelect ? 'group' : 'img'}
        aria-label={summary}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Cotas */}
        {[eMin, (eMin + eMax) / 2, eMax].map((z) => (
          <g key={z}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yE(z)} y2={yE(z)} stroke={PALETTE.border} />
            <text x={PAD_L - 8} y={yE(z) + 4} textAnchor="end" {...axisText}>
              {fmt(z)} m
            </text>
          </g>
        ))}
        {legSpans.slice(0, -1).map((s) => (
          <line key={s.id} x1={X(s.x1)} x2={X(s.x1)} y1={ELEV.y} y2={compact ? ELEV.y + ELEV.h : H - 4} stroke={PALETTE.border} />
        ))}
        {elevPath && (
          <>
            <polygon
              points={`${X(0)},${ELEV.y + ELEV.h} ${elevPath} ${X(total)},${ELEV.y + ELEV.h}`}
              fill={PALETTE.cyan}
              fillOpacity="0.07"
            />
            <polyline points={elevPath} fill="none" stroke={PALETTE.cyan} strokeWidth="2" strokeLinejoin="round" />
          </>
        )}

        {cursor(ELEV.y, compact ? ELEV.y + ELEV.h : H - 4)}

        {nodeXs.map((n, i) => {
          const key = `${n.id}-${i}`;
          const selected = selectedId === n.id && !n.end;
          const name = `${nodeLabel(n.id)}${n.end ? ' (return)' : ''}`;
          const label = `${name}, ${fmt(n.x / 1000, 2)} km, ${fmt(n.elev)} m`;
          const cxn = X(n.x);
          const cyn = yE(n.elev);
          return (
            <g
              key={key}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `Waypoint ${label}` : undefined}
              aria-pressed={onSelect ? selected : undefined}
              onClick={() => onSelect?.(n.id)}
              onFocus={(e) => setFocusId(e.currentTarget.matches(':focus-visible') ? key : null)}
              onBlur={() => setFocusId(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect?.(n.id);
                }
              }}
              style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}
            >
              <title>{label}</title>
              {/* Zona de pulsación de 32 px alrededor del punto */}
              <circle cx={cxn} cy={cyn} r="16" fill="transparent" />
              {focusId === key && <circle cx={cxn} cy={cyn} r="13" fill="none" stroke={PALETTE.accent} strokeWidth="2" />}
              {selected && <circle cx={cxn} cy={cyn} r="9" fill="none" stroke={PALETTE.accent} strokeWidth="1.5" />}
              <circle cx={cxn} cy={cyn} r={selected ? 5.5 : 4.5} fill={PALETTE.text} stroke={PALETTE.ground} strokeWidth="1.5" />
              <text
                x={Math.min(W - PAD_R - 2, Math.max(PAD_L + 4, cxn))}
                y={n.id === 'BASE' ? cyn + 18 : cyn - 13}
                textAnchor={n.end ? 'end' : i === 0 ? 'start' : 'middle'}
                fill={selected ? PALETTE.text : PALETTE.text2}
                fontSize={TEXT}
                fontWeight={selected ? 600 : 500}
              >
                {nodeLabel(n.id)}
              </text>
            </g>
          );
        })}

        {/* Eje de distancias */}
        {kmTicks.map((m) => (
          <text key={m} x={X(m)} y={AXIS_Y} textAnchor={m === 0 ? 'start' : 'middle'} {...axisText}>
            {fmt(m / 1000, 1)}
          </text>
        ))}
        <text x={W - PAD_R} y={AXIS_Y} textAnchor="end" {...axisText}>
          km
        </text>

        {!compact && (
          <>
            {/* Filas de pendiente y terreno por tramo */}
            {PLANNED_LEGS.map((leg, i) => {
              const s = legSpans[i];
              if (!s) return null;
              const a = waypoint(leg.from);
              const b = waypoint(leg.to);
              const level = classify('slope_deg', leg.maxSlopeDeg);
              const meanTiu = a && b ? (a.tiu + b.tiu) / 2 : null;
              const planned = plan?.legs.find((p) => p.leg_id === leg.id);
              const mid = (X(s.x0) + X(s.x1)) / 2;
              const span = X(s.x1) - X(s.x0);
              const wide = span > 250;
              const mediumW = span > 125;
              const small = span > 64;
              const tiny = span > 26;
              const eta = fmt(terrainEta(meanTiu), 1);
              const o2 = planned ? `${fmt(planned.o2_grams, 0)} g of O₂` : null;
              return (
                <g key={leg.id} fontSize={TEXT} textAnchor="middle">
                  <title>
                    {`${leg.id}: mean slope ${fmt(leg.meanSlopeDeg, 1)}°, max ${fmt(leg.maxSlopeDeg, 1)}°. Thermal inertia ${a?.tiu} to ${b?.tiu} TIU, walking cost ×${eta}${o2 ? `, ${o2}` : ''}.`}
                  </title>
                  <rect x={X(s.x0) + 1} y={ROWS_Y} width={Math.max(1, span - 2)} height={20} rx="3" {...levelTint(level)} />
                  <text x={mid} y={ROWS_Y + 14} fill={PALETTE.text}>
                    {wide
                      ? `${leg.id}: mean ${fmt(leg.meanSlopeDeg, 1)}°, max ${fmt(leg.maxSlopeDeg, 1)}°`
                      : mediumW
                        ? `${leg.id}: max ${fmt(leg.maxSlopeDeg, 1)}°`
                        : small
                          ? `${leg.id} ${fmt(leg.maxSlopeDeg, 0)}°`
                          : tiny
                            ? `${fmt(leg.maxSlopeDeg, 0)}°`
                            : ''}
                  </text>
                  <rect x={X(s.x0) + 1} y={ROWS_Y + 24} width={Math.max(1, span - 2)} height={20} rx="3" {...levelTint('none')} />
                  <text x={mid} y={ROWS_Y + 38} fill={PALETTE.text2}>
                    {wide
                      ? `${a?.tiu} to ${b?.tiu} TIU, cost ×${eta}${o2 ? `, ${o2}` : ''}`
                      : mediumW
                        ? `cost ×${eta}${planned ? `, ${fmt(planned.o2_grams, 0)} g O₂` : ''}`
                        : span > 40
                          ? `×${eta}`
                          : ''}
                  </text>
                </g>
              );
            })}
            <text x={PAD_L - 8} y={ROWS_Y + 14} textAnchor="end" {...axisText}>Slope</text>
            <text x={PAD_L - 8} y={ROWS_Y + 38} textAnchor="end" {...axisText}>Terrain</text>
          </>
        )}
      </svg>

      <div className="min-h-6 t-label text-ink-2 tabular-nums" aria-live="off">
        {hover ? (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="font-semibold text-ink">
              {hover.leg}, km {fmt(hover.x / 1000, 2)}
            </span>
            <span>Elevation {fmt(hover.elev_m, 0)} m</span>
            {hover.grade_deg !== null && (
              <span>
                Slope {hover.grade_deg > 0 ? '+' : ''}
                {fmt(hover.grade_deg, 1)}°
              </span>
            )}
            {hover.power_w !== null && <span>Power {fmt(hover.power_w)} W</span>}
            {hover.power_w !== null && <span>Speed {fmt(hover.speed_mps, 2)} m/s</span>}
            {hover.rssi_dbm !== null && <span>Radio {fmt(hover.rssi_dbm, 0)} dBm</span>}
            {Number.isFinite(hover.o2Pct) && <span>O₂ {fmt(hover.o2Pct, 1)} %</span>}
          </div>
        ) : (
          <span className="text-ink-3">
            {fromPlan
              ? onSelect
                ? 'Hover over the profile to read each point of the path. Waypoints are clickable.'
                : 'Hover over the profile to read each point of the path.'
              : 'Only the four route points stored in the mission data are drawn.'}
          </span>
        )}
      </div>

      {!compact && (
        <Disclosure summary="More route detail">
          {fromPlan ? (
            <div className="space-y-2">
              <svg
                viewBox={`0 0 ${W} ${H2}`}
                className="block w-full h-auto select-none"
                role="img"
                aria-label="Metabolic power, oxygen and battery versus distance, and radio link at each point of the path"
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
              >
                {legSpans.slice(0, -1).map((s) => (
                  <line key={s.id} x1={X(s.x1)} x2={X(s.x1)} y1={POWER.y} y2={RADIO_Y + 16} stroke={PALETTE.border} />
                ))}

                {/* Potencia metabólica del planificador, con los límites de la misión */}
                <text x={PAD_L} y={POWER.y - 10} fill={PALETTE.text2} fontSize={TEXT}>
                  Metabolic power (W)
                </text>
                <line x1={PAD_L} x2={W - PAD_R} y1={yP(0)} y2={yP(0)} stroke={PALETTE.border} />
                {(['amber', 'red'] as const).map((k) => {
                  const lim = limits('metabolic_rate_w')[k];
                  return (
                    <g key={k}>
                      <line x1={PAD_L} x2={W - PAD_R} y1={yP(lim)} y2={yP(lim)} stroke={LEVEL_COLOR[k]} strokeOpacity="0.5" strokeDasharray="4 4" />
                      <text x={PAD_L - 8} y={yP(lim) + (k === 'red' ? 0 : 8)} textAnchor="end" fill={LEVEL_COLOR[k]} fontSize={TEXT}>
                        {lim} W
                      </text>
                    </g>
                  );
                })}
                <polyline points={line((p) => (p.power_w === null ? null : yP(p.power_w)))} fill="none" stroke={PALETTE.text} strokeWidth="1.5" strokeLinejoin="round" />

                {/* Consumibles frente a distancia */}
                <text x={PAD_L} y={CONS.y - 10} fill={PALETTE.text2} fontSize={TEXT}>
                  {narrow
                    ? `O₂ (solid) and battery (dashed)`
                    : `Primary O₂ while walking (solid line) and battery at ${SUIT_SCENARIO.batteryDrawW} W (dashed)`}
                </text>
                {[100, 90, 80].map((pct) => (
                  <g key={pct}>
                    <line x1={PAD_L} x2={W - PAD_R} y1={yC(pct)} y2={yC(pct)} stroke={PALETTE.border} />
                    <text x={PAD_L - 8} y={yC(pct) + 4} textAnchor="end" {...axisText}>
                      {pct} %
                    </text>
                  </g>
                ))}
                <polyline points={line((p) => yC(p.o2Pct))} fill="none" stroke={PALETTE.text} strokeWidth="1.5" />
                <polyline points={line((p) => yC(p.batPct))} fill="none" stroke={PALETTE.text2} strokeWidth="1.5" strokeDasharray="5 4" />

                {/* Enlace de radio celda a celda */}
                {pts.slice(1).map((p, i) => {
                  const prev = pts[i];
                  const level = classify('radio_rssi_dbm', p.rssi_dbm);
                  return (
                    <rect
                      key={i}
                      x={X(prev.x)}
                      y={RADIO_Y}
                      width={Math.max(0.6, X(p.x) - X(prev.x) + 0.3)}
                      height={16}
                      fill={LEVEL_COLOR[level]}
                      fillOpacity="0.32"
                    />
                  );
                })}
                <text x={PAD_L - 8} y={RADIO_Y + 12} textAnchor="end" {...axisText}>
                  Radio
                </text>

                {cursor(POWER.y, RADIO_Y + 16)}
              </svg>
              <p className="t-label text-ink-3">
                Link with the suit at each point: green if good (above {fmt(radio.amber)} dBm), amber if weak
                (down to {fmt(radio.red)} dBm) and red if lost (radio shadow).
              </p>
            </div>
          ) : (
            <p className="t-label text-ink-3">
              Power, consumables and radio at each point come from the compute engine, which is not responding.
            </p>
          )}
        </Disclosure>
      )}
    </div>
  );
};
