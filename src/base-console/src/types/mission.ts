export type ConsoleView = '3d-console' | 'route-planificator' | 'eva-hud-nominal' | 'eva-emergency';

export type SpyglassMode = 'tri-sector' | 'xray-crism' | 'xray-themis' | 'xray-mola';

export interface WaypointNode {
  id: 'BASE' | 'WP1' | 'WP2' | 'WP3';
  name: string;
  shortLabel: string;
  role: string;
  lat: number;
  lonE: number;
  lonW: number;
  elevMolaM: number;
  slopeLocalDeg: number;
  rampSlopeDeg?: number;
  tiu: number;
  svfScenario: number;
  svfDem: number;
  radioLosBase: boolean;
  h2oWtPct: number | null;
  geology: string;
  distFromBaseM: number;
}

export interface RouteLeg {
  id: string;
  from: 'BASE' | 'WP1' | 'WP2' | 'WP3';
  to: 'BASE' | 'WP1' | 'WP2' | 'WP3';
  distanceM: number;
  deltaElevM: number;
  bearingDeg: number;
  meanSlopeDeg: number;
  maxSlopeDeg: number;
}

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
  base_time_min: number;
  base_dose_proj_env_msv: number;
  base_dose_proj_ramp_msv: number;
  base_viable: boolean;
  wp3_time_min: number;
  wp3_dose_proj_env_msv: number;
  wp3_dose_proj_ramp_msv: number;
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

export interface ChaosRunResult {
  seed: number;
  baseSurvivalPct: number;
  wp3SurvivalPct: number;
  baseSurvivals: number;
  wp3Survivals: number;
  totalRuns: number;
  meanBaseDoseMsv: number;
  meanWp3DoseMsv: number;
  wp3TimeMin: number;
  baseTimeMin: number;
  trajectories: Array<{
    id: number;
    survivedWp3: boolean;
    survivedBase: boolean;
    speFlux: number;
    windMs: number;
    wp3DoseMsv: number;
  }>;
}
