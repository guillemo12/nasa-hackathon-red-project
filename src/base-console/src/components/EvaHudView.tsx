import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Crosshair, FlaskConical, Layers, MapPin, Minus, Plus, Trash2, Undo2, Volume2 } from 'lucide-react';
import { Button, Disclosure, Notice, Panel, Row, Segmented, Stat, StatusDot, levelTextClass } from '@/components/ui';
import {
  CANONICAL_WAYPOINTS,
  EVA07_DOC,
  EVA07_EVENTS,
  PLANNED_LEGS,
  PLANNER_WALKBACK,
  REFERENCE_FIGURES,
  SUIT_SCENARIO,
  T_DECISION_MIN,
  T_END_MIN,
  T_START_MIN,
  UX_LABELS,
  legBetween,
  waypoint,
} from '@/data/missionData';
import { ApiError, fetchHexGrid, fetchRoutePlan, fetchTerrain } from '@/engine/apiClient';
import { addPoint, clearPoints, removePoint, usePoints } from '@/engine/reportedPoints';
import { EmergencyRedecision, POINT_COLOR, PointList, RouteImpact, redecisionDiffers, useEmergency } from '@/components/ReportedPointsPanel';
import { causeLabel, formatT, openSkyWindowMin } from '@/engine/evaModel';
import { bearingWords, compassPoint, fmt, haversineM, hillshadeDataUrl, minutesWords, nodeLabel } from '@/engine/geo';
import {
  MARS_TREK_LAYERS,
  TILE_SIZE,
  getTrekTileUrl,
  latLonToWorldPx,
  worldPxToLatLon,
  type MarsTrekLayerId,
} from '@/engine/marsTrekTiles';
import { P1_CONSTANTS, classify, limits, terrainEta, type Level } from '@/engine/thresholds';
import { AR_PATH, LEVEL_COLOR, NODE_COLOR, PALETTE, RADIO_CLASS_LEVEL, STATE_STYLE } from '@/theme';
import type { Eva07Sample, HexCell, Notify, ReportedKind, RoutePlan, TerrainGrid } from '@/types/mission';

interface EvaHudViewProps {
  sample: Eva07Sample;
  tMin: number;
  isLive: boolean;
  apiOnline: boolean;
  onToggleLive: () => void;
  onSelectTimeMin: (tMin: number) => void;
  onNotify: Notify;
}

type VoiceStatus = 'idle' | 'playing' | 'done' | 'blocked' | 'unavailable';

/** Zoom máximo que sirve Mars Trek para estas capas; por encima se amplía la tesela. */
const TREK_MAX_ZOOM = 7;
const MAP_MIN_ZOOM = 5;
const MAP_MAX_ZOOM = 15;
/** Zoom con el que el mapa encuadra el tramo de escape WP2 → WP3 (≈ 4 m por píxel). */
const MAP_ESCAPE_ZOOM = 14;
const MAP_DEFAULT_ZOOM = 13;
/** `helmet-vision.md` §2.3: borde punteado ámbar sobre talud de más de 18°. */
const AR_SLOPE_WARN_DEG = 18;
const O2_DENSITY = P1_CONSTANTS.o2_density_g_per_l_stpd;

const MAP_CENTER = {
  lat: CANONICAL_WAYPOINTS.reduce((a, w) => a + w.lat, 0) / CANONICAL_WAYPOINTS.length,
  lonE: CANONICAL_WAYPOINTS.reduce((a, w) => a + w.lonE, 0) / CANONICAL_WAYPOINTS.length,
};

// El refugio se enseña en T+115 (`refugio_activo`): la llegada es en T+114,45 y el deslizador va
// por minutos enteros, así que T+114 todavía es evacuación.
const PRESET_IDS = ['llegada_wp1', 'nlos', 'regolito', 'spe_polvo', 'refugio_activo', 'telemetria_final'];
const PRESET_LABEL: Record<string, string> = {
  llegada_wp1: 'Sampling at WP1',
  nlos: 'Radio loss',
  regolito: '22° ramp',
  spe_polvo: 'Multi-emergency',
  refugio_activo: 'Shelter WP3',
  telemetria_final: 'End',
};
const TIMELINE_PRESETS = PRESET_IDS.map((id) => EVA07_EVENTS.find((e) => e.id === id))
  .filter((e): e is (typeof EVA07_EVENTS)[number] => Boolean(e))
  .map((e) => ({ t: e.t_min, label: `${formatT(e.t_min)} ${PRESET_LABEL[e.id]}`, evac: e.id === 'spe_polvo' }));

const LAYER_OPTIONS: Array<{ value: MarsTrekLayerId; label: string }> = [
  { value: 'viking', label: 'Imagery' },
  { value: 'mola', label: 'Relief' },
];
const POINT_KIND_OPTIONS: Array<{ value: ReportedKind; label: string }> = [
  { value: 'ISRU', label: 'ISRU' },
  { value: 'PELIGRO', label: 'Hazard' },
  { value: 'REFUGIO', label: 'Shelter' },
];
/** Dial mecánico de tres posiciones de la unidad de muñeca. */
type DialValue = '1' | '2' | '3';
const DIAL_OPTIONS: Array<{ value: DialValue; label: string; hint: string }> = [
  { value: '1', label: 'Trail', hint: 'Trail and target only' },
  { value: '2', label: 'Nodes', hint: 'Nodes with distance' },
  { value: '3', label: 'Escape', hint: 'Escape vector to WP3' },
];
/** Nombres de los nodos dentro de una frase («Hacia…», «En…»). */
const GOAL_NAME: Record<string, string> = { BASE: 'Base', WP1: 'WP1 (sulfates)', WP2: 'WP2 (slope)', WP3: 'shelter WP3' };
/** De dónde sale la potencia metabólica de cada fase, en palabras. */
const POWER_SOURCE_TEXT: Record<string, string> = {
  sin_consumo: 'No consumption',
  escenario: 'Assumed value',
  modelo: 'From the model',
  modelo_tramo_real: 'From the leg model',
  modelo_ritmo_regulado: 'Model with paced walking',
  planificador_dstar: 'From the planner',
};
/** Los textos de la cronología llegan con términos internos: aquí se dicen en claro. */
/** English display text for the Spanish titles and phase texts of `eva07_events.json` (the data file stays as generated). */
const DATA_TEXT_EN: Record<string, string> = {
  'Inspección Spyglass de 3 sectores en la consola': 'Three-layer terrain inspection in the console',
  'Chaos Mode: 10.000 simulaciones (semilla 42), 96,02 % de misión segura con cambio al refugio frente a 23,84 % solo con la Base':
    'Contingency simulation: 10,000 runs (seed 42), 96.02% safe missions with shelter switching vs 23.84% base-only',
  'Sincronización de la sub-malla h3o al traje por Zenoh': 'Route uploaded to the suit',
  'Salida de la Base con rumbo 152°': 'Departure from the Base, heading 152°',
  'Llegada a WP1 (ISRU)': 'Arrival at WP1 (ISRU)',
  'Objetivo ISRU cumplido; salida hacia WP2': 'ISRU goal met; departure to WP2',
  'Amenaza 1: sombra de radio (NLOS) tras el espolón': 'Hazard 1: radio shadow behind the spur',
  'Amenaza 2: regolito suelto en rampa de 22° (pico 3,2 L/min)': 'Hazard 2: loose regolith on a 22° ramp (3.2 L/min peak)',
  'Amenazas 3 y 4: alerta SPE y frente de polvo; 4 amenazas activas': 'Hazards 3 and 4: SPE alert and dust front; 4 hazards active',
  'Dynamic Goal Switching: destino Base → WP3': 'Goal switch: destination Base → WP3',
  'Llegada a WP3 tras 9,45 min de huida (T+114,45)': 'Arrival at WP3 after a 9.45 min escape (T+114.45)',
  'Bajo la cornisa: primer minuto completo de refugio activo': 'Under the overhang: first full minute in shelter',
  'Pico del SPE: 8 mSv/h fuera, 1,2 mSv/h en la alcoba': 'SPE peak: 8 mSv/h outside, 1.2 mSv/h in the alcove',
  'Remite el pico del SPE': 'The SPE peak eases',
  'Enlace Zenoh restablecido por el repetidor del rover': 'Link restored by the rover relay',
  'Telemetría final recibida en la consola': 'Final telemetry received in the console',
  'Consola de Base: Spyglass, Chaos Mode y sincronización': 'Base console: terrain inspection, contingency simulation and route upload',
  'Marcha Base→WP1 (0,89 m/s, pendiente media +3,0°, η 1,3)': 'Walk Base→WP1 (0.89 m/s, mean slope +3.0°, η 1.3)',
  'Muestreo ISRU en WP1': 'ISRU sampling at WP1',
  'Aproximación al lóbulo de WP2 con línea de vista': 'Approach to the WP2 lobe with line of sight',
  'Aproximación a WP2 sin línea de vista': 'Approach to WP2 without line of sight',
  'Rampa local de 22° en 110 TIU: pico de 3,2 L/min': 'Local 22° ramp on 110 TIU: 3.2 L/min peak',
  'Progresión lenta por la rampa, ritmo regulado a 585 W': 'Slow progress up the ramp, pace held at 585 W',
  'Alerta SPE y polvo; Dynamic Goal Switching; huida D* Lite a WP3 (9,45 min, 595 m de camino, 1,05 m/s de media, rumbo 344°) y entrada bajo la cornisa':
    'SPE and dust alert; goal switch; escape computed by the planner to WP3 (9.45 min, 595 m path, 1.05 m/s mean, heading 344°) and entry under the overhang',
  'Refugio activo, subida hacia el pico SPE': 'Sheltering while the SPE rises to its peak',
  'Refugio activo durante el pico SPE': 'Sheltering through the SPE peak',
  'Remite el pico; permanencia protegida': 'The peak eases; staying protected',
  'Enlace Zenoh restablecido por repetidor; telemetría final': 'Link restored by relay; final telemetry',
};
const plain = (text: string) =>
  (DATA_TEXT_EN[text] ?? text)
    .replace(/\s*\(NLOS\)/g, '')
    .replace(/Inspección Spyglass de 3 sectores/g, 'Three-layer terrain inspection')
    .replace(/Spyglass, Chaos Mode y sincronización/g, 'terrain inspection, contingency simulation and route upload')
    .replace(/Chaos Mode/g, 'Contingency simulation')
    .replace(/sub-malla h3o al traje por Zenoh/g, 'route to the suit')
    .replace(/Enlace Zenoh/g, 'Link')
    .replace(/Dynamic Goal Switching/g, 'goal switch')
    .replace(/huida D\* Lite/g, 'escape computed by the planner')
    .replace(/API Rust/g, 'compute engine')
    .replace(/\bBASE\b/g, 'Base');
const LAYER_RESOLUTION: Record<MarsTrekLayerId, string> = { viking: '232 m per pixel', mola: '463 m per pixel' };
const RADIO_TEXT: Record<string, string> = { VERDE: 'good', AMBAR: 'weak', ROJO: 'lost' };
const ICON_BUTTON =
  'shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer';

const listText = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Duración en palabras: sin decimales por encima de una hora y sin cifras huecas por encima de tres. */
const durationText = (min: number): string =>
  min >= 180 ? `over ${fmt(Math.floor(min / 60))} hours` : min > 60 ? `${fmt(min)} min` : `${fmt(min, 1)} min`;
/** Filtro común de las teselas de fondo: grises con un tinte ocre suave, sea cual sea la capa. */
const TILE_FILTER: Record<MarsTrekLayerId, string> = {
  viking: 'grayscale(1) sepia(0.3) brightness(0.8) contrast(0.95)',
  // El relieve coloreado de MOLA, en grises, queda muy duro: se le baja el contraste.
  mola: 'grayscale(1) sepia(0.3) contrast(0.5) brightness(0.95)',
};
/** El relieve de 20 m se funde con la tesela de fondo por sus cuatro lados: no se ve dónde acaba. */
const RELIEF_MASK =
  'linear-gradient(to right, transparent 0%, black 16%, black 84%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)';
const pointInPolygon = (lat: number, lonE: number, poly: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lonE < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const ESCAPE_LEG = legBetween('WP2', 'WP3');
const WP3 = waypoint('WP3');
const BASE = waypoint('BASE');

export const EvaHudView: React.FC<EvaHudViewProps> = ({
  sample,
  tMin,
  apiOnline,
  onSelectTimeMin,
  onNotify,
}) => {
  const [dialPos, setDialPos] = useState<1 | 2 | 3>(2);
  const [showHexGrid, setShowHexGrid] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showBaseReturn, setShowBaseReturn] = useState(false);
  const [evacConfirmed, setEvacConfirmed] = useState(false);
  const [isruSamples, setIsruSamples] = useState<number[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceSeconds, setVoiceSeconds] = useState<number | null>(null);

  const visorRef = useRef<HTMLDivElement | null>(null);
  const [visorSize, setVisorSize] = useState({ width: 900, height: 460 });
  const [baseLayer, setBaseLayer] = useState<MarsTrekLayerId>('viking');
  const [zoom, setZoom] = useState<number>(MAP_DEFAULT_ZOOM);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lonE: number }>(MAP_CENTER);
  const [markMode, setMarkMode] = useState(false);
  const [pointKind, setPointKind] = useState<ReportedKind>('PELIGRO');
  const reported = usePoints();
  const customPoints = reported.points;
  const [pointBusy, setPointBusy] = useState(false);

  const [hexCells, setHexCells] = useState<HexCell[]>([]);
  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  const [plan, setPlan] = useState<RoutePlan | null>(null);

  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, wx: 0, wy: 0 });

  useEffect(() => {
    if (!apiOnline) return;
    let active = true;
    fetchHexGrid().then((c) => active && setHexCells(c)).catch(() => undefined);
    fetchTerrain().then((t) => active && setTerrain(t)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiOnline]);

  // El plan se vuelve a pedir cada vez que cambian los puntos marcados (lo replanifica el motor).
  useEffect(() => {
    if (!apiOnline) return;
    let active = true;
    fetchRoutePlan(Math.max(0, reported.version))
      .then((p) => active && setPlan(p))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiOnline, reported.version]);
  const planCurrent = plan !== null && (plan.points_version ?? 0) === Math.max(0, reported.version);
  const emergency = useEmergency(reported.version, apiOnline && customPoints.length > 0);

  const markPoint = async (kind: ReportedKind, lat: number, lonE: number) => {
    setPointBusy(true);
    try {
      const pt = await addPoint(kind, lat, lonE, tMin);
      onNotify(`${pt.label} saved to the engine`, pt.effect, kind === 'PELIGRO' ? 'amber' : kind === 'REFUGIO' ? 'green' : 'cyan');
    } catch (err) {
      onNotify(
        'Point not saved',
        err instanceof ApiError && err.status === 400
          ? 'Outside the terrain grid area: the engine cannot use it.'
          : 'The compute engine is not responding: the point has not reached Base or the planner.',
        'red'
      );
    } finally {
      setPointBusy(false);
    }
  };
  const dropPoint = async (id?: number) => {
    setPointBusy(true);
    try {
      if (id === undefined) await clearPoints();
      else await removePoint(id);
    } catch {
      onNotify('Not deleted', 'The compute engine is not responding.', 'red');
    } finally {
      setPointBusy(false);
    }
  };

  const hillshade = useMemo(() => (terrain ? hillshadeDataUrl(terrain) : ''), [terrain]);

  useEffect(() => {
    const el = visorRef.current;
    if (!el) return;
    const update = () => setVisorSize({ width: el.clientWidth || 900, height: el.clientHeight || 460 });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Ctrl (o ⌘) + rueda amplía el mapa, igual que en Cartografía; la rueda sola desplaza la página,
  // para que un mapa que llena la pantalla no la deje atrapada.
  useEffect(() => {
    const el = visorRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, z + (e.deltaY < 0 ? 1 : -1))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---------------------------------------------------------------------------
  // Estado, objetivo y cifras del instante
  // ---------------------------------------------------------------------------
  const state = sample.guardrail.state;
  const style = STATE_STYLE[state];
  const v = sample.values;
  const isPreEva = state === 'PRE_EVA';
  const isCaution = state === 'CAUTION';
  const isMulti = state === 'MULTI_HAZARD';
  const isEvac = state === 'EVAC_SHELTER';
  const isHold = state === 'SHELTER_HOLD';
  const inputs = sample.guardrail.inputs;

  const powerLevel = classify('metabolic_rate_w', v.metabolic_power_w);
  const o2RateLevel = classify('o2_consumption_l_min', v.o2_l_min);
  const o2Level = classify('o2_primary_pct', v.o2_remaining_pct);
  const doseLevel = classify('eva_spe_dose_budget_msv', v.dose_spe_msv);
  const radioLevel = RADIO_CLASS_LEVEL[v.radio_class] ?? 'none';
  const slopeLevel = classify('slope_deg', inputs?.cell_slope_deg);
  const tiuLevel = classify('thermal_inertia_tiu', inputs?.cell_tiu);
  const tauLevel = classify('dust_tau_880nm', v.dust_tau);

  const goal = waypoint(sample.phase.goal);
  const bearing = sample.position.target_bearing_deg;
  const tVital = sample.guardrail.t_vital_min ?? null;

  // Walkback Limit Dual: T_vital (O₂ y radiación) y márgenes por destino. El escenario no modela en el
  // tiempo el agua ni la batería: solo se cita su autonomía de entrada en la decisión de T+105.
  const tO2 = inputs?.t_vital_o2_min ?? v.o2_remaining_g / O2_DENSITY / Math.max(v.o2_l_min, 0.05);
  const tRad = inputs?.t_vital_radiation_min ?? null;
  const limiting = tVital === null ? null : tRad !== null && tRad <= tO2 ? 'RADIACIÓN' : 'O₂';
  const openSky = openSkyWindowMin(sample);
  const margin = (time: number): number | null => {
    if (openSky !== null) return openSky - time;
    return tVital === null ? null : tVital * PLANNER_WALKBACK.safety_factor - time;
  };
  const baseMargin = margin(v.base_time_min);
  const wp3Margin = margin(v.wp3_time_min);
  const barMax = Math.max(60, v.base_time_min, v.wp3_time_min, Math.min(tVital ?? 0, 180)) * 1.08;
  const barPct = (min: number) => `${Math.min(100, Math.max(0, (min / barMax) * 100))}%`;

  // ---------------------------------------------------------------------------
  // Voz del copiloto (orden única ≤ 8 s al entrar en 0x04)
  // ---------------------------------------------------------------------------
  const escapeBearing = ESCAPE_LEG?.bearingDeg ?? bearing ?? 0;
  // La orden es única: lleva el tiempo de la decisión (el del planificador en T+105), no el que
  // queda en cada minuto. El vector de la tarjeta sí se actualiza.
  const voiceLine = `Combined alert. Base not viable due to radiation. Follow chevrons to shelter, heading ${bearingWords(escapeBearing)}. ${capitalize(minutesWords(PLANNER_WALKBACK.wp3.time_min))}.`;

  const speak = () => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setVoiceStatus('unavailable');
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(voiceLine);
    utter.lang = 'en-US';
    utter.rate = 1.1;
    let started = 0;
    let begun = false;
    utter.onstart = () => {
      begun = true;
      started = performance.now();
      setVoiceStatus('playing');
    };
    utter.onend = () => {
      if (begun) setVoiceSeconds((performance.now() - started) / 1000);
      setVoiceStatus(begun ? 'done' : 'blocked');
    };
    utter.onerror = () => setVoiceStatus('blocked');
    synth.speak(utter);
    // Si el navegador exige un gesto del usuario, la voz automática no arranca.
    window.setTimeout(() => {
      if (!begun) setVoiceStatus((s) => (s === 'idle' ? 'blocked' : s));
    }, 1500);
  };

  const prevState = useRef<string | null>(null);
  useEffect(() => {
    if (state === 'EVAC_SHELTER' && prevState.current !== 'EVAC_SHELTER') {
      setVoiceStatus('idle');
      setVoiceSeconds(null);
      speak();
    }
    if (state !== 'EVAC_SHELTER') {
      setEvacConfirmed(false);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
    // El mapa encuadra lo que importa en cada estado: el tramo de escape, el refugio o la ruta.
    const wasFocus = prevState.current === 'EVAC_SHELTER' || prevState.current === 'SHELTER_HOLD';
    if (state === 'EVAC_SHELTER' && WP3 && sample.position.lat !== null && sample.position.lon_e !== null) {
      setMapCenter({ lat: (sample.position.lat + WP3.lat) / 2, lonE: (sample.position.lon_e + WP3.lonE) / 2 });
      setZoom(MAP_ESCAPE_ZOOM);
    } else if (state === 'SHELTER_HOLD' && WP3) {
      setMapCenter({ lat: WP3.lat, lonE: WP3.lonE });
      setZoom(MAP_ESCAPE_ZOOM);
    } else if (wasFocus) {
      setMapCenter(MAP_CENTER);
      setZoom(MAP_DEFAULT_ZOOM);
    }
    prevState.current = state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ---------------------------------------------------------------------------
  // Mapa (teselas Mars Trek + relieve real de la malla de terreno + capa vectorial)
  // ---------------------------------------------------------------------------
  const tileZoom = Math.min(zoom, TREK_MAX_ZOOM);
  const scale = Math.pow(2, zoom - tileZoom);
  const tilePx = TILE_SIZE * scale;
  const worldPx = (lat: number, lonE: number) => {
    const p = latLonToWorldPx(lat, lonE, tileZoom);
    return { x: p.x * scale, y: p.y * scale };
  };
  const centerWorld = worldPx(mapCenter.lat, mapCenter.lonE);
  // En pantalla ancha la tarjeta de evacuación va sobre la izquierda del mapa: el centro se
  // desplaza para que la ruta de escape no quede tapada. En estrecha, la tarjeta va fuera del mapa.
  const cx = visorSize.width / 2;
  const cy = visorSize.height / 2;
  const toScreen = (lat: number, lonE: number) => {
    const p = worldPx(lat, lonE);
    return { x: cx + (p.x - centerWorld.x), y: cy + (p.y - centerWorld.y) };
  };
  const screenToLatLon = (sx: number, sy: number) =>
    worldPxToLatLon(
      (centerWorld.x + sx - cx) / scale,
      (centerWorld.y + sy - cy) / scale,
      tileZoom
    );

  const cols = Math.pow(2, tileZoom + 1);
  const rows = Math.pow(2, tileZoom);
  const topLeftX = centerWorld.x - cx;
  const topLeftY = centerWorld.y - cy;
  const visibleTiles: Array<{ key: string; url: string; left: number; top: number }> = [];
  for (let ty = Math.max(0, Math.floor(topLeftY / tilePx)); ty <= Math.min(rows - 1, Math.floor((topLeftY + visorSize.height) / tilePx)); ty++) {
    for (let tx = Math.floor(topLeftX / tilePx); tx <= Math.floor((topLeftX + visorSize.width) / tilePx); tx++) {
      visibleTiles.push({
        key: `${baseLayer}-${tileZoom}-${tx}-${ty}`,
        url: getTrekTileUrl(baseLayer, tileZoom, ((tx % cols) + cols) % cols, ty),
        left: tx * tilePx - topLeftX,
        top: ty * tilePx - topLeftY,
      });
    }
  }

  const metersPerPx = haversineM(mapCenter.lat, mapCenter.lonE, mapCenter.lat + 0.01, mapCenter.lonE) /
    Math.abs(worldPx(mapCenter.lat + 0.01, mapCenter.lonE).y - centerWorld.y);
  const scaleBarM = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000].find((m) => m / metersPerPx >= 70) ?? 50000;

  // Camino planificado de cada tramo (real si hay plan; recto entre nodos si no).
  const legPath = (legId: string): Array<{ lat: number; lonE: number }> => {
    const planned = plan?.legs.find((l) => l.leg_id === legId && !l.error);
    if (planned) return planned.profile.map((p) => ({ lat: p.lat, lonE: p.lon_e }));
    const leg = PLANNED_LEGS.find((l) => l.id === legId) ?? legBetween('WP2', 'BASE');
    const a = leg && waypoint(leg.from);
    const b = leg && waypoint(leg.to);
    return a && b ? [{ lat: a.lat, lonE: a.lonE }, { lat: b.lat, lonE: b.lonE }] : [];
  };
  const pts = (path: Array<{ lat: number; lonE: number }>) =>
    path.map((p) => toScreen(p.lat, p.lonE)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const astro =
    sample.position.lat !== null && sample.position.lon_e !== null
      ? toScreen(sample.position.lat, sample.position.lon_e)
      : null;

  // Puntos de cada tramo planificado que pisan talud de más de 18° (por la pendiente del propio
  // camino o por la de la celda de terreno que cruzan).
  const steepByLeg = useMemo(() => {
    const out = new Map<string, boolean[]>();
    if (!plan) return out;
    const steepCells = hexCells.filter((c) => c.boundary && (c.slope_deg ?? 0) > AR_SLOPE_WARN_DEG);
    for (const leg of plan.legs) {
      if (leg.error) continue;
      out.set(
        leg.leg_id,
        leg.profile.map(
          (p) =>
            Math.abs(p.grade_deg ?? 0) > AR_SLOPE_WARN_DEG ||
            steepCells.some((c) => pointInPolygon(p.lat, p.lon_e, c.boundary as Array<[number, number]>)),
        ),
      );
    }
    return out;
  }, [plan, hexCells]);

  // Sendero AR: lo que queda del tramo en curso, desde la astronauta hasta el objetivo.
  const arTrack = useMemo(() => {
    const empty = { path: [] as Array<{ x: number; y: number }>, steepRuns: [] as Array<Array<{ x: number; y: number }>> };
    if (!astro || !goal || sample.position.at_goal || isPreEva) return empty;
    const leg = legBetween(sample.position.from, sample.phase.goal);
    const full = leg ? legPath(leg.id) : [];
    const flags = (leg && steepByLeg.get(leg.id)) || [];
    // La API pone a la astronauta sobre esta misma ruta: el sendero empieza en el punto de la
    // ruta más cercano a ella (no en una fracción de índices, que no es una fracción de metros).
    const pLat = sample.position.lat ?? 0;
    const pLon = sample.position.lon_e ?? 0;
    const start = full.length
      ? full.reduce((best, p, i) => (haversineM(pLat, pLon, p.lat, p.lonE) < haversineM(pLat, pLon, full[best].lat, full[best].lonE) ? i : best), 0)
      : 0;
    const rest = full.slice(start + 1).map((p) => toScreen(p.lat, p.lonE));
    const path = [astro, ...rest, toScreen(goal.lat, goal.lonE)];
    const steep = [Boolean(flags[start]), ...full.slice(start + 1).map((_, i) => Boolean(flags[start + 1 + i])), Boolean(flags[full.length - 1])];
    const steepRuns: Array<Array<{ x: number; y: number }>> = [];
    let run: Array<{ x: number; y: number }> = [];
    path.forEach((p, i) => {
      if (steep[i]) {
        if (run.length === 0 && i > 0) run.push(path[i - 1]);
        run.push(p);
      } else if (run.length > 0) {
        run.push(p);
        steepRuns.push(run);
        run = [];
      }
    });
    if (run.length > 1) steepRuns.push(run);
    return { path, steepRuns };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample.position.frac, sample.position.lat, sample.position.lon_e, sample.position.from, sample.phase.goal, sample.position.at_goal, plan, steepByLeg, zoom, mapCenter, visorSize, isPreEva]);
  const arPath = arTrack.path;
  // `helmet-vision.md` §2.3: cian en nominal, precaución y varias amenazas; rojo con chevrones en
  // evacuación; verde en refugio. El ámbar solo bordea los tramos con talud de más de 18°.
  const pathColor = isEvac ? AR_PATH.evac : isHold ? AR_PATH.shelter : AR_PATH.nominal;
  const pathState = isEvac ? 'evacuacion' : isHold ? 'refugio' : 'nominal';

  // Chevrones repartidos a lo largo del sendero de evacuación.
  const chevrons = useMemo(() => {
    if (!isEvac || arPath.length < 2) return [];
    const seg: Array<{ len: number; a: { x: number; y: number }; b: { x: number; y: number } }> = [];
    let total = 0;
    for (let i = 0; i + 1 < arPath.length; i++) {
      const len = Math.hypot(arPath[i + 1].x - arPath[i].x, arPath[i + 1].y - arPath[i].y);
      seg.push({ len, a: arPath[i], b: arPath[i + 1] });
      total += len;
    }
    const n = Math.max(2, Math.min(9, Math.floor(total / 34)));
    const out: Array<{ x: number; y: number; deg: number }> = [];
    for (let k = 1; k <= n; k++) {
      let d = (total * k) / (n + 1);
      for (const sg of seg) {
        if (d <= sg.len || sg === seg[seg.length - 1]) {
          const f = sg.len > 0 ? Math.min(1, d / sg.len) : 0;
          out.push({
            x: sg.a.x + (sg.b.x - sg.a.x) * f,
            y: sg.a.y + (sg.b.y - sg.a.y) * f,
            deg: (Math.atan2(sg.b.y - sg.a.y, sg.b.x - sg.a.x) * 180) / Math.PI + 90,
          });
          break;
        }
        d -= sg.len;
      }
    }
    return out;
  }, [isEvac, arPath]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button,[data-no-pan]')) return;
    dragRef.current = { active: true, moved: false, startX: e.clientX, startY: e.clientY, wx: centerWorld.x, wy: centerWorld.y };
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) > 5) d.moved = true;
    if (d.moved) setMapCenter(worldPxToLatLon((d.wx - dx) / scale, (d.wy - dy) / scale, tileZoom));
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    if (d.moved || !markMode || (e.target as HTMLElement).closest('button,[data-no-pan]')) return;
    const rect = visorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { lat, lonE } = screenToLatLon(e.clientX - rect.left, e.clientY - rect.top);
    if (pointBusy) return;
    void markPoint(pointKind, lat, lonE);
  };
  const handleMapKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 60;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      setMapCenter(worldPxToLatLon((centerWorld.x + dx) / scale, (centerWorld.y + dy) / scale, tileZoom));
    };
    if (e.key === 'ArrowLeft') move(-step, 0);
    else if (e.key === 'ArrowRight') move(step, 0);
    else if (e.key === 'ArrowUp') move(0, -step);
    else if (e.key === 'ArrowDown') move(0, step);
    else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(MAP_MAX_ZOOM, z + 1));
    else if (e.key === '-') setZoom((z) => Math.max(MAP_MIN_ZOOM, z - 1));
  };

  const aoiBox = terrain
    ? {
        tl: toScreen(terrain.aoi.lat_max, terrain.aoi.lon_e_min),
        br: toScreen(terrain.aoi.lat_min, terrain.aoi.lon_e_max),
      }
    : null;

  const goalName = GOAL_NAME[sample.phase.goal] ?? goal?.shortLabel ?? sample.phase.goal;
  const powerSource = POWER_SOURCE_TEXT[sample.phase.power_source] ?? capitalize(sample.phase.power_source.replace(/_/g, ' '));
  const objectiveText = (() => {
    if (isPreEva) {
      const l1 = PLANNED_LEGS[0];
      return `At Base, before departure. First target, ${nodeLabel(l1.to)}: heading ${fmt(l1.bearingDeg)}° ${compassPoint(l1.bearingDeg)} · ${fmt(l1.distanceM)} m`;
    }
    if (isHold) return 'At shelter WP3, under cover beneath the overhang';
    if (sample.position.at_goal) return `At ${goalName}`;
    return `To ${goalName}${bearing !== null ? `: heading ${fmt(bearing)}° ${compassPoint(bearing)}` : ''} · ${fmt(sample.position.target_distance_m)} m`;
  })();

  const isruOpen = sample.phase_id === 'A2_isru_wp1';
  const threatParts = sample.active_threats.map((t) => {
    if (t === 'spe') return `solar storm up to ${fmt(PLANNER_WALKBACK.spe_rate_envelope_msv_h)} mSv/h`;
    if (t === 'polvo') return `dust (τ ${fmt(v.dust_tau, 1)})`;
    if (t === 'sombra_radio') return 'radio shadow';
    if (t === 'trampa_regolito') return `${SUIT_SCENARIO.wp2RampDeg}° slope on loose regolith (${fmt(waypoint('WP2')?.tiu)} TIU)`;
    return t.replace(/_/g, ' ');
  });
  const threatText = capitalize(listText(threatParts));

  const stateLevel: Level = isEvac ? 'red' : isCaution || isMulti ? 'amber' : isPreEva ? 'none' : 'green';
  const cause = plain(causeLabel(sample));
  const phaseDetail = plain(sample.phase.description);
  const stateText = isCaution || isMulti ? `${style.short}: ${cause}` : style.label;
  const radioText = RADIO_TEXT[v.radio_class] ?? v.radio_class;
  const dialHint = DIAL_OPTIONS.find((o) => o.value === String(dialPos))?.hint;
  const speBudgetLeft = Math.max(0, PLANNER_WALKBACK.dose_budget_msv - v.dose_spe_msv);
  const marginText = (m: number | null) =>
    m === null ? '' : m >= 180 ? ', with ample margin' : m >= 0 ? `, with ${durationText(m)} margin` : `; short by ${durationText(Math.abs(m))}`;

  const confirmEvac = () => {
    setEvacConfirmed(true);
    onNotify('Evacuation to shelter WP3 confirmed', `Heading ${fmt(escapeBearing)}°, ${fmt(v.wp3_route_m)} m, ${fmt(v.wp3_time_min, 1)} min.`, 'red');
  };

  // La única tarjeta que puede gritar: la orden, el vector, el porqué y una confirmación.
  const evacCard = isEvac && (
    <div
      data-no-pan
      className={`rounded-lg border border-danger/60 bg-danger-bg p-4 grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] ${evacConfirmed ? '' : 'border-pulse'}`}
      style={{ ['--pulse-color' as string]: 'color-mix(in srgb, var(--color-danger) 40%, transparent)' }}
    >
      <div role="alert" className="space-y-3">
      <div className="flex items-center gap-2 t-label font-medium text-danger-ink">
        <StatusDot level="red" pulse={!evacConfirmed} />
        Evacuation
      </div>
      <div>
        <h2 className="text-[28px] leading-9 font-semibold text-ink">{style.label}</h2>
        <p className="mt-1 t-value tabular-nums text-ink">
          {fmt(escapeBearing)}° {compassPoint(escapeBearing)} · {fmt(v.wp3_route_m)} m · {fmt(v.wp3_time_min, 1)} min
        </p>
      </div>
      <p className="text-sm text-ink-2">
        {threatText}. Base is not viable: the shelter is the only way out.
      </p>
      </div>
      <div className="space-y-3 md:self-center">
      <Button
        variant={evacConfirmed ? 'secondary' : 'danger'}
        aria-pressed={evacConfirmed}
        onClick={confirmEvac}
        className="w-full"
      >
        {evacConfirmed ? 'Evacuation confirmed' : 'Confirm evacuation'}
      </Button>
      <div className="flex items-start gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={speak}
          aria-label="Play the order"
          title="Play the order"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
        >
          <Volume2 className={`w-4 h-4 ${voiceStatus === 'playing' ? 'hud-pulse' : ''}`} aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="text-sm text-ink">“{voiceLine}”</p>
          <p className="t-label text-ink-3 mt-1" data-voice-status={voiceStatus} data-voice-seconds={voiceSeconds ?? ''}>
            {voiceStatus === 'unavailable' && 'This browser has no voice: the order is text only.'}
            {voiceStatus === 'blocked' && 'The browser blocked the voice: press the speaker to play the order.'}
            {voiceStatus === 'playing' && 'Playing in the helmet…'}
            {voiceStatus === 'done' && voiceSeconds !== null && `Order spoken in ${fmt(voiceSeconds, 1)} s.`}
            {voiceStatus === 'idle' && 'Preparing voice…'}
          </p>
        </div>
      </div>
      <Disclosure summary="More detail">
        <Row
          label={`Return to Base at ${formatT(T_DECISION_MIN)}`}
          level="red"
          value={`${fmt(PLANNER_WALKBACK.base.time_min, 1)} min, ${fmt(PLANNER_WALKBACK.base.dose_spe_msv, 2)} mSv (limit ${fmt(PLANNER_WALKBACK.dose_budget_msv)})`}
        />
        <Row label="Shelter attenuates" value={`${SUIT_SCENARIO.shelterAttenuationPct}% of radiation`} />
        <Row label="Sky view at shelter" value={fmt(WP3?.svfScenario, 2)} />
        <Row label="Walking pace" value={`${fmt(PLANNER_WALKBACK.wp3.mean_speed_mps, 2)} m/s`} />
        <p className="t-label text-ink-3 pt-1">{phaseDetail}</p>
      </Disclosure>
      </div>
    </div>
  );

  const redecisionNote = redecisionDiffers(emergency, PLANNER_WALKBACK.wp3.time_min);

  return (
    <div className="space-y-4">
      {redecisionNote && (
        <Notice level={redecisionNote.level} role={redecisionNote.level === 'red' ? 'alert' : 'status'}>
          {redecisionNote.text}
        </Notice>
      )}
      {evacCard}

      {/* Cronología, estado y margen de retorno: un solo bloque bajo, para que mande el mapa */}
      <Panel bodyClassName="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-sm font-semibold text-ink">EVA telemetry</h1>
          <span
            className="hidden sm:inline t-value tabular-nums text-ink"
            title={`Sol ${UX_LABELS.sol}, ${sample.lmst} local time (${sample.met})`}
          >
            {formatT(tMin)}
          </span>
          <div
            role="group"
            aria-label={`Jump to a moment of the EVA (${EVA07_EVENTS.length} milestones in total)`}
            className="flex flex-wrap items-center gap-1 sm:ml-auto"
          >
            {TIMELINE_PRESETS.map((p) => {
              const pressed = Math.abs(tMin - p.t) < 0.5;
              return (
                <Button
                  key={p.t}
                  size="sm"
                  variant={pressed ? 'secondary' : 'quiet'}
                  aria-pressed={pressed}
                  onClick={() => onSelectTimeMin(p.t)}
                  className={pressed ? 'bg-raised font-medium tabular-nums' : 'tabular-nums'}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* En móvil el deslizador ocupa todo el ancho y los botones de afinar van debajo. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
          <div className="col-span-3 sm:col-span-1 sm:col-start-2 sm:row-start-1 min-w-0">
            <input
              type="range"
              className="timeline block w-full"
              min={T_START_MIN}
              max={T_END_MIN}
              step={1}
              value={Math.round(tMin)}
              onChange={(e) => onSelectTimeMin(Number(e.target.value))}
              aria-label="Mission time in minutes since departure"
              aria-valuetext={`${formatT(tMin)} minutes, ${sample.lmst} local time`}
            />
            <div className="relative h-4 t-label tabular-nums text-ink-3" aria-hidden>
              {[T_START_MIN, 0, 60, 105, T_END_MIN].map((t) => (
                <span
                  key={t}
                  className={`absolute whitespace-nowrap ${t === T_START_MIN ? '' : t === T_END_MIN ? '-translate-x-full' : '-translate-x-1/2'} ${t === 0 || t === 105 ? 'hidden sm:inline' : ''}`}
                  style={{ left: `${((t - T_START_MIN) / (T_END_MIN - T_START_MIN)) * 100}%` }}
                >
                  {formatT(t)}
                </span>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            aria-label="Back one minute"
            disabled={Math.round(tMin) <= T_START_MIN}
            onClick={() => onSelectTimeMin(Math.max(T_START_MIN, Math.round(tMin) - 1))}
            className="justify-self-start tabular-nums sm:col-start-1 sm:row-start-1"
          >
            −1 min
          </Button>
          <span className="sm:hidden self-center text-center t-value tabular-nums text-ink">{formatT(tMin)}</span>
          <Button
            size="sm"
            aria-label="Forward one minute"
            disabled={Math.round(tMin) >= T_END_MIN}
            onClick={() => onSelectTimeMin(Math.min(T_END_MIN, Math.round(tMin) + 1))}
            className="justify-self-end tabular-nums sm:col-start-3 sm:row-start-1"
          >
            +1 min
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm tabular-nums">
          <p className="text-ink-2" title={phaseDetail}>
            {capitalize(plain(sample.title))}.
          </p>
          {/* En evacuación el estado ya lo dicen la cabecera y la tarjeta de alerta: aquí no se repite. */}
          {!isEvac && (
            <span role="status" className="flex items-center gap-2 font-medium text-ink">
              <StatusDot level={stateLevel} pulse={style.pulse} />
              {stateText}
            </span>
          )}
          <span>
            <span className="text-ink-3">O₂ </span>
            <span className={`font-medium ${levelTextClass(o2Level)}`}>
              {fmt(v.o2_remaining_pct, 1)} % ({fmt(v.o2_remaining_g)} g)
            </span>
          </span>
          <span>
            <span className="text-ink-3">Dose </span>
            <span className={`font-medium ${levelTextClass(doseLevel)}`}>
              {fmt(v.dose_spe_msv, 2)} of {fmt(PLANNER_WALKBACK.dose_budget_msv, 2)} mSv
            </span>
          </span>
          <span>
            <span className="text-ink-3">Link </span>
            <span className={`font-medium ${levelTextClass(radioLevel)}`}>
              {radioText} ({fmt(v.radio_rssi_dbm, 0)} dBm)
            </span>
          </span>
        </div>

        <div
          className="border-t border-line pt-2 grid gap-x-8 gap-y-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          role="group"
          aria-labelledby="margen-h"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="margen-h" className="text-sm font-semibold text-ink">Return margin</h2>
              {!isPreEva && !isHold && tVital !== null && (
                <span className="t-label tabular-nums text-ink-2">
                  Endurance {durationText(tVital)}. Limited by {limiting === 'O₂' ? 'O₂' : 'radiation'}.
                </span>
              )}
            </div>
            {!isPreEva && !isHold && tVital !== null && (
              <div className="relative py-5" aria-hidden>
                <div className="relative h-2 rounded bg-raised">
                  <div className="absolute inset-y-0 left-0 rounded bg-ink-3" style={{ width: barPct(tVital) }} />
                  <div className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: barPct(v.wp3_time_min) }} />
                  <div
                    className={`absolute -top-1 -bottom-1 w-0.5 ${v.base_viable ? 'bg-ink' : 'bg-danger'}`}
                    style={{ left: barPct(v.base_time_min) }}
                  />
                </div>
                <span
                  className="absolute top-0 -translate-x-1/2 t-label text-ink-2 whitespace-nowrap"
                  style={{ left: `clamp(1rem, ${barPct(v.wp3_time_min)}, calc(100% - 1rem))` }}
                >
                  WP3
                </span>
                <span
                  className={`absolute bottom-0 -translate-x-1/2 t-label whitespace-nowrap ${v.base_viable ? 'text-ink-2' : 'text-danger-ink'}`}
                  style={{ left: `clamp(1rem, ${barPct(v.base_time_min)}, calc(100% - 1rem))` }}
                >
                  Base
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-1 text-sm tabular-nums lg:self-center">
            {isPreEva && <p className="text-ink-2">The EVA has not started yet.</p>}

            {isHold && (
              <p className="text-ink-2">
                Under cover in the shelter, no movement pending. {fmt(speBudgetLeft, 2)} mSv of dose left
                {tRad !== null && <>, enough for {durationText(tRad)} more under the overhang in a {fmt(PLANNER_WALKBACK.spe_rate_envelope_msv_h)} mSv/h storm</>}
                . O₂ is ample. Return to Base ({fmt(v.base_time_min, 1)} min){' '}
                {v.base_viable ? 'is viable' : 'is not viable yet'}.
              </p>
            )}

            {!isPreEva && !isHold && tVital !== null && (
              <>
                <p className="text-ink">
                  <span className="font-medium">Shelter WP3:</span> {fmt(v.wp3_time_min, 1)} min away
                  <span className={openSky !== null && wp3Margin !== null ? levelTextClass(classify('walkback_margin_min', wp3Margin)) : undefined}>
                    {marginText(wp3Margin)}
                  </span>
                  .{!v.wp3_viable && <span className="text-danger-ink font-medium"> Not viable.</span>}
                </p>
                <p>
                  <span className={v.base_viable ? 'text-ink' : 'text-ink-3 line-through'}>
                    <span className="font-medium">Base:</span> {fmt(v.base_time_min, 1)} min away{marginText(baseMargin)}.
                  </span>
                  {!v.base_viable && <span className="text-danger-ink font-medium"> Not viable.</span>}
                </p>
                <p className="t-label text-ink-3">
                  O₂ lasts {durationText(tO2)}
                  {tRad === null ? ' and there is no solar storm' : ` and radiation allows ${durationText(tRad)}`}
                  {openSky !== null && ` (${durationText(openSky)} in the open)`}. Water and battery are not part of this calculation.
                </p>
              </>
            )}
          </div>
        </div>
      </Panel>

      {isMulti && (
        <Notice level="amber" role="alert">
          <span className="font-medium">{sample.active_threats.length} threats at once. First priority: {cause.charAt(0).toLowerCase() + cause.slice(1)}.</span>{' '}
          {threatText}. No need to evacuate yet: return to Base is still viable ({fmt(v.base_time_min, 1)} min) and shelter
          WP3 is {fmt(v.wp3_time_min, 1)} min away.
        </Notice>
      )}
      {isHold && (
        <Notice level="none" role="status">
          <span className="font-medium">Under cover in shelter WP3.</span> The overhang attenuates {SUIT_SCENARIO.shelterAttenuationPct}% of the
          radiation (sky view {fmt(WP3?.svfScenario, 2)}): {fmt(v.spe_local_rate_msv_h, 2)} mSv/h inside versus{' '}
          {fmt(v.spe_ext_rate_cal_msv_h, 1)} outside. Accumulated dose {fmt(v.dose_spe_msv, 2)} of {fmt(PLANNER_WALKBACK.dose_budget_msv, 2)} mSv.{' '}
          {v.radio_class === 'VERDE'
            ? `The relay has restored the link (${formatT(EVA07_DOC.threat_windows_t_min.sombra_radio[1])}).`
            : 'No link: telemetry is stored in the suit until it is restored.'}
        </Notice>
      )}

      {/* Mapa */}
      <section aria-label="Route map" className="rounded-lg border border-line bg-panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
          <Segmented label="Map base layer" options={LAYER_OPTIONS} value={baseLayer} onChange={setBaseLayer} />
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(MAP_MAX_ZOOM, z + 1))} className={ICON_BUTTON}>
              <Plus className="w-4 h-4" aria-hidden />
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(MAP_MIN_ZOOM, z - 1))} className={ICON_BUTTON}>
              <Minus className="w-4 h-4" aria-hidden />
            </button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setMapCenter(MAP_CENTER);
                setZoom(MAP_DEFAULT_ZOOM);
              }}
            >
              <Crosshair className="w-4 h-4" aria-hidden />
              Center route
            </Button>
          </div>
          {!isEvac && (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant={markMode ? 'secondary' : 'quiet'}
                aria-pressed={markMode}
                onClick={() => setMarkMode((m) => !m)}
                className={markMode ? 'bg-raised font-medium' : undefined}
              >
                <MapPin className="w-4 h-4" aria-hidden />
                {markMode ? 'Click the map to mark' : 'Mark point'}
              </Button>
              {markMode && <Segmented label="Point type" options={POINT_KIND_OPTIONS} value={pointKind} onChange={setPointKind} />}
              {customPoints.length > 0 && (
                <>
                  <button type="button" disabled={pointBusy} aria-label="Undo last point" title="Undo last point" onClick={() => void dropPoint(customPoints[customPoints.length - 1].id)} className={ICON_BUTTON}>
                    <Undo2 className="w-4 h-4" aria-hidden />
                  </button>
                  <Button size="sm" variant="quiet" disabled={pointBusy} onClick={() => void dropPoint()}>
                    <Trash2 className="w-4 h-4" aria-hidden />
                    Clear points ({customPoints.length})
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {customPoints.length > 0 && (
          <div className="px-3 py-2 border-b border-line space-y-2">
            {planCurrent ? <RouteImpact plan={plan} /> : <p className="text-sm text-ink-3" aria-live="polite">The engine is replanning the route…</p>}
            {planCurrent && (plan?.summary?.detoured_legs.length ?? 0) > 0 && (
              <p className="t-label text-ink-3">
                The astronaut and her trail follow the replanned route; the nominal one stays as a dotted red line. Phase times still follow the stored timeline.
              </p>
            )}
            {sample.position.route === 'inalcanzable' && (
              <Notice level="red" role="alert">
                The astronaut is on a leg the engine marks as unreachable: her position is drawn on a straight line between nodes, not on a route.
              </Notice>
            )}
            {!reported.online && <Notice level="red">No link to the engine: the points on this screen may be out of date.</Notice>}
          </div>
        )}

        <div className="relative">

          <div
            ref={visorRef}
            tabIndex={0}
            role="application"
            aria-label="Route map. Arrow keys to pan, plus and minus to zoom."
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => (dragRef.current.active = false)}
            onKeyDown={handleMapKey}
            className={`relative h-[clamp(26rem,calc(100dvh-14rem),44rem)] overflow-hidden select-none bg-sunken focus-visible:outline-offset-[-2px] ${markMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          >
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {visibleTiles.map((tile) => (
                <img
                  key={tile.key}
                  src={tile.url}
                  alt=""
                  draggable={false}
                  // Posición entera y un píxel de solape: sin costuras entre teselas ampliadas.
                  style={{ position: 'absolute', left: Math.floor(tile.left), top: Math.floor(tile.top), width: tilePx + 1, height: tilePx + 1, filter: TILE_FILTER[baseLayer] }}
                  className="max-w-none"
                />
              ))}
              {hillshade && aoiBox && (
                <img
                  src={hillshade}
                  alt=""
                  draggable={false}
                  data-relief
                  style={{
                    position: 'absolute',
                    left: aoiBox.tl.x,
                    top: aoiBox.tl.y,
                    width: aoiBox.br.x - aoiBox.tl.x,
                    height: aoiBox.br.y - aoiBox.tl.y,
                    // En grises y mezclado con la tesela: aporta el detalle sin cambiar el tono del fondo.
                    filter: 'grayscale(1) contrast(1.4)',
                    mixBlendMode: 'overlay',
                    maskImage: RELIEF_MASK,
                    WebkitMaskImage: RELIEF_MASK,
                    maskComposite: 'intersect',
                    WebkitMaskComposite: 'source-in',
                  }}
                  className="max-w-none"
                />
              )}
              <div className="absolute inset-0 bg-ground/30" />
            </div>

            <svg width={visorSize.width} height={visorSize.height} viewBox={`0 0 ${visorSize.width} ${visorSize.height}`} className="absolute inset-0 pointer-events-none" aria-hidden>
              {/* Malla de pendientes (celdas de 170 m) */}
              {showHexGrid &&
                hexCells.map((c) => {
                  if (!c.boundary) return null;
                  const slope = c.slope_deg ?? 0;
                  const steep = slope > AR_SLOPE_WARN_DEG;
                  const level = classify('slope_deg', c.slope_deg);
                  const fill = c.flags.shelter ? PALETTE.green : c.flags.regolith_trap ? PALETTE.accent : LEVEL_COLOR[level];
                  return (
                    <polygon
                      key={c.h3_hex}
                      points={c.boundary.map(([la, lo]) => toScreen(la, lo)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                      fill={fill}
                      fillOpacity={c.flags.shelter ? 0.4 : level === 'green' ? 0.05 : 0.18}
                      stroke={steep && (isCaution || isMulti) ? PALETTE.amber : PALETTE.cyan}
                      strokeOpacity={steep && (isCaution || isMulti) ? 0.9 : 0.35}
                      strokeWidth={steep && (isCaution || isMulti) ? 1.4 : 0.7}
                      strokeDasharray={steep && (isCaution || isMulti) ? '3 4' : undefined}
                    />
                  );
                })}

              {/* Ruta nominal de los tramos desviados, atenuada, para ver el rodeo */}
              {planCurrent &&
                plan?.legs.map((l) =>
                  l.deviation?.status === 'desviada' && l.deviation.nominal_route ? (
                    <polyline key={`nom-${l.leg_id}`} data-nominal-route={l.leg_id} points={pts(l.deviation.nominal_route.map(([la, lo]) => ({ lat: la, lonE: lo })))} fill="none" stroke={PALETTE.red} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="1 4" />
                  ) : null
                )}
              {/* Triángulo planificado */}
              {PLANNED_LEGS.map((leg) => (
                <polyline key={leg.id} points={pts(legPath(leg.id))} fill="none" stroke={PALETTE.text2} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 5" />
              ))}

              {/* Vector de escape a WP3 (modo «Escape» o varias amenazas) y retorno a la Base */}
              {astro && WP3 && !isEvac && !isHold && !isPreEva && (dialPos === 3 || isMulti) && (() => {
                const p = toScreen(WP3.lat, WP3.lonE);
                return (
                  <g>
                    <line x1={astro.x} y1={astro.y} x2={p.x} y2={p.y} stroke={PALETTE.green} strokeWidth="2.5" strokeDasharray="8 6" />
                    <text x={(astro.x + p.x) / 2 + 8} y={(astro.y + p.y) / 2} className="num" fill={PALETTE.green} fontSize="12" fontWeight="600" stroke={PALETTE.ground} strokeWidth="3" paintOrder="stroke">
                      Escape to WP3 · {fmt(v.wp3_time_min, 1)} min
                    </text>
                  </g>
                );
              })()}
              {astro && BASE && showBaseReturn && !isEvac && !isHold && !isPreEva && (() => {
                const p = toScreen(BASE.lat, BASE.lonE);
                const col = v.base_viable ? PALETTE.text : PALETTE.red;
                return (
                  <g>
                    <line x1={astro.x} y1={astro.y} x2={p.x} y2={p.y} stroke={col} strokeWidth="2.5" strokeDasharray="8 6" />
                    <text x={(astro.x + p.x) / 2 + 8} y={(astro.y + p.y) / 2} className="num" fill={col} fontSize="12" fontWeight="600" stroke={PALETTE.ground} strokeWidth="3" paintOrder="stroke">
                      Return to Base · {fmt(v.base_time_min, 1)} min
                    </text>
                  </g>
                );
              })()}

              {/* Sendero: cian salvo en evacuación (rojo, con chevrones) y refugio (verde). En precaución
                  y con varias amenazas, borde punteado ámbar solo donde el talud pasa de 18°. */}
              {arPath.length >= 2 && (
                <g>
                  <polyline points={arPath.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={pathColor} strokeOpacity="0.28" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
                  {(isCaution || isMulti) &&
                    arTrack.steepRuns.map((run, i) => (
                      <polyline
                        key={i}
                        data-ar-steep
                        points={run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                        fill="none"
                        stroke={AR_PATH.caution}
                        strokeWidth="11"
                        strokeDasharray="2 5"
                        strokeLinejoin="round"
                      />
                    ))}
                  {(isCaution || isMulti) &&
                    arTrack.steepRuns.map((run, i) => (
                      <polyline key={i} points={run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={PALETTE.ground} strokeWidth="7" strokeLinejoin="round" />
                    ))}
                  <polyline data-ar-path={pathState} points={arPath.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={pathColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={isMulti ? 'hud-pulse' : undefined} />
                </g>
              )}
              {chevrons.map((c, i) => (
                <polyline
                  key={i}
                  points="-11,7 0,-7 11,7"
                  transform={`translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${c.deg.toFixed(1)})`}
                  fill="none"
                  stroke={PALETTE.red}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="chevron-march"
                  style={{ animationDelay: `${i * 0.14}s` }}
                />
              ))}

              {/* Nodos */}
              {CANONICAL_WAYPOINTS.map((wp) => {
                const p = toScreen(wp.lat, wp.lonE);
                const col = NODE_COLOR[wp.id];
                const isGoal = wp.id === sample.phase.goal && !isPreEva;
                const showLabel = dialPos >= 2 || isGoal || isEvac || isHold;
                const name = nodeLabel(wp.id);
                const label = dialPos >= 2 && astro && !isEvac ? `${name} · ${fmt(haversineM(sample.position.lat ?? wp.lat, sample.position.lon_e ?? wp.lonE, wp.lat, wp.lonE))} m` : name;
                const w = label.length * 7.3 + 12;
                return (
                  <g key={wp.id}>
                    {wp.id === 'WP3' && (isEvac || isHold) && <circle cx={p.x} cy={p.y} r="16" fill="none" stroke={PALETTE.green} strokeWidth="2.5" className={isEvac ? 'hud-pulse' : undefined} />}
                    <circle cx={p.x} cy={p.y} r={isGoal ? 8 : 6} fill={col} stroke={PALETTE.ground} strokeWidth="1.5" />
                    {showLabel && (
                      <>
                        <rect x={p.x + 10} y={p.y - 10} width={w} height="20" rx="4" fill={PALETTE.ground} fillOpacity="0.85" />
                        <text x={p.x + 16} y={p.y + 4} className="num" fill={PALETTE.text} fontSize="12" fontWeight="500">
                          {label}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* Astronauta */}
              {astro && !isPreEva && (
                <g transform={`translate(${astro.x.toFixed(1)},${astro.y.toFixed(1)})`}>
                  <circle r="13" fill={style.color} fillOpacity="0.2" stroke={style.color} strokeWidth="2" />
                  {bearing !== null && !sample.position.at_goal && <polygon points="0,-20 6,-9 -6,-9" fill={style.color} transform={`rotate(${bearing})`} />}
                  <circle r="5" fill={PALETTE.text} stroke={PALETTE.ground} strokeWidth="1.5" />
                </g>
              )}

              {/* Puntos marcados por la astronauta */}
              {customPoints.map((pt) => {
                const p = toScreen(pt.lat, pt.lon_e);
                const color = POINT_COLOR[pt.kind];
                const hm = reported.hazardModel;
                return (
                  <g key={pt.id} data-reported-point={pt.kind}>
                    {pt.kind === 'PELIGRO' && hm && (
                      <>
                        <circle cx={p.x} cy={p.y} r={hm.caution_radius_m / metersPerPx} fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="4 4" />
                        <circle cx={p.x} cy={p.y} r={hm.exclusion_radius_m / metersPerPx} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.5" />
                      </>
                    )}
                    <circle cx={p.x} cy={p.y} r="9" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="2" />
                    <text x={p.x + 13} y={p.y + 4} className="num" fill={PALETTE.text} fontSize="12" fontWeight="600" stroke={PALETTE.ground} strokeWidth="3" paintOrder="stroke">
                      {pt.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Dónde está y adónde va */}
            {!isEvac && (
              <p className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-md bg-ground/85 px-2.5 py-1.5 text-sm tabular-nums text-ink">
                {objectiveText}
              </p>
            )}

            {/* Procedencia de la imagen y escala */}
            <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
              <p className={`min-w-0 rounded-md bg-ground/85 px-2 py-1 t-label text-ink-2 `}>
                {MARS_TREK_LAYERS[baseLayer].attribution}, {LAYER_RESOLUTION[baseLayer]}
                {zoom > TREK_MAX_ZOOM ? `, magnified ×${scale}` : ''}. {hillshade ? 'Terrain relief at 20 m.' : 'Relief unavailable: the compute engine is not responding.'} Ctrl + wheel to zoom.
              </p>
              <div className="shrink-0 flex flex-col items-end rounded-md bg-ground/85 px-2 py-1 num t-label text-ink" aria-hidden>
                <div className="h-1.5 border-x border-b border-ink" style={{ width: scaleBarM / metersPerPx }} />
                <div>{scaleBarM >= 1000 ? `${fmt(scaleBarM / 1000)} km` : `${fmt(scaleBarM)} m`}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {customPoints.length > 0 && (
        <Panel title="Marked points" aside={`${customPoints.length} in the engine`} bodyClassName="space-y-4">
          <PointList points={customPoints} onRemove={(id) => void dropPoint(id)} busy={pointBusy} />
          {reported.hazardModel && <p className="t-label text-ink-3">{reported.hazardModel.note}</p>}
          <div>
            <h3 className="text-sm font-semibold text-ink mb-1.5">Emergency re-decision with these points</h3>
            <EmergencyRedecision data={emergency} canonicalWp3Min={PLANNER_WALKBACK.wp3.time_min} />
          </div>
        </Panel>
      )}

      {/* Controles del traje (unidad de muñeca) y lecturas */}
      <Panel title="Suit controls" aside={`${UX_LABELS.suit} wrist unit`} bodyClassName="space-y-4">
        {isEvac ? (
          <p className="text-sm text-ink-2">
            The grid, sample logging, readings and visor mode are paused until the shelter is reached.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={showHexGrid ? 'secondary' : 'quiet'}
                aria-pressed={showHexGrid}
                title="Zone 1: terrain grid colored by slope"
                onClick={() => {
                  if (!showHexGrid && hexCells.length === 0) {
                    onNotify('Slope grid unavailable', 'It is served by the compute engine, which is not responding.', 'amber');
                    return;
                  }
                  setShowHexGrid((g) => !g);
                }}
                className={showHexGrid ? 'bg-raised font-medium' : undefined}
              >
                <Layers className="w-4 h-4" aria-hidden />
                Slope grid
              </Button>

              <Button
                size="sm"
                variant="quiet"
                aria-disabled={!isruOpen}
                title={isruOpen ? 'Zone 2: log a sample at WP1' : 'Zone 2: only during sampling at WP1'}
                onClick={() => {
                  if (!isruOpen) {
                    onNotify('Samples cannot be logged now', 'Only during sampling at WP1 (T+28 to T+75).', 'amber');
                    return;
                  }
                  setIsruSamples((s) => [...s, sample.t_min]);
                  onNotify(`ISRU sample #${isruSamples.length + 1} logged`, `WP1, ${formatT(sample.t_min)}. Hydrated sulfates (≥ ${fmt(waypoint('WP1')?.h2oWtPct)}% H₂O in bulk rock).`, 'green');
                }}
                className={isruOpen ? undefined : 'opacity-60'}
              >
                <FlaskConical className="w-4 h-4" aria-hidden />
                Log ISRU sample ({isruSamples.length})
              </Button>

              <Button
                size="sm"
                variant={showBaseReturn ? 'secondary' : 'quiet'}
                aria-pressed={showBaseReturn}
                disabled={isPreEva || isHold}
                title={`Zone 4: direct return to Base${isPreEva ? '' : `, ${fmt(v.base_time_min, 1)} min, ${v.base_viable ? 'viable' : 'not viable'}`}`}
                onClick={() => {
                  const next = !showBaseReturn;
                  setShowBaseReturn(next);
                  if (next)
                    onNotify(
                      'Return to Base drawn on the map',
                      `${fmt(v.base_time_min, 1)} min, ${v.base_viable ? 'viable' : 'not viable'}${v.base_dose_proj_msv > 0 ? `. Projected dose: ${fmt(v.base_dose_proj_msv, 2)} mSv` : ''}.`,
                      v.base_viable ? 'cyan' : 'red'
                    );
                }}
                className={showBaseReturn ? 'bg-raised font-medium' : undefined}
              >
                <Undo2 className="w-4 h-4" aria-hidden />
                Draw return to Base
              </Button>

              <Button
                size="sm"
                variant={showDiagnostics ? 'secondary' : 'quiet'}
                aria-expanded={showDiagnostics}
                aria-controls="traje-detalle"
                title="Zone 3: consumables, dose and samples"
                onClick={() => setShowDiagnostics((d) => !d)}
                className={showDiagnostics ? 'bg-raised font-medium' : undefined}
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} aria-hidden />
                Consumables and dose
              </Button>

              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <span className="t-label text-ink-3">{dialHint}</span>
                <Segmented
                  label="Visor mode"
                  options={DIAL_OPTIONS}
                  value={String(dialPos) as DialValue}
                  onChange={(d) => setDialPos(Number(d) as 1 | 2 | 3)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-3 border-t border-line pt-3">
              <Stat label="Metabolic power" value={fmt(v.metabolic_power_w)} unit="W" level={powerLevel} hint={powerSource} />
              <Stat label="O₂ consumption" value={fmt(v.o2_l_min, 2)} unit="L/min" level={o2RateLevel} />
              <Stat label="Suit pressure" value={fmt(SUIT_SCENARIO.pressureKpa, 1)} unit="kPa" hint="Assumed value" />
              {inputs ? (
                <>
                  <Stat label="Slope" value={`${fmt(inputs.cell_slope_deg, 1)}°`} level={slopeLevel} hint={plain(sample.phase.location)} />
                  <Stat label="Thermal inertia" value={fmt(inputs.cell_tiu)} unit="TIU" level={tiuLevel} hint={`Terrain coefficient ${fmt(terrainEta(inputs.cell_tiu), 1)}`} />
                  <Stat label="Sky view" value={fmt(inputs.cell_svf, 2)} />
                </>
              ) : (
                <p className="col-span-2 sm:col-span-3 t-label text-ink-3 self-center">
                  No terrain reading: the astronaut is in the habitat ({plain(sample.phase.location)}).
                </p>
              )}
            </div>

            {showDiagnostics && (
              <div id="traje-detalle" className="border-t border-line pt-2">
                <div className="grid sm:grid-cols-2 gap-x-10">
                  <Row label="Primary O₂" level={o2Level} value={`${fmt(v.o2_remaining_pct, 1)} % (${fmt(v.o2_remaining_g)} g)`} />
                  <Row label="O₂ endurance at current rate" value={isPreEva ? 'No consumption yet' : isHold ? 'Ample, under cover' : capitalize(durationText(tO2))} />
                  <Row label="Cooling water" value={`${fmt(SUIT_SCENARIO.coolingWaterKg, 1)} kg (assumed value)`} />
                  <Row label="Battery" value={`${fmt(SUIT_SCENARIO.batteryWh)} Wh (assumed value)`} />
                  <Row label="Solar storm dose" level={doseLevel} value={`${fmt(v.dose_spe_msv, 2)} of ${fmt(PLANNER_WALKBACK.dose_budget_msv, 2)} mSv`} />
                  <Row label="Dose warning from" value={`${fmt(limits('eva_spe_dose_budget_msv').amber, 1)} mSv`} />
                  <Row label="Background dose (GCR)" value={`${fmt(v.dose_gcr_msv, 3)} mSv`} />
                  <Row label="Airborne dust" level={tauLevel} value={`τ ${fmt(v.dust_tau, 1)}`} />
                  <Row label="ISRU samples" value={`${isruSamples.length} logged`} />
                  <Row label="UHF radio beacon" value={`${fmt(REFERENCE_FIGURES.radio_beacon_freq_mhz)} MHz`} />
                  <Row
                    label="Safety rules"
                    value={isPreEva ? 'on standby' : sample.source === 'api' ? 'computed by the engine' : 'local copy'}
                  />
                </div>
                <p className="t-label text-ink-3 mt-2">
                  In this phase: {phaseDetail}. The model does not compute water or battery use. At {formatT(T_DECISION_MIN)} the compute engine starts from{' '}
                  {fmt(PLANNER_WALKBACK.t_vital_lcvg_min)} min of water and {fmt(PLANNER_WALKBACK.t_vital_battery_min)} min of battery.
                </p>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
};
