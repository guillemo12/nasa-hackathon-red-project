//! EVA-07 mission computations shared by `eva07_mission_sim`, `export_mission_results` and the
//! tests: one place computes the timeline, the T+105 decision inputs, the walkback decision on
//! P1's real terrain and the Chaos Mode Monte Carlo. Printed figures and exported JSON both come
//! from here, so what the simulator shows is exactly what the planner used to decide.

use std::path::{Path, PathBuf};

use red_atlas_shared::{
    eva07_spe_open_sky_rate_msv_h, ActiveHazards, Eva07Effort, Eva07Phase, HexCellState64B,
    PaceProfile, PlssTelemetry, TargetGoal, DUST_TAU_STORM, EVA07_DECISION_T_MIN,
    EVA07_PRE_DECISION_PHASES, EVA_SPE_DOSE_BUDGET_MSV, O2_DENSITY_G_PER_L, PACE_EMERGENCY_ESCAPE,
    PACE_SUSTAINED_RETURN, SPE_PEAK_ENVELOPE_MSV_H, is_no_data, NLOS_RSSI_THRESHOLD_DBM, SUIT_O2_PRIMARY_USABLE_G,
    SURVIVAL_TRIANGLE_LEGS, SURVIVAL_TRIANGLE_SITE,
};
use serde::{Deserialize, Serialize};

use crate::h3_mars_grid::H3MarsGrid;
use crate::metabolic_dstar::{
    metabolic_o2_rate_l_min, pandolf_mars_metabolic_watts, MetabolicDStarPlanner, PathResult,
    WalkbackDecision,
};
use crate::stochastic_hazard::{
    run_chaos_mode_monte_carlo, ChaosModeReport, CHAOS_DT_MIN, CHAOS_INITIAL_O2_L,
    CHAOS_O2_SWITCH_L, CHAOS_SOLAR_ACTIVITY, CHAOS_TRAVERSE_LEGS,
};

/// P1 terrain grid (H3 res 12), path relative to the repository root.
pub const P1_GRID_PARQUET_REL: &str = "data/nasa-layers/hexgrid_route_res12_hexcell64b.parquet";
/// Exported walkback results, path relative to the repository root.
pub const PLANNER_WALKBACK_JSON_REL: &str = "data/mission-scenarios/planner_walkback.json";
/// Exported Chaos Mode results, path relative to the repository root.
pub const CHAOS_MODE_JSON_REL: &str = "data/mission-scenarios/chaos_mode_results.json";

/// Repository root as seen from this crate at build time (`src/core-engine/../..`).
pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Absolute path of a repository-relative file.
pub fn repo_path(rel: &str) -> PathBuf {
    repo_root().join(rel)
}

// ============================================================================
// 1. EVA-07 timeline (P1 model, minute integration)
// ============================================================================

/// State of the EVA-07 timeline at the end of minute `t_min`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TimelineSample {
    pub t_min: i32,
    pub power_w: f64,
    pub o2_rate_l_min: f64,
    pub o2_remaining_g: f64,
    pub dose_spe_msv: f64,
}

impl TimelineSample {
    pub fn o2_remaining_pct(&self) -> f64 {
        100.0 * self.o2_remaining_g / SUIT_O2_PRIMARY_USABLE_G
    }
    pub fn o2_remaining_liters(&self) -> f32 {
        (self.o2_remaining_g / O2_DENSITY_G_PER_L) as f32
    }
    pub fn timestamp_s(&self) -> f64 {
        self.t_min as f64 * 60.0
    }
}

/// Metabolic power of a phase with the P1 model.
pub fn phase_power_w(phase: &Eva07Phase) -> f64 {
    match phase.effort {
        Eva07Effort::None => 0.0,
        Eva07Effort::Scenario(watts) => watts,
        Eva07Effort::Walk { leg, speed_mps, tiu, slip, slope_deg } => {
            let leg = &SURVIVAL_TRIANGLE_LEGS[leg];
            let grade_deg = slope_deg
                .map(|s| s as f64)
                .unwrap_or_else(|| (leg.delta_elev_m / leg.distance_m).atan().to_degrees());
            pandolf_mars_metabolic_watts(grade_deg, tiu, speed_mps, slip)
        }
    }
}

/// Phase containing `t_min` (the last phase for `t_min` at or after the end).
pub fn phase_at(phases: &[Eva07Phase], t_min: f64) -> &Eva07Phase {
    phases
        .iter()
        .find(|p| t_min >= p.t0_min && t_min < p.t1_min)
        .unwrap_or(&phases[phases.len() - 1])
}

/// Integrates the timeline minute by minute (P1 convention: the interval `[t-1, t]` is split
/// among the phases that cover it, whose boundaries may be fractional; the SPE rate profile is
/// piecewise linear with knots on whole minutes, so the trapezoid on each piece is exact).
pub fn integrate_timeline(phases: &[Eva07Phase]) -> Vec<TimelineSample> {
    let t_start = phases[0].t0_min as i32;
    let t_end = phases[phases.len() - 1].t1_min as i32;
    let mut o2_used_g = 0.0;
    let mut dose = 0.0;
    let mut samples = Vec::new();
    for t in t_start..=t_end {
        if t > t_start {
            let (a_min, b_min) = ((t - 1) as f64, t as f64);
            for ph in phases {
                let (a, b) = (a_min.max(ph.t0_min), b_min.min(ph.t1_min));
                if b <= a {
                    continue;
                }
                let o2_g_min = metabolic_o2_rate_l_min(phase_power_w(ph)) * O2_DENSITY_G_PER_L;
                o2_used_g += o2_g_min * (b - a);
                let r0 = eva07_spe_open_sky_rate_msv_h(a);
                let r1 = eva07_spe_open_sky_rate_msv_h(b);
                dose += ph.dose_factor * 0.5 * (r0 + r1) * (b - a) / 60.0;
            }
        }
        let power = phase_power_w(phase_at(phases, t as f64));
        samples.push(TimelineSample {
            t_min: t,
            power_w: power,
            o2_rate_l_min: metabolic_o2_rate_l_min(power),
            o2_remaining_g: SUIT_O2_PRIMARY_USABLE_G - o2_used_g,
            dose_spe_msv: dose,
        });
    }
    samples
}

/// Timeline sample at minute `t_min`, if covered.
pub fn sample_at(timeline: &[TimelineSample], t_min: i32) -> Option<TimelineSample> {
    timeline.iter().find(|s| s.t_min == t_min).copied()
}

// ============================================================================
// 2. T+105 decision inputs
// ============================================================================

/// Cooling water left at T+105, minutes (scenario value of the simulator).
pub const DECISION_LCVG_REMAINING_MIN: f32 = 75.0;
/// Battery left at T+105, minutes (scenario value of the simulator).
pub const DECISION_BATTERY_REMAINING_MIN: f32 = 90.0;
/// Heart rate at T+105, bpm (scenario value of the simulator).
pub const DECISION_HEART_RATE_BPM: u16 = 162;
/// Catabatic wind of the T+105 dust front, m/s (scenario value of the simulator).
pub const DECISION_WIND_M_S: f32 = 28.0;

/// PLSS telemetry and active hazards at the T+105 alert. They come only from the phases before
/// the decision (no dependency on the planner): O2 and dose integrated to T+105 and the O2 rate
/// of the pace the suit measures just before the alert (ramp regulated at 585 W). `rssi_dbm` is
/// the primary S-band level where the astronaut stands; the radio-shadow threat (H4) is raised
/// by that level against the -100 dBm red threshold (a missing level counts as shadow).
pub fn t105_decision_inputs(rssi_dbm: f32) -> Result<(PlssTelemetry, ActiveHazards), String> {
    let pre = integrate_timeline(&EVA07_PRE_DECISION_PHASES);
    let t = EVA07_DECISION_T_MIN as i32;
    let s = sample_at(&pre, t).ok_or_else(|| format!("timeline does not reach T+{t}"))?;
    let last = &EVA07_PRE_DECISION_PHASES[EVA07_PRE_DECISION_PHASES.len() - 1];
    let telemetry = PlssTelemetry {
        timestamp_s: s.timestamp_s(),
        o2_remaining_liters: s.o2_remaining_liters(),
        lcvg_water_remaining_min: DECISION_LCVG_REMAINING_MIN,
        battery_remaining_min: DECISION_BATTERY_REMAINING_MIN,
        current_o2_rate_l_min: metabolic_o2_rate_l_min(phase_power_w(last)) as f32,
        cumulative_rad_msv: s.dose_spe_msv as f32,
        mission_rad_limit_msv: EVA_SPE_DOSE_BUDGET_MSV,
        heart_rate_bpm: DECISION_HEART_RATE_BPM,
    };
    let hazards = ActiveHazards {
        h1_dust_storm: true,
        h2_spe_radiation: true,
        h3_regolith_slope: true,
        h4_nlos_offline: is_no_data(rssi_dbm) || rssi_dbm < NLOS_RSSI_THRESHOLD_DBM,
        dust_tau: DUST_TAU_STORM,
        wind_speed_ms: DECISION_WIND_M_S,
        spe_dose_rate_msv_h: SPE_PEAK_ENVELOPE_MSV_H,
        rssi_dbm,
    };
    Ok((telemetry, hazards))
}

// ============================================================================
// 3. Walkback decision on P1's real terrain
// ============================================================================

/// Half-width of the search corridor around WP2 -> Base and WP2 -> WP3 at the T+105 decision,
/// m. `tests/p1_hexgrid.rs` checks that the corridor gives the same optimum (cost, time, walked
/// polyline) as the full grid. On the current grid every width from 50 m keeps the optimum;
/// 200 m keeps a 4x margin over that (it was not chosen to meet a latency target).
pub const DECISION_CORRIDOR_HALF_WIDTH_M: f64 = 200.0;

/// Summary of one planned route.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RouteReport {
    pub destination: String,
    pub pace: PaceProfile,
    pub cells: usize,
    pub corners: usize,
    /// Length of the D* Lite cell chain, m.
    pub raw_length_m: f64,
    /// Length of the walked (smoothed) polyline, m.
    pub length_m: f64,
    pub time_min: f64,
    pub arrival_t_min: f64,
    pub mean_speed_mps: f64,
    pub mean_power_w: f64,
    pub o2_liters: f64,
    /// Projected SPE dose en route (decision model: envelope rate x SVF of each cell), mSv.
    pub dose_spe_msv: f64,
    /// Share of the walked length by signed grade band, percent.
    pub grade_down_lt_minus5_pct: f64,
    pub grade_minus5_to_5_pct: f64,
    pub grade_5_to_10_pct: f64,
    pub grade_gt_10_pct: f64,
    pub grade_max_up_deg: f64,
    pub grade_max_down_deg: f64,
    /// Share of the walked length where the power cap (not the speed cap) sets the speed.
    pub power_capped_pct: f64,
}

impl RouteReport {
    fn from_path(destination: &str, path: &PathResult, pace: PaceProfile) -> Self {
        let (mut down, mut flat, mut gentle, mut steep, mut capped) = (0.0, 0.0, 0.0, 0.0, 0.0);
        let (mut max_up, mut max_down): (f64, f64) = (0.0, 0.0);
        for s in &path.profile {
            match s.grade_deg {
                g if g < -5.0 => down += s.step_m,
                g if g <= 5.0 => flat += s.step_m,
                g if g <= 10.0 => gentle += s.step_m,
                _ => steep += s.step_m,
            }
            max_up = max_up.max(s.grade_deg);
            max_down = max_down.min(s.grade_deg);
            if s.speed_mps < pace.speed_cap_mps - 1e-9 && (s.power_w - pace.power_cap_w).abs() < 1e-6 {
                capped += s.step_m;
            }
        }
        let len = path.length_m.max(1e-9);
        let pct = |x: f64| 100.0 * x / len;
        Self {
            destination: destination.to_string(),
            pace,
            cells: path.path_h3.len(),
            corners: path.smoothed_h3.len(),
            raw_length_m: path.raw_length_m,
            length_m: path.length_m,
            time_min: path.estimated_time_min,
            arrival_t_min: EVA07_DECISION_T_MIN + path.estimated_time_min,
            mean_speed_mps: path.mean_speed_mps(),
            mean_power_w: path.mean_power_w(),
            o2_liters: path.estimated_o2_liters,
            dose_spe_msv: path.estimated_rad_msv,
            grade_down_lt_minus5_pct: pct(down),
            grade_minus5_to_5_pct: pct(flat),
            grade_5_to_10_pct: pct(gentle),
            grade_gt_10_pct: pct(steep),
            grade_max_up_deg: max_up,
            grade_max_down_deg: max_down,
            power_capped_pct: pct(capped),
        }
    }
}

/// Identification of the grid the planner ran on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridVersion {
    pub path: String,
    pub resolution: u8,
    pub cells: usize,
    /// `H3MarsGrid::planner_fingerprint` of the full grid, hex.
    pub planner_fingerprint: String,
}

/// Walkback decision at T+105 on P1's terrain, as exported to `planner_walkback.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WalkbackReport {
    pub schema_version: String,
    pub generator: String,
    pub decision_t_min: f64,
    pub grid: GridVersion,
    pub corridor_half_width_m: Option<f64>,
    pub radiation_model: String,
    // Inputs
    pub o2_remaining_l: f64,
    pub o2_rate_l_min: f64,
    pub dose_accumulated_msv: f64,
    pub dose_budget_msv: f64,
    pub dust_tau: f64,
    pub wind_m_s: f64,
    pub spe_rate_envelope_msv_h: f64,
    // Time margins
    pub t_vital_min: f64,
    pub t_vital_o2_min: f64,
    pub t_vital_lcvg_min: f64,
    pub t_vital_battery_min: f64,
    pub t_vital_radiation_min: f64,
    pub current_cell_svf: f64,
    /// Reference only (not used by the decision): time to spend the remaining budget at the
    /// envelope rate with open-sky exposure (factor 1.0), P1's "ventana a cielo abierto".
    pub open_sky_window_min: f64,
    pub remaining_dose_budget_msv: f64,
    // Decision
    pub safety_factor: f64,
    pub radiation_switch_ratio: f64,
    pub time_switch: bool,
    pub rad_switch: bool,
    pub dynamic_goal_switched: bool,
    pub active_target: String,
    pub base_feasible: bool,
    pub wp3: RouteReport,
    pub base: RouteReport,
    pub wp3_within_t_vital: bool,
    pub wp3_within_open_sky_window: bool,
}

/// Output of [`compute_t105_walkback`]: the report plus the raw decision (with paths).
pub struct WalkbackRun {
    pub report: WalkbackReport,
    pub decision: WalkbackDecision,
    pub telemetry: PlssTelemetry,
    pub hazards: ActiveHazards,
    pub wp2_h3: u64,
    pub base_h3: u64,
    pub wp3_h3: u64,
}

/// Runs the T+105 Walkback Limit Dual on `grid` (P1's res-12 terrain), optionally restricted to
/// a corridor of `corridor_half_width_m` around WP2 -> Base and WP2 -> WP3. The radio level in
/// `ActiveHazards` is the primary S-band level of the WP2 cell of the grid (the planner does not
/// use it and it is not exported).
pub fn compute_t105_walkback(
    grid: &H3MarsGrid,
    grid_path_rel: &str,
    corridor_half_width_m: Option<f64>,
) -> Result<WalkbackRun, String> {
    let node = |i: usize| {
        let site = &SURVIVAL_TRIANGLE_SITE[i];
        grid.nearest_cell(site.lat_deg, site.lon_deg)
            .map(|c| c.h3_index)
            .ok_or_else(|| format!("{} not found in the grid", site.id))
    };
    let (base_h3, wp2_h3, wp3_h3) = (node(0)?, node(2)?, node(3)?);
    let search = match corridor_half_width_m {
        Some(w) => grid.corridor_around(wp2_h3, &[base_h3, wp3_h3], w),
        None => grid.clone(),
    };
    let (cells, adj) = search.planner_graph();
    let mut planner = MetabolicDStarPlanner::new(cells, adj);
    let rssi_dbm = grid.get_cell(wp2_h3).map_or(f32::NAN, |c| c.los_base_rssi_dbm);
    let (telemetry, hazards) = t105_decision_inputs(rssi_dbm)?;
    let decision = planner.evaluate_walkback_detailed(wp2_h3, base_h3, wp3_h3, &telemetry, &hazards);
    let report = walkback_report(grid, grid_path_rel, corridor_half_width_m, &telemetry, &hazards, &decision)?;
    Ok(WalkbackRun { report, decision, telemetry, hazards, wp2_h3, base_h3, wp3_h3 })
}

fn walkback_report(
    grid: &H3MarsGrid,
    grid_path_rel: &str,
    corridor_half_width_m: Option<f64>,
    telemetry: &PlssTelemetry,
    hazards: &ActiveHazards,
    d: &WalkbackDecision,
) -> Result<WalkbackReport, String> {
    let wp3 = d.wp3_path.as_ref().ok_or("no WP2 -> WP3 route on the grid")?;
    let base = d.base_path.as_ref().ok_or("no WP2 -> Base route on the grid")?;
    let wp3 = RouteReport::from_path("WP3", wp3, PACE_EMERGENCY_ESCAPE);
    let base = RouteReport::from_path("BASE", base, PACE_SUSTAINED_RETURN);
    let rate = hazards.spe_dose_rate_msv_h as f64;
    let open_sky_window_min = if rate > 0.0 { d.remaining_rad_budget_msv / rate * 60.0 } else { f64::INFINITY };
    Ok(WalkbackReport {
        schema_version: "1.0".into(),
        generator: "cargo run --release --bin export_mission_results (src/core-engine)".into(),
        decision_t_min: EVA07_DECISION_T_MIN,
        grid: GridVersion {
            path: grid_path_rel.to_string(),
            resolution: grid.res,
            cells: grid.len(),
            planner_fingerprint: format!("{:016x}", grid.planner_fingerprint()),
        },
        corridor_half_width_m,
        radiation_model: "SPE dose = envelope rate measured at the alert (constant) x Sky View Factor \
                          of each cell walked (missing SVF = open sky); T_vital radiation term uses \
                          the SVF of the current cell"
            .into(),
        o2_remaining_l: telemetry.o2_remaining_liters as f64,
        o2_rate_l_min: telemetry.current_o2_rate_l_min as f64,
        dose_accumulated_msv: telemetry.cumulative_rad_msv as f64,
        dose_budget_msv: telemetry.mission_rad_limit_msv as f64,
        dust_tau: hazards.dust_tau as f64,
        wind_m_s: hazards.wind_speed_ms as f64,
        spe_rate_envelope_msv_h: rate,
        t_vital_min: d.t_vital_min,
        t_vital_o2_min: d.t_vital_o2_min,
        t_vital_lcvg_min: d.t_vital_lcvg_min,
        t_vital_battery_min: d.t_vital_battery_min,
        t_vital_radiation_min: d.t_vital_radiation_min,
        current_cell_svf: d.current_cell_svf,
        open_sky_window_min,
        remaining_dose_budget_msv: d.remaining_rad_budget_msv,
        safety_factor: d.safety_factor,
        radiation_switch_ratio: d.radiation_switch_ratio,
        time_switch: d.time_switch,
        rad_switch: d.rad_switch,
        dynamic_goal_switched: d.status.dynamic_goal_switched,
        active_target: match d.status.active_target {
            TargetGoal::Wp3Shelter => "WP3",
            TargetGoal::BaseHabitat => "BASE",
            TargetGoal::Wp1Isru => "WP1",
            TargetGoal::Wp2Fault => "WP2",
        }
        .into(),
        base_feasible: d.status.base_feasible,
        wp3_within_t_vital: wp3.time_min <= d.t_vital_min,
        wp3_within_open_sky_window: wp3.time_min <= open_sky_window_min,
        wp3,
        base,
    })
}

/// Primary S-band level of P1's grid at each node of the survival triangle:
/// `(node id, rssi_dbm)` in Base, WP1, WP2, WP3 order (NaN if the cell is missing).
pub fn node_radio_levels(grid: &H3MarsGrid) -> Vec<(&'static str, f32)> {
    SURVIVAL_TRIANGLE_SITE
        .iter()
        .map(|s| {
            let rssi = grid
                .nearest_cell(s.lat_deg, s.lon_deg)
                .map_or(f32::NAN, |c| c.los_base_rssi_dbm);
            (s.id, rssi)
        })
        .collect()
}

/// Full EVA-07 timeline with the escape phase taken from the planner (time and mean power).
pub fn full_timeline(wp3: &RouteReport) -> Vec<TimelineSample> {
    integrate_timeline(&red_atlas_shared::eva07_phases(wp3.time_min, wp3.mean_power_w))
}

/// Loads P1's res-12 grid from `path` with a readable error.
pub fn load_grid(path: &Path) -> Result<H3MarsGrid, String> {
    H3MarsGrid::load_p1_parquet(path).map_err(|e| format!("cannot load P1 grid {}: {e}", path.display()))
}

// ============================================================================
// 4. Chaos Mode (10,000 seeded trials)
// ============================================================================

/// Seed of the exported Chaos Mode run (same as the simulator's Act 1).
pub const CHAOS_SEED: u64 = 42;
/// Number of exported Chaos Mode trials.
pub const CHAOS_TRIALS: usize = 10_000;
/// Mars local solar hour at departure (14:30 LMST, simulator convention).
pub const CHAOS_SOLAR_HOUR: f64 = 14.5;
/// H3 resolution of the synthetic corridor the Chaos Mode samples.
pub const CHAOS_CORRIDOR_RES: u8 = 11;

/// Cells of the Chaos Mode traverse: the synthetic Melas Chasma corridor at resolution 11,
/// sorted by H3 index (reproducible order).
pub fn chaos_corridor_cells() -> Vec<HexCellState64B> {
    H3MarsGrid::generate_melas_chasma_corridor(CHAOS_CORRIDOR_RES).planner_graph().0
}

/// Chaos Mode run as exported to `chaos_mode_results.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChaosExport {
    pub schema_version: String,
    pub generator: String,
    pub seed: u64,
    pub trials: usize,
    pub mars_solar_hour: f64,
    pub corridor: String,
    pub corridor_cells: usize,
    pub traverse_legs: usize,
    pub leg_minutes: f64,
    pub solar_activity_factor: f64,
    pub initial_o2_l: f64,
    pub o2_switch_threshold_l: f64,
    pub dose_budget_msv: f64,
    pub criterion: String,
    pub limitations: String,
    pub report: ChaosModeReport,
}

/// Runs the exported Chaos Mode configuration.
pub fn compute_chaos_export() -> ChaosExport {
    let cells = chaos_corridor_cells();
    let report = run_chaos_mode_monte_carlo(&cells, CHAOS_TRIALS, CHAOS_SEED, CHAOS_SOLAR_HOUR);
    ChaosExport {
        schema_version: "1.0".into(),
        generator: "cargo run --release --bin export_mission_results (src/core-engine)".into(),
        seed: CHAOS_SEED,
        trials: CHAOS_TRIALS,
        mars_solar_hour: CHAOS_SOLAR_HOUR,
        corridor: format!(
            "synthetic Melas Chasma corridor, H3 res {CHAOS_CORRIDOR_RES}, cells sorted by index"
        ),
        corridor_cells: cells.len(),
        traverse_legs: CHAOS_TRAVERSE_LEGS,
        leg_minutes: CHAOS_DT_MIN,
        solar_activity_factor: CHAOS_SOLAR_ACTIVITY,
        initial_o2_l: CHAOS_INITIAL_O2_L,
        o2_switch_threshold_l: CHAOS_O2_SWITCH_L,
        dose_budget_msv: EVA_SPE_DOSE_BUDGET_MSV as f64,
        criterion: "mision segura = reaches a destination (Base, or WP3 shelter when switching is \
                    allowed) with SPE dose <= 2 mSv and primary O2 left; otherwise the most severe \
                    of: consumables lost > destination not reached > flight-rule breach (dose > 2 mSv)"
            .into(),
        limitations: "cells sampled by position in the sorted corridor, not along a planned route; \
                      only primary O2 modelled as consumable; escape to the shelter = 1 leg at 0.55 \
                      of the open-sky dose; Base return = 14 nominal legs from leg 6"
            .into(),
        report,
    }
}

/// Serializes any export as pretty JSON with a trailing newline.
pub fn to_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string_pretty(value)
        .map(|s| s + "\n")
        .map_err(|e| format!("JSON serialization failed: {e}"))
}

/// Compares two JSON documents: same structure and keys, strings and booleans equal, numbers
/// equal within `rel_tol` (relative, with an absolute floor of `rel_tol`). Returns the first
/// mismatch path.
pub fn json_mismatch(a: &serde_json::Value, b: &serde_json::Value, rel_tol: f64) -> Option<String> {
    fn walk(a: &serde_json::Value, b: &serde_json::Value, tol: f64, path: &str) -> Option<String> {
        use serde_json::Value as V;
        match (a, b) {
            (V::Number(x), V::Number(y)) => {
                let (x, y) = (x.as_f64()?, y.as_f64()?);
                ((x - y).abs() > tol * x.abs().max(y.abs()).max(1.0))
                    .then(|| format!("{path}: {x} != {y}"))
            }
            (V::Object(x), V::Object(y)) => {
                if x.len() != y.len() {
                    return Some(format!("{path}: different keys"));
                }
                x.iter().find_map(|(k, v)| match y.get(k) {
                    Some(w) => walk(v, w, tol, &format!("{path}.{k}")),
                    None => Some(format!("{path}.{k}: missing")),
                })
            }
            (V::Array(x), V::Array(y)) => {
                if x.len() != y.len() {
                    return Some(format!("{path}: different lengths"));
                }
                x.iter().zip(y).enumerate().find_map(|(i, (v, w))| walk(v, w, tol, &format!("{path}[{i}]")))
            }
            _ => (a != b).then(|| format!("{path}: {a} != {b}")),
        }
    }
    walk(a, b, rel_tol, "$")
}
