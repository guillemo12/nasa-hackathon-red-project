import trianguloGeoJson from '@data/mission-scenarios/triangulo_supervivencia.geojson';
import eva07EventsJson from '@data/mission-scenarios/eva07_events.json';
import evaThresholdsJson from '@data/mission-scenarios/eva_thresholds.json';
import layersCatalogJson from '@data/nasa-layers/layers_catalog.json';
import type { Eva07Event, RouteLeg, WaypointNode } from '@/types/mission';

export const CANONICAL_WAYPOINTS: WaypointNode[] = [
  {
    id: 'BASE',
    name: 'Base Alpha (Hábitat Melas SW)',
    shortLabel: 'BASE ALPHA',
    role: 'habitat',
    lat: -9.89646,
    lonE: 283.3892,
    lonW: 76.6108,
    elevMolaM: -1660,
    slopeLocalDeg: 2.8,
    tiu: 320,
    svfScenario: 0.85,
    svfDem: 0.85,
    radioLosBase: true,
    h2oWtPct: null,
    geology: 'Terraza aluvial (abanico distal) en cuenca SW de Melas',
    distFromBaseM: 0,
  },
  {
    id: 'WP1',
    name: 'WP1 — Sulfatos Hidratados ISRU',
    shortLabel: 'WP1 SULFATOS',
    role: 'isru_water',
    lat: -9.9188,
    lonE: 283.40126,
    lonW: 76.59874,
    elevMolaM: -1582,
    slopeLocalDeg: 6.7,
    tiu: 410,
    svfScenario: 0.85,
    svfDem: 0.85,
    radioLosBase: true,
    h2oWtPct: 12.0,
    geology: 'Sulfatos monohidratados/polihidratados (kieserita ≥12% H₂O)',
    distFromBaseM: 1500,
  },
  {
    id: 'WP2',
    name: 'WP2 — Talud Peligroso / Trampa TIU',
    shortLabel: 'WP2 TALUD 22°',
    role: 'hazard_slope',
    lat: -9.93261,
    lonE: 283.38623,
    lonW: 76.61377,
    elevMolaM: -1464,
    slopeLocalDeg: 19.4,
    rampSlopeDeg: 22.0,
    tiu: 110,
    svfScenario: 0.84,
    svfDem: 0.84,
    radioLosBase: false,
    h2oWtPct: null,
    geology: 'Regolito fino suelto (<150 TIU) en rampa de 22° [E] / 19.4° [D]',
    distFromBaseM: 2700,
  },
  {
    id: 'WP3',
    name: 'WP3 — Alcoba Refugio Basáltico',
    shortLabel: 'WP3 REFUGIO',
    role: 'shelter',
    lat: -9.92286,
    lonE: 283.38349,
    lonW: 76.61651,
    elevMolaM: -1520,
    slopeLocalDeg: 20.1,
    tiu: 620,
    svfScenario: 0.15,
    svfDem: 0.76,
    radioLosBase: false,
    h2oWtPct: null,
    geology: 'Alcoba con cornisa basáltica (>5m roca, SVF 0.15 [E], 85% aten. SPE)',
    distFromBaseM: 3300,
  },
];

export const CANONICAL_LEGS: RouteLeg[] = [
  { id: 'L1', from: 'BASE', to: 'WP1', distanceM: 1500, deltaElevM: 78, bearingDeg: 152, meanSlopeDeg: 2.96, maxSlopeDeg: 8.0 },
  { id: 'L2', from: 'WP1', to: 'WP2', distanceM: 1200, deltaElevM: 118, bearingDeg: 227, meanSlopeDeg: 5.62, maxSlopeDeg: 19.9 },
  { id: 'L3', from: 'WP2', to: 'WP3', distanceM: 600, deltaElevM: -56, bearingDeg: 344, meanSlopeDeg: -5.26, maxSlopeDeg: 22.5 },
  { id: 'L4', from: 'WP3', to: 'BASE', distanceM: 1600, deltaElevM: -140, bearingDeg: 12, meanSlopeDeg: -5.02, maxSlopeDeg: 20.1 },
];

export const EVA07_EVENTS: Eva07Event[] = eva07EventsJson.events as Eva07Event[];
export const EVA_THRESHOLDS = evaThresholdsJson;
export const LAYERS_CATALOG = layersCatalogJson;
export const TRIANGULO_GEOJSON = trianguloGeoJson;

export function getNearestEvaEvent(tMin: number): Eva07Event {
  let best = EVA07_EVENTS[0];
  let bestDiff = Math.abs(best.t_min - tMin);
  for (const ev of EVA07_EVENTS) {
    const diff = Math.abs(ev.t_min - tMin);
    if (diff < bestDiff) {
      best = ev;
      bestDiff = diff;
    }
  }
  return best;
}
