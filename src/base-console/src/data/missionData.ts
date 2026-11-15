// Fuente única de cifras de la interfaz: todo sale de los ficheros de P1 en `data/`.
// Aquí no se escribe a mano ninguna cifra que exista en esos ficheros.
import trianguloGeoJson from '@data/mission-scenarios/triangulo_supervivencia.geojson';
import eva07EventsJson from '@data/mission-scenarios/eva07_events.json';
import evaThresholdsJson from '@data/mission-scenarios/eva_thresholds.json';
import chaosReferenceJson from '@data/mission-scenarios/chaos_mode_results.json';
import plannerWalkbackJson from '@data/mission-scenarios/planner_walkback.json';
import layersCatalogJson from '@data/nasa-layers/layers_catalog.json';
import type {
  ChaosReport,
  Eva07Event,
  Eva07Phase,
  NodeId,
  RouteLeg,
  WaypointNode,
} from '@/types/mission';

interface GeoFeature {
  type: string;
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}
interface GeoCollection {
  features: GeoFeature[];
  metadata?: { perimeter_m?: number };
}

export const TRIANGULO_GEOJSON = trianguloGeoJson as GeoCollection;
export const EVA07_DOC = eva07EventsJson;
export const EVA07_EVENTS = eva07EventsJson.events as unknown as Eva07Event[];
export const EVA07_PHASES = eva07EventsJson.phases as unknown as Eva07Phase[];
export const EVA_THRESHOLDS = evaThresholdsJson;
export const LAYERS_CATALOG = layersCatalogJson;
export const PLANNER_WALKBACK = plannerWalkbackJson;
export const REFERENCE_FIGURES = eva07EventsJson.reference_figures;

/** Referencia de P1 del Chaos Mode: exportada por el motor Rust (10.000 pasadas, semilla 42). */
export const CHAOS_REFERENCE = chaosReferenceJson as unknown as {
  generator: string;
  seed: number;
  trials: number;
  corridor: string;
  criterion: string;
  limitations: string;
  dose_budget_msv: number;
  report: ChaosReport;
};

const SHORT_LABELS: Record<NodeId, string> = {
  BASE: 'BASE ALPHA',
  WP1: 'WP1 SULFATOS',
  WP2: 'WP2 TALUD',
  WP3: 'WP3 REFUGIO',
};

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);

/** Tramos de `triangulo_supervivencia.geojson` (L1–L4 planificados y R1 de contingencia). */
export const CANONICAL_LEGS: RouteLeg[] = TRIANGULO_GEOJSON.features
  .filter((ft) => ft.geometry.type === 'LineString')
  .map((ft) => {
    const p = ft.properties;
    return {
      id: String(p.leg_id),
      from: p.from as NodeId,
      to: p.to as NodeId,
      kind: String(p.kind ?? 'planned'),
      distanceM: num(p.distance_m),
      deltaElevM: num(p.delta_elev_m),
      bearingDeg: num(p.bearing_deg),
      meanSlopeDeg: num(p.mean_slope_deg),
      maxSlopeDeg: num(p.slope_max_deg),
      losRecoveredAtM: typeof p.los_recovered_at_m === 'number' ? p.los_recovered_at_m : undefined,
    };
  });

export const PLANNED_LEGS: RouteLeg[] = CANONICAL_LEGS.filter((l) => l.kind === 'planned');

function cumulativeDistance(id: NodeId): number {
  let d = 0;
  for (const leg of PLANNED_LEGS) {
    if (leg.from === id) return d;
    d += leg.distanceM;
  }
  return d;
}

/** Nodos de `triangulo_supervivencia.geojson`. */
export const CANONICAL_WAYPOINTS: WaypointNode[] = TRIANGULO_GEOJSON.features
  .filter((ft) => ft.geometry.type === 'Point')
  .map((ft) => {
    const p = ft.properties;
    const id = p.node_id as NodeId;
    return {
      id,
      name: String(p.name),
      shortLabel: SHORT_LABELS[id] ?? id,
      role: String(p.role),
      lat: num(p.lat_pc_deg),
      lonE: num(p.lon_e_deg),
      lonW: num(p.lon_w_deg),
      elevMolaM: num(p.elev_mola_m),
      slopeLocalDeg: num(p.slope_local_deg),
      tiu: num(p.thermal_inertia_tiu),
      svfScenario: num(p.sky_view_factor),
      svfDem: num(p.sky_view_factor_dem),
      radioLosBase: Boolean(p.radio_los_base),
      h2oWtPct: typeof p.h2o_wt_pct === 'number' ? p.h2o_wt_pct : null,
      geology: String(p.geology),
      distFromBaseM: cumulativeDistance(id),
    };
  });

export function waypoint(id: string): WaypointNode | undefined {
  return CANONICAL_WAYPOINTS.find((w) => w.id === id);
}

export function legBetween(from: string, to: string): RouteLeg | undefined {
  return CANONICAL_LEGS.find((l) => l.from === from && l.to === to);
}

export const PERIMETER_M: number =
  TRIANGULO_GEOJSON.metadata?.perimeter_m ?? PLANNED_LEGS.reduce((a, l) => a + l.distanceM, 0);

export const MAX_ELEV_GAIN_M: number =
  Math.max(...CANONICAL_WAYPOINTS.map((w) => w.elevMolaM)) -
  Math.min(...CANONICAL_WAYPOINTS.map((w) => w.elevMolaM));

export const T_START_MIN: number = EVA07_EVENTS[0].t_min;
export const T_END_MIN: number = EVA07_EVENTS[EVA07_EVENTS.length - 1].t_min;
export const T_DECISION_MIN: number = PLANNER_WALKBACK.decision_t_min;


// ---------------------------------------------------------------------------
// Cifras que hoy solo viven en `DATOS_CANONICOS_P1.md` (no están en ningún JSON de `data/`).
// Único sitio de la interfaz donde se escriben; cada una lleva su apartado de origen.
// ---------------------------------------------------------------------------
export const SUIT_SCENARIO = {
  /** §3 «Traje [E]»: agua de refrigeración. */
  coolingWaterKg: 4.5,
  /** §3 «Traje [E]»: batería y consumo medio. */
  batteryWh: 1000,
  batteryDrawW: 140,
  /** §3 «Traje [E]»: presión de trabajo. */
  pressureKpa: 29.6,
  /** §3: rampa local del WP2 [E] (22°) y TIU del banco de regolito. */
  wp2RampDeg: 22,
  /** §2: atenuación del refugio con SVF 0,15. */
  shelterAttenuationPct: 85,
  /** §2: replanificación medida del cambio de destino. */
  replanMs: 17,
} as const;

/** Etiquetas de la demo que vienen de los documentos de UX (wireframes), no de P1. */
export const UX_LABELS = {
  sol: 142,
  operator: 'Aris Thorne',
  operatorRole: 'OPERADOR JEFE',
  astronaut: 'Dra. Elena Rostova',
  suit: 'xEMU-04',
} as const;
