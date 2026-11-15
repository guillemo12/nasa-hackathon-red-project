export type ConsoleView = '3d-console' | 'route-planificator' | 'eva-hud-nominal' | 'eva-emergency';

export type SpyglassMode = 'tri-sector' | 'xray-crism' | 'xray-themis' | 'xray-mola';

export type NodeId = 'BASE' | 'WP1' | 'WP2' | 'WP3';

export type Tone = 'cyan' | 'green' | 'amber' | 'red';
export type Notify = (title: string, detail?: string, tone?: Tone) => void;

export interface WaypointNode {
  id: NodeId;
  name: string;
  shortLabel: string;
  role: string;
  lat: number;
  lonE: number;
  lonW: number;
  elevMolaM: number;
  slopeLocalDeg: number;
  /** Rampa local de escenario [E] (solo WP2). */
  rampSlopeDeg?: number;
  tiu: number;
  svfScenario: number;
  svfDem: number;
  radioLosBase: boolean;
  h2oWtPct: number | null;
  geology: string;
  /** Distancia acumulada por la ruta planificada desde la Base, m. */
  distFromBaseM: number;
}

export interface RouteLeg {
  id: string;
  from: NodeId;
  to: NodeId;
  kind: string;
  distanceM: number;
  deltaElevM: number;
  bearingDeg: number;
  meanSlopeDeg: number;
  maxSlopeDeg: number;
  losRecoveredAtM?: number;
}

/** `values` de cada hito de `data/mission-scenarios/eva07_events.json`. */
export interface Eva07EventValues {
  o2_remaining_pct: number;
  o2_remaining_g: number;
  metabolic_power_w: number;
  o2_l_min: number;
  spe_ext_rate_cal_msv_h: number;
  spe_local_rate_msv_h: number;
  dose_spe_msv: number;
  dose_spe_env_msv: number;
  dose_spe_linear_msv: number;
  dose_gcr_msv: number;
  radio_rssi_dbm: number;
  radio_class: 'VERDE' | 'AMBAR' | 'ROJO';
  dust_tau: number;
  base_route_m: number;
  base_time_min: number;
  base_dose_proj_msv: number;
  base_o2_need_g: number;
  base_viable: boolean;
  wp3_route_m: number;
  wp3_time_min: number;
  wp3_dose_proj_msv: number;
  wp3_o2_need_g: number;
  wp3_viable: boolean;
  viable_destination: 'BASE' | 'WP3';
}

export interface Eva07Event {
  t_min: number;
  lmst: string;
  id: string;
  title: string;
  threat: string | null;
  active_threats: string[];
  phase_id: string;
  values: Eva07EventValues;
}

export interface Eva07Phase {
  phase_id: string;
  t0: number;
  t1: number;
  act: number;
  description: string;
  location: string;
  goal: string;
  power_w: number;
  power_source: string;
  o2_l_min: number;
  svf_geo: number;
  dose_factor: number;
  active_threats: string[];
}

/** Estados de la máquina compartida (`src/shared/README.md` §4) más la fase de consola. */
export type GuardrailState =
  | 'PRE_EVA'
  | 'NOMINAL'
  | 'CAUTION'
  | 'MULTI_HAZARD'
  | 'EVAC_SHELTER'
  | 'SHELTER_HOLD';

export interface GuardrailFrame {
  state: GuardrailState;
  state_code: string;
  primary_cause: string;
  /** Quién ha evaluado las reglas: el motor Rust (API) o la réplica local. */
  engine: string;
  t_vital_min?: number | null;
  target_eta_min?: number;
  nlos_autonomous?: boolean;
  voice_summary_slots?: string[];
  inputs?: {
    cell_slope_deg: number;
    cell_tiu: number | null;
    cell_svf: number;
    wind_m_s: number;
    spe_rate_msv_h: number;
    t_vital_o2_min: number;
    t_vital_radiation_min: number | null;
  };
}

/** Estado de la EVA-07 en un instante cualquiera (API `GET /api/eva07?t=` o modelo local). */
export interface Eva07Sample {
  t_min: number;
  lmst: string;
  met: string;
  id: string;
  title: string;
  threat: string | null;
  active_threats: string[];
  phase_id: string;
  phase: {
    description: string;
    location: string;
    goal: string;
    power_source: string;
    svf_geo: number | null;
    dose_factor: number | null;
  };
  position: {
    from: string;
    to: string;
    frac: number;
    lat: number | null;
    lon_e: number | null;
    at_goal: boolean;
    target_bearing_deg: number | null;
    target_distance_m: number;
    /** Solo de la API: la posición va sobre la ruta del planificador (nominal o replanificada). */
    route?: 'nominal' | 'planificada' | 'replanificada' | 'inalcanzable';
    route_remaining_m?: number;
  };
  values: Eva07EventValues;
  guardrail: GuardrailFrame;
  source: 'api' | 'local';
}

export interface ChaosOutcomeCounts {
  safe: number;
  flight_rule_breach: number;
  consumables_lost: number;
  destination_not_reached: number;
}

/** `ChaosModeReport` del motor Rust (`stochastic_hazard.rs`). */
export interface ChaosReport {
  trials: number;
  survived_with_wp3_shelter: number;
  survived_base_only: number;
  survival_rate_with_shelter_pct: number;
  survival_rate_base_only_pct: number;
  multi_hazard_events_triggered: number;
  outcomes_with_shelter: ChaosOutcomeCounts;
  outcomes_base_only: ChaosOutcomeCounts;
  switched_to_shelter: number;
  trials_by_max_concurrent_hazards: number[];
  safe_with_shelter_by_max_concurrent: number[];
  safe_base_only_by_max_concurrent: number[];
}

export interface ChaosRun {
  seed: number;
  trials: number;
  corridor: string;
  report: ChaosReport;
}

export type ChaosStatus = 'idle' | 'running' | 'done' | 'error';

export interface ChaosState {
  status: ChaosStatus;
  run: ChaosRun | null;
  error?: string;
  /** Marca de tiempo de la última pasada terminada (dispara la animación del gemelo 3D). */
  finishedAt?: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

export interface SyncState {
  status: SyncStatus;
  checksum?: string;
  cells?: number;
  bytes?: number;
  simulated?: boolean;
}

export interface TerrainGrid {
  source: string;
  h3_res: number;
  grid_cells: number;
  note: string;
  aoi: { lat_min: number; lat_max: number; lon_e_min: number; lon_e_max: number };
  rows: number;
  cols: number;
  spacing_m: number;
  width_m: number;
  height_m: number;
  elev_min_m: number;
  elev_max_m: number;
  elev_m: Array<number | null>;
  slope_deg: Array<number | null>;
  sky_view_factor: Array<number | null>;
  thermal_inertia_tiu: Array<number | null>;
  isru_h2o_pct: Array<number | null>;
  los_base_rssi_dbm: Array<number | null>;
  flags: number[];
}

export interface HexCell {
  h3_hex: string;
  lat: number;
  lon_e: number;
  elev_m: number | null;
  slope_deg: number | null;
  aspect_deg: number | null;
  thermal_inertia_tiu: number | null;
  isru_h2o_pct: number | null;
  sky_view_factor: number | null;
  los_base_rssi_dbm: number | null;
  flags: {
    slope_critical: boolean;
    regolith_trap: boolean;
    shelter: boolean;
    nlos: boolean;
    isru_water: boolean;
  };
  /** Vértices `[lat, lonE]` del hexágono H3 real. */
  boundary?: Array<[number, number]>;
}

export interface SpyglassResult {
  query: { lat: number; lon_e: number; radius_m: number };
  h3_res: number;
  center: HexCell;
  res9_parent: HexCell | null;
  sectors: {
    north_h2o: {
      cells: number;
      with_data: number;
      max_pct: number | null;
      cells_ge_isru_min: number;
      points: Array<[number, number, number | null]>;
    };
    right_tiu: {
      cells: number;
      with_data: number;
      min_tiu: number | null;
      cells_trap: number;
      points: Array<[number, number, number | null]>;
    };
    left_mola: {
      cells: number;
      max_slope_deg: number | null;
      cells_slope_critical: number;
      min_svf: number | null;
      cells_shelter: number;
      points: Array<[number, number, number | null, number | null]>;
    };
  };
}

export interface RouteSample {
  d_m: number;
  t_min: number;
  elev_m: number | null;
  grade_deg: number | null;
  speed_mps: number | null;
  power_w: number | null;
  tiu: number | null;
  svf: number | null;
  rssi_dbm: number | null;
  lat: number;
  lon_e: number;
}

export interface PlannedLeg {
  leg_id: string;
  from: NodeId;
  to: NodeId;
  straight_distance_m: number;
  bearing_deg: number;
  length_m: number;
  time_min: number;
  mean_speed_mps: number;
  mean_power_w: number;
  o2_liters: number;
  o2_grams: number;
  gcr_dose_msv: number;
  spe_envelope_dose_msv: number;
  profile: RouteSample[];
  error?: string;
  /** Solo con puntos marcados: qué ha hecho el motor con el tramo. */
  deviation?: LegDeviation;
}

export type ReportedKind = 'ISRU' | 'PELIGRO' | 'REFUGIO';

/** Punto marcado desde Telemetría EVA y guardado en el motor (`/api/points`). */
export interface ReportedPoint {
  id: number;
  kind: ReportedKind;
  label: string;
  lat: number;
  lon_e: number;
  t_min: number | null;
  /** Qué hace el motor con él, en una frase. */
  effect: string;
  /** Valores de la celda res 12 donde cae (null si queda fuera de la malla). */
  cell: {
    elev_m: number | null;
    slope_deg: number | null;
    sky_view_factor: number | null;
    thermal_inertia_tiu: number | null;
    isru_h2o_pct: number | null;
    dtm_shelter: boolean;
  } | null;
}

export interface HazardModel {
  exclusion_radius_m: number;
  caution_radius_m: number;
  caution_cost_factor: number;
  snap_max_m: number;
  note: string;
}

export interface LegDeviation {
  status: 'desviada' | 'sin_cambios' | 'inalcanzable' | 'sin_referencia';
  caused_by: Array<{ id: number; label: string; nominal_min_distance_m: number }>;
  search: string;
  nominal_length_m?: number;
  nominal_time_min?: number;
  added_length_m?: number;
  added_time_min?: number;
  added_o2_liters?: number;
  min_distance_to_hazard_m?: number | null;
  /** Ruta nominal (lat, lon E) para dibujarla atenuada junto al desvío. */
  nominal_route?: Array<[number, number]>;
  reason?: string;
  blocking_points?: Array<{ id: number; label: string }>;
}

export interface RoutePlan {
  engine: string;
  conditions: string;
  pace: { speed_cap_mps: number; power_cap_w: number };
  grid: { path: string; resolution: number; cells: number; planner_fingerprint: string };
  legs: PlannedLeg[];
  points_version?: number;
  reported_points?: ReportedPoint[];
  hazard_model?: HazardModel;
  replanned?: boolean;
  summary?: {
    detoured_legs: string[];
    unreachable_legs: string[];
    added_length_m: number;
    added_time_min: number;
    added_o2_liters: number;
  };
}

export interface EmergencyRoute {
  length_m: number;
  time_min: number;
  o2_liters: number;
  dose_spe_msv: number;
  route: Array<[number, number]>;
}

/** Redecisión de T+105 del motor con los puntos marcados (`/api/emergency`). */
export interface EmergencyDecision {
  points_version: number;
  decision_t_min: number;
  rule: string;
  canonical_note: string;
  uses_reported_shelter: boolean;
  chosen_id: string;
  chosen_label: string;
  active_target: string;
  dynamic_goal_switched: boolean;
  base_feasible: boolean;
  t_vital_min: number;
  t_walkback_base_min: number;
  t_walkback_shelter_min: number;
  base: EmergencyRoute | null;
  candidates: Array<{
    id: string;
    label: string;
    reported: boolean;
    lat: number;
    lon_e: number;
    on_grid: boolean;
    cell_svf: number | null;
    dtm_confirms_shelter: boolean;
    reachable: boolean;
    chosen: boolean;
    escape: EmergencyRoute | null;
  }>;
  error?: string;
}

/** Procedencia de la imagen orbital del gemelo 3D (`/api/ortho`). */
export interface OrthoMeta {
  url: string;
  width: number;
  height: number;
  bounds: { lat_min: number; lat_max: number; lon_e_min: number; lon_e_max: number };
  resolution_m: number;
  mission: string;
  instrument: string;
  product: string;
  source_id: string;
  citation: string;
  credit: string;
  band: string;
  coregistration: {
    shift_east_m: number;
    shift_north_m: number;
    quadrant_spread_m: number;
    residual_m: number;
    reference_product: string;
  };
}
