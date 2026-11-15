import React from 'react';
import { X } from 'lucide-react';
import { ISRU_H2O_MIN_PCT, SHELTER_SVF_MAX, classify, limits, type Level } from '@/engine/thresholds';
import { fmt, fmtCoords } from '@/engine/geo';
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
  /** Lupa fijada: en el mapa va solo el círculo y su nombre; la lectura se lista aparte. */
  compact?: boolean;
  /** Oculta las cifras y el pie (la lupa libre está encima de una fijada). */
  hideLabels?: boolean;
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

interface Finding {
  text: string;
  level: Level;
}

/**
 * Lo que lee una lupa, separando dos cosas que no son lo mismo: el punto central (las cifras)
 * y el resto del círculo (lo que hay «dentro de la lupa», aunque el centro no lo tenga).
 */
function readLens(data: LensData, mode: SpyglassMode) {
  const res = data.status === 'ok' ? data.result : null;
  const node = data.status === 'noapi' ? data.node : null;

  // Valores del centro: celda del terreno (motor de cálculo) o punto de la ruta (sin motor).
  const h2o = res ? res.center.isru_h2o_pct : node?.h2oWtPct ?? null;
  const tiu = res ? res.center.thermal_inertia_tiu : node?.tiu ?? null;
  const slope = res ? res.center.slope_deg : node?.slopeLocalDeg ?? null;
  const svf = res ? res.center.sky_view_factor : node?.svfScenario ?? null;
  const elev = res ? res.center.elev_m : node?.elevMolaM ?? null;

  const tiuLevel = classify('thermal_inertia_tiu', tiu);
  const tiuLimits = limits('thermal_inertia_tiu');
  const slopeRed = limits('slope_deg').red;

  // En el punto central.
  const isruCenter = h2o !== null && h2o >= ISRU_H2O_MIN_PCT;
  const trapCenter = tiu !== null && tiuLevel === 'red';
  const steepCenter = slope !== null && classify('slope_deg', slope) === 'red';
  const shelterCenter = svf !== null && svf <= SHELTER_SVF_MAX;
  // En cualquier celda de la lupa (también tiñe el sector).
  const isruHere = res ? res.sectors.north_h2o.cells_ge_isru_min > 0 : isruCenter;
  const trapHere = res ? res.sectors.right_tiu.cells_trap > 0 : trapCenter;
  const steepHere = res ? res.sectors.left_mola.cells_slope_critical > 0 : steepCenter;
  const shelterHere = res ? res.sectors.left_mola.cells_shelter > 0 : shelterCenter;

  const water: Finding | null = isruCenter
    ? { text: `Hydrated sulfates at the center, fit for ISRU (${fmt(ISRU_H2O_MIN_PCT)} % or more)`, level: 'none' }
    : isruHere
      ? { text: 'Hydrated sulfates inside the lens', level: 'none' }
      : null;
  const trap: Finding | null = trapCenter
    ? { text: `Dust trap at the center (under ${tiuLimits.red} TIU)`, level: 'red' }
    : trapHere
      ? { text: 'Dust traps inside the lens', level: 'amber' }
      : null;
  const shelter: Finding | null = shelterCenter
    ? { text: `Shelter at the center (sky view ${fmt(SHELTER_SVF_MAX, 2)} or less)`, level: 'none' }
    : shelterHere
      ? { text: 'Shelter inside the lens', level: 'none' }
      : null;
  const steep: Finding | null = steepCenter
    ? { text: `Critical slope at the center (over ${slopeRed}°)`, level: 'red' }
    : steepHere
      ? { text: `Slopes over ${slopeRed}° inside the lens`, level: 'amber' }
      : null;

  // Cifras del centro; la que no existe en los datos no se enseña.
  const values = {
    north: h2o === null ? null : `${fmt(h2o, 1)} % H₂O`,
    right: tiu === null ? null : `${fmt(tiu)} TIU`,
    left: slope === null ? null : `${fmt(slope, 1)}°`,
  };

  const message =
    data.status === 'outside'
      ? 'Off the terrain'
      : data.status === 'loading'
        ? 'Reading the terrain…'
        : data.status === 'noapi' && !node
          ? 'No data here: only at the route points'
          : null;

  // Una capa: nombre de la capa, su valor en el centro y lo que significa.
  let single: { title: string; value: string | null; findings: Finding[] };
  if (mode === 'xray-crism') {
    single = {
      title: 'Water (CRISM)',
      value: values.north,
      findings: [
        h2o === null
          ? { text: 'No water data at the center', level: 'none' }
          : isruCenter
            ? water!
            : { text: `Center not fit for ISRU (under ${fmt(ISRU_H2O_MIN_PCT)} %)`, level: 'none' },
        ...(!isruCenter && water ? [water] : []),
      ],
    };
  } else if (mode === 'xray-themis') {
    single = {
      title: 'Thermal inertia (THEMIS)',
      value: values.right,
      findings: [
        tiu === null
          ? { text: 'No thermal inertia data at the center', level: 'none' }
          : trapCenter
            ? trap!
            : tiuLevel === 'amber'
              ? { text: `Soft regolith at the center (${tiuLimits.red} to ${tiuLimits.amber} TIU)`, level: 'amber' }
              : { text: 'Firm rock at the center', level: 'none' },
        ...(!trapCenter && trap ? [trap] : []),
      ],
    };
  } else {
    const found = [shelter, steep].filter((f): f is Finding => f !== null);
    single = {
      title: 'Relief (MOLA)',
      value: values.left === null ? null : svf === null ? values.left : `${values.left} · SVF ${fmt(svf, 2)}`,
      findings: found.length
        ? found
        : [{ text: slope === null ? 'No slope data at the center' : 'No steep slopes or shelter inside the lens', level: 'none' }],
    };
  }

  // Lo que hay bajo la lupa, dicho en llano. Solo se colorea lo que avisa.
  const xray = mode !== 'tri-sector';
  const findings: Finding[] = message
    ? []
    : xray
      ? single.findings
      : [water, trap, shelter, steep].filter((f): f is Finding => f !== null);

  return { res, node, svf, elev, isruHere, trapHere, steepHere, shelterHere, values, single, message, findings, xray };
}

const closeBtn =
  'w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer';

/**
 * Lupa de tres sectores de 120° (`strategic-3d-console.md` §1.2): arriba el agua (CRISM), a la
 * derecha la inercia térmica (THEMIS) y a la izquierda la pendiente y el refugio (MOLA). Cada
 * sector dibuja las celdas reales que devuelve el motor de cálculo. Dentro del círculo va solo
 * la cifra de cada capa en el punto central; lo que significa se dice en el pie.
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
  compact = false,
  hideLabels = false,
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
  const { res, node, svf, elev, isruHere, trapHere, steepHere, shelterHere, values, single, message, findings, xray } = readLens(data, mode);
  const q = res?.query.radius_m ?? 1;
  const dot = Math.max(1.6, (5.2 / q) * r);
  const px = (e: number, n: number) => [c + (e / q) * r, c - (n / q) * r] as const;

  const showNorth = mode === 'tri-sector' || mode === 'xray-crism';
  const showRight = mode === 'tri-sector' || mode === 'xray-themis';
  const showLeft = mode === 'tri-sector' || mode === 'xray-mola';

  const textInside = size >= INSIDE_TEXT_MIN_PX;
  const name = label ?? nearest;
  const detail = res
    ? `H3 cell …${res.center.h3_hex.slice(-7, -3)}${radiusM !== null ? `, radius ${fmt(q)} m` : ''}`
    : undefined;
  const centerValues = xray ? single.value : [values.north, values.right, values.left].filter(Boolean).join(', ');

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
    <div className="relative flex flex-col items-center">
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

          {/* Quien coloca la lupa marca `data-clipped` en su contenedor (`group`) si el círculo no cabe entero. */}
          <g className="group-data-[clipped]:hidden">
          {!message && !hideLabels && textInside && (xray ? (
            <>
              {size >= 180 && txt(c, c - r * 0.36, PALETTE.text2, single.title, 'xt')}
              {single.value && txt(c, c + r * 0.36, PALETTE.text, single.value, 'xv', size >= 180)}
            </>
          ) : (
            <>
              {values.north && txt(at(0, 0.62)[0], at(0, 0.62)[1], PALETTE.text, values.north, 'n1')}
              {values.right && txt(at(120, 0.56)[0], at(120, 0.56)[1], PALETTE.text, values.right, 'r1')}
              {values.left && txt(at(240, 0.56)[0], at(240, 0.56)[1], PALETTE.text, values.left, 'l1')}
            </>
          ))}
          </g>
        </svg>
      </div>

      {compact ? (
        // El rótulo nace bajo el círculo; quien coloca la lupa lo mueve con `--tag-x` y `--tag-y`
        // (desde el centro del círculo) si ahí estorba.
        <div
          data-lens-card
          className="absolute left-1/2 top-1/2 flex items-center rounded-md bg-ground/90 pl-2 t-label text-ink font-medium whitespace-nowrap pointer-events-auto"
          style={{ translate: `calc(-50% + var(--tag-x, 0px)) calc(-50% + var(--tag-y, ${size / 2 + 20}px))` }}
        >
          {name}
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={`Remove the lens at ${name}`} className={closeBtn}>
              <X className="w-4 h-4" aria-hidden />
            </button>
          ) : (
            <span className="w-2 h-6" />
          )}
        </div>
      ) : hideLabels ? null : (
        <div data-lens-card className="mt-1 max-w-64 px-2 py-1 rounded-md bg-ground/90 t-label text-ink-2 tabular-nums text-center pointer-events-auto" title={detail}>
          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
            {name && <span className="text-ink font-medium">{name}</span>}
            {frozen && <span>(pinned)</span>}
            {elev !== null && <span>· {fmt(elev)} m</span>}
            {onClose && (
              <button type="button" onClick={onClose} aria-label={`Remove the lens at ${name}`} className={`-my-1 -mr-1.5 ${closeBtn}`}>
                <X className="w-4 h-4" aria-hidden />
              </button>
            )}
          </div>
          {message && <div>{message}</div>}
          {!message && !textInside && centerValues && <div className="text-ink">{centerValues}</div>}
          {findings.map((f, i) => (
            <div key={i} className={levelTextClass(f.level)}>{f.text}</div>
          ))}
          {!message && !xray && svf !== null && <div>Sky view at the center (SVF) {fmt(svf, 2)}</div>}
          {lat !== null && lonE !== null && <div className="text-ink-3 whitespace-nowrap">{fmtCoords(lat, lonE)}</div>}
          {node && <div className="text-ink-3">Route point data</div>}
        </div>
      )}
    </div>
  );
};

/** Lectura de una lupa fijada, en una fila de lista: así las de varias lupas no se pisan en el mapa. */
export const LensReadout: React.FC<{
  name: string;
  mode: SpyglassMode;
  data: LensData;
  lat: number;
  lonE: number;
  onClose: () => void;
}> = ({ name, mode, data, lat, lonE, onClose }) => {
  const { node, svf, elev, values, message, findings } = readLens(data, mode);
  const figures = [values.north, values.right, values.left, svf !== null ? `sky view ${fmt(svf, 2)}` : null].filter(Boolean).join(' · ');
  return (
    <li className="py-2 border-t border-line first:border-t-0 first:pt-0 last:pb-0 t-label text-ink-2 tabular-nums">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink">{name}</span>
        {elev !== null && <span>{fmt(elev)} m</span>}
        <button type="button" onClick={onClose} aria-label={`Remove the lens at ${name}`} className={`ml-auto -my-1 -mr-1.5 ${closeBtn}`}>
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
      {message ? <div>{message}</div> : figures && <div className="text-ink">At the center: {figures}</div>}
      {findings.map((f, i) => (
        <div key={i} className={levelTextClass(f.level)}>{f.text}</div>
      ))}
      <div className="text-ink-3">{fmtCoords(lat, lonE)}{node ? ' · route point data' : ''}</div>
    </li>
  );
};
