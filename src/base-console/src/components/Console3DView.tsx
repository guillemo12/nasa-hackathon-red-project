import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  CANONICAL_WAYPOINTS,
  CHAOS_REFERENCE,
  EVA07_DOC,
  LAYERS_CATALOG,
  PERIMETER_M,
  PLANNED_LEGS,
  PLANNER_WALKBACK,
  SUIT_SCENARIO,
  UX_LABELS,
  waypoint,
} from '@/data/missionData';
import { fetchHexGrid, fetchRoutePlan, fetchSpyglass, fetchTerrain } from '@/engine/apiClient';
import { CHAOS_VISIBLE_TRIALS, certify } from '@/engine/chaos';
import { formatT } from '@/engine/evaModel';
import { compassPoint, fmt, fmtCoords, haversineM, insideAoi, nodeLabel } from '@/engine/geo';
import { ISRU_H2O_MIN_PCT, P1_CONSTANTS, classify, limits, type Level } from '@/engine/thresholds';
import { TwinScene, VERTICAL_EXAGGERATION, type RoutePath, type TwinLayers } from '@/engine/twinScene';
import { NODE_COLOR, PALETTE, RADIO_CLASS_LEVEL, STATE_STYLE } from '@/theme';
import { RouteProfileChart } from '@/components/RouteProfileChart';
import { LensReadout, SpyglassLens, type LensData } from '@/components/SpyglassLens';
import { Button, Disclosure, Notice, Panel, Row, Segmented, Stat, StatusDot, levelTextClass } from '@/components/ui';
import type {
  ChaosState,
  Eva07Sample,
  HexCell,
  NodeId,
  Notify,
  RoutePlan,
  SpyglassMode,
  SyncState,
  TerrainGrid,
} from '@/types/mission';

interface Console3DViewProps {
  sample: Eva07Sample;
  apiOnline: boolean;
  sync: SyncState;
  certified: boolean;
  onSyncZenoh: () => void | Promise<void>;
  chaos: ChaosState;
  onRunChaos: (trials: number, seed?: number) => void | Promise<void>;
  onNotify: Notify;
}

interface Pin {
  id: number;
  label: string;
  lat: number;
  lonE: number;
  data: LensData;
}

interface Anchor {
  el: HTMLElement;
  lat: number;
  lonE: number;
  liftM: number;
  /** `label`: rótulo de nodo, tramo o simulación; `pin` y `main`: lupas ancladas al terreno. */
  kind: 'label' | 'pin' | 'main';
  /** Las etiquetas de nodo se separan del marcador alejándose del centro del triángulo… */
  radial?: boolean;
  /** …y no salen del mapa ni se meten bajo la barra inferior. */
  clamp?: boolean;
}

/** Tamaño de la lupa en pantalla (diámetro), px: límites de `strategic-3d-console.md` §1.2. */
const LENS_MIN_PX = 100;
const LENS_MAX_PX = 400;
const LENS_DEFAULT_PX = 220;
const LENS_DEFAULT_OPACITY = 0.85;
const MAX_PINS = 3;
/** Radio en el terreno que consulta la lupa, m (límites de la API). */
const QUERY_MIN_M = 15;
const QUERY_MAX_M = 200;
/** Sin API, la lupa solo tiene dato a menos de esta distancia de un nodo del GeoJSON, m. */
const NODE_SNAP_M = 60;

const AOI = LAYERS_CATALOG.aoi;
const CENTROID = {
  lat: CANONICAL_WAYPOINTS.reduce((a, w) => a + w.lat, 0) / CANONICAL_WAYPOINTS.length,
  lonE: CANONICAL_WAYPOINTS.reduce((a, w) => a + w.lonE, 0) / CANONICAL_WAYPOINTS.length,
};
const WB = PLANNER_WALKBACK;
const NLOS_WINDOW = EVA07_DOC.threat_windows_t_min.sombra_radio;
const RADIO_TEXT: Record<string, string> = { VERDE: 'bueno', AMBAR: 'débil', ROJO: 'cortado' };

/** Los nombres cortos llegan en mayúsculas de los datos de la misión; aquí se escriben como nombres. */
const nodeName = (shortLabel: string) =>
  shortLabel
    .split(' ')
    .map((w) => (/\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');

/** Con el foco en uno de estos, las teclas son suyas y no de la lupa. */
const KEY_OWNERS = 'input, select, textarea, button, a[href], summary, [contenteditable]:not([contenteditable="false"])';

function nearestNode(lat: number, lonE: number): { label: string; node: (typeof CANONICAL_WAYPOINTS)[number]; distM: number } {
  let best = CANONICAL_WAYPOINTS[0];
  let d = Infinity;
  for (const w of CANONICAL_WAYPOINTS) {
    const dw = haversineM(lat, lonE, w.lat, w.lonE);
    if (dw < d) {
      d = dw;
      best = w;
    }
  }
  return { label: d <= NODE_SNAP_M ? best.id : d < 400 ? `A ${fmt(d)} m de ${nodeLabel(best.id)}` : 'Cuenca suroeste', node: best, distM: d };
}

export const Console3DView: React.FC<Console3DViewProps> = ({
  sample,
  apiOnline,
  sync,
  certified,
  onSyncZenoh,
  chaos,
  onRunChaos,
  onNotify,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<TwinScene | null>(null);
  const anchors = useRef(new Map<string, Anchor>());
  const mainEl = useRef<HTMLDivElement | null>(null);
  const bottomBar = useRef<HTMLDivElement | null>(null);
  const hovering = useRef(false);
  const sideCol = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<() => void>(() => undefined);
  const cursor = useRef({ x: 0, y: 0 });
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const moveFrame = useRef(0);
  const downAt = useRef({ x: 0, y: 0 });
  const clickTimer = useRef(0);
  const spyBusy = useRef(false);
  const spyNext = useRef<{ lat: number; lonE: number; radiusM: number } | null>(null);
  const pinSeq = useRef(0);
  const spyToken = useRef(0);

  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  const [hexCells, setHexCells] = useState<HexCell[]>([]);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [sceneVersion, setSceneVersion] = useState(0);

  const [layers, setLayers] = useState<TwinLayers>({ mola: true, crism: true, themis: true, h3o: true });
  const [mode, setMode] = useState<SpyglassMode>('tri-sector');
  const [lastXray, setLastXray] = useState<SpyglassMode>('xray-crism');
  const [lensSize, setLensSize] = useState(LENS_DEFAULT_PX);
  const [lensOpacity, setLensOpacity] = useState(LENS_DEFAULT_OPACITY);
  const [mainGeo, setMainGeo] = useState<{ lat: number; lonE: number } | null>(null);
  const [mainData, setMainData] = useState<LensData>({ status: 'outside' });
  const [mainRadiusM, setMainRadiusM] = useState<number | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [lensVisible, setLensVisible] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [cam, setCam] = useState({ azimuthDeg: 0, elevationDeg: 45, mPerPx: 5 });
  const [profileOpen, setProfileOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  /** La lupa libre (o la congelada) está encima de una fijada: calla sus rótulos. */
  const [overPin, setOverPin] = useState(false);
  const overPinRef = useRef(false);

  const lensSizeRef = useRef(lensSize);
  lensSizeRef.current = lensSize;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const lensVisibleRef = useRef(lensVisible);
  lensVisibleRef.current = lensVisible;
  const apiRef = useRef(apiOnline);
  apiRef.current = apiOnline;

  // ------------------------------------------------------------------ datos de la misión
  useEffect(() => {
    if (!apiOnline) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetchTerrain()
      .then((t) => active && setTerrain(t))
      .catch(() => undefined)
      .finally(() => active && setLoading(false));
    fetchHexGrid().then((c) => active && setHexCells(c)).catch(() => undefined);
    fetchRoutePlan().then((p) => active && setPlan(p)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiOnline]);

  // ------------------------------------------------------------------ escena
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new TwinScene(mount, AOI, terrain);
    sceneRef.current = scene;
    let lastCam = '';
    let lastCard = { w: 256, h: 84 };
    // Coloca los rótulos anclados al terreno y resuelve los choques: ninguna etiqueta de nodo,
    // tramo o simulación se queda bajo una lupa, las de nodo no salen del mapa ni se meten bajo
    // la barra inferior, y la lupa libre calla sus rótulos si está encima de una fijada.
    const layout = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      const floor = height - (bottomBar.current ? bottomBar.current.offsetHeight + 12 : 0) - 4;
      // En pantalla ancha las columnas de paneles van encima del mapa: las etiquetas de nodo las esquivan.
      const side = sideCol.current && window.matchMedia('(min-width: 80rem)').matches ? sideCol.current.offsetWidth + 12 : 0;
      const centroid = scene.project(scene.worldOf(CENTROID.lat, CENTROID.lonE));
      const pinR = lensSizeRef.current * 0.3;
      const mainR = lensSizeRef.current / 2;
      const circles: Array<{ x: number; y: number; r: number; el: HTMLElement | null }> = [];
      let main: { x: number; y: number; r: number; el: HTMLElement | null } | null =
        !frozenRef.current && lensVisibleRef.current ? { ...cursor.current, r: mainR, el: mainEl.current } : null;
      const labels: Array<{ a: Anchor; x: number; y: number; visible: boolean }> = [];
      anchors.current.forEach((a) => {
        const p = scene.project(scene.worldOf(a.lat, a.lonE, a.liftM));
        if (a.kind === 'label') {
          labels.push({ a, x: p.x, y: p.y, visible: p.visible });
          return;
        }
        a.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        a.el.style.visibility = p.visible ? 'visible' : 'hidden';
        if (!p.visible) return;
        if (a.kind === 'pin') circles.push({ x: p.x, y: p.y, r: pinR, el: a.el });
        else main = { x: p.x, y: p.y, r: mainR, el: a.el };
      });
      // El rótulo de cada lupa fijada va debajo del círculo; si ahí pisa la barra inferior, el borde
      // del mapa u otra lupa fijada, prueba encima, a la derecha y a la izquierda.
      type Box = { x0: number; x1: number; y0: number; y1: number };
      const boxes: Box[] = [];
      for (const c of circles) {
        // Si el círculo se sale del mapa o se mete bajo la barra, sus cifras se cortarían: se callan
        // (la lectura completa está en «Lupas fijadas»).
        c.el?.toggleAttribute('data-clipped', c.x - c.r < side || c.x + c.r > width - side || c.y - c.r < 0 || c.y + c.r > floor + 4);
        const tag = c.el?.querySelector<HTMLElement>('[data-lens-card]');
        const hw = (tag?.offsetWidth ?? 80) / 2;
        const hh = (tag?.offsetHeight ?? 32) / 2;
        const spots = [
          [0, c.r + 4 + hh],
          [0, -(c.r + 4 + hh)],
          [c.r + 4 + hw, 0],
          [-(c.r + 4 + hw), 0],
        ].map(([dx, dy]) => {
          const box: Box = { x0: c.x + dx - hw, x1: c.x + dx + hw, y0: c.y + dy - hh, y1: c.y + dy + hh };
          const outside = box.x0 < side + 4 || box.x1 > width - side - 4 || box.y0 < 4 || box.y1 > floor;
          const onLens = circles.some(
            (o) => o !== c && Math.hypot(o.x - Math.max(box.x0, Math.min(box.x1, o.x)), o.y - Math.max(box.y0, Math.min(box.y1, o.y))) < o.r
          );
          const onTag = boxes.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
          return { dx, dy, box, cost: (outside ? 4 : 0) + (onLens ? 2 : 0) + (onTag ? 2 : 0) };
        });
        const best = spots.reduce((a, b) => (b.cost < a.cost ? b : a));
        boxes.push(best.box);
        c.el?.style.setProperty('--tag-x', `${best.dx.toFixed(1)}px`);
        c.el?.style.setProperty('--tag-y', `${best.dy.toFixed(1)}px`);
      }
      const lens = main as { x: number; y: number; r: number; el: HTMLElement | null } | null;
      // Pie de la lupa principal. Mientras está oculto se usa su último tamaño medido, para que
      // la decisión de ocultarlo no cambie por el hecho de haberlo ocultado.
      const card = lens?.el?.querySelector<HTMLElement>('[data-lens-card]');
      if (card) lastCard = { w: card.offsetWidth, h: card.offsetHeight };
      const cardBox: Box | null = lens
        ? { x0: lens.x - lastCard.w / 2, x1: lens.x + lastCard.w / 2, y0: lens.y + lens.r, y1: lens.y + lens.r + lastCard.h + 4 }
        : null;
      // «Encima de una fijada»: se tocan los círculos o el pie caería sobre el círculo de la fijada.
      const over =
        lens !== null &&
        cardBox !== null &&
        circles.some(
          (c) =>
            Math.hypot(c.x - lens.x, c.y - lens.y) < c.r + lens.r ||
            Math.hypot(c.x - Math.max(cardBox.x0, Math.min(cardBox.x1, c.x)), c.y - Math.max(cardBox.y0, Math.min(cardBox.y1, c.y))) < c.r
        );
      if (over !== overPinRef.current) {
        overPinRef.current = over;
        setOverPin(over);
      }
      if (cardBox && !over) boxes.push(cardBox);
      if (lens) circles.push(lens);
      // Primero las de nodo: si una de tramo o de simulación cae sobre ellas, cede la segunda.
      labels.sort((p, q) => Number(q.a.clamp ?? false) - Number(p.a.clamp ?? false));
      const nodeBoxes: Box[] = [];
      for (const { a, x: px, y: py, visible } of labels) {
        const w = a.el.offsetWidth;
        const h = a.el.offsetHeight;
        let x = px;
        let y = py;
        if (a.radial) {
          const dx = x - centroid.x;
          const dy = y - centroid.y;
          const len = Math.hypot(dx, dy) || 1;
          const reach = 18 + (Math.abs(dx / len) * w) / 2 + (Math.abs(dy / len) * h) / 2;
          x += (dx / len) * reach;
          y += (dy / len) * reach;
        }
        if (a.clamp) {
          x = Math.max(side + w / 2 + 4, Math.min(width - side - w / 2 - 4, x));
          y = Math.max(h / 2 + 4, Math.min(floor - h / 2, y));
        }
        const x0 = x - w / 2;
        const x1 = x + w / 2;
        const y0 = y - h / 2;
        const y1 = y + h / 2;
        const covered =
          circles.some((c) => Math.hypot(c.x - Math.max(x0, Math.min(x1, c.x)), c.y - Math.max(y0, Math.min(y1, c.y))) < c.r + 4) ||
          [...boxes, ...nodeBoxes].some((b) => x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0);
        if (a.clamp && visible && !covered) nodeBoxes.push({ x0, x1, y0, y1 });
        a.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        a.el.style.visibility = visible && !covered ? 'visible' : 'hidden';
      }
    };
    layoutRef.current = layout;
    scene.onFrame = () => {
      layout();
      const info = scene.cameraInfo();
      const key = `${info.azimuthDeg.toFixed(0)}|${info.elevationDeg.toFixed(0)}|${info.mPerPx.toFixed(2)}`;
      if (key !== lastCam) {
        lastCam = key;
        setCam(info);
      }
    };
    setSceneVersion((v) => v + 1);
    return () => {
      layoutRef.current = () => undefined;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [terrain]);

  useEffect(() => {
    sceneRef.current?.setLayers(layers);
  }, [layers, sceneVersion]);

  useEffect(() => {
    sceneRef.current?.setHexCells(hexCells);
  }, [hexCells, sceneVersion]);

  useEffect(() => {
    const routes: RoutePath[] = PLANNED_LEGS.map((leg) => {
      const planned = plan?.legs.find((l) => l.leg_id === leg.id && !l.error);
      const a = waypoint(leg.from);
      const b = waypoint(leg.to);
      return {
        id: leg.id,
        // Ruta del planificador en cian; el tramo de escape WP2 → WP3, en verde (wireframe 3d-console).
        color: leg.id === 'L3' ? PALETTE.green : PALETTE.cyan,
        points: planned
          ? planned.profile.map((p) => ({ lat: p.lat, lonE: p.lon_e }))
          : a && b
            ? [{ lat: a.lat, lonE: a.lonE }, { lat: b.lat, lonE: b.lonE }]
            : [],
      };
    });
    sceneRef.current?.setRoutes(
      routes,
      CANONICAL_WAYPOINTS.map((w) => ({ lat: w.lat, lonE: w.lonE, color: NODE_COLOR[w.id] }))
    );
  }, [plan, sceneVersion]);

  // Respuesta visual de la simulación de imprevistos en el mapa.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const wp2 = waypoint('WP2');
    const base = waypoint('BASE');
    const wp3 = waypoint('WP3');
    if (chaos.status === 'done' && chaos.run && wp2 && base && wp3) {
      scene.playChaos(
        { lat: wp2.lat, lonE: wp2.lonE },
        { lat: base.lat, lonE: base.lonE },
        { lat: wp3.lat, lonE: wp3.lonE },
        Math.min(chaos.run.trials, CHAOS_VISIBLE_TRIALS),
        chaos.run.report.survival_rate_with_shelter_pct / 100
      );
    } else {
      scene.clearChaos();
    }
  }, [chaos.status, chaos.finishedAt, chaos.run, sceneVersion]);

  const setAnchor = useCallback((id: string, lat: number, lonE: number, liftM: number, kind: Anchor['kind'] = 'label', node = false) => {
    return (el: HTMLElement | null) => {
      if (el) anchors.current.set(id, { el, lat, lonE, liftM, kind, radial: node, clamp: node });
      else anchors.current.delete(id);
      sceneRef.current?.invalidate();
    };
  }, []);

  // ------------------------------------------------------------------ lupa
  const lensDataFor = useCallback(
    async (lat: number, lonE: number, radiusM: number): Promise<LensData> => {
      const near = nearestNode(lat, lonE);
      const nodeOnly: LensData = { status: 'noapi', node: near.distM <= NODE_SNAP_M ? near.node : null };
      if (!apiRef.current) return nodeOnly;
      const res = await fetchSpyglass(lat, lonE, radiusM);
      if (res === 'outside') return { status: 'outside' };
      if (res === null) return nodeOnly;
      return { status: 'ok', result: res };
    },
    []
  );

  const pumpSpyglass = useCallback(async () => {
    if (spyBusy.current || !spyNext.current) return;
    spyBusy.current = true;
    const q = spyNext.current;
    spyNext.current = null;
    const token = spyToken.current;
    const data = await lensDataFor(q.lat, q.lonE, q.radiusM);
    spyBusy.current = false;
    // Si mientras tanto se ha movido la lupa, manda la última posición; una respuesta que
    // llega cuando la lupa ya ha salido del terreno se descarta.
    if (spyNext.current) void pumpSpyglass();
    else if (token === spyToken.current) setMainData(data);
  }, [lensDataFor]);

  const moveLens = useCallback(
    (x: number, y: number) => {
      const scene = sceneRef.current;
      if (!scene || frozenRef.current) return;
      cursor.current = { x, y };
      if (mainEl.current) mainEl.current.style.transform = `translate(${x}px, ${y}px)`;
      setLensVisible(true);
      lensVisibleRef.current = true;
      layoutRef.current();
      const hit = scene.raycast(x, y);
      if (!hit || !insideAoi({ aoi: AOI } as TerrainGrid, hit.lat, hit.lonE)) {
        // Fuera del terreno la lupa no conserva la lectura anterior.
        spyToken.current += 1;
        spyNext.current = null;
        setMainGeo(null);
        setMainRadiusM(null);
        setMainData({ status: 'outside' });
        return;
      }
      const radiusM = Math.min(QUERY_MAX_M, Math.max(QUERY_MIN_M, (hit.mPerPx * lensSizeRef.current) / 2));
      setMainGeo({ lat: hit.lat, lonE: hit.lonE });
      setMainRadiusM(radiusM);
      spyNext.current = { lat: hit.lat, lonE: hit.lonE, radiusM };
      void pumpSpyglass();
    },
    [pumpSpyglass]
  );

  const pinsRef = useRef<Pin[]>([]);
  pinsRef.current = pins;
  const addPin = useCallback(
    (lat: number, lonE: number, label?: string) => {
      if (pinsRef.current.length >= MAX_PINS) {
        onNotify('Ya hay 3 lupas fijadas', 'Quita una con su aspa o con la tecla Escape antes de fijar otra.', 'amber');
        return;
      }
      const id = ++pinSeq.current;
      const name = label ?? nearestNode(lat, lonE).label;
      const radiusM = Math.min(QUERY_MAX_M, Math.max(QUERY_MIN_M, (sceneRef.current?.cameraInfo().mPerPx ?? 1) * (lensSizeRef.current / 2)));
      const pin: Pin = { id, label: name, lat, lonE, data: { status: 'loading' } };
      pinsRef.current = [...pinsRef.current, pin];
      setPins((prev) => (prev.length >= MAX_PINS ? prev : [...prev, pin]));
      void lensDataFor(lat, lonE, radiusM).then((data) =>
        setPins((cur) => cur.map((p) => (p.id === id ? { ...p, data } : p)))
      );
    },
    [lensDataFor, onNotify]
  );

  const toggleNodePin = (id: NodeId) => {
    const existing = pins.find((p) => p.label === id);
    if (existing) {
      setPins((prev) => prev.filter((p) => p.id !== existing.id));
      return;
    }
    const w = waypoint(id);
    if (w) addPin(w.lat, w.lonE, id);
  };

  const toggleFreeze = useCallback(() => {
    if (frozen) {
      // Al soltarla, la lupa libre reaparece donde estaba congelada (no en la esquina).
      const scene = sceneRef.current;
      if (scene && mainGeo) {
        const p = scene.project(scene.worldOf(mainGeo.lat, mainGeo.lonE));
        cursor.current = { x: p.x, y: p.y };
      }
      setFrozen(false);
    } else if (mainGeo) {
      setFrozen(true);
    }
  }, [frozen, mainGeo]);

  const toggleMode = useCallback(() => {
    setMode((m) => {
      if (m === 'tri-sector') return lastXray;
      setLastXray(m);
      return 'tri-sector';
    });
  }, [lastXray]);

  // Al cambiar el tamaño, la lupa libre vuelve a medir con su nuevo radio.
  useEffect(() => {
    if (!frozen && lensVisible) moveLens(cursor.current.x, cursor.current.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensSize]);

  // Rueda: tamaño de la lupa (100–400 px). Con Ctrl, zoom de la cámara. Oyente no pasivo.
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) sceneRef.current?.zoom(e.deltaY > 0 ? 1.12 : 0.89);
      else setLensSize((s) => Math.min(LENS_MAX_PX, Math.max(LENS_MIN_PX, s + (e.deltaY < 0 ? 20 : -20))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = mountRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 0) return; // arrastrando: órbita de la cámara
    pendingMove.current = localXY(e);
    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      const p = pendingMove.current;
      if (p) moveLens(p.x, p.y);
    });
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 5) return;
    window.clearTimeout(clickTimer.current);
    // Espera por si es un doble clic (que fija una lupa comparativa en vez de congelar).
    clickTimer.current = window.setTimeout(toggleFreeze, 240);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    window.clearTimeout(clickTimer.current);
    const { x, y } = localXY(e);
    const hit = sceneRef.current?.raycast(x, y);
    if (hit) addPin(hit.lat, hit.lonE);
  };

  const handleKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 12;
    const el = mountRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    const nudge = (dx: number, dy: number) => {
      e.preventDefault();
      if (frozen) toggleFreeze();
      frozenRef.current = false;
      const start = lensVisible ? cursor.current : { x: w / 2, y: h / 2 };
      moveLens(Math.min(w, Math.max(0, start.x + dx)), Math.min(h, Math.max(0, start.y + dy)));
    };
    const act = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    switch (e.key) {
      case 'ArrowLeft': return nudge(-step, 0);
      case 'ArrowRight': return nudge(step, 0);
      case 'ArrowUp': return nudge(0, -step);
      case 'ArrowDown': return nudge(0, step);
      case ' ': return act(toggleMode);
      case 'Enter': return act(() => mainGeo && addPin(mainGeo.lat, mainGeo.lonE));
      case 'f':
      case 'F': return act(toggleFreeze);
      case 'Escape':
        return act(() => {
          if (frozen) toggleFreeze();
          else setPins((prev) => prev.slice(0, -1));
        });
      case '+':
      case '=': return act(() => setLensSize((s) => Math.min(LENS_MAX_PX, s + 20)));
      case '-': return act(() => setLensSize((s) => Math.max(LENS_MIN_PX, s - 20)));
      case 'PageUp': return act(() => sceneRef.current?.zoom(0.85));
      case 'PageDown': return act(() => sceneRef.current?.zoom(1.18));
      case 'a':
      case 'A': return act(() => sceneRef.current?.orbit(-10, 0));
      case 'd':
      case 'D': return act(() => sceneRef.current?.orbit(10, 0));
      case 'w':
      case 'W': return act(() => sceneRef.current?.orbit(0, -6));
      case 's':
      case 'S': return act(() => sceneRef.current?.orbit(0, 6));
      default:
        if (['1', '2', '3', '4'].includes(e.key)) act(() => toggleNodePin(CANONICAL_WAYPOINTS[Number(e.key) - 1].id));
    }
  };

  // Los atajos valen con el foco en el mapa o con el puntero encima, sin tener que hacer clic.
  // Si el foco está en un control (botón, campo, enlace), la tecla es de ese control.
  const keyHandler = useRef(handleKey);
  keyHandler.current = handleKey;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const focus = document.activeElement;
      if (focus !== mountRef.current && (!hovering.current || focus?.closest(KEY_OWNERS))) return;
      keyHandler.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------------ cifras de los paneles
  const v = sample.values;
  const state = STATE_STYLE[sample.guardrail.state];
  const isPreEva = sample.guardrail.state === 'PRE_EVA';
  const radioLevel = RADIO_CLASS_LEVEL[v.radio_class] ?? 'none';
  const dusty = sample.active_threats.includes('polvo');
  const radioText: string | undefined = RADIO_TEXT[v.radio_class];
  const run = chaos.status === 'done' ? chaos.run : null;
  const cert = run ? certify(run) : null;
  const near = mainGeo ? nearestNode(mainGeo.lat, mainGeo.lonE) : null;
  const scaleBarM = useMemo(
    () => [50, 100, 200, 500, 1000, 2000].find((m) => m / cam.mPerPx >= 60) ?? 2000,
    [cam.mPerPx]
  );
  const maxSlopeLeg = PLANNED_LEGS.reduce((a, l) => (l.maxSlopeDeg > a.maxSlopeDeg ? l : a), PLANNED_LEGS[0]);
  const wp2 = waypoint('WP2');
  const base = waypoint('BASE');
  const wp3 = waypoint('WP3');
  const mid = (a?: { lat: number; lonE: number }, b?: { lat: number; lonE: number }) =>
    a && b ? { lat: (a.lat + b.lat) / 2, lonE: (a.lonE + b.lonE) / 2 } : null;

  const layerItems: Array<{ key: keyof TwinLayers; title: string; sub: string }> = [
    { key: 'mola', title: 'Relieve (MOLA)', sub: `Pendientes de más de ${limits('slope_deg').red}° y refugios` },
    { key: 'crism', title: 'Sulfatos (CRISM)', sub: `Zonas con ${fmt(ISRU_H2O_MIN_PCT)} % de agua o más` },
    { key: 'themis', title: 'Inercia térmica (THEMIS)', sub: `Trampas de polvo, menos de ${limits('thermal_inertia_tiu').red} TIU` },
    { key: 'h3o', title: 'Malla hexagonal', sub: hexCells.length ? 'Refugios, trampas de polvo y zonas con agua, celda a celda' : 'No disponible sin el relieve' },
  ];

  const handleSync = async () => {
    if (!certified) {
      onNotify('Aún no se puede enviar la ruta', 'Simula la ruta antes de enviarla al traje.', 'amber');
      return;
    }
    if (sync.status === 'ok' || syncBusy) return;
    setSyncBusy(true);
    await onSyncZenoh();
    setSyncBusy(false);
  };

  // Lo normal va sin color: solo precaución y evacuación tiñen el estado.
  const stateLevel: Level =
    sample.guardrail.state === 'EVAC_SHELTER'
      ? 'red'
      : sample.guardrail.state === 'CAUTION' || sample.guardrail.state === 'MULTI_HAZARD'
        ? 'amber'
        : 'none';
  const tint = (level: Level) => (level === 'red' || level === 'amber' ? levelTextClass(level) : undefined);
  const syncBlocked = !certified || sync.status === 'ok' || sync.status === 'syncing';
  const destLevel: Level = !isPreEva && v.viable_destination === 'WP3' ? 'red' : 'none';
  const mapLabel = 'px-1.5 py-0.5 rounded bg-ground/85 t-label tabular-nums whitespace-nowrap';
  const iconBtn = 'w-8 h-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-raised cursor-pointer';
  const column = 'space-y-3 xl:absolute xl:top-2 xl:w-80 xl:max-h-[calc(100%-4.5rem)] xl:overflow-y-auto xl:p-1';

  return (
    <div className="relative flex flex-col gap-3 xl:block xl:h-full xl:min-h-[540px]">
      <h1 className="sr-only">Cartografía de la cuenca suroeste de Melas Chasma</h1>

      {/* Mapa 3D */}
      <div
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => (hovering.current = false)}
        className="relative h-[68vh] min-h-[440px] xl:h-full rounded-lg overflow-hidden border border-line bg-sunken"
      >
        <div
          ref={mountRef}
          tabIndex={0}
          role="application"
          aria-label="Mapa 3D del terreno con lupa. Flechas: mover la lupa. Espacio: cambiar entre tres capas y una capa. Intro: fijar una lupa para comparar. F: congelar o soltar. Más y menos: tamaño. A, D, W, S: girar el mapa. Re Pág y Av Pág: zoom. 1 a 4: lupas en Base, WP1, WP2 y WP3."
          onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
          onPointerMove={handlePointerMove}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          className="absolute inset-0 cursor-crosshair"
        />

        {/* Etiquetas ancladas al terreno */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {CANONICAL_WAYPOINTS.map((node) => (
            <div key={node.id} ref={setAnchor(`node-${node.id}`, node.lat, node.lonE, 12, 'label', true)} className="absolute top-0 left-0" style={{ willChange: 'transform' }}>
              <div className={`-translate-x-1/2 -translate-y-1/2 ${mapLabel} text-ink font-medium`}>
                {node.id === 'BASE' ? nodeLabel(node.id) : nodeName(node.shortLabel)} · {fmt(node.elevMolaM)} m
              </div>
            </div>
          ))}
          {PLANNED_LEGS.map((leg) => {
            const m = mid(waypoint(leg.from), waypoint(leg.to));
            if (!m) return null;
            return (
              <div key={leg.id} ref={setAnchor(`leg-${leg.id}`, m.lat, m.lonE, 20)} className="absolute top-0 left-0">
                <div className={`-translate-x-1/2 -translate-y-1/2 ${mapLabel} text-ink-2`}>
                  {leg.id} · {fmt(leg.distanceM / 1000, 2)} km
                </div>
              </div>
            );
          })}
          {run && (() => {
            const mb = mid(wp2, base);
            const ms = mid(wp2, wp3);
            return (
              <>
                {mb && (
                  <div ref={setAnchor('chaos-base', mb.lat, mb.lonE, 40)} className="absolute top-0 left-0">
                    <div className={`-translate-x-1/2 -translate-y-1/2 ${mapLabel} text-ink font-medium flex items-center gap-1.5`}>
                      <StatusDot level="red" />
                      Solo con la Base: {fmt(run.report.survival_rate_base_only_pct, 1)} % a salvo
                    </div>
                  </div>
                )}
                {ms && (
                  <div ref={setAnchor('chaos-wp3', ms.lat, ms.lonE, 40)} className="absolute top-0 left-0">
                    <div className={`-translate-x-1/2 -translate-y-1/2 ${mapLabel} text-ink font-medium`}>
                      Con el refugio WP3: {fmt(run.report.survival_rate_with_shelter_pct, 1)} % a salvo
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {/* Lupas comparativas fijadas al terreno (hasta 3) */}
          {pins.map((pin) => (
            <div key={pin.id} ref={setAnchor(`pin-${pin.id}`, pin.lat, pin.lonE, 0, 'pin')} className="group absolute top-0 left-0">
              <div className="-translate-x-1/2" style={{ marginTop: -lensSize * 0.3 }}>
                <SpyglassLens
                  size={Math.round(lensSize * 0.6)}
                  opacity={lensOpacity}
                  mode={mode}
                  data={pin.data}
                  nearest={nodeLabel(pin.label)}
                  label={nodeLabel(pin.label)}
                  lat={pin.lat}
                  lonE={pin.lonE}
                  radiusM={null}
                  frozen
                  compact
                  onClose={() => setPins((prev) => prev.filter((p) => p.id !== pin.id))}
                />
              </div>
            </div>
          ))}

          {/* Lupa principal: sigue al cursor o queda congelada sobre el terreno */}
          {frozen && mainGeo ? (
            <div ref={setAnchor('main-lens', mainGeo.lat, mainGeo.lonE, 0, 'main')} className="absolute top-0 left-0">
              <div className="-translate-x-1/2" style={{ marginTop: -lensSize / 2 }}>
                <SpyglassLens size={lensSize} opacity={lensOpacity} mode={mode} data={mainData} nearest={near ? nodeLabel(near.label) : '—'} lat={mainGeo.lat} lonE={mainGeo.lonE} radiusM={mainRadiusM} frozen hideLabels={overPin} />
              </div>
            </div>
          ) : (
            <div
              ref={mainEl}
              className="absolute top-0 left-0"
              style={{
                transform: `translate(${cursor.current.x}px, ${cursor.current.y}px)`,
                visibility: lensVisible ? 'visible' : 'hidden',
                willChange: 'transform',
              }}
            >
              <div className="-translate-x-1/2" style={{ marginTop: -lensSize / 2 }}>
                <SpyglassLens size={lensSize} opacity={lensOpacity} mode={mode} data={mainData} nearest={near ? nodeLabel(near.label) : ''} lat={mainGeo?.lat ?? null} lonE={mainGeo?.lonE ?? null} radiusM={mainRadiusM} hideLabels={overPin} />
              </div>
            </div>
          )}
        </div>

        {/* Norte */}
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2" aria-hidden>
          <svg width="44" height="44" viewBox="-22 -22 44 44" style={{ transform: `rotate(${-cam.azimuthDeg}deg)` }}>
            <circle r="21" fill={PALETTE.ground} fillOpacity="0.85" stroke={PALETTE.borderStrong} />
            <polygon points="0,-5 4,7 -4,7" fill={PALETTE.text} />
            <polygon points="0,17 4,7 -4,7" fill={PALETTE.muted} />
            <text y="-8" textAnchor="middle" fill={PALETTE.text} fontSize="12" fontWeight="600">N</text>
          </svg>
        </div>

        {(loading || !terrain) && (
          <Notice level={loading ? 'none' : 'amber'} role="status" className="absolute top-16 left-1/2 -translate-x-1/2 w-[min(26rem,calc(100%-1.5rem))]">
            {loading ? 'Cargando el terreno…' : 'Mapa sin relieve: solo se ven los puntos de la ruta, y la lupa solo lee sobre ellos.'}
          </Notice>
        )}

        {/* Barra inferior: escala, cámara, zoom y perfil de ruta */}
        <div ref={bottomBar} className="absolute bottom-3 left-3 right-3 flex flex-col items-center gap-2 pointer-events-none">
          {profileOpen && (
            <div className="pointer-events-auto self-stretch xl:mx-[21rem] rounded-lg border border-line bg-panel p-3">
              <RouteProfileChart plan={plan} compact />
            </div>
          )}
          {detailOpen && (
            <div id="mapa-detalle" className="pointer-events-auto max-w-full rounded-md border border-line bg-panel px-3 py-2 t-label text-ink-2 tabular-nums space-y-0.5">
              <div>
                {mainGeo ? `Cursor en ${fmtCoords(mainGeo.lat, mainGeo.lonE)}` : 'Cursor fuera del terreno'}
              </div>
              <div className="sm:hidden">
                Azimut {fmt(cam.azimuthDeg)}° {compassPoint(cam.azimuthDeg)} · elevación {fmt(cam.elevationDeg)}°
              </div>
              <div>Sistema de referencia IAU_2015:49900</div>
              <div>
                {terrain
                  ? `Terreno a 20 m, con el relieve exagerado ×${fmt(VERTICAL_EXAGGERATION, 1)}`
                  : 'Sin terreno: plano con los puntos de los datos de la misión'}
              </div>
            </div>
          )}
          <div
            className="pointer-events-auto max-w-full flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-md border border-line bg-ground/90 pl-3 pr-1 py-1 t-label text-ink-2 tabular-nums"
            title={`Sistema de referencia IAU_2015:49900. ${terrain ? 'Terreno a 20 m.' : 'Sin terreno cargado.'}`}
          >
            <span className="flex items-end gap-1.5">
              <span className="inline-block h-1.5 border-x border-b border-ink-2" style={{ width: scaleBarM / cam.mPerPx }} aria-hidden />
              {scaleBarM >= 1000 ? `${fmt(scaleBarM / 1000)} km` : `${fmt(scaleBarM)} m`}
            </span>
            <span className="hidden sm:inline">
              Azimut {fmt(cam.azimuthDeg)}° {compassPoint(cam.azimuthDeg)} · elevación {fmt(cam.elevationDeg)}°
            </span>
            <span className="flex items-center">
              <button type="button" aria-label="Acercar" title="Acercar" onClick={() => sceneRef.current?.zoom(0.85)} className={iconBtn}><Plus className="w-4 h-4" aria-hidden /></button>
              <button type="button" aria-label="Alejar" title="Alejar" onClick={() => sceneRef.current?.zoom(1.18)} className={iconBtn}><Minus className="w-4 h-4" aria-hidden /></button>
              <button type="button" aria-label="Volver a la vista inicial" title="Volver a la vista inicial" onClick={() => sceneRef.current?.resetView()} className={iconBtn}><RotateCcw className="w-4 h-4" aria-hidden /></button>
              <Button variant="quiet" size="sm" aria-pressed={profileOpen} onClick={() => setProfileOpen((o) => !o)} className={profileOpen ? 'bg-raised !text-ink' : ''}>
                Perfil de ruta
              </Button>
              <Button variant="quiet" size="sm" aria-expanded={detailOpen} aria-controls="mapa-detalle" onClick={() => setDetailOpen((o) => !o)} className={detailOpen ? 'bg-raised !text-ink' : ''}>
                Más detalle
              </Button>
            </span>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 items-start xl:contents">
        {/* Columna izquierda: capas, lupa y triángulo */}
        <div ref={sideCol} className={`${column} xl:left-2`}>
          {pins.length > 0 && (
            <Panel title="Lupas fijadas" defaultOpen aside={<span className="whitespace-nowrap">{pins.length} de {MAX_PINS}</span>}>
              <ul>
                {pins.map((pin) => (
                  <LensReadout
                    key={pin.id}
                    name={nodeLabel(pin.label)}
                    mode={mode}
                    data={pin.data}
                    lat={pin.lat}
                    lonE={pin.lonE}
                    onClose={() => setPins((prev) => prev.filter((p) => p.id !== pin.id))}
                  />
                ))}
              </ul>
            </Panel>
          )}
          <Panel
            title="Capas"
            defaultOpen
            aside={<span className={`whitespace-nowrap ${!loading && !terrain ? 'text-warn' : ''}`}>{loading ? 'Cargando…' : terrain ? 'Terreno a 20 m' : 'Sin terreno'}</span>}
          >
            <div className="-mx-1.5">
              {layerItems.map((item) => (
                <label key={item.key} className="flex items-start gap-3 min-h-11 px-1.5 py-1.5 rounded-md cursor-pointer hover:bg-raised">
                  <input
                    type="checkbox"
                    checked={layers[item.key]}
                    onChange={() => setLayers((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                    className="mt-0.5 w-4 h-4 shrink-0 cursor-pointer"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{item.title}</span>
                    <span className="block t-label text-ink-3">{item.sub}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              <div className="t-label text-ink-3">La lupa enseña</div>
              <Segmented
                label="Modo de la lupa"
                className="w-full [&>button]:flex-1"
                options={[
                  { value: 'tri', label: 'Tres capas' },
                  { value: 'one', label: 'Una capa' },
                ]}
                value={mode === 'tri-sector' ? 'tri' : 'one'}
                onChange={(next) => setMode(next === 'tri' ? 'tri-sector' : mode === 'tri-sector' ? lastXray : mode)}
              />
              {mode !== 'tri-sector' && (
                <Segmented
                  label="Capa que enseña la lupa"
                  className="w-full [&>button]:flex-1"
                  options={[
                    { value: 'xray-crism', label: 'Agua' },
                    { value: 'xray-themis', label: 'Inercia' },
                    { value: 'xray-mola', label: 'Relieve' },
                  ]}
                  value={mode}
                  onChange={(id) => {
                    setMode(id);
                    setLastXray(id);
                  }}
                />
              )}
            </div>

            <Disclosure summary="Ajustes de la lupa" className="mt-3">
              <div className="space-y-3">
                <label className="block t-label text-ink-3">
                  <span className="flex justify-between">
                    <span>Tamaño</span>
                    <span className="text-ink tabular-nums">{lensSize} px</span>
                  </span>
                  <input type="range" className="timeline w-full" min={LENS_MIN_PX} max={LENS_MAX_PX} step={10} value={lensSize} onChange={(e) => setLensSize(Number(e.target.value))} />
                </label>
                <label className="block t-label text-ink-3">
                  <span className="flex justify-between">
                    <span>Opacidad</span>
                    <span className="text-ink tabular-nums">{Math.round(lensOpacity * 100)} %</span>
                  </span>
                  <input type="range" className="timeline w-full" min={30} max={100} step={5} value={Math.round(lensOpacity * 100)} onChange={(e) => setLensOpacity(Number(e.target.value) / 100)} />
                </label>
                <Button aria-pressed={frozen} onClick={toggleFreeze} className={`w-full ${frozen ? '!border-accent' : ''}`}>
                  {frozen ? 'Lupa congelada: soltarla' : 'Lupa libre: congelarla'}
                </Button>
                <p className="t-label text-ink-3">
                  Con el cursor sobre el mapa: un clic o la tecla F congelan y sueltan la lupa. Con doble clic o Intro se
                  fija una lupa para comparar ({pins.length} de {MAX_PINS}) y Escape la quita. La rueda cambia el tamaño y
                  Espacio, el modo. Arrastra para girar el mapa; Ctrl y la rueda hacen zoom.
                </p>
              </div>
            </Disclosure>
          </Panel>

          <Panel title="Triángulo de supervivencia" defaultOpen={false} aside={<span className="whitespace-nowrap">{fmt(PERIMETER_M / 1000, 2)} km</span>}>
            <Row label="Perímetro" value={`${fmt(PERIMETER_M / 1000, 2)} km`} />
            {PLANNED_LEGS.map((leg) => (
              <Row key={leg.id} label={`${leg.id}, de ${nodeLabel(leg.from)} a ${nodeLabel(leg.to)}`} value={`${fmt(leg.distanceM / 1000, 2)} km`} />
            ))}
            <Row
              label="Pendiente máxima"
              value={`${fmt(maxSlopeLeg.maxSlopeDeg, 1)}° en ${maxSlopeLeg.id}`}
              level={classify('slope_deg', maxSlopeLeg.maxSlopeDeg)}
            />
            <div className="mt-3 t-label text-ink-3">Fijar una lupa en</div>
            <div role="group" aria-label="Fijar una lupa en un punto de la ruta" className="mt-1.5 grid grid-cols-4 gap-1.5">
              {CANONICAL_WAYPOINTS.map((wp) => {
                const on = pins.some((p) => p.label === wp.id);
                return (
                  <button
                    key={wp.id}
                    type="button"
                    aria-pressed={on}
                    title={wp.geology}
                    onClick={() => toggleNodePin(wp.id)}
                    className={`min-h-8 rounded-md border text-sm cursor-pointer ${on ? 'border-accent bg-raised text-ink font-medium' : 'border-line-strong text-ink-2 hover:text-ink hover:bg-raised'}`}
                  >
                    {nodeLabel(wp.id)}
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              className="w-full mt-2"
              onClick={() => {
                pinsRef.current = [];
                setPins([]);
                (['WP1', 'WP2', 'WP3'] as NodeId[]).forEach((id) => {
                  const w = waypoint(id);
                  if (w) addPin(w.lat, w.lonE, id);
                });
              }}
            >
              Comparar WP1, WP2 y WP3
            </Button>
          </Panel>
        </div>

        {/* Columna derecha: astronauta, meteorología, margen de retorno y simulación */}
        <div className={`${column} xl:right-2`}>
          <Panel
            title={UX_LABELS.astronaut}
            defaultOpen
            aside={
              <span className={`flex items-center gap-1.5 whitespace-nowrap ${tint(stateLevel) ?? ''}`}>
                {stateLevel !== 'none' && <StatusDot level={stateLevel} pulse={state.pulse} />}
                {isPreEva ? 'En la Base' : state.short}
              </span>
            }
          >
            <p className="t-label text-ink-3 tabular-nums">
              Traje {UX_LABELS.suit} · {formatT(sample.t_min)}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Stat
                label="Oxígeno (O₂)"
                value={fmt(v.o2_remaining_pct, 1)}
                unit="%"
                hint={`${fmt(v.o2_remaining_g)} g útiles`}
                level={classify('o2_primary_pct', v.o2_remaining_pct)}
              />
              <Stat label="Al refugio WP3" value={fmt(v.wp3_time_min, 1)} unit="min" hint={`${fmt(v.wp3_route_m)} m de ruta`} />
            </div>

            <Button
              variant="primary"
              onClick={() => void handleSync()}
              aria-disabled={syncBlocked}
              aria-describedby={!certified ? 'envio-ayuda' : undefined}
              className="w-full mt-4 aria-disabled:bg-raised aria-disabled:text-ink-3 aria-disabled:font-normal aria-disabled:hover:brightness-100 aria-disabled:cursor-not-allowed"
            >
              {sync.status === 'syncing' ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden /> : sync.status === 'ok' ? <Check className="w-4 h-4" aria-hidden /> : null}
              {sync.status === 'syncing' ? 'Enviando la ruta…' : sync.status === 'ok' ? 'Ruta enviada al traje' : 'Enviar ruta al traje'}
            </Button>
            {!certified && (
              <p id="envio-ayuda" className="mt-2 t-label text-ink-3">
                Simula la ruta antes de enviarla al traje.
              </p>
            )}
            {sync.status === 'error' && (
              <p role="alert" className="mt-2 t-label text-danger-ink">
                El último envío ha fallado porque el motor de cálculo no responde. Vuelve a intentarlo.
              </p>
            )}
            {sync.status === 'ok' && sync.checksum && (
              <Disclosure summary="Detalle del envío" className="mt-1">
                <Row label="Huella SHA-256" value={<span className="num">{sync.checksum.slice(0, 24)}…</span>} />
                <Row label="Celdas enviadas" value={fmt(sync.cells)} />
                {sync.simulated && <p className="t-label text-ink-3 pt-1">El enlace con el traje está simulado en esta demostración.</p>}
              </Disclosure>
            )}

            <Disclosure summary="Más datos del traje" className="mt-1">
              <Row label="Presión del traje (valor supuesto)" value={`${fmt(SUIT_SCENARIO.pressureKpa, 1)} kPa`} />
              <Row label="Potencia metabólica" value={`${fmt(v.metabolic_power_w)} W`} level={classify('metabolic_rate_w', v.metabolic_power_w)} />
              <Row label="Dosis por tormenta solar (SPE)" value={`${fmt(v.dose_spe_msv, 2)} mSv`} level={classify('eva_spe_dose_budget_msv', v.dose_spe_msv)} />
              {wp3?.svfScenario != null && <Row label="Cielo visible en el refugio (SVF)" value={fmt(wp3.svfScenario, 2)} />}
            </Disclosure>
          </Panel>

          <Panel
            title="Meteorología y enlace"
            defaultOpen={false}
            aside={radioText ? <span className={`whitespace-nowrap ${tint(radioLevel) ?? ''}`}>Enlace {radioText}</span> : undefined}
          >
            <Row label="Polvo en el aire (τ)" value={fmt(v.dust_tau, 1)} level={classify('dust_tau_880nm', v.dust_tau)} />
            {/* Solo hay dato de viento mientras pasa el frente de polvo. */}
            {dusty && <Row label="Viento" value={`${fmt(WB.wind_m_s)} m/s, frente de polvo`} level={classify('wind_speed_m_s', WB.wind_m_s)} />}
            <Row label="Presión en la Base" value={`${fmt(P1_CONSTANTS.surface_pressure_pa_site)} Pa`} />
            <Row
              label="Enlace con el traje"
              value={`${radioText ? `${radioText} · ` : ''}${fmt(v.radio_rssi_dbm, 0)} dBm`}
              level={radioLevel}
            />
            <Row label="Sombra de radio prevista" value={`de ${formatT(NLOS_WINDOW[0])} a ${formatT(NLOS_WINDOW[1])}`} />
          </Panel>

          <Panel
            title="Margen de retorno"
            defaultOpen={false}
            aside={<span className={`whitespace-nowrap ${tint(destLevel) ?? ''}`}>{isPreEva ? 'Antes de la salida' : `Destino: ${nodeLabel(v.viable_destination)}`}</span>}
          >
            <p className="t-label text-ink-3 tabular-nums pb-1">Situación en {formatT(sample.t_min)}.</p>
            <Row
              label={v.base_viable ? 'Volver a la Base' : 'Volver a la Base (no viable)'}
              value={`${fmt(v.base_time_min, 1)} min · ${fmt(v.base_route_m)} m`}
              level={v.base_viable ? undefined : 'red'}
            />
            <Row label="Ir al refugio WP3" value={`${fmt(v.wp3_time_min, 1)} min · ${fmt(v.wp3_route_m)} m`} />
            {!isPreEva && <Row label="Destino viable" value={nodeLabel(v.viable_destination)} level={destLevel} />}
            <p className="t-label text-ink-3 tabular-nums pt-2">
              En {formatT(WB.decision_t_min)}, volver a la Base cuesta {fmt(WB.base.time_min, 1)} min y {fmt(WB.base.dose_spe_msv, 2)} mSv;
              ir al refugio WP3, {fmt(WB.wp3.time_min, 1)} min y {fmt(WB.wp3.dose_spe_msv, 2)} mSv.
            </p>
          </Panel>

          <Panel
            title="Simulación de imprevistos"
            defaultOpen={false}
            aside={
              chaos.status === 'running' ? (
                <span className="whitespace-nowrap">Simulando…</span>
              ) : run && cert ? (
                <span className={`whitespace-nowrap ${cert.authorized ? '' : 'text-danger-ink'}`}>{cert.authorized ? 'Autorizada' : 'No autorizada'}</span>
              ) : (
                <span className="whitespace-nowrap">Sin simular</span>
              )
            }
          >
            <Button disabled={chaos.status === 'running' || !apiOnline} onClick={() => void onRunChaos(CHAOS_VISIBLE_TRIALS)} className="w-full">
              {chaos.status === 'running' && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              {chaos.status === 'running' ? 'Simulando…' : `Simular ${CHAOS_VISIBLE_TRIALS} salidas`}
            </Button>
            <div role="status" className="mt-3">
              {run && cert ? (
                <>
                  <p className={`text-sm font-medium ${cert.authorized ? 'text-ink' : 'text-danger-ink'}`}>
                    {cert.authorized ? 'Ruta autorizada' : 'Ruta no autorizada'} con {fmt(run.report.trials)} de {fmt(run.trials)} salidas simuladas.
                  </p>
                  <div className="mt-1">
                    <Row label="A salvo con el refugio WP3" value={`${fmt(run.report.survival_rate_with_shelter_pct, 1)} %`} />
                    <Row label="A salvo solo con la Base" value={`${fmt(run.report.survival_rate_base_only_pct, 1)} %`} />
                    <Row label="Semilla" value={run.seed} />
                  </div>
                </>
              ) : (
                <p className="t-label text-ink-3">
                  {!apiOnline
                    ? 'Sin el motor de cálculo no se puede simular.'
                    : chaos.status === 'error'
                      ? 'La última simulación ha fallado. Vuelve a intentarlo.'
                      : 'Aún sin simular: hasta entonces la ruta no se puede enviar al traje.'}
                </p>
              )}
            </div>
            {run && <p className="mt-2 t-label text-ink-3">Las trazas ámbar del mapa son ilustrativas: la simulación da recuentos, no recorridos.</p>}
            <Disclosure summary="Simulación de referencia" className="mt-1">
              <Row label="Salidas simuladas" value={fmt(CHAOS_REFERENCE.trials)} />
              <Row label="Semilla" value={CHAOS_REFERENCE.seed} />
              <Row label="A salvo con el refugio WP3" value={`${fmt(CHAOS_REFERENCE.report.survival_rate_with_shelter_pct, 2)} %`} />
              <Row label="A salvo solo con la Base" value={`${fmt(CHAOS_REFERENCE.report.survival_rate_base_only_pct, 2)} %`} />
            </Disclosure>
          </Panel>
        </div>
      </div>
    </div>
  );
};
