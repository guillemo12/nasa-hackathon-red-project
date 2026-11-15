import React from 'react';
import { X } from 'lucide-react';
import { ISRU_H2O_MIN_PCT, SHELTER_SVF_MAX, classify, limits, type Level } from '@/engine/thresholds';
import { fmt } from '@/engine/geo';
import { LEVEL_COLOR, PALETTE } from '@/theme';
import { levelTextClass } from '@/components/ui';
import type { SpyglassMode, SpyglassResult, WaypointNode } from '@/types/mission';

export type LensData =
  | { status: 'loading' }
  | { status: 'ok'; result: SpyglassResult }
  /** El cursor está fuera del terreno cargado. */
  | { status: 'outside' }
  /** Sin motor de cálculo: solo hay dato en los puntos de la ruta. */
  | { status: 'noapi'; node: WaypointNode | null };

interface Props {
  size: number;
  opacity: number;
  mode: SpyglassMode;
  data: LensData;
  nearest: string;
  lat: number | null;
  lonE: number | null;
  radiusM: number | null;
  frozen?: boolean;
  label?: string;
  onClose?: () => void;
}

/** Por debajo de este diámetro las cifras no caben dentro del círculo y pasan al pie. */
const INSIDE_TEXT_MIN_PX = 120;
/** Las celdas sin nada que avisar se dibujan tenues para que destaquen las que sí avisan. */
const CALM_POINT_OPACITY = 0.4;

const lerpColor = (a: string, b: string, t: number): string => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const k = Math.min(1, Math.max(0, t));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
};

/**
 * Lupa de tres sectores de 120° (`strategic-3d-console.md` §1.2): arriba el agua (CRISM), a la
 * derecha la inercia térmica (THEMIS) y a la izquierda la pendiente y el refugio (MOLA). Cada
 * sector dibuja las celdas reales que devuelve el motor de cálculo. Dentro del círculo va solo
 * la cifra de cada capa; lo que significa se dice en el pie.
 */
export const SpyglassLens: React.FC<Props> = ({
  size,
  opacity,
  mode,
  data,
  nearest,
  lat,
  lonE,
  radiusM,
  frozen = false,
  label,
  onClose,
}) => {
  const c = size / 2;
  const r = c - 2;
  const at = (bearingDeg: number, k = 1) => {
    const b = (bearingDeg * Math.PI) / 180;
    return [c + r * k * Math.sin(b), c - r * k * Math.cos(b)] as const;
  };
  const sector = (b0: number, b1: number) => {
    const [x0, y0] = at(b0);
    const [x1, y1] = at(b1);
    return `M${c},${c} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0,1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
  };
  const uid = React.useId().replace(/:/g, '');
  const res = data.status === 'ok' ? data.result : null;
  const node = data.status === 'noapi' ? data.node : null;
  const q = res?.query.radius_m ?? 1;
  const dot = Math.max(1.6, (5.2 / q) * r);
  const px = (e: number, n: number) => [c + (e / q) * r, c - (n / q) * r] as const;

  // Valores del centro: celda del terreno (motor de cálculo) o punto de la ruta (sin motor).
  const h2o = res ? res.center.isru_h2o_pct : node?.h2oWtPct ?? null;
  const tiu = res ? res.center.thermal_inertia_tiu : node?.tiu ?? null;
  const slope = res ? res.center.slope_deg : node?.slopeLocalDeg ?? null;
  const svf = res ? res.center.sky_view_factor : node?.svfScenario ?? null;
  const elev = res ? res.center.elev_m : node?.elevMolaM ?? null;

  const isruHere = res ? res.sectors.north_h2o.cells_ge_isru_min > 0 : (h2o ?? 0) >= ISRU_H2O_MIN_PCT;
  const trapHere = res ? res.sectors.right_tiu.cells_trap > 0 : classify('thermal_inertia_tiu', tiu) === 'red';
  const steepHere = res ? res.sectors.left_mola.cells_slope_critical > 0 : classify('slope_deg', slope) === 'red';
  const shelterHere = res ? res.sectors.left_mola.cells_shelter > 0 : svf !== null && svf <= SHELTER_SVF_MAX;

  const showNorth = mode === 'tri-sector' || mode === 'xray-crism';
  const showRight = mode === 'tri-sector' || mode === 'xray-themis';
  const showLeft = mode === 'tri-sector' || mode === 'xray-mola';
  const xray = mode !== 'tri-sector';

  const tiuLevel = classify('thermal_inertia_tiu', tiu);
  const tiuLimits = limits('thermal_inertia_tiu');
  const slopeRed = limits('slope_deg').red;

  // Una capa: nombre de la capa, su valor en el centro y lo que significa.
  const single: { title: string; value: string; verdict: string; level: Level } = (() => {
    if (mode === 'xray-crism')
      return {
        title: 'Agua (CRISM)',
        value: h2o === null ? 'Sin dato' : `${fmt(h2o, 1)} % H₂O`,
        verdict:
          h2o === null
            ? 'Sin dato de agua en este punto'
            : h2o >= ISRU_H2O_MIN_PCT
              ? `Sulfatos hidratados, apto para ISRU (${fmt(ISRU_H2O_MIN_PCT)} % o más)`
              : `No apto para ISRU (menos del ${fmt(ISRU_H2O_MIN_PCT)} %)`,
        level: 'none',
      };
    if (mode === 'xray-themis')
      return {
        title: 'Inercia térmica (THEMIS)',
        value: tiu === null ? 'Sin dato' : `${fmt(tiu)} TIU`,
        verdict:
          tiu === null
            ? 'Sin dato de inercia en este punto'
            : tiuLevel === 'red'
              ? `Trampa de polvo (menos de ${tiuLimits.red} TIU)`
              : tiuLevel === 'amber'
                ? `Regolito blando (de ${tiuLimits.red} a ${tiuLimits.amber} TIU)`
                : 'Roca firme',
        level: tiu === null ? 'none' : tiuLevel,
      };
    const slopeLevel = classify('slope_deg', slope);
    return {
      title: 'Relieve (MOLA)',
      value: slope === null ? 'Sin dato' : `${fmt(slope, 1)}° · SVF ${fmt(svf, 2)}`,
      verdict: shelterHere
        ? `Refugio (cielo visible de ${fmt(SHELTER_SVF_MAX, 2)} o menos)`
        : slopeLevel === 'red'
          ? `Pendiente crítica (más de ${slopeRed}°)`
          : steepHere
            ? `Talud de más de ${slopeRed}° cerca`
            : `Cota ${fmt(elev)} m`,
      level: shelterHere ? 'none' : slopeLevel === 'red' ? 'red' : steepHere ? 'amber' : 'none',
    };
  })();

  const message =
    data.status === 'outside'
      ? 'Fuera del terreno'
      : data.status === 'loading'
        ? 'Leyendo el terreno…'
        : data.status === 'noapi' && !node
          ? 'Sin datos aquí: falta el motor de cálculo'
          : null;

  // Tres capas: lo que hay bajo la lupa, dicho en llano. Solo se colorea lo que avisa.
  const findings: Array<{ text: string; level: Level }> = [];
  if (!message) {
    if (xray) findings.push({ text: single.verdict, level: single.level });
    else {
      if (isruHere) findings.push({ text: 'Sulfatos hidratados, apto para ISRU', level: 'none' });
      if (trapHere) findings.push({ text: `Trampa de polvo (menos de ${tiuLimits.red} TIU)`, level: 'red' });
      if (shelterHere) findings.push({ text: 'Refugio', level: 'none' });
      else if (steepHere) findings.push({ text: `Talud de más de ${slopeRed}°`, level: 'amber' });
    }
  }

  const sectorValues = {
    north: h2o === null ? 'Sin dato' : `${fmt(h2o, 1)} % H₂O`,
    right: tiu === null ? 'Sin dato' : `${fmt(tiu)} TIU`,
    left: slope === null ? 'Sin dato' : `${fmt(slope, 1)}°`,
  };
  const textInside = size >= INSIDE_TEXT_MIN_PX;
  const name = label ?? nearest;
  const detail = res
    ? `Celda H3 …${res.center.h3_hex.slice(-7, -3)}${radiusM !== null ? `, radio de ${fmt(q)} m` : ''}`
    : undefined;

  const txt = (x: number, y: number, fill: string, text: string, key: string, big = false) => (
    <text
      key={key}
      x={x}
      y={y}
      textAnchor="middle"
      fill={fill}
      fontSize={big ? 16 : 12}
      fontWeight={big ? 600 : 500}
      stroke={PALETTE.ground}
      strokeWidth="3"
      paintOrder="stroke"
    >
      {text}
    </text>
  );
  const pointFill = (level: Level) =>
    level === 'red' || level === 'amber' ? LEVEL_COLOR[level] : level === 'green' ? PALETTE.text2 : PALETTE.muted;

  return (
    <div className="flex flex-col items-center">
      <div className={`relative rounded-full border overflow-hidden ${frozen ? 'border-accent' : 'border-ink-3'}`} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <defs>
            <pattern id={`hz-${uid}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4.5" height="9" fill={PALETTE.amber} fillOpacity="0.5" />
            </pattern>
            <clipPath id={`n-${uid}`}><path d={sector(300, 60)} /></clipPath>
            <clipPath id={`r-${uid}`}><path d={sector(60, 180)} /></clipPath>
            <clipPath id={`l-${uid}`}><path d={sector(180, 300)} /></clipPath>
          </defs>

          {/* Arriba: agua de hidratación (CRISM) */}
          {showNorth && (
            <g>
              <path d={sector(300, 60)} fill={isruHere ? PALETTE.cyan : PALETTE.deepBlue} fillOpacity={(isruHere ? 0.26 : 0.16) * opacity} stroke={PALETTE.borderStrong} />
              <g clipPath={`url(#n-${uid})`}>
                {res?.sectors.north_h2o.points.map(([e, n, v], i) => {
                  const [x, y] = px(e, n);
                  return <circle key={i} cx={x} cy={y} r={dot} fill={v === null ? PALETTE.muted : lerpColor(PALETTE.deepBlue, PALETTE.cyan, v / 20)} fillOpacity={v === null ? 0.18 : 0.95} />;
                })}
              </g>
              {isruHere && (
                <circle cx={at(0, 0.5)[0]} cy={at(0, 0.5)[1]} r={r * 0.2} fill="none" stroke={PALETTE.text} strokeWidth="1.5" strokeDasharray="6 5" />
              )}
            </g>
          )}

          {/* Derecha: inercia térmica (THEMIS) */}
          {showRight && (
            <g>
              <path d={sector(60, 180)} fill={trapHere ? PALETTE.red : PALETTE.muted} fillOpacity={(trapHere ? 0.26 : 0.14) * opacity} stroke={PALETTE.borderStrong} />
              <g clipPath={`url(#r-${uid})`}>
                {res?.sectors.right_tiu.points.map(([e, n, v], i) => {
                  const [x, y] = px(e, n);
                  const level = classify('thermal_inertia_tiu', v);
                  return <circle key={i} cx={x} cy={y} r={dot} fill={pointFill(level)} fillOpacity={v === null ? 0.18 : level === 'green' ? CALM_POINT_OPACITY : 0.95} />;
                })}
              </g>
            </g>
          )}

          {/* Izquierda: pendiente y refugio (MOLA) */}
          {showLeft && (
            <g>
              <path d={sector(180, 300)} fill={shelterHere ? PALETTE.green : PALETTE.muted} fillOpacity={(shelterHere ? 0.26 : 0.14) * opacity} stroke={PALETTE.borderStrong} />
              {steepHere && <path d={sector(180, 300)} fill={`url(#hz-${uid})`} fillOpacity={0.55 * opacity} />}
              <g clipPath={`url(#l-${uid})`}>
                {res?.sectors.left_mola.points.map(([e, n, sl, sv], i) => {
                  const [x, y] = px(e, n);
                  const shelter = sv !== null && sv <= SHELTER_SVF_MAX;
                  const level = sl === null ? 'green' : classify('slope_deg', sl);
                  return <circle key={i} cx={x} cy={y} r={dot} fill={shelter ? PALETTE.green : pointFill(level)} fillOpacity={sl === null ? 0.18 : !shelter && level === 'green' ? CALM_POINT_OPACITY : 0.95} />;
                })}
              </g>
            </g>
          )}

          <circle cx={c} cy={c} r="3" fill={PALETTE.text} stroke={PALETTE.ground} strokeWidth="1.5" />

          {!message && textInside && (xray ? (
            <>
              {size >= 180 && txt(c, c - r * 0.36, PALETTE.text2, single.title, 'xt')}
              {txt(c, c + r * 0.36, PALETTE.text, single.value, 'xv', size >= 180)}
            </>
          ) : (
            <>
              {txt(at(0, 0.62)[0], at(0, 0.62)[1], PALETTE.text, sectorValues.north, 'n1')}
              {txt(at(120, 0.56)[0], at(120, 0.56)[1], PALETTE.text, sectorValues.right, 'r1')}
              {txt(at(240, 0.56)[0], at(240, 0.56)[1], PALETTE.text, sectorValues.left, 'l1')}
            </>
          ))}
        </svg>
      </div>

      <div className="mt-1 max-w-64 px-2 py-1 rounded-md bg-ground/90 t-label text-ink-2 tabular-nums text-center pointer-events-auto" title={detail}>
        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
          {name && <span className="text-ink font-medium">{name}</span>}
          {frozen && <span>(fija)</span>}
          {elev !== null && <span>· {fmt(elev)} m</span>}
          {onClose && (
            <button type="button" onClick={onClose} aria-label={`Quitar la lupa de ${name}`} className="-my-1 -mr-1.5 w-8 h-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer">
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
        {message && <div>{message}</div>}
        {!message && !textInside && (
          <div className="text-ink">{xray ? single.value : `${sectorValues.north}, ${sectorValues.right}, ${sectorValues.left}`}</div>
        )}
        {findings.map((f) => (
          <div key={f.text} className={levelTextClass(f.level)}>{f.text}</div>
        ))}
        {!message && !xray && svf !== null && <div>Cielo visible (SVF) {fmt(svf, 2)}</div>}
        {lat !== null && lonE !== null && (
          <div className="text-ink-3 whitespace-nowrap">
            {fmt(Math.abs(lat), 4)}°S {fmt(lonE, 4)}°E
          </div>
        )}
        {node && <div className="text-ink-3">Dato del punto de la ruta</div>}
      </div>
    </div>
  );
};
