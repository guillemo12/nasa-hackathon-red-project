import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Crosshair, FlaskConical, Layers, MapPin, Minus, Pause, Play, Plus, Trash2, Undo2, Volume2 } from 'lucide-react';
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
import { fetchHexGrid, fetchRoutePlan, fetchTerrain } from '@/engine/apiClient';
import { causeLabel, formatT, openSkyWindowMin } from '@/engine/evaModel';
import { bearingWords, compassPoint, fmt, haversineM, hillshadeDataUrl, numberWord } from '@/engine/geo';
import {
  MARS_TREK_LAYERS,
  TILE_SIZE,
  getTrekTileUrl,
  latLonToWorldPx,
  worldPxToLatLon,
  type MarsTrekLayerId,
} from '@/engine/marsTrekTiles';
import { P1_CONSTANTS, classify, limits, terrainEta, type Level } from '@/engine/thresholds';
import { LEVEL_COLOR, NODE_COLOR, PALETTE, RADIO_CLASS_LEVEL, STATE_STYLE } from '@/theme';
import type { Eva07Sample, HexCell, Notify, RoutePlan, TerrainGrid } from '@/types/mission';

interface EvaHudViewProps {
  sample: Eva07Sample;
  tMin: number;
  isLive: boolean;
  apiOnline: boolean;
  onToggleLive: () => void;
  onSelectTimeMin: (tMin: number) => void;
  onNotify: Notify;
}

interface CustomMapPoint {
  id: number;
  lat: number;
  lonE: number;
  label: string;
  kind: 'ISRU' | 'PELIGRO' | 'REFUGIO';
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

const PRESET_IDS = ['llegada_wp1', 'nlos', 'regolito', 'spe_polvo', 'llegada_wp3', 'telemetria_final'];
const PRESET_LABEL: Record<string, string> = {
  llegada_wp1: 'Muestreo en WP1',
  nlos: 'Corte de radio',
  regolito: 'Rampa de 22°',
  spe_polvo: 'Multiemergencia',
  llegada_wp3: 'Refugio WP3',
  telemetria_final: 'Final',
};
const TIMELINE_PRESETS = PRESET_IDS.map((id) => EVA07_EVENTS.find((e) => e.id === id))
  .filter((e): e is (typeof EVA07_EVENTS)[number] => Boolean(e))
  .map((e) => ({ t: e.t_min, label: `${formatT(e.t_min)} ${PRESET_LABEL[e.id]}`, evac: e.id === 'spe_polvo' }));

const LAYER_OPTIONS: Array<{ value: MarsTrekLayerId; label: string }> = [
  { value: 'viking', label: 'Imagen' },
  { value: 'mola', label: 'Relieve' },
];
const POINT_KIND_OPTIONS: Array<{ value: CustomMapPoint['kind']; label: string }> = [
  { value: 'ISRU', label: 'ISRU' },
  { value: 'PELIGRO', label: 'Peligro' },
  { value: 'REFUGIO', label: 'Refugio' },
];
const POINT_KIND_TEXT: Record<CustomMapPoint['kind'], string> = { ISRU: 'ISRU', PELIGRO: 'peligro', REFUGIO: 'refugio' };
/** Dial mecánico de tres posiciones de la unidad de muñeca. */
type DialValue = '1' | '2' | '3';
const DIAL_OPTIONS: Array<{ value: DialValue; label: string; hint: string }> = [
  { value: '1', label: 'Sendero', hint: 'Solo el sendero y el objetivo' },
  { value: '2', label: 'Nodos', hint: 'Nodos con su distancia' },
  { value: '3', label: 'Escape', hint: 'Vector de escape a WP3' },
];
/** Nombres de los nodos dentro de una frase («Hacia…», «En…»). */
const GOAL_NAME: Record<string, string> = { BASE: 'la Base', WP1: 'WP1 (sulfatos)', WP2: 'WP2 (talud)', WP3: 'el refugio WP3' };
/** De dónde sale la potencia metabólica de cada fase, en palabras. */
const POWER_SOURCE_TEXT: Record<string, string> = {
  sin_consumo: 'Sin consumo',
  escenario: 'Valor supuesto',
  modelo: 'Según el modelo',
  modelo_tramo_real: 'Según el modelo del tramo',
  modelo_ritmo_regulado: 'Modelo con ritmo regulado',
  planificador_dstar: 'Según el planificador',
};
/** Los textos de la cronología llegan con términos internos: aquí se dicen en claro. */
const plain = (text: string) =>
  text
    .replace(/\s*\(NLOS\)/g, '')
    .replace(/Enlace Zenoh/g, 'Enlace')
    .replace(/Dynamic Goal Switching/g, 'cambio de destino')
    .replace(/huida D\* Lite/g, 'huida calculada por el planificador')
    .replace(/API Rust/g, 'motor de cálculo');
const LAYER_RESOLUTION: Record<MarsTrekLayerId, string> = { viking: '232 m por píxel', mola: '463 m por píxel' };
const RADIO_TEXT: Record<string, string> = { VERDE: 'bueno', AMBAR: 'débil', ROJO: 'cortado' };
const ICON_BUTTON =
  'shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer';

const listText = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const ESCAPE_LEG = legBetween('WP2', 'WP3');
const WP3 = waypoint('WP3');
const BASE = waypoint('BASE');

export const EvaHudView: React.FC<EvaHudViewProps> = ({
  sample,
  tMin,
  isLive,
  apiOnline,
  onToggleLive,
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
  const [pointKind, setPointKind] = useState<CustomMapPoint['kind']>('ISRU');
  const [customPoints, setCustomPoints] = useState<CustomMapPoint[]>([]);

  const [hexCells, setHexCells] = useState<HexCell[]>([]);
  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  const [plan, setPlan] = useState<RoutePlan | null>(null);

  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, wx: 0, wy: 0 });

  useEffect(() => {
    if (!apiOnline) return;
    let active = true;
    fetchHexGrid().then((c) => active && setHexCells(c)).catch(() => undefined);
    fetchTerrain().then((t) => active && setTerrain(t)).catch(() => undefined);
    fetchRoutePlan().then((p) => active && setPlan(p)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiOnline]);

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

  // Walkback Limit Dual: T_vital (O₂ y radiación) y márgenes por destino. P1 no modela en el
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
  const escapeMinutes = Math.max(1, Math.round(isEvac ? v.wp3_time_min : PLANNER_WALKBACK.wp3.time_min));
  const voiceLine = `Alerta combinada. Base inviable por radiación. Siga chevrones al refugio, rumbo ${bearingWords(escapeBearing)}. ${capitalize(numberWord(escapeMinutes))} minutos.`;

  const speak = () => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setVoiceStatus('unavailable');
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(voiceLine);
    utter.lang = 'es-ES';
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
  // Mapa (teselas Mars Trek + relieve real de la malla de P1 + capa vectorial)
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

  // Sendero AR: lo que queda del tramo en curso, desde la astronauta hasta el objetivo.
  const arPath: Array<{ x: number; y: number }> = useMemo(() => {
    if (!astro || !goal || sample.position.at_goal || isPreEva) return [];
    const leg = legBetween(sample.position.from, sample.phase.goal);
    const full = leg ? legPath(leg.id) : [];
    const start = Math.floor(sample.position.frac * Math.max(0, full.length - 1));
    const rest = full.slice(start + 1).map((p) => toScreen(p.lat, p.lonE));
    return [astro, ...rest, toScreen(goal.lat, goal.lonE)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample.position.frac, sample.position.from, sample.phase.goal, sample.position.at_goal, plan, zoom, mapCenter, visorSize, isPreEva]);

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
    const next: CustomMapPoint = { id: Date.now(), lat, lonE, label: `P${customPoints.length + 1}`, kind: pointKind };
    setCustomPoints((prev) => [...prev, next]);
    onNotify(`Punto ${next.label} (${POINT_KIND_TEXT[next.kind]}) añadido`, `${fmt(lat, 4)}°, ${fmt(lonE, 4)}°E`, 'cyan');
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
      return `En la Base, antes de salir. Primer objetivo, ${l1.to}: rumbo ${fmt(l1.bearingDeg)}° ${compassPoint(l1.bearingDeg)} · ${fmt(l1.distanceM)} m`;
    }
    if (isHold) return 'En el refugio WP3, a cubierto bajo la cornisa';
    if (sample.position.at_goal) return `En ${goalName}`;
    return `Hacia ${goalName}${bearing !== null ? `: rumbo ${fmt(bearing)}° ${compassPoint(bearing)}` : ''} · ${fmt(sample.position.target_distance_m)} m`;
  })();

  const isruOpen = sample.phase_id === 'A2_isru_wp1';
  const threatParts = sample.active_threats.map((t) => {
    if (t === 'spe') return `tormenta solar de hasta ${fmt(PLANNER_WALKBACK.spe_rate_envelope_msv_h)} mSv/h`;
    if (t === 'polvo') return `polvo (τ ${fmt(v.dust_tau, 1)})`;
    if (t === 'sombra_radio') return 'sombra de radio';
    if (t === 'trampa_regolito') return `talud de ${SUIT_SCENARIO.wp2RampDeg}° sobre regolito suelto (${fmt(waypoint('WP2')?.tiu)} TIU)`;
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
    m === null ? '' : m >= 0 ? `, con ${fmt(m, 1)} min de margen` : `; faltan ${fmt(Math.abs(m), 1)} min`;

  const confirmEvac = () => {
    setEvacConfirmed(true);
    onNotify('Evacuación al refugio WP3 confirmada', `Rumbo ${fmt(escapeBearing)}°, ${fmt(v.wp3_route_m)} m, ${fmt(v.wp3_time_min, 1)} min.`, 'red');
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
        Evacuación
      </div>
      <div>
        <h2 className="text-[28px] leading-9 font-semibold text-ink">{style.label}</h2>
        <p className="mt-1 t-value tabular-nums text-ink">
          {fmt(escapeBearing)}° {compassPoint(escapeBearing)} · {fmt(v.wp3_route_m)} m · {fmt(v.wp3_time_min, 1)} min
        </p>
      </div>
      <p className="text-sm text-ink-2">
        {threatText}. La Base no es viable: el refugio es la única salida.
      </p>
      </div>
      <div className="space-y-3 md:self-center">
      <Button
        variant={evacConfirmed ? 'secondary' : 'danger'}
        aria-pressed={evacConfirmed}
        onClick={confirmEvac}
        className="w-full"
      >
        {evacConfirmed ? 'Evacuación confirmada' : 'Confirmar evacuación'}
      </Button>
      <div className="flex items-start gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={speak}
          aria-label="Oír la orden"
          title="Oír la orden"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
        >
          <Volume2 className={`w-4 h-4 ${voiceStatus === 'playing' ? 'hud-pulse' : ''}`} aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="text-sm text-ink">«{voiceLine}»</p>
          <p className="t-label text-ink-3 mt-1" data-voice-status={voiceStatus} data-voice-seconds={voiceSeconds ?? ''}>
            {voiceStatus === 'unavailable' && 'Este navegador no tiene voz: la orden queda solo escrita.'}
            {voiceStatus === 'blocked' && 'El navegador no ha dejado sonar la voz: pulsa el altavoz para oír la orden.'}
            {voiceStatus === 'playing' && 'Sonando en el casco…'}
            {voiceStatus === 'done' && voiceSeconds !== null && `Orden dicha en ${fmt(voiceSeconds, 1)} s.`}
            {voiceStatus === 'idle' && 'Preparando la voz…'}
          </p>
        </div>
      </div>
      <Disclosure summary="Más detalle">
        <Row
          label="Vuelta a la Base"
          level="red"
          value={`${fmt(v.base_time_min, 1)} min, ${fmt(v.base_dose_proj_msv, 2)} mSv (límite ${fmt(PLANNER_WALKBACK.dose_budget_msv)})`}
        />
        <Row label="El refugio atenúa" value={`${SUIT_SCENARIO.shelterAttenuationPct} % de la radiación`} />
        <Row label="Cielo visible en el refugio" value={fmt(WP3?.svfScenario, 2)} />
        <Row label="Ritmo de marcha" value={`${fmt(PLANNER_WALKBACK.wp3.mean_speed_mps, 2)} m/s`} />
        <p className="t-label text-ink-3 pt-1">{phaseDetail}</p>
      </Disclosure>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {evacCard}

      {/* Cronología */}
      <Panel bodyClassName="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold text-ink">Telemetría EVA</h1>
          <span className="t-label text-ink-3">
            EVA-07 · {UX_LABELS.astronaut}, traje {UX_LABELS.suit}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleLive}
            aria-pressed={isLive}
            aria-label={isLive ? 'Pausar la cronología' : 'Reproducir la cronología'}
            title="Un minuto de misión por segundo"
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-md border border-line-strong text-ink hover:bg-raised cursor-pointer"
          >
            {isLive ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
          </button>
          <div className="flex-1 min-w-0">
            <input
              type="range"
              className="timeline w-full"
              min={T_START_MIN}
              max={T_END_MIN}
              step={1}
              value={Math.round(tMin)}
              onChange={(e) => onSelectTimeMin(Number(e.target.value))}
              aria-label="Tiempo de misión en minutos desde la salida"
              aria-valuetext={`${formatT(tMin)} minutos, ${sample.lmst} hora local`}
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
          <span className="shrink-0 w-14 text-right t-value tabular-nums text-ink">{formatT(tMin)}</span>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
          <p className="text-sm font-medium text-ink" title={phaseDetail}>
            {plain(sample.title)}.
          </p>
          <p className="t-label tabular-nums text-ink-3">
            Sol {UX_LABELS.sol}, {sample.lmst} hora local ({sample.met}). {isLive ? 'En marcha.' : 'En pausa.'}
          </p>
        </div>

        <div
          role="group"
          aria-label={`Ir a un momento de la salida (${EVA07_EVENTS.length} hitos en total)`}
          className="flex flex-wrap items-center gap-1"
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
      </Panel>

      {/* Estado y margen de retorno */}
      <Panel bodyClassName="space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm tabular-nums">
          <span role="status" className="flex items-center gap-2 font-medium text-ink">
            <StatusDot level={stateLevel} pulse={style.pulse} />
            {stateText}
          </span>
          <span>
            <span className="text-ink-3">O₂ </span>
            <span className={`font-medium ${levelTextClass(o2Level)}`}>
              {fmt(v.o2_remaining_pct, 1)} % ({fmt(v.o2_remaining_g)} g)
            </span>
          </span>
          <span>
            <span className="text-ink-3">Dosis </span>
            <span className={`font-medium ${levelTextClass(doseLevel)}`}>
              {fmt(v.dose_spe_msv, 2)} de {fmt(PLANNER_WALKBACK.dose_budget_msv, 2)} mSv
            </span>
          </span>
          <span>
            <span className="text-ink-3">Enlace </span>
            <span className={`font-medium ${levelTextClass(radioLevel)}`}>
              {radioText} ({fmt(v.radio_rssi_dbm, 0)} dBm)
            </span>
          </span>
        </div>

        <div className="border-t border-line pt-3" role="group" aria-labelledby="margen-h">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="margen-h" className="text-sm font-semibold text-ink">Margen de retorno</h2>
            {!isPreEva && !isHold && tVital !== null && (
              <span className="t-label tabular-nums text-ink-2">
                Autonomía de {fmt(Math.min(tVital, 999), 1)} min. Limita {limiting === 'O₂' ? 'el O₂' : 'la radiación'}.
              </span>
            )}
          </div>

          {isPreEva && <p className="mt-1.5 text-sm text-ink-2">La salida aún no ha empezado.</p>}

          {isHold && (
            <p className="mt-1.5 text-sm tabular-nums text-ink-2">
              En el refugio, sin desplazamiento pendiente. Quedan {fmt(speBudgetLeft, 2)} mSv de dosis
              {tRad !== null && <>, que dan para {fmt(tRad, 0)} min más bajo la cornisa con una tormenta de {fmt(PLANNER_WALKBACK.spe_rate_envelope_msv_h)} mSv/h</>}
              . Hay O₂ para {fmt(Math.min(tO2, 999), 0)} min. La vuelta a la Base ({fmt(v.base_time_min, 1)} min){' '}
              {v.base_viable ? 'es viable' : 'todavía no es viable'}.
            </p>
          )}

          {!isPreEva && !isHold && tVital !== null && (
            <>
              <div className="relative py-5 mt-1" aria-hidden>
                <div className="relative h-2 rounded bg-raised">
                  <div className={`absolute inset-y-0 left-0 rounded bg-ink-3`} style={{ width: barPct(tVital) }} />
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
              <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 text-sm tabular-nums">
                <p className="text-ink">
                  <span className="font-medium">Refugio WP3:</span> a {fmt(v.wp3_time_min, 1)} min
                  <span className={openSky !== null && wp3Margin !== null ? levelTextClass(classify('walkback_margin_min', wp3Margin)) : undefined}>
                    {marginText(wp3Margin)}
                  </span>
                  .{!v.wp3_viable && <span className="text-danger-ink font-medium"> No viable.</span>}
                </p>
                <p>
                  <span className={v.base_viable ? 'text-ink' : 'text-ink-3 line-through'}>
                    <span className="font-medium">Base:</span> a {fmt(v.base_time_min, 1)} min{marginText(baseMargin)}.
                  </span>
                  {!v.base_viable && <span className="text-danger-ink font-medium"> No viable.</span>}
                </p>
              </div>
              <p className="mt-2 t-label tabular-nums text-ink-3">
                Hay O₂ para {fmt(Math.min(tO2, 999), 0)} min
                {tRad === null ? ' y no hay tormenta solar' : ` y la radiación deja ${fmt(tRad, 1)} min`}
                {openSky !== null && ` (${fmt(openSky, 1)} min a cielo abierto)`}. El agua y la batería no entran en este cálculo.
              </p>
            </>
          )}
        </div>
      </Panel>

      {isMulti && (
        <Notice level="amber" role="alert">
          <span className="font-medium">{sample.active_threats.length} amenazas a la vez. Lo primero: {cause.charAt(0).toLowerCase() + cause.slice(1)}.</span>{' '}
          {threatText}. Todavía no hay que evacuar: la vuelta a la Base sigue siendo viable ({fmt(v.base_time_min, 1)} min) y el refugio
          WP3 está a {fmt(v.wp3_time_min, 1)} min.
        </Notice>
      )}
      {isHold && (
        <Notice level="none" role="status">
          <span className="font-medium">A cubierto en el refugio WP3.</span> La cornisa atenúa el {SUIT_SCENARIO.shelterAttenuationPct} % de la
          radiación (cielo visible {fmt(WP3?.svfScenario, 2)}): {fmt(v.spe_local_rate_msv_h, 2)} mSv/h dentro frente a{' '}
          {fmt(v.spe_ext_rate_cal_msv_h, 1)} fuera. Dosis acumulada, {fmt(v.dose_spe_msv, 2)} de {fmt(PLANNER_WALKBACK.dose_budget_msv, 2)} mSv.{' '}
          {v.radio_class === 'VERDE'
            ? `El repetidor ha restablecido el enlace (${formatT(EVA07_DOC.threat_windows_t_min.sombra_radio[1])}).`
            : 'Sin enlace: la telemetría se guarda en el traje hasta recuperarlo.'}
        </Notice>
      )}

      {/* Mapa */}
      <section aria-label="Mapa de la ruta" className="rounded-lg border border-line bg-panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
          <Segmented label="Capa base del mapa" options={LAYER_OPTIONS} value={baseLayer} onChange={setBaseLayer} />
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Acercar el mapa" onClick={() => setZoom((z) => Math.min(MAP_MAX_ZOOM, z + 1))} className={ICON_BUTTON}>
              <Plus className="w-4 h-4" aria-hidden />
            </button>
            <button type="button" aria-label="Alejar el mapa" onClick={() => setZoom((z) => Math.max(MAP_MIN_ZOOM, z - 1))} className={ICON_BUTTON}>
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
              Centrar ruta
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
                {markMode ? 'Pulsa el mapa para marcar' : 'Marcar punto'}
              </Button>
              {markMode && <Segmented label="Tipo de punto" options={POINT_KIND_OPTIONS} value={pointKind} onChange={setPointKind} />}
              {customPoints.length > 0 && (
                <>
                  <button type="button" aria-label="Deshacer el último punto" title="Deshacer el último punto" onClick={() => setCustomPoints((p) => p.slice(0, -1))} className={ICON_BUTTON}>
                    <Undo2 className="w-4 h-4" aria-hidden />
                  </button>
                  <Button size="sm" variant="quiet" onClick={() => setCustomPoints([])}>
                    <Trash2 className="w-4 h-4" aria-hidden />
                    Borrar puntos ({customPoints.length})
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="relative">

          <div
            ref={visorRef}
            tabIndex={0}
            role="application"
            aria-label="Mapa de la ruta. Flechas para desplazar, más y menos para ampliar."
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
                  style={{ position: 'absolute', left: tile.left, top: tile.top, width: tilePx, height: tilePx, imageRendering: scale > 1 ? 'auto' : undefined }}
                  className="max-w-none opacity-80"
                />
              ))}
              {hillshade && aoiBox && (
                <img
                  src={hillshade}
                  alt=""
                  draggable={false}
                  style={{ position: 'absolute', left: aoiBox.tl.x, top: aoiBox.tl.y, width: aoiBox.br.x - aoiBox.tl.x, height: aoiBox.br.y - aoiBox.tl.y }}
                  className="max-w-none"
                />
              )}
              <div className="absolute inset-0 bg-ground/30" />
            </div>

            <svg width={visorSize.width} height={visorSize.height} viewBox={`0 0 ${visorSize.width} ${visorSize.height}`} className="absolute inset-0 pointer-events-none" aria-hidden>
              {/* Malla de pendientes (celdas de 170 m) */}
              {(showHexGrid || isCaution || isMulti) &&
                hexCells.map((c) => {
                  if (!c.boundary) return null;
                  const slope = c.slope_deg ?? 0;
                  const steep = slope > AR_SLOPE_WARN_DEG;
                  if (!showHexGrid && !steep) return null;
                  const level = classify('slope_deg', c.slope_deg);
                  const fill = c.flags.shelter ? PALETTE.green : c.flags.regolith_trap ? PALETTE.accent : LEVEL_COLOR[level];
                  return (
                    <polygon
                      key={c.h3_hex}
                      points={c.boundary.map(([la, lo]) => toScreen(la, lo)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                      fill={showHexGrid ? fill : 'none'}
                      fillOpacity={showHexGrid ? (c.flags.shelter ? 0.4 : level === 'green' ? 0.05 : 0.18) : 0}
                      stroke={steep && (isCaution || isMulti) ? PALETTE.amber : PALETTE.cyan}
                      strokeOpacity={steep && (isCaution || isMulti) ? 0.9 : 0.35}
                      strokeWidth={steep && (isCaution || isMulti) ? 1.4 : 0.7}
                      strokeDasharray={steep && (isCaution || isMulti) ? '3 4' : undefined}
                    />
                  );
                })}

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
                      Escape a WP3 · {fmt(v.wp3_time_min, 1)} min
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
                      Retorno a la Base · {fmt(v.base_time_min, 1)} min
                    </text>
                  </g>
                );
              })()}

              {/* Sendero: línea continua con el color del estado */}
              {arPath.length >= 2 && (
                <g>
                  <polyline points={arPath.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={style.color} strokeOpacity="0.28" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points={arPath.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={style.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={isMulti ? 'hud-pulse' : undefined} />
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
                const label = dialPos >= 2 && astro && !isEvac ? `${wp.id} · ${fmt(haversineM(sample.position.lat ?? wp.lat, sample.position.lon_e ?? wp.lonE, wp.lat, wp.lonE))} m` : wp.id;
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
                const p = toScreen(pt.lat, pt.lonE);
                const color = pt.kind === 'PELIGRO' ? PALETTE.red : pt.kind === 'REFUGIO' ? PALETTE.green : PALETTE.cyan;
                return (
                  <g key={pt.id}>
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
                {zoom > TREK_MAX_ZOOM ? `, ampliada ×${scale}` : ''}. {hillshade ? 'Relieve del terreno a 20 m.' : 'Relieve no disponible: el motor de cálculo no responde.'} Ctrl + rueda para ampliar.
              </p>
              <div className="shrink-0 flex flex-col items-end rounded-md bg-ground/85 px-2 py-1 num t-label text-ink" aria-hidden>
                <div className="h-1.5 border-x border-b border-ink" style={{ width: scaleBarM / metersPerPx }} />
                <div>{scaleBarM >= 1000 ? `${fmt(scaleBarM / 1000)} km` : `${scaleBarM} m`}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Controles del traje (unidad de muñeca) y lecturas */}
      <Panel title="Controles del traje" aside={`Unidad de muñeca del ${UX_LABELS.suit}`} bodyClassName="space-y-4">
        {isEvac ? (
          <p className="text-sm text-ink-2">
            La malla, el registro de muestras, las lecturas y el modo del visor están en pausa hasta llegar al refugio.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={showHexGrid ? 'secondary' : 'quiet'}
                aria-pressed={showHexGrid}
                title="Zona 1: malla del terreno coloreada por pendiente"
                onClick={() => {
                  if (!showHexGrid && hexCells.length === 0) {
                    onNotify('La malla de pendientes no está disponible', 'La sirve el motor de cálculo, que ahora no responde.', 'amber');
                    return;
                  }
                  setShowHexGrid((g) => !g);
                }}
                className={showHexGrid ? 'bg-raised font-medium' : undefined}
              >
                <Layers className="w-4 h-4" aria-hidden />
                Malla de pendientes
              </Button>

              <Button
                size="sm"
                variant="quiet"
                aria-disabled={!isruOpen}
                title={isruOpen ? 'Zona 2: registrar una muestra en WP1' : 'Zona 2: solo durante el muestreo en WP1'}
                onClick={() => {
                  if (!isruOpen) {
                    onNotify('Ahora no se pueden registrar muestras', 'Solo durante el muestreo en WP1 (de T+28 a T+75).', 'amber');
                    return;
                  }
                  setIsruSamples((s) => [...s, sample.t_min]);
                  onNotify(`Muestra ISRU n.º ${isruSamples.length + 1} registrada`, `WP1, ${formatT(sample.t_min)}. Sulfatos hidratados (≥ ${fmt(waypoint('WP1')?.h2oWtPct)} % de H₂O en roca total).`, 'green');
                }}
                className={isruOpen ? undefined : 'opacity-60'}
              >
                <FlaskConical className="w-4 h-4" aria-hidden />
                Registrar muestra ISRU ({isruSamples.length})
              </Button>

              <Button
                size="sm"
                variant={showBaseReturn ? 'secondary' : 'quiet'}
                aria-pressed={showBaseReturn}
                disabled={isPreEva || isHold}
                title={`Zona 4: vuelta directa a la Base${isPreEva ? '' : `, ${fmt(v.base_time_min, 1)} min, ${v.base_viable ? 'viable' : 'no viable'}`}`}
                onClick={() => {
                  const next = !showBaseReturn;
                  setShowBaseReturn(next);
                  if (next)
                    onNotify(
                      'Retorno a la Base trazado en el mapa',
                      `${fmt(v.base_time_min, 1)} min, ${v.base_viable ? 'viable' : 'no viable'}${v.base_dose_proj_msv > 0 ? `. Dosis prevista: ${fmt(v.base_dose_proj_msv, 2)} mSv` : ''}.`,
                      v.base_viable ? 'cyan' : 'red'
                    );
                }}
                className={showBaseReturn ? 'bg-raised font-medium' : undefined}
              >
                <Undo2 className="w-4 h-4" aria-hidden />
                Trazar retorno a la Base
              </Button>

              <Button
                size="sm"
                variant={showDiagnostics ? 'secondary' : 'quiet'}
                aria-expanded={showDiagnostics}
                aria-controls="traje-detalle"
                title="Zona 3: consumibles, dosis y muestras"
                onClick={() => setShowDiagnostics((d) => !d)}
                className={showDiagnostics ? 'bg-raised font-medium' : undefined}
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} aria-hidden />
                Consumibles y dosis
              </Button>

              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <span className="t-label text-ink-3">{dialHint}</span>
                <Segmented
                  label="Modo del visor"
                  options={DIAL_OPTIONS}
                  value={String(dialPos) as DialValue}
                  onChange={(d) => setDialPos(Number(d) as 1 | 2 | 3)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-3 border-t border-line pt-3">
              <Stat label="Potencia metabólica" value={fmt(v.metabolic_power_w)} unit="W" level={powerLevel} hint={powerSource} />
              <Stat label="Consumo de O₂" value={fmt(v.o2_l_min, 2)} unit="L/min" level={o2RateLevel} />
              <Stat label="Presión del traje" value={fmt(SUIT_SCENARIO.pressureKpa, 1)} unit="kPa" hint="Valor supuesto" />
              {inputs ? (
                <>
                  <Stat label="Pendiente" value={`${fmt(inputs.cell_slope_deg, 1)}°`} level={slopeLevel} hint={sample.phase.location} />
                  <Stat label="Inercia térmica" value={fmt(inputs.cell_tiu)} unit="TIU" level={tiuLevel} hint={`Coeficiente de terreno ${fmt(terrainEta(inputs.cell_tiu), 1)}`} />
                  <Stat label="Cielo visible" value={fmt(inputs.cell_svf, 2)} />
                </>
              ) : (
                <p className="col-span-2 sm:col-span-3 t-label text-ink-3 self-center">
                  Sin lectura del terreno: la astronauta está en el hábitat ({sample.phase.location}).
                </p>
              )}
            </div>

            {showDiagnostics && (
              <div id="traje-detalle" className="border-t border-line pt-2">
                <div className="grid sm:grid-cols-2 gap-x-10">
                  <Row label="O₂ primario" level={o2Level} value={`${fmt(v.o2_remaining_pct, 1)} % (${fmt(v.o2_remaining_g)} g)`} />
                  <Row label="Autonomía de O₂ al ritmo actual" value={`${fmt(Math.min(tO2, 999))} min`} />
                  <Row label="Agua de refrigeración" value={`${fmt(SUIT_SCENARIO.coolingWaterKg, 1)} kg (valor supuesto)`} />
                  <Row label="Batería" value={`${fmt(SUIT_SCENARIO.batteryWh)} Wh (valor supuesto)`} />
                  <Row label="Dosis de la tormenta solar" level={doseLevel} value={`${fmt(v.dose_spe_msv, 2)} de ${fmt(PLANNER_WALKBACK.dose_budget_msv, 2)} mSv`} />
                  <Row label="Aviso de dosis a partir de" value={`${fmt(limits('eva_spe_dose_budget_msv').amber, 1)} mSv`} />
                  <Row label="Dosis de fondo (GCR)" value={`${fmt(v.dose_gcr_msv, 3)} mSv`} />
                  <Row label="Polvo en suspensión" level={tauLevel} value={`τ ${fmt(v.dust_tau, 1)}`} />
                  <Row label="Muestras ISRU" value={`${isruSamples.length} ${isruSamples.length === 1 ? 'registrada' : 'registradas'}`} />
                  <Row label="Baliza de radio UHF" value={`${fmt(REFERENCE_FIGURES.radio_beacon_freq_mhz)} MHz`} />
                  <Row
                    label="Reglas de seguridad"
                    value={<span title={sample.guardrail.engine}>{isPreEva ? 'en espera' : sample.source === 'api' ? 'calculadas por el motor' : 'copia local'}</span>}
                  />
                </div>
                <p className="t-label text-ink-3 mt-2">
                  En esta fase: {phaseDetail}. El modelo no calcula el consumo de agua ni de batería. En {formatT(T_DECISION_MIN)} el motor de cálculo parte de{' '}
                  {fmt(PLANNER_WALKBACK.t_vital_lcvg_min)} min de agua y {fmt(PLANNER_WALKBACK.t_vital_battery_min)} min de batería.
                </p>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
};
