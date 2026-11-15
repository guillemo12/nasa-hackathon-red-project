// Modelo local de la EVA-07 para cuando la API Rust no responde.
//
// Reproduce, con los mismos datos de P1, lo que hace `GET /api/eva07?t=` en
// `src/core-engine/src/bin/api_server.rs`: valores por fase (escalones), O₂ y dosis integrados
// desde el último hito, y la máquina de estados compartida (`src/shared/README.md` §4,
// `GuardrailFsm::evaluate` de `neuro_symbolic.rs`). Es la única réplica en TypeScript.
import {
  CANONICAL_WAYPOINTS,
  EVA07_DOC,
  EVA07_EVENTS,
  EVA07_PHASES,
  PLANNER_WALKBACK,
  SUIT_SCENARIO,
  legBetween,
  waypoint,
} from '@/data/missionData';
import { P1_CONSTANTS, limits } from '@/engine/thresholds';
import type {
  Eva07Event,
  Eva07EventValues,
  Eva07Phase,
  Eva07Sample,
  GuardrailFrame,
  GuardrailState,
} from '@/types/mission';

/** Sol marciano / día terrestre: los minutos terrestres se dividen entre esto. */
const MARS_SOL_OVER_EARTH_DAY = 88775.244 / 86400;

const SUIT_O2_USABLE_G = EVA07_EVENTS[0].values.o2_remaining_g;
const O2_DENSITY_G_PER_L = P1_CONSTANTS.o2_density_g_per_l_stpd;

type Knots = Array<[number, number]>;
const PROFILES = EVA07_DOC.spe_profile_comparison as unknown as Record<
  string,
  { knots_t_min_msv_h: Knots }
>;

function departureLmstMin(): number {
  const dep = EVA07_EVENTS.find((e) => e.t_min === 0) ?? EVA07_EVENTS[0];
  const [hh, mm] = dep.lmst.split(':').map(Number);
  return hh * 60 + mm - dep.t_min / MARS_SOL_OVER_EARTH_DAY;
}
const DEPARTURE_LMST_MIN = departureLmstMin();

/** Hora local marciana `hh:mm` (truncada al minuto, como la escribe P1). */
export function formatLmst(tMin: number): string {
  const total = DEPARTURE_LMST_MIN + tMin / MARS_SOL_OVER_EARTH_DAY;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const whole = Math.floor(wrapped + 1e-9);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** Tiempo transcurrido de misión `T+hh:mm` en minutos terrestres desde la salida. */
export function formatMet(tMin: number): string {
  const whole = Math.floor(Math.abs(tMin));
  const sign = tMin < 0 ? '-' : '+';
  return `T${sign}${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** `T+105` / `T−45`, para rótulos cortos. */
export function formatT(tMin: number): string {
  const r = Math.round(tMin);
  return r >= 0 ? `T+${r}` : `T−${Math.abs(r)}`;
}

export function phaseAt(t: number): Eva07Phase {
  return (
    EVA07_PHASES.find((p) => t >= p.t0 && t < p.t1) ?? EVA07_PHASES[EVA07_PHASES.length - 1]
  );
}

function knotsRate(knots: Knots, t: number): number {
  if (knots.length === 0 || t < knots[0][0]) return 0;
  for (let i = 0; i + 1 < knots.length; i++) {
    const [t0, r0] = knots[i];
    const [t1, r1] = knots[i + 1];
    if (t <= t1) return t1 > t0 ? r0 + ((r1 - r0) * (t - t0)) / (t1 - t0) : r1;
  }
  return knots[knots.length - 1][1];
}

function integrate(a: number, b: number, g: (t: number) => number): number {
  if (b <= a) return 0;
  const n = Math.max(1, Math.ceil((b - a) / 0.01));
  const h = (b - a) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += g(a + (i + 0.5) * h);
  return sum * h;
}

function locationAt(t: number): { from: string; to: string; frac: number } {
  let idx = EVA07_PHASES.findIndex((p) => t >= p.t0 && t < p.t1);
  if (idx < 0) idx = EVA07_PHASES.length - 1;
  const loc = EVA07_PHASES[idx].location;
  if (!loc.includes('→')) return { from: loc, to: loc, frac: 0 };
  const [from, to] = loc.split('→');
  let i0 = idx;
  let i1 = idx;
  while (i0 > 0 && EVA07_PHASES[i0 - 1].location === loc) i0--;
  while (i1 + 1 < EVA07_PHASES.length && EVA07_PHASES[i1 + 1].location === loc) i1++;
  const t0 = EVA07_PHASES[i0].t0;
  const t1 = EVA07_PHASES[i1].t1;
  const frac = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  return { from, to, frac };
}

const STATE_CODES: Record<GuardrailState, string> = {
  PRE_EVA: 'PRE_EVA',
  NOMINAL: '0x01_NOMINAL',
  CAUTION: '0x02_CAUTION',
  MULTI_HAZARD: '0x03_MULTI_HAZARD',
  EVAC_SHELTER: '0x04_EVAC_SHELTER',
  SHELTER_HOLD: '0x05_SHELTER_HOLD',
};

/** Viento por defecto del motor sin frente de polvo (`ActiveHazards::default`), m/s. */
const WIND_DEFAULT_M_S = 5;

interface GuardrailInputs {
  threats: string[];
  slopeDeg: number;
  tiu: number;
  svf: number;
  atShelter: boolean;
  values: Eva07EventValues;
}

/** Réplica de `GuardrailFsm::evaluate` con los umbrales de `eva_thresholds.json`. */
function evaluateGuardrail(inp: GuardrailInputs): GuardrailFrame {
  const has = (name: string) => inp.threats.includes(name);
  const v = inp.values;
  const wind = has('polvo') ? PLANNER_WALKBACK.wind_m_s : WIND_DEFAULT_M_S;
  const speRate = has('spe') ? PLANNER_WALKBACK.spe_rate_envelope_msv_h : 0;
  const o2Liters = v.o2_remaining_g / O2_DENSITY_G_PER_L;
  const o2RedLiters =
    ((SUIT_O2_USABLE_G / O2_DENSITY_G_PER_L) * limits('o2_primary_pct').red) / 100;

  const h1 = has('polvo') || v.dust_tau > limits('dust_tau_880nm').red || wind > limits('wind_speed_m_s').red;
  const h2 =
    has('spe') ||
    speRate > limits('dose_rate_msv_h').red ||
    o2Liters < o2RedLiters ||
    v.o2_l_min > limits('o2_consumption_l_min').red;
  const h3 =
    has('trampa_regolito') ||
    inp.slopeDeg > limits('slope_deg').red ||
    inp.tiu < limits('thermal_inertia_tiu').red;
  const h4 = has('sombra_radio') || v.radio_rssi_dbm < limits('radio_rssi_dbm').red;
  const count = Number(h1) + Number(h2) + Number(h3) + Number(h4);

  const tO2 = o2Liters / Math.max(v.o2_l_min, 0.05);
  const localRate = speRate * Math.min(1, Math.max(0.05, inp.svf));
  const budget = PLANNER_WALKBACK.dose_budget_msv;
  const tRad = localRate > 1e-6 ? (Math.max(0, budget - v.dose_spe_msv) / localRate) * 60 : Infinity;
  // P1 no da un modelo temporal del agua ni de la batería (el motor solo tiene su autonomía
  // en T+105): T_vital se calcula aquí con el O₂ y la radiación, igual que en la API.
  const tVital = Math.min(tO2, tRad);

  const caution =
    inp.slopeDeg >= limits('slope_deg').amber ||
    inp.tiu <= limits('thermal_inertia_tiu').amber ||
    v.dust_tau >= limits('dust_tau_880nm').amber ||
    wind >= limits('wind_speed_m_s').amber ||
    speRate >= limits('dose_rate_msv_h').amber ||
    v.radio_rssi_dbm <= limits('radio_rssi_dbm').amber ||
    v.o2_l_min >= limits('o2_consumption_l_min').amber ||
    v.base_time_min > tVital * 0.7;

  const toWp3 = v.viable_destination === 'WP3';
  const evac =
    toWp3 ||
    !v.base_viable ||
    v.base_time_min > tVital * PLANNER_WALKBACK.safety_factor ||
    (has('spe') && speRate > limits('dose_rate_msv_h').red && v.base_time_min > v.wp3_time_min);

  let state: GuardrailState;
  if (inp.atShelter) state = 'SHELTER_HOLD';
  else if (evac) state = 'EVAC_SHELTER';
  else if (count >= 2) state = 'MULTI_HAZARD';
  else if (count === 1 || caution) state = 'CAUTION';
  else state = 'NOMINAL';

  let cause = 'NOMINAL';
  if (state === 'SHELTER_HOLD') cause = 'SHELTER_HOLD_REACHED';
  else if (state === 'EVAC_SHELTER' || state === 'MULTI_HAZARD') {
    cause = h2
      ? 'SPE_RADIATION_CRITICAL'
      : h3
        ? 'REGOLITH_SLOPE_TERRAIN_TRAP'
        : h1
          ? 'DUST_STORM_HIGH_WIND'
          : h4
            ? 'NLOS_RADIO_LOSS'
            : 'DYNAMIC_GOAL_SWITCH_EVAC';
  } else if (state === 'CAUTION') {
    cause = h2
      ? 'SPE_RADIATION_ELEVATED'
      : h3
        ? 'REGOLITH_SLOPE_WARNING'
        : h1
          ? 'DUST_WIND_ELEVATED'
          : h4
            ? 'NLOS_OFFLINE'
            : 'CAUTION_MARGIN_AMBER';
  }

  return {
    state,
    state_code: STATE_CODES[state],
    primary_cause: cause,
    engine: 'réplica local de las reglas (API Rust no disponible)',
    t_vital_min: Number.isFinite(tVital) ? Number(tVital.toFixed(2)) : null,
    target_eta_min: state === 'SHELTER_HOLD' ? 0 : state === 'EVAC_SHELTER' ? v.wp3_time_min : v.base_time_min,
    nlos_autonomous: h4,
    inputs: {
      cell_slope_deg: Number(inp.slopeDeg.toFixed(2)),
      cell_tiu: Number.isFinite(inp.tiu) ? inp.tiu : null,
      cell_svf: inp.svf,
      wind_m_s: wind,
      spe_rate_msv_h: speRate,
      t_vital_o2_min: Number(Math.min(tO2, 9999).toFixed(1)),
      t_vital_radiation_min: Number.isFinite(tRad) ? Number(tRad.toFixed(1)) : null,
    },
  };
}

const LERP_KEYS = [
  'dose_gcr_msv',
  'base_route_m',
  'base_time_min',
  'base_o2_need_g',
  'wp3_route_m',
  'wp3_time_min',
  'wp3_o2_need_g',
] as const;

const DOSE_PROFILES: Array<[keyof Eva07EventValues, string]> = [
  ['dose_spe_msv', 'rampa_calibrada'],
  ['dose_spe_env_msv', 'envolvente'],
  ['dose_spe_linear_msv', 'rampa_lineal'],
];

/** Estado de la EVA-07 en el minuto `tTarget` con los datos de P1 (sin API). */
export function sampleEva07Local(tTarget: number): Eva07Sample {
  const events = EVA07_EVENTS;
  const t = Math.min(events[events.length - 1].t_min, Math.max(events[0].t_min, tTarget));

  let i0 = 0;
  for (let i = 0; i < events.length; i++) if (events[i].t_min <= t) i0 = i;
  const e0: Eva07Event = events[i0];
  const t0 = e0.t_min;
  const titleIdx = Math.abs(t - t0) < 1e-9 ? events.findIndex((e) => e.t_min === t0) : i0;
  const eTitle = events[titleIdx];
  const e1 = events[i0 + 1];
  const phase = phaseAt(t);
  const values: Eva07EventValues = { ...e0.values };

  values.metabolic_power_w = phase.power_w;
  values.o2_l_min = phase.o2_l_min;

  const o2UsedL = integrate(t0, t, (tau) => phaseAt(tau).o2_l_min);
  values.o2_remaining_g = Math.max(0, e0.values.o2_remaining_g - o2UsedL * O2_DENSITY_G_PER_L);
  values.o2_remaining_pct = (100 * values.o2_remaining_g) / SUIT_O2_USABLE_G;

  for (const [key, profile] of DOSE_PROFILES) {
    const knots = PROFILES[profile]?.knots_t_min_msv_h ?? [];
    const add = integrate(t0, t, (tau) => knotsRate(knots, tau) * phaseAt(tau).dose_factor) / 60;
    (values[key] as number) = (e0.values[key] as number) + add;
  }
  const extRate = knotsRate(PROFILES.rampa_calibrada?.knots_t_min_msv_h ?? [], t);
  values.spe_ext_rate_cal_msv_h = extRate;
  values.spe_local_rate_msv_h = extRate * phase.dose_factor;

  if (e1 && e1.t_min > t0) {
    const alpha = Math.min(1, Math.max(0, (t - t0) / (e1.t_min - t0)));
    const lerp = (key: keyof Eva07EventValues) =>
      (e0.values[key] as number) + ((e1.values[key] as number) - (e0.values[key] as number)) * alpha;
    for (const key of LERP_KEYS) (values[key] as number) = lerp(key);
    if (e0.active_threats.includes('spe') && e1.active_threats.includes('spe')) {
      values.base_dose_proj_msv = lerp('base_dose_proj_msv');
      values.wp3_dose_proj_msv = lerp('wp3_dose_proj_msv');
    }
  }

  const loc = locationAt(t);
  const from = waypoint(loc.from);
  const to = waypoint(loc.to);
  const goal = waypoint(phase.goal);
  const onLeg = loc.from !== loc.to;
  const atGoal = !onLeg && loc.from === phase.goal;
  const lat = from && to ? from.lat + (to.lat - from.lat) * loc.frac : null;
  const lonE = from && to ? from.lonE + (to.lonE - from.lonE) * loc.frac : null;

  let bearing: number | null = null;
  let distance = 0;
  if (goal && !atGoal && lat !== null) {
    const leg = legBetween(loc.from, phase.goal);
    bearing = leg ? leg.bearingDeg : null;
    if (phase.goal === 'WP3') distance = values.wp3_route_m;
    else if (phase.goal === 'BASE') distance = values.base_route_m;
    else if (leg) distance = leg.distanceM * (1 - loc.frac);
  }

  // Terreno bajo la astronauta, con el mismo criterio de fase que P1: valores del nodo en un
  // nodo (rampa de 22° en WP2) y pendiente del tramo con la TIU media de sus dos nodos en marcha.
  let slopeDeg = 0;
  let tiu = NaN;
  let svf = 1;
  if (from && to && !onLeg) {
    slopeDeg = from.id === 'WP2' ? SUIT_SCENARIO.wp2RampDeg : from.slopeLocalDeg;
    tiu = from.tiu;
    svf = from.svfScenario;
  } else if (from && to) {
    const leg = legBetween(loc.from, loc.to);
    slopeDeg = leg ? Math.abs((Math.atan(leg.deltaElevM / leg.distanceM) * 180) / Math.PI) : 0;
    tiu = (from.tiu + to.tiu) / 2;
    svf = phase.svf_geo;
  }

  const guardrail: GuardrailFrame =
    t < 0
      ? {
          state: 'PRE_EVA',
          state_code: 'PRE_EVA',
          primary_cause: 'PRE_EVA',
          engine: 'sin evaluar: astronauta en la Base (fase de consola)',
        }
      : evaluateGuardrail({
          threats: phase.active_threats,
          slopeDeg,
          tiu,
          svf,
          atShelter: !onLeg && loc.from === 'WP3',
          values,
        });

  return {
    t_min: Number(t.toFixed(2)),
    lmst: formatLmst(t),
    met: formatMet(t),
    id: eTitle.id,
    title: eTitle.title,
    threat: eTitle.threat,
    active_threats: phase.active_threats,
    phase_id: phase.phase_id,
    phase: {
      description: phase.description,
      location: phase.location,
      goal: phase.goal,
      power_source: phase.power_source,
      svf_geo: phase.svf_geo,
      dose_factor: phase.dose_factor,
    },
    position: {
      from: loc.from,
      to: loc.to,
      frac: Number(loc.frac.toFixed(4)),
      lat,
      lon_e: lonE,
      at_goal: atGoal,
      target_bearing_deg: bearing,
      target_distance_m: Math.round(distance),
    },
    values,
    guardrail,
    source: 'local',
  };
}

/** Texto en español de la causa prioritaria que emite el guardrail. */
export function causeLabel(sample: Eva07Sample): string {
  const spe = sample.active_threats.includes('spe');
  switch (sample.guardrail.primary_cause) {
    case 'SPE_RADIATION_CRITICAL':
      // El motor agrupa radiación y O₂ en la misma prioridad; sin SPE activo, es el consumo.
      return spe ? 'Radiación SPE crítica' : 'Consumo de O₂ en rojo';
    case 'SPE_RADIATION_ELEVATED':
      return spe ? 'Radiación SPE elevada' : 'Consumo de O₂ elevado';
    case 'REGOLITH_SLOPE_TERRAIN_TRAP':
      return 'Trampa de regolito en pendiente';
    case 'REGOLITH_SLOPE_WARNING':
      return 'Pendiente o regolito en aviso';
    case 'DUST_STORM_HIGH_WIND':
      return 'Frente de polvo y viento';
    case 'DUST_WIND_ELEVATED':
      return 'Polvo o viento elevados';
    case 'NLOS_RADIO_LOSS':
    case 'NLOS_OFFLINE':
      return 'Sombra de radio (NLOS): modo autónomo';
    case 'DYNAMIC_GOAL_SWITCH_EVAC':
      return 'Cambio de destino al refugio';
    case 'CAUTION_MARGIN_AMBER':
      return 'Una variable en ámbar';
    case 'SHELTER_HOLD_REACHED':
      return 'Refugio alcanzado';
    case 'PRE_EVA':
      return 'Fase de consola (pre-EVA)';
    default:
      return 'Todas las variables en verde';
  }
}

/** Ventana a cielo abierto que queda con la dosis acumulada y la envolvente SPE, min. */
export function openSkyWindowMin(sample: Eva07Sample): number | null {
  if (!sample.active_threats.includes('spe')) return null;
  const left = Math.max(0, PLANNER_WALKBACK.dose_budget_msv - sample.values.dose_spe_msv);
  return (left / PLANNER_WALKBACK.spe_rate_envelope_msv_h) * 60;
}

export const NODE_ORDER = CANONICAL_WAYPOINTS.map((w) => w.id);
