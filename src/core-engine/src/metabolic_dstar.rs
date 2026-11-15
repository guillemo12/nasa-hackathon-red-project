//! Metabolic D* Lite Pathplanner, Reference metabolic cost function (the function keeps its
//! historical name `pandolf_mars_metabolic_watts`, but it is no longer a Pandolf model),
//! Walkback Limit Dual calculator, and Dynamic Goal Switching for R.E.D. ATLAS.
//!
//! Implements Sections 3.2-3.4 of `docs/03-system-architecture-ai/ARQUITECTURA_E_IA.md`.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

use red_atlas_shared::{
    ActiveHazards, HexCellState64B, MARS_GRAVITY, METABOLIC_CLIMB_EFFICIENCY,
    METABOLIC_LEVEL_COEF, METABOLIC_REST_W, O2_ENERGY_JOULES_PER_LITER, PlssTelemetry,
    SPE_CRITICAL_RATE_MSV_H, TERRAIN_ETA_BY_TIU_BAND, TIU_AMBER_THRESHOLD,
    TIU_ETA_MID_THRESHOLD, TOTAL_EVA_MASS_KG, TargetGoal, UNPASSABLE_SLOPE_DEG,
    WALKBACK_SAFETY_FACTOR, WalkbackDualStatus, CRITICAL_SLOPE_DEG, LOW_TIU_TRAP_THRESHOLD,
    is_no_data, or_assumed, PaceProfile, SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG, PACE_EMERGENCY_ESCAPE, PACE_MIN_SPEED_MPS,
    PACE_SUSTAINED_RETURN, REGOLITH_TRAP_SLIP_FRACTION, SVF_NO_DATA_ASSUMED, TIU_NO_DATA_ASSUMED,
};
use serde::{Deserialize, Serialize};

use crate::h3_mars_grid::{grid_line_h3, h3_to_lat_lon, MARS_RADIUS_M};

const WIND_DRAG_BETA: f64 = 0.05;
const LOW_TIU_REGOLITH_THRESHOLD: f32 = LOW_TIU_TRAP_THRESHOLD;
const CRITICAL_SLOPE_THRESHOLD_DEG: f64 = CRITICAL_SLOPE_DEG as f64;
/// Upper bound for the slip fraction `s`. The model divides by `1 - s`, which diverges as
/// `s -> 1`; slips above 0.95 are clamped to 0.95 instead of producing infinite power. the pipeline's
/// validator raises an error only for `s >= 1`, so the two differ only for `0.95 < s < 1`
/// (e.g. s = 0.99: 4,163 W here vs 19,879 W in the pipeline), far outside any scenario value (0.30).
const MAX_SLIP_FRACTION: f64 = 0.95;
const RADIATION_SWITCH_RATIO: f64 = 0.35;
const MIN_SVF: f64 = 0.05;

/// Sky View Factor used for dose: the cell value clamped to `[MIN_SVF, 1]`, or open sky
/// (`SVF_NO_DATA_ASSUMED`) when the cell has no SVF (`clamp` does not clean a NaN).
fn dose_svf(sky_view_factor: f32) -> f64 {
    (or_assumed(sky_view_factor, SVF_NO_DATA_ASSUMED) as f64).clamp(MIN_SVF, 1.0)
}

/// Multi-criteria edge cost weights combining metabolic O2, SPE radiation, and dust drag.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CostWeights {
    pub w_metabolic: f64,
    pub w_radiation: f64,
    pub w_dust: f64,
    /// Speed / power caps that set the walking speed on every edge.
    pub pace: PaceProfile,
}

impl Default for CostWeights {
    /// Sustained-return pace (`PACE_SUSTAINED_RETURN`).
    fn default() -> Self {
        Self {
            w_metabolic: 1.0,
            w_radiation: 1.5,
            w_dust: 0.3,
            pace: PACE_SUSTAINED_RETURN,
        }
    }
}

impl CostWeights {
    /// Same weights with the emergency-escape pace (`PACE_EMERGENCY_ESCAPE`).
    pub fn emergency_escape() -> Self {
        Self {
            pace: PACE_EMERGENCY_ESCAPE,
            ..Self::default()
        }
    }
}

/// One step of the walked (smoothed) route.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PathSample {
    /// Destination cell of the step.
    pub h3: u64,
    pub step_m: f64,
    pub cum_dist_m: f64,
    pub cum_time_min: f64,
    /// Signed grade along the step (positive = uphill), degrees.
    pub grade_deg: f64,
    pub speed_mps: f64,
    pub power_w: f64,
}

/// Output of a planned EVA route across the `h3o` hexagonal terrain graph.
///
/// `path_h3` is the D* Lite cell chain. Time, O2, dose and cost are measured on the walked
/// route: the cell chain shortened by string-pulling (`smoothed_h3` are its corner cells, each
/// straight leg checked cell by cell for transitability and accepted only if it does not cost
/// more than the cell chain it replaces). Graphs without real H3 cells are not smoothed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathResult {
    pub path_h3: Vec<u64>,
    pub total_cost: f64,
    pub estimated_time_min: f64,
    pub estimated_o2_liters: f64,
    pub estimated_rad_msv: f64,
    /// Length of the D* Lite cell chain (sum of center-to-center steps), m.
    pub raw_length_m: f64,
    /// Length of the walked polyline, m.
    pub length_m: f64,
    /// Corner cells of the walked polyline (start and goal included).
    pub smoothed_h3: Vec<u64>,
    /// Step-by-step profile of the walked polyline.
    pub profile: Vec<PathSample>,
}

impl PathResult {
    /// Mean walking speed over the walked route, m/s.
    pub fn mean_speed_mps(&self) -> f64 {
        if self.estimated_time_min > 0.0 {
            self.length_m / (self.estimated_time_min * 60.0)
        } else {
            0.0
        }
    }

    /// Time-weighted mean metabolic power over the walked route, W.
    pub fn mean_power_w(&self) -> f64 {
        let mut prev_t = 0.0;
        let mut energy = 0.0;
        for s in &self.profile {
            energy += s.power_w * (s.cum_time_min - prev_t);
            prev_t = s.cum_time_min;
        }
        if prev_t > 0.0 { energy / prev_t } else { 0.0 }
    }
}

/// Every figure the Walkback Limit Dual decision uses (`evaluate_walkback_detailed`).
///
/// - `t_vital_min` = min(O2 left / current O2 rate, cooling water, battery, time until the SPE
///   budget is spent at the envelope rate x the SVF of the cell where the astronaut stands).
/// - Route doses (`PathResult::estimated_rad_msv`) = envelope rate x SVF of each cell walked.
/// - Switch to the shelter if `T_base > safety_factor * T_vital` and `T_shelter < T_base`
///   (`time_switch`), or if the Base dose exceeds the remaining budget while the shelter dose is
///   below `radiation_switch_ratio` x the Base dose under a critical SPE rate (`rad_switch`).
#[derive(Debug, Clone, PartialEq)]
pub struct WalkbackDecision {
    pub status: WalkbackDualStatus,
    pub t_vital_min: f64,
    pub t_vital_o2_min: f64,
    pub t_vital_lcvg_min: f64,
    pub t_vital_battery_min: f64,
    pub t_vital_radiation_min: f64,
    pub current_cell_svf: f64,
    pub remaining_rad_budget_msv: f64,
    pub safety_factor: f64,
    pub radiation_switch_ratio: f64,
    pub time_switch: bool,
    pub rad_switch: bool,
    pub base_path: Option<PathResult>,
    pub wp3_path: Option<PathResult>,
}

/// THEMIS-derived terrain factor `\eta(I)` (reference bands):
/// 1.0 (> 400 TIU), 1.3 (250-400), 1.6 (150-250), 2.1 (< 150). At the exact boundaries the pipeline's
/// `eta_from_tiu` takes the softer band: 400 -> 1.3, 250 -> 1.6, 150 -> 1.6.
///
/// A cell without TIU (`CELL_NO_DATA`, most of the real grid) uses `TIU_NO_DATA_ASSUMED` (mid band,
/// eta 1.3) explicitly; before, NaN failed every comparison and fell into the softest band (2.1).
pub fn soil_sinkage_eta(thermal_inertia_tiu: f32) -> f64 {
    let tiu = or_assumed(thermal_inertia_tiu, TIU_NO_DATA_ASSUMED);
    if tiu > TIU_AMBER_THRESHOLD {
        TERRAIN_ETA_BY_TIU_BAND[0]
    } else if tiu > TIU_ETA_MID_THRESHOLD {
        TERRAIN_ETA_BY_TIU_BAND[1]
    } else if tiu >= LOW_TIU_TRAP_THRESHOLD {
        TERRAIN_ETA_BY_TIU_BAND[2]
    } else {
        TERRAIN_ETA_BY_TIU_BAND[3]
    }
}

/// Suited metabolic power on Mars (Watts), reference model:
///
/// `M = 120 + eta * 0.285 * W * v + W * v * sin(theta) / (0.25 * (1 - s))`,
/// with `W = TOTAL_EVA_MASS_KG * MARS_GRAVITY` and `s` the slip fraction.
///
/// Flat firm ground (`> 400 TIU`, `0 deg`, `1.0 m/s`, `s = 0`) gives ~300 W (~0.90 L/min O2);
/// the WP2 ramp (`22 deg`, `110 TIU`, `0.55 m/s`, `s = 0.30`) gives ~1073 W (~3.2 L/min O2).
/// Downhill the model credits no climbing work (reference model: the climbing term is zero for negative
/// grades; the eccentric cost of descending is not modelled), so costs stay non-negative.
///
/// No data: a NaN slope, speed or slip returns NaN (explicit "no data"), never the level-ground
/// or resting power. A NaN TIU is the documented no-data case of `soil_sinkage_eta`
/// (`TIU_NO_DATA_ASSUMED`). The slip is clamped to `[0, 0.95]` (see `MAX_SLIP_FRACTION`).
pub fn pandolf_mars_metabolic_watts(
    slope_deg: f64,
    thermal_inertia_tiu: f32,
    walk_speed_mps: f64,
    slip_fraction: f64,
) -> f64 {
    if slope_deg.is_nan() || walk_speed_mps.is_nan() || slip_fraction.is_nan() {
        return f64::NAN;
    }
    let v = walk_speed_mps.max(0.0);
    let weight_n = TOTAL_EVA_MASS_KG * MARS_GRAVITY;
    let slip = slip_fraction.clamp(0.0, MAX_SLIP_FRACTION);

    let eta = soil_sinkage_eta(thermal_inertia_tiu);
    let level_term = eta * METABOLIC_LEVEL_COEF * weight_n * v;
    let climb_term = (weight_n * v * slope_deg.to_radians().sin()
        / (METABOLIC_CLIMB_EFFICIENCY * (1.0 - slip)))
        .max(0.0);

    METABOLIC_REST_W + level_term + climb_term
}

/// Converts metabolic power (Watts) into oxygen consumption rate (L/min STP).
/// A NaN power (no data) gives NaN, not 0 L/min.
pub fn metabolic_o2_rate_l_min(watts: f64) -> f64 {
    if watts.is_nan() {
        return f64::NAN;
    }
    (watts.max(0.0) * 60.0) / O2_ENERGY_JOULES_PER_LITER
}

/// Dust visibility factor on walking speed: `1 / (1 + 0.15 (tau - 0.5)+)`.
pub fn dust_visibility_factor(dust_tau: f32) -> f64 {
    let tau = dust_tau.max(0.0) as f64;
    1.0 / (1.0 + 0.15 * (tau - 0.5).max(0.0))
}

/// Pace rule shared with the pipeline's metabolic model: the highest speed (m/s) that satisfies both the
/// speed cap of `pace` (times the dust visibility factor when the profile says so) and its
/// metabolic power cap, given the edge grade (deg, signed), terrain TIU and slip fraction.
/// The model is linear in speed, so the power-limited speed is `(cap - 120) / (dM/dv)`.
pub fn max_speed_under_caps(
    grade_deg: f64,
    thermal_inertia_tiu: f32,
    slip_fraction: f64,
    pace: &PaceProfile,
    dust_tau: f32,
) -> f64 {
    let vis = if pace.dust_visibility_limits_speed {
        dust_visibility_factor(dust_tau)
    } else {
        1.0
    };
    let speed_cap = pace.speed_cap_mps * vis;
    let per_speed = pandolf_mars_metabolic_watts(grade_deg, thermal_inertia_tiu, 1.0, slip_fraction)
        - METABOLIC_REST_W;
    let power_speed = if per_speed > 0.0 {
        (pace.power_cap_w - METABOLIC_REST_W) / per_speed
    } else {
        f64::INFINITY
    };
    speed_cap.min(power_speed).max(PACE_MIN_SPEED_MPS)
}

/// Penalty zone around a point (center in planetocentric latitude, East longitude 0-360).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ZonePenalty {
    pub lat_deg: f64,
    pub lon_e_deg: f64,
    pub exclusion_radius_m: f64,
    pub caution_radius_m: f64,
    pub caution_factor: f64,
}

/// Local (east, north) position in m on the tangent plane at the fixed site reference (Base
/// node), the frame of the planner's positions, bearings and walked lengths.
pub fn local_xy(lat_deg: f64, lon_e_deg: f64) -> (f64, f64) {
    let (la0, lo0) = (SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG);
    let mut dlon = lon_e_deg - lo0;
    if dlon > 180.0 {
        dlon -= 360.0;
    } else if dlon < -180.0 {
        dlon += 360.0;
    }
    (
        MARS_RADIUS_M * la0.to_radians().cos() * dlon.to_radians(),
        MARS_RADIUS_M * (lat_deg - la0).to_radians(),
    )
}

/// Full evaluation of one directed edge.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EdgeEval {
    pub total_cost: f64,
    pub delta_t_min: f64,
    pub o2_liters: f64,
    pub rad_msv: f64,
    /// Signed grade along the edge in degrees (positive = uphill).
    pub grade_deg: f64,
    pub speed_mps: f64,
    pub power_w: f64,
}

impl EdgeEval {
    const IMPASSABLE: Self = Self {
        total_cost: f64::INFINITY,
        delta_t_min: f64::INFINITY,
        o2_liters: f64::INFINITY,
        rad_msv: f64::INFINITY,
        grade_deg: f64::NAN,
        speed_mps: 0.0,
        power_w: f64::NAN,
    };
}

/// Downhill gradient vector `tan(slope) * (sin aspect, cos aspect)` (east, north) of a cell from
/// its DTM attributes, or `None` if slope or aspect is missing.
fn cell_gradient(c: &HexCellState64B) -> Option<(f64, f64)> {
    if is_no_data(c.slope_deg) || is_no_data(c.aspect_deg) {
        return None;
    }
    let t = (c.slope_deg as f64).to_radians().tan();
    let a = (c.aspect_deg as f64).to_radians();
    Some((t * a.sin(), t * a.cos()))
}

/// Signed grade of the directed edge `u -> v` in degrees and the slope that decides
/// transitability, or `None` if the edge is unknown terrain.
///
/// With a bearing and slope + aspect on both cells, the grade is the directional derivative of
/// the DTM along the edge: the mean downhill gradient of the two cells (the pipeline slope is a Horn 3x3
/// on the 20 m DTM, i.e. a 40 m base) projected on the bearing, and transitability uses the
/// cell slope attribute. This removes the staircase of a 20 m DTM sampled on ~5 m cells, where
/// neighbor `dz` is either 0 or a full pixel step. Without them (hand-made test graphs, cells
/// without aspect) it falls back to `atan(dz / d)` between cell centers.
fn edge_grade(
    u: &HexCellState64B,
    v: &HexCellState64B,
    dist_m: f64,
    bearing_deg: Option<f64>,
) -> Option<(f64, f64)> {
    // `dist_m` NaN, zero or negative: unknown edge.
    if is_no_data(u.elev_m) || is_no_data(v.elev_m) || dist_m.is_nan() || dist_m <= 0.0 {
        return None;
    }
    if let (Some(b), Some(gu), Some(gv)) = (bearing_deg, cell_gradient(u), cell_gradient(v)) {
        let (sb, cb) = b.to_radians().sin_cos();
        let ge = 0.5 * (gu.0 + gv.0);
        let gn = 0.5 * (gu.1 + gv.1);
        let grade = (-(ge * sb + gn * cb)).atan().to_degrees();
        let cell_slope = (u.slope_deg.max(v.slope_deg)) as f64;
        return Some((grade, cell_slope));
    }
    let dz = (v.elev_m - u.elev_m) as f64;
    let geom = (dz / dist_m).atan().to_degrees();
    let cell_slope = if is_no_data(v.slope_deg) {
        geom.abs()
    } else {
        (v.slope_deg as f64).abs().max(geom.abs())
    };
    // Flat-elevation test graphs: use the destination cell slope as the climb.
    let grade = if dz.abs() > 1e-3 || is_no_data(v.slope_deg) {
        geom
    } else {
        v.slope_deg as f64
    };
    Some((grade, cell_slope))
}

/// Evaluates the directed edge `u -> v` (length `dist_m`, optional bearing in degrees from
/// North) under the pace rule of `weights.pace`.
///
/// - Impassable (infinite) if either cell has no elevation or the transitability slope exceeds
///   `UNPASSABLE_SLOPE_DEG`.
/// - Speed: `max_speed_under_caps` with the edge grade, the destination TIU (missing TIU uses
///   `TIU_NO_DATA_ASSUMED`) and slip `REGOLITH_TRAP_SLIP_FRACTION` on trap edges
///   (raw TIU < 150 and slope > 20 deg; a missing TIU is never a trap).
/// - Dose: SPE rate times the destination SVF (missing SVF = open sky). Never NaN.
pub fn edge_eval(
    u: &HexCellState64B,
    v: &HexCellState64B,
    dist_m: f64,
    bearing_deg: Option<f64>,
    hazards: &ActiveHazards,
    weights: &CostWeights,
) -> EdgeEval {
    if dist_m == 0.0 {
        return EdgeEval {
            total_cost: 0.0,
            delta_t_min: 0.0,
            o2_liters: 0.0,
            rad_msv: 0.0,
            grade_deg: 0.0,
            speed_mps: 0.0,
            power_w: METABOLIC_REST_W,
        };
    }
    let Some((grade_deg, transit_slope_deg)) = edge_grade(u, v, dist_m, bearing_deg) else {
        return EdgeEval::IMPASSABLE;
    };
    if transit_slope_deg > UNPASSABLE_SLOPE_DEG as f64 || grade_deg.abs() > UNPASSABLE_SLOPE_DEG as f64 {
        return EdgeEval::IMPASSABLE;
    }

    let trap = v.thermal_inertia_tiu < LOW_TIU_REGOLITH_THRESHOLD
        && transit_slope_deg > CRITICAL_SLOPE_THRESHOLD_DEG;
    let slip = if trap { REGOLITH_TRAP_SLIP_FRACTION } else { 0.0 };

    let speed_mps = max_speed_under_caps(
        grade_deg,
        v.thermal_inertia_tiu,
        slip,
        &weights.pace,
        hazards.dust_tau,
    );
    let power_w = pandolf_mars_metabolic_watts(grade_deg, v.thermal_inertia_tiu, speed_mps, slip);
    if !power_w.is_finite() {
        return EdgeEval::IMPASSABLE;
    }
    let delta_t_min = (dist_m / speed_mps) / 60.0;
    let o2_liters = metabolic_o2_rate_l_min(power_w) * delta_t_min;

    let svf = dose_svf(v.sky_view_factor);
    let spe_rate = hazards.spe_dose_rate_msv_h.max(0.0) as f64;
    let rad_msv = spe_rate * svf * (delta_t_min / 60.0);

    let tau = hazards.dust_tau.max(0.0) as f64;
    let wind = hazards.wind_speed_ms.max(0.0) as f64;
    let dust_cost = (tau + WIND_DRAG_BETA * wind) * delta_t_min;

    let total_cost = weights.w_metabolic * o2_liters
        + weights.w_radiation * rad_msv
        + weights.w_dust * dust_cost;

    EdgeEval {
        total_cost,
        delta_t_min,
        o2_liters,
        rad_msv,
        grade_deg,
        speed_mps,
        power_w,
    }
}

/// Evaluates the dynamic multi-criteria edge cost `C(u, v, t)` between adjacent hex cells
/// without a bearing (grade from `atan(dz / d)`). See `edge_eval`.
///
/// Returns `(total_cost, delta_t_min, o2_liters)`, infinite if the edge is impassable.
pub fn edge_cost(
    u: &HexCellState64B,
    v: &HexCellState64B,
    dist_m: f64,
    hazards: &ActiveHazards,
    weights: &CostWeights,
) -> (f64, f64, f64) {
    if dist_m < 0.0 {
        return (f64::INFINITY, f64::INFINITY, f64::INFINITY);
    }
    let e = edge_eval(u, v, dist_m, None, hazards, weights);
    (e.total_cost, e.delta_t_min, e.o2_liters)
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct DStarKey(f64, f64);

impl Eq for DStarKey {}

impl Ord for DStarKey {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .0
            .total_cmp(&self.0)
            .then_with(|| other.1.total_cmp(&self.1))
    }
}

impl PartialOrd for DStarKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HeapEntry {
    key: DStarKey,
    node: usize,
}

impl Ord for HeapEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        self.key
            .cmp(&other.key)
            .then_with(|| other.node.cmp(&self.node))
    }
}

impl PartialOrd for HeapEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[inline]
fn key_lt(a: DStarKey, b: DStarKey) -> bool {
    a.0 < b.0 || (a.0 == b.0 && a.1 < b.1)
}

/// Zero-allocation hot-loop Metabolic D* Lite planner over indexed hexagonal graph nodes `0..N`.
pub struct MetabolicDStarPlanner {
    cells: Vec<HexCellState64B>,
    adj: Vec<Vec<(usize, f64)>>,
    rev_adj: Vec<Vec<(usize, f64)>>,
    h3_to_idx: HashMap<u64, usize>,
    /// Local (east, north) position in m of each cell center (NaN for non-H3 test ids).
    pos: Vec<(f64, f64)>,
    /// Cost multiplier of every edge that enters the cell: 1 = none, `INFINITY` = excluded
    /// (impassable). Set by `set_zone_penalties` (points reported during the EVA).
    penalty: Vec<f64>,
    // Pre-allocated scratch buffers for zero-allocation replanning
    g_score: Vec<f64>,
    rhs: Vec<f64>,
    open_key: Vec<DStarKey>,
    in_open: Vec<bool>,
    heap: BinaryHeap<HeapEntry>,
    dirty_nodes: Vec<usize>,
    dirty_mark: Vec<bool>,
    // Cached search metadata for incremental D* Lite repair
    cached_goal: Option<usize>,
    cached_hazards: Option<ActiveHazards>,
    cached_weights: Option<CostWeights>,
}

impl MetabolicDStarPlanner {
    /// Creates a new planner and pre-allocates all search buffers for `0..cells.len()`.
    pub fn new(cells: Vec<HexCellState64B>, adj: Vec<Vec<(usize, f64)>>) -> Self {
        let n = cells.len();
        debug_assert_eq!(n, adj.len(), "Adjacency list length must match cell count");

        let mut h3_to_idx = HashMap::with_capacity(n);
        let mut rev_adj = vec![Vec::new(); n];

        for (u, cell) in cells.iter().enumerate() {
            h3_to_idx.insert(cell.h3_index, u);
        }
        // Local tangent plane at the fixed site reference (Base node), so that positions,
        // bearings and walked lengths do not depend on which cells the graph contains.
        let pos = cells
            .iter()
            .map(|c| {
                let (la, lo) = h3_to_lat_lon(c.h3_index);
                if la.is_finite() { local_xy(la, lo) } else { (f64::NAN, f64::NAN) }
            })
            .collect();
        for (u, neighbors) in adj.iter().enumerate() {
            for &(v, dist_m) in neighbors {
                if v < n {
                    rev_adj[v].push((u, dist_m));
                }
            }
        }

        Self {
            cells,
            adj,
            rev_adj,
            h3_to_idx,
            pos,
            penalty: vec![1.0; n],
            g_score: vec![f64::INFINITY; n],
            rhs: vec![f64::INFINITY; n],
            open_key: vec![DStarKey(f64::INFINITY, f64::INFINITY); n],
            in_open: vec![false; n],
            heap: BinaryHeap::with_capacity(n.saturating_mul(4).max(16)),
            dirty_nodes: Vec::with_capacity(n),
            dirty_mark: vec![false; n],
            cached_goal: None,
            cached_hazards: None,
            cached_weights: None,
        }
    }

    /// Bearing in degrees from North of the edge `u -> v`, if both are real H3 cells.
    #[inline]
    fn bearing_deg(&self, u: usize, v: usize) -> Option<f64> {
        let (eu, nu) = self.pos[u];
        let (ev, nv) = self.pos[v];
        let (de, dn) = (ev - eu, nv - nu);
        if de.is_finite() && dn.is_finite() && (de != 0.0 || dn != 0.0) {
            Some(de.atan2(dn).to_degrees())
        } else {
            None
        }
    }

    #[inline]
    fn eval_edge(
        &self,
        u: usize,
        v: usize,
        dist_m: f64,
        hazards: &ActiveHazards,
        weights: &CostWeights,
    ) -> EdgeEval {
        self.eval_edge_with_bearing(u, v, dist_m, self.bearing_deg(u, v), hazards, weights)
    }

    /// `edge_eval` plus the zone penalty of the destination cell (`set_zone_penalties`): an
    /// excluded cell is impassable, a penalized one multiplies only the planner cost (time,
    /// O2 and dose of the edge are physical and do not change).
    #[inline]
    fn eval_edge_with_bearing(
        &self,
        u: usize,
        v: usize,
        dist_m: f64,
        bearing_deg: Option<f64>,
        hazards: &ActiveHazards,
        weights: &CostWeights,
    ) -> EdgeEval {
        let p = self.penalty[v];
        if !p.is_finite() {
            return EdgeEval::IMPASSABLE;
        }
        let mut e = edge_eval(&self.cells[u], &self.cells[v], dist_m, bearing_deg, hazards, weights);
        if p != 1.0 {
            e.total_cost *= p;
        }
        e
    }

    /// Replaces the zone penalties (reported hazard points). Every cell whose center is closer
    /// than `exclusion_radius_m` to a zone center is excluded; closer than `caution_radius_m`,
    /// its incoming edges cost `caution_factor` times more. Overlapping zones keep the largest
    /// penalty. Changed cells are marked dirty, so the next `plan_path` to the same goal repairs
    /// the search incrementally (D* Lite). Returns the number of excluded and penalized cells.
    pub fn set_zone_penalties(&mut self, zones: &[ZonePenalty]) -> (usize, usize) {
        let centers: Vec<(f64, f64)> = zones
            .iter()
            .map(|z| local_xy(z.lat_deg, z.lon_e_deg))
            .collect();
        let (mut excluded, mut penalized) = (0, 0);
        for i in 0..self.cells.len() {
            let (x, y) = self.pos[i];
            let mut p: f64 = 1.0;
            if x.is_finite() {
                for (z, &(cx, cy)) in zones.iter().zip(&centers) {
                    let d = (x - cx).hypot(y - cy);
                    if d < z.exclusion_radius_m {
                        p = f64::INFINITY;
                    } else if d < z.caution_radius_m {
                        p = p.max(z.caution_factor.max(1.0));
                    }
                }
            }
            if !p.is_finite() {
                excluded += 1;
            } else if p > 1.0 {
                penalized += 1;
            }
            if p != self.penalty[i] {
                self.penalty[i] = p;
                self.mark_dirty(i);
            }
        }
        (excluded, penalized)
    }

    /// True if the cell is inside an exclusion zone (`set_zone_penalties`).
    pub fn is_excluded(&self, h3: u64) -> bool {
        self.h3_to_idx
            .get(&h3)
            .is_some_and(|&i| !self.penalty[i].is_finite())
    }

    fn mark_dirty(&mut self, idx: usize) {
        if !self.dirty_mark[idx] {
            self.dirty_mark[idx] = true;
            self.dirty_nodes.push(idx);
        }
        for k in 0..self.rev_adj[idx].len() {
            let p = self.rev_adj[idx][k].0;
            if !self.dirty_mark[p] {
                self.dirty_mark[p] = true;
                self.dirty_nodes.push(p);
            }
        }
    }

    /// Evaluates the straight leg between cells `a` and `b` along the H3 grid line, or `None`
    /// if a cell is missing from the graph or a step is impassable.
    fn straight_leg(
        &self,
        a: usize,
        b: usize,
        hazards: &ActiveHazards,
        weights: &CostWeights,
    ) -> Option<(Vec<(usize, EdgeEval)>, f64)> {
        let line = grid_line_h3(self.cells[a].h3_index, self.cells[b].h3_index)?;
        let idx: Vec<usize> = line
            .iter()
            .map(|h| self.h3_to_idx.get(h).copied())
            .collect::<Option<_>>()?;
        let (ea, na) = self.pos[a];
        let (eb, nb) = self.pos[b];
        let (de, dn) = (eb - ea, nb - na);
        let length = de.hypot(dn);
        if !length.is_finite() || idx.len() < 2 {
            return None;
        }
        let bearing = de.atan2(dn).to_degrees();
        let step = length / (idx.len() - 1) as f64;
        let mut out = Vec::with_capacity(idx.len() - 1);
        let mut cost = 0.0;
        for w in idx.windows(2) {
            let e = self.eval_edge_with_bearing(w[0], w[1], step, Some(bearing), hazards, weights);
            if !e.total_cost.is_finite() {
                return None;
            }
            cost += e.total_cost;
            out.push((w[1], e));
        }
        Some((out, cost))
    }

    /// Builds the walked route from the D* Lite cell chain (string-pulling) and its metrics.
    fn finalize_path(
        &self,
        raw: &[(usize, f64)],
        hazards: &ActiveHazards,
        weights: &CostWeights,
    ) -> PathResult {
        let path_h3: Vec<u64> = raw.iter().map(|&(i, _)| self.cells[i].h3_index).collect();
        let raw_steps: Vec<(usize, EdgeEval)> = raw
            .windows(2)
            .map(|w| (w[1].0, self.eval_edge(w[0].0, w[1].0, w[1].1, hazards, weights)))
            .collect();
        let raw_length_m: f64 = raw.iter().skip(1).map(|&(_, d)| d).sum();
        let mut prefix = Vec::with_capacity(raw.len());
        prefix.push(0.0);
        for (_, e) in &raw_steps {
            prefix.push(prefix.last().unwrap() + e.total_cost);
        }

        let smoothable = raw.iter().all(|&(i, _)| self.pos[i].0.is_finite());
        let mut steps: Vec<(usize, EdgeEval, f64)> = Vec::new();
        let mut corners = vec![raw[0].0];
        let last = raw.len() - 1;
        let mut i = 0;
        while i < last {
            let mut best = i + 1;
            let mut best_leg: Option<Vec<(usize, EdgeEval)>> = None;
            if smoothable {
                // Farthest chain cell reachable by a valid straight leg: scan from the far end
                // and stop at the first accepted one.
                for j in ((i + 2)..=last).rev() {
                    if let Some((leg, cost)) = self.straight_leg(raw[i].0, raw[j].0, hazards, weights) {
                        if cost <= (prefix[j] - prefix[i]) * (1.0 + 1e-9) {
                            best = j;
                            best_leg = Some(leg);
                            break;
                        }
                    }
                }
            }
            match best_leg {
                Some(leg) => {
                    let n = leg.len() as f64;
                    let (ea, na) = self.pos[raw[i].0];
                    let (eb, nb) = self.pos[raw[best].0];
                    let step = (eb - ea).hypot(nb - na) / n;
                    steps.extend(leg.into_iter().map(|(v, e)| (v, e, step)));
                }
                None => {
                    let (v, e) = raw_steps[i];
                    steps.push((v, e, raw[i + 1].1));
                }
            }
            corners.push(raw[best].0);
            i = best;
        }

        let (mut cost, mut t, mut o2, mut rad, mut dist) = (0.0, 0.0, 0.0, 0.0, 0.0);
        let mut profile = Vec::with_capacity(steps.len());
        for (v, e, step_m) in steps {
            cost += e.total_cost;
            t += e.delta_t_min;
            o2 += e.o2_liters;
            rad += e.rad_msv;
            dist += step_m;
            profile.push(PathSample {
                h3: self.cells[v].h3_index,
                step_m,
                cum_dist_m: dist,
                cum_time_min: t,
                grade_deg: e.grade_deg,
                speed_mps: e.speed_mps,
                power_w: e.power_w,
            });
        }
        PathResult {
            path_h3,
            total_cost: cost,
            estimated_time_min: t,
            estimated_o2_liters: o2,
            estimated_rad_msv: rad,
            raw_length_m,
            length_m: dist,
            smoothed_h3: corners.iter().map(|&i| self.cells[i].h3_index).collect(),
            profile,
        }
    }

    #[inline]
    fn calculate_key(&self, u: usize) -> DStarKey {
        let m = self.g_score[u].min(self.rhs[u]);
        DStarKey(m, m)
    }

    fn update_vertex(
        &mut self,
        u: usize,
        goal_idx: usize,
        hazards: &ActiveHazards,
        weights: &CostWeights,
    ) {
        if u != goal_idx {
            let mut best_rhs = f64::INFINITY;
            for &(v, dist_m) in &self.adj[u] {
                let gv = self.g_score[v];
                if !gv.is_finite() {
                    continue;
                }
                let c = self.eval_edge(u, v, dist_m, hazards, weights).total_cost;
                if c.is_finite() {
                    let cand = c + gv;
                    if cand < best_rhs {
                        best_rhs = cand;
                    }
                }
            }
            self.rhs[u] = best_rhs;
        }

        if self.g_score[u] != self.rhs[u] {
            let k = self.calculate_key(u);
            if !self.in_open[u] || self.open_key[u] != k {
                self.open_key[u] = k;
                self.in_open[u] = true;
                self.heap.push(HeapEntry { key: k, node: u });
            }
        } else {
            self.in_open[u] = false;
        }
    }

    fn compute_shortest_path(
        &mut self,
        start_idx: usize,
        goal_idx: usize,
        hazards: &ActiveHazards,
        weights: &CostWeights,
    ) {
        while let Some(&top) = self.heap.peek() {
            if !self.in_open[top.node] || top.key != self.open_key[top.node] {
                self.heap.pop();
                continue;
            }

            let start_key = self.calculate_key(start_idx);
            let rhs_ne_g = self.rhs[start_idx] != self.g_score[start_idx];
            if !key_lt(top.key, start_key) && !rhs_ne_g {
                break;
            }

            self.heap.pop();
            let u = top.node;
            let k_old = top.key;
            let k_new = self.calculate_key(u);

            if key_lt(k_old, k_new) {
                self.open_key[u] = k_new;
                self.in_open[u] = true;
                self.heap.push(HeapEntry { key: k_new, node: u });
            } else if self.g_score[u] > self.rhs[u] {
                self.g_score[u] = self.rhs[u];
                self.in_open[u] = false;
                let pred_count = self.rev_adj[u].len();
                for i in 0..pred_count {
                    let p = self.rev_adj[u][i].0;
                    self.update_vertex(p, goal_idx, hazards, weights);
                }
            } else {
                self.g_score[u] = f64::INFINITY;
                self.in_open[u] = false;
                self.update_vertex(u, goal_idx, hazards, weights);
                let pred_count = self.rev_adj[u].len();
                for i in 0..pred_count {
                    let p = self.rev_adj[u][i].0;
                    self.update_vertex(p, goal_idx, hazards, weights);
                }
            }
        }
    }

    fn reset_search_state(&mut self, goal_idx: usize, hazards: &ActiveHazards, weights: &CostWeights) {
        self.g_score.fill(f64::INFINITY);
        self.rhs.fill(f64::INFINITY);
        self.in_open.fill(false);
        self.heap.clear();
        for &d in &self.dirty_nodes {
            self.dirty_mark[d] = false;
        }
        self.dirty_nodes.clear();

        self.rhs[goal_idx] = 0.0;
        let k = DStarKey(0.0, 0.0);
        self.open_key[goal_idx] = k;
        self.in_open[goal_idx] = true;
        self.heap.push(HeapEntry {
            key: k,
            node: goal_idx,
        });

        self.cached_goal = Some(goal_idx);
        self.cached_hazards = Some(hazards.clone());
        self.cached_weights = Some(*weights);
    }

    /// Updates a cell's terrain/hazard attributes and marks incident vertices dirty
    /// for incremental D* Lite repair on the next `plan_path` call.
    pub fn update_cell_hazard(&mut self, h3: u64, updated_cell: HexCellState64B) {
        if let Some(&idx) = self.h3_to_idx.get(&h3) {
            self.cells[idx] = updated_cell;
            self.mark_dirty(idx);
        }
    }

    /// Plans or incrementally repairs the optimal metabolic/radiation/dust route
    /// from `start_h3` to `goal_h3`.
    pub fn plan_path(
        &mut self,
        start_h3: u64,
        goal_h3: u64,
        hazards: &ActiveHazards,
        weights: &CostWeights,
    ) -> Option<PathResult> {
        let start_idx = *self.h3_to_idx.get(&start_h3)?;
        let goal_idx = *self.h3_to_idx.get(&goal_h3)?;

        if start_idx == goal_idx {
            return Some(PathResult {
                path_h3: vec![start_h3],
                total_cost: 0.0,
                estimated_time_min: 0.0,
                estimated_o2_liters: 0.0,
                estimated_rad_msv: 0.0,
                raw_length_m: 0.0,
                length_m: 0.0,
                smoothed_h3: vec![start_h3],
                profile: Vec::new(),
            });
        }

        let can_repair_incrementally = self.cached_goal == Some(goal_idx)
            && self.cached_hazards.as_ref() == Some(hazards)
            && self.cached_weights.as_ref() == Some(weights);

        if can_repair_incrementally {
            let dirty_len = self.dirty_nodes.len();
            for i in 0..dirty_len {
                let u = self.dirty_nodes[i];
                self.dirty_mark[u] = false;
                self.update_vertex(u, goal_idx, hazards, weights);
            }
            self.dirty_nodes.clear();
        } else {
            self.reset_search_state(goal_idx, hazards, weights);
        }

        self.compute_shortest_path(start_idx, goal_idx, hazards, weights);

        if !self.g_score[start_idx].is_finite() {
            return None;
        }

        let n = self.cells.len();
        let mut raw: Vec<(usize, f64)> = Vec::with_capacity(n.min(256));
        raw.push((start_idx, 0.0));
        let mut cur = start_idx;
        for _ in 0..n {
            if cur == goal_idx {
                return Some(self.finalize_path(&raw, hazards, weights));
            }
            let mut best: Option<(usize, f64)> = None;
            let mut best_f = f64::INFINITY;
            for &(v, dist_m) in &self.adj[cur] {
                let gv = self.g_score[v];
                if !gv.is_finite() {
                    continue;
                }
                let c = self.eval_edge(cur, v, dist_m, hazards, weights).total_cost;
                if c.is_finite() && c + gv < best_f {
                    best_f = c + gv;
                    best = Some((v, dist_m));
                }
            }
            let (next, dist_m) = best?;
            raw.push((next, dist_m));
            cur = next;
        }

        None
    }

    /// Evaluates the Walkback Limit Dual and applies the deterministic Dynamic Goal Switching
    /// rule, returning every figure the decision uses (single source for decision and display).
    ///
    /// Radiation model (one model, used by the edge cost, the route projection and `T_vital`):
    /// SPE dose rate = `hazards.spe_dose_rate_msv_h` (the envelope the suit measures at the
    /// alert; it cannot predict the ramp) x the Sky View Factor of each cell (missing SVF = open
    /// sky). Routes: sustained-return pace to the Base, emergency-escape pace to the shelter.
    pub fn evaluate_walkback_detailed(
        &mut self,
        current_h3: u64,
        base_h3: u64,
        wp3_shelter_h3: u64,
        telemetry: &PlssTelemetry,
        hazards: &ActiveHazards,
    ) -> WalkbackDecision {
        let return_weights = CostWeights::default();
        let escape_weights = CostWeights::emergency_escape();

        let o2_rate = (telemetry.current_o2_rate_l_min as f64).max(0.05);
        let t_o2_min = (telemetry.o2_remaining_liters.max(0.0) as f64) / o2_rate;
        let t_lcvg_min = telemetry.lcvg_water_remaining_min.max(0.0) as f64;
        let t_batt_min = telemetry.battery_remaining_min.max(0.0) as f64;

        let remaining_rad_budget =
            (telemetry.mission_rad_limit_msv - telemetry.cumulative_rad_msv).max(0.0) as f64;
        let current_svf = self
            .h3_to_idx
            .get(&current_h3)
            .map(|&idx| dose_svf(self.cells[idx].sky_view_factor))
            .unwrap_or(1.0);
        let local_rad_rate_msv_h = (hazards.spe_dose_rate_msv_h.max(0.0) as f64) * current_svf;
        let t_rad_min = if local_rad_rate_msv_h > 1e-6 {
            (remaining_rad_budget / local_rad_rate_msv_h) * 60.0
        } else {
            f64::INFINITY
        };

        let t_vital = t_o2_min.min(t_lcvg_min).min(t_batt_min).min(t_rad_min);

        let base_path = self.plan_path(current_h3, base_h3, hazards, &return_weights);
        let wp3_path = self.plan_path(current_h3, wp3_shelter_h3, hazards, &escape_weights);

        let t_walkback_base = base_path
            .as_ref()
            .map(|p| p.estimated_time_min)
            .unwrap_or(f64::INFINITY);
        let t_walkback_shelter = wp3_path
            .as_ref()
            .map(|p| p.estimated_time_min)
            .unwrap_or(f64::INFINITY);
        let rad_to_base = base_path
            .as_ref()
            .map(|p| p.estimated_rad_msv)
            .unwrap_or(f64::INFINITY);
        let rad_to_wp3 = wp3_path
            .as_ref()
            .map(|p| p.estimated_rad_msv)
            .unwrap_or(f64::INFINITY);

        let safety_factor = WALKBACK_SAFETY_FACTOR as f64;
        let spe_critical = (hazards.spe_dose_rate_msv_h as f64) > SPE_CRITICAL_RATE_MSV_H as f64;

        let time_switch =
            t_walkback_base > safety_factor * t_vital && t_walkback_shelter < t_walkback_base;
        let rad_switch = rad_to_base > remaining_rad_budget
            && rad_to_wp3 < RADIATION_SWITCH_RATIO * rad_to_base
            && spe_critical;
        let switch_to_shelter = time_switch || rad_switch;

        let base_feasible = base_path.is_some()
            && t_walkback_base <= safety_factor * t_vital
            && !(rad_to_base > remaining_rad_budget && spe_critical);

        let active_target = if switch_to_shelter {
            TargetGoal::Wp3Shelter
        } else {
            TargetGoal::BaseHabitat
        };

        WalkbackDecision {
            status: WalkbackDualStatus {
                t_vital_min: t_vital as f32,
                t_walkback_base_min: t_walkback_base as f32,
                t_walkback_shelter_min: t_walkback_shelter as f32,
                active_target,
                dynamic_goal_switched: switch_to_shelter,
                base_feasible,
            },
            t_vital_min: t_vital,
            t_vital_o2_min: t_o2_min,
            t_vital_lcvg_min: t_lcvg_min,
            t_vital_battery_min: t_batt_min,
            t_vital_radiation_min: t_rad_min,
            current_cell_svf: current_svf,
            remaining_rad_budget_msv: remaining_rad_budget,
            safety_factor,
            radiation_switch_ratio: RADIATION_SWITCH_RATIO,
            time_switch,
            rad_switch,
            base_path,
            wp3_path,
        }
    }

    /// Walkback Limit Dual and Dynamic Goal Switching (see `evaluate_walkback_detailed`);
    /// returns the status and the selected route.
    pub fn evaluate_walkback_and_switch(
        &mut self,
        current_h3: u64,
        base_h3: u64,
        wp3_shelter_h3: u64,
        telemetry: &PlssTelemetry,
        hazards: &ActiveHazards,
    ) -> (WalkbackDualStatus, Option<PathResult>) {
        let d = self.evaluate_walkback_detailed(current_h3, base_h3, wp3_shelter_h3, telemetry, hazards);
        let selected = if d.status.dynamic_goal_switched {
            d.wp3_path
        } else {
            d.base_path
        };
        (d.status, selected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cell(
        h3_index: u64,
        elev_m: f32,
        slope_deg: f32,
        tiu: f32,
        svf: f32,
    ) -> HexCellState64B {
        HexCellState64B {
            h3_index,
            elev_m,
            slope_deg,
            aspect_deg: 0.0,
            thermal_inertia_tiu: tiu,
            roughness_hi: 0.1,
            isru_h2o_pct: 0.0,
            sky_view_factor: svf,
            los_base_rssi_dbm: -80.0,
            base_metabolic_cost: 280.0,
            horizon_hash_id: 0,
            hazard_bitmask: 0,
            padding_crc: [0u8; 14],
        }
    }

    fn nominal_hazards() -> ActiveHazards {
        ActiveHazards {
            h1_dust_storm: false,
            h2_spe_radiation: false,
            h3_regolith_slope: false,
            h4_nlos_offline: false,
            dust_tau: 0.4,
            wind_speed_ms: 4.0,
            spe_dose_rate_msv_h: 0.0,
            rssi_dbm: -75.0,
        }
    }

    #[test]
    fn test_soil_sinkage_eta_values() {
        // Reference bands: 1.0 (> 400 TIU), 1.3 (250-400), 1.6 (150-250), 2.1 (< 150).
        assert!((soil_sinkage_eta(420.0) - 1.0).abs() < 1e-9);
        assert!((soil_sinkage_eta(400.0) - 1.3).abs() < 1e-9);
        // Exact boundaries follow the pipeline's `eta_from_tiu` (softer band): 250 -> 1.6, 150 -> 1.6.
        assert!((soil_sinkage_eta(250.0) - 1.6).abs() < 1e-9);
        assert!((soil_sinkage_eta(250.1) - 1.3).abs() < 1e-9);
        assert!((soil_sinkage_eta(150.0) - 1.6).abs() < 1e-9);
        assert!((soil_sinkage_eta(149.9) - 2.1).abs() < 1e-9);
        // Pipeline validator: level ground at 1.0 m/s on exactly 250 TIU = 408.43 W.
        assert!((pandolf_mars_metabolic_watts(0.0, 250.0, 1.0, 0.0) - 408.433).abs() < 1e-3);
        assert!((soil_sinkage_eta(320.0) - 1.3).abs() < 1e-9);
        assert!((soil_sinkage_eta(200.0) - 1.6).abs() < 1e-9);
        let eta_wp2_regolith = soil_sinkage_eta(110.0);
        assert!(
            (eta_wp2_regolith - 2.1).abs() < 1e-9,
            "Expected 110 TIU regolith eta 2.1, got {eta_wp2_regolith}"
        );
    }

    #[test]
    fn test_no_data_cells_have_explicit_costs() {
        use red_atlas_shared::CELL_NO_DATA;
        // Missing TIU: mid band (eta 1.3), not the softest band (2.1).
        assert!((soil_sinkage_eta(CELL_NO_DATA) - 1.3).abs() < 1e-9);
        assert!((soil_sinkage_eta(CELL_NO_DATA) - soil_sinkage_eta(TIU_NO_DATA_ASSUMED)).abs() < 1e-12);

        let weights = CostWeights::default();
        let mut hazards = nominal_hazards();
        hazards.spe_dose_rate_msv_h = red_atlas_shared::SPE_PEAK_ENVELOPE_MSV_H;
        let u = make_cell(1, 0.0, 2.0, 400.0, 0.85);

        // Missing elevation on either end: unpassable, never NaN.
        let v_no_elev = make_cell(2, CELL_NO_DATA, 2.0, 400.0, 0.85);
        assert!(edge_cost(&u, &v_no_elev, 10.0, &hazards, &weights).0.is_infinite());
        assert!(edge_cost(&v_no_elev, &u, 10.0, &hazards, &weights).0.is_infinite());

        // Missing TIU / SVF / slope: finite costs equal to the documented assumptions.
        let v_no_tiu = make_cell(3, 0.0, 2.0, CELL_NO_DATA, 0.85);
        let v_mid_tiu = make_cell(4, 0.0, 2.0, TIU_NO_DATA_ASSUMED, 0.85);
        let (c_nan, t_nan, _) = edge_cost(&u, &v_no_tiu, 10.0, &hazards, &weights);
        let (c_mid, t_mid, _) = edge_cost(&u, &v_mid_tiu, 10.0, &hazards, &weights);
        assert!(c_nan.is_finite() && (c_nan - c_mid).abs() < 1e-12 && (t_nan - t_mid).abs() < 1e-12);

        // A missing TIU on a steep edge never triggers the regolith trap slowdown.
        // (dz 4 m over 10 m = 21.8 deg, above the 20 deg trap slope.)
        let steep_nan = make_cell(5, 4.0, 22.0, CELL_NO_DATA, 0.85);
        let steep_trap = make_cell(9, 4.0, 22.0, 110.0, 0.85);
        let mut trap_hazards = hazards.clone();
        trap_hazards.h3_regolith_slope = true;
        let (_, t_steep, _) = edge_cost(&u, &steep_nan, 10.0, &trap_hazards, &weights);
        let (_, t_trap, _) = edge_cost(&u, &steep_trap, 10.0, &trap_hazards, &weights);
        let grade = (4.0f64 / 10.0).atan().to_degrees();
        let v_free = max_speed_under_caps(grade, TIU_NO_DATA_ASSUMED, 0.0, &weights.pace, hazards.dust_tau);
        let t_free = (10.0 / v_free) / 60.0;
        assert!((t_steep - t_free).abs() < 1e-9, "{t_steep} vs {t_free}");
        assert!(t_trap > t_steep * 1.3, "110 TIU must still trigger the trap (slip + eta 2.1)");

        let v_no_svf = make_cell(6, 0.0, 2.0, 400.0, CELL_NO_DATA);
        let v_open = make_cell(7, 0.0, 2.0, 400.0, SVF_NO_DATA_ASSUMED);
        let (c_svf, _, _) = edge_cost(&u, &v_no_svf, 10.0, &hazards, &weights);
        let (c_open, _, _) = edge_cost(&u, &v_open, 10.0, &hazards, &weights);
        assert!(c_svf.is_finite() && (c_svf - c_open).abs() < 1e-12);

        let v_no_slope = make_cell(8, 0.0, CELL_NO_DATA, 400.0, 0.85);
        let (c_slope, _, _) = edge_cost(&u, &v_no_slope, 10.0, &hazards, &weights);
        assert!(c_slope.is_finite());
    }

    #[test]
    fn test_pace_rule_speed_and_power_caps() {
        use red_atlas_shared::{
            DUST_TAU_STORM, ESCAPE_POWER_CAP_W, ESCAPE_SPEED_CAP_MPS, RETURN_POWER_CAP_W,
        };
        // Downhill escape on firm ground: the speed cap binds (no climbing term).
        let v = max_speed_under_caps(-5.0, 365.0, 0.0, &PACE_EMERGENCY_ESCAPE, DUST_TAU_STORM);
        assert!((v - ESCAPE_SPEED_CAP_MPS).abs() < 1e-12);
        // Steep climb: the power cap binds and the model returns exactly the cap.
        let v = max_speed_under_caps(15.0, 365.0, 0.0, &PACE_EMERGENCY_ESCAPE, DUST_TAU_STORM);
        assert!(v < ESCAPE_SPEED_CAP_MPS);
        assert!((pandolf_mars_metabolic_watts(15.0, 365.0, v, 0.0) - ESCAPE_POWER_CAP_W).abs() < 1e-6);
        // Reference post-peak pace on the WP2 ramp (22 deg, 110 TIU, s 0.30) regulated to 585 W: 0.268 m/s.
        let v = max_speed_under_caps(22.0, 110.0, 0.30, &PACE_SUSTAINED_RETURN, 0.4);
        assert!((v - 0.268).abs() < 0.001, "{v}");
        assert!((pandolf_mars_metabolic_watts(22.0, 110.0, v, 0.30) - RETURN_POWER_CAP_W).abs() < 1e-6);
        // Sustained return in the storm: visibility lowers the 1.0 m/s cap to 0.78 m/s.
        let v = max_speed_under_caps(0.0, 365.0, 0.0, &PACE_SUSTAINED_RETURN, DUST_TAU_STORM);
        assert!((v - dust_visibility_factor(DUST_TAU_STORM)).abs() < 1e-12 && v < 0.78);
    }

    #[test]
    fn test_pandolf_flat_basalt_vs_wp2_regolith_trap() {
        // Reference values: flat firm ground at 1.0 m/s = 300 W (0.90 L/min).
        let flat_watts = pandolf_mars_metabolic_watts(0.0, 420.0, 1.0, 0.0);
        let flat_o2 = metabolic_o2_rate_l_min(flat_watts);
        assert!(
            (flat_watts - 300.0).abs() < 1.0,
            "Flat basalt watts should be ~300 W, got {flat_watts}"
        );
        assert!(
            (flat_o2 - 0.90).abs() < 0.01,
            "Flat basalt O2 rate should be ~0.90 L/min, got {flat_o2}"
        );

        // Shared canonical peak: WP2 22 deg, 110 TIU, 0.55 m/s, 30% slip = 1073 W = 3.2 L/min.
        let wp2_watts = pandolf_mars_metabolic_watts(
            22.0,
            110.0,
            red_atlas_shared::WP2_TRAVERSE_SPEED_MPS,
            red_atlas_shared::WP2_SLIP_FRACTION,
        );
        let wp2_o2 = metabolic_o2_rate_l_min(wp2_watts);
        assert!(
            (wp2_watts - 1073.0).abs() < 1.0,
            "WP2 22 deg / 110 TIU watts should be ~1073 W, got {wp2_watts}"
        );
        assert!(
            (wp2_o2 - 3.2).abs() < 0.01,
            "WP2 O2 rate should be 3.2 L/min, got {wp2_o2}"
        );

        // Downhill earns no climbing credit: a descent costs the same as level walking.
        let descent = pandolf_mars_metabolic_watts(-25.0, 420.0, 1.0, 0.0);
        assert!((descent - flat_watts).abs() < 1e-9);
        // Reference escape to WP3 at 1.25 m/s downhill: 593.2 W on the 110 TIU bank, 412.9 W after.
        assert!((pandolf_mars_metabolic_watts(-5.26, 110.0, 1.25, 0.0) - 593.2).abs() < 0.1);
        assert!((pandolf_mars_metabolic_watts(-5.26, 365.0, 1.25, 0.0) - 412.9).abs() < 0.1);
    }

    /// The walked (string-pulled) route must never cross a cell that is too steep or has no
    /// elevation, even when the straight line between start and goal does.
    #[test]
    fn test_smoothed_route_never_crosses_blocked_cells() {
        use crate::h3_mars_grid::{haversine_dist_m, k_ring, lat_lon_to_h3, H3MarsGrid};
        use red_atlas_shared::{CELL_NO_DATA, SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG};
        use std::collections::HashSet;

        let center = lat_lon_to_h3(SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG, 12);
        let (lat0, lon0) = h3_to_lat_lon(center);
        // Local (east, north) offsets in m of a cell center.
        let offset = |h: u64| {
            let (la, lo) = h3_to_lat_lon(h);
            (
                haversine_dist_m(lat0, lon0, lat0, lo) * (lo - lon0).signum(),
                haversine_dist_m(lat0, lon0, la, lon0) * (la - lat0).signum(),
            )
        };
        let patch = k_ring(center, 25);
        let nearest = |e: f64, n: f64| {
            *patch
                .iter()
                .min_by(|a, b| {
                    let (da, db) = (offset(**a), offset(**b));
                    ((da.0 - e).hypot(da.1 - n)).total_cmp(&(db.0 - e).hypot(db.1 - n))
                })
                .unwrap()
        };
        for no_elevation in [false, true] {
            let mut grid = H3MarsGrid::new(12);
            let mut wall = HashSet::new();
            for &h in &patch {
                let (east, north) = offset(h);
                let mut cell = make_cell(h, -1660.0, 3.0, 420.0, 0.85);
                cell.aspect_deg = 90.0;
                // N-S wall across the patch, open only at its northern end.
                if east.abs() < 12.0 && north < 120.0 {
                    wall.insert(h);
                    if no_elevation {
                        cell.elev_m = CELL_NO_DATA;
                    } else {
                        cell.slope_deg = 35.0;
                    }
                }
                grid.insert(cell);
            }
            let (cells, adj) = grid.planner_graph();
            let mut planner = MetabolicDStarPlanner::new(cells, adj);
            let (start, goal) = (nearest(-150.0, -60.0), nearest(150.0, -60.0));
            let path = planner
                .plan_path(start, goal, &nominal_hazards(), &CostWeights::default())
                .expect("a route around the wall exists");
            assert!(path.smoothed_h3.len() > 2, "the straight line is blocked: corners expected");
            assert!(path.length_m > 400.0 && path.length_m <= path.raw_length_m + 1e-6);
            assert!(path.path_h3.iter().all(|h| !wall.contains(h)));
            assert!(
                path.profile.iter().all(|s| !wall.contains(&s.h3)),
                "walked route crosses the wall (no_elevation = {no_elevation})"
            );
            assert_eq!(path.profile.last().map(|s| s.h3), Some(goal));
        }
    }

    #[test]
    fn test_edge_cost_unpassable_and_svf_attenuation() {
        let weights = CostWeights::default();
        let mut hazards = nominal_hazards();
        hazards.h2_spe_radiation = true;
        hazards.spe_dose_rate_msv_h = red_atlas_shared::SPE_PEAK_ENVELOPE_MSV_H;

        let u = make_cell(1, 0.0, 2.0, 400.0, 0.85);
        let v_cliff = make_cell(2, 65.0, 33.0, 400.0, 0.5);
        let (cliff_cost, _, _) = edge_cost(&u, &v_cliff, 100.0, &hazards, &weights);
        assert!(cliff_cost.is_infinite(), "Slope > 30 deg must be unpassable");

        let v_open = make_cell(3, 0.0, 0.0, 400.0, 1.0);
        let v_wp3 = make_cell(4, 0.0, 0.0, 400.0, 0.15);

        let (cost_open, dt_open, o2_open) = edge_cost(&u, &v_open, 100.0, &hazards, &weights);
        let (cost_wp3, dt_wp3, o2_wp3) = edge_cost(&u, &v_wp3, 100.0, &hazards, &weights);

        assert!((dt_open - dt_wp3).abs() < 1e-9);
        assert!((o2_open - o2_wp3).abs() < 1e-9);

        let rad_open = (cost_open - weights.w_metabolic * o2_open) / weights.w_radiation;
        let rad_wp3 = (cost_wp3 - weights.w_metabolic * o2_wp3) / weights.w_radiation;
        // Both have identical dust cost, so difference isolates the 85% SVF radiation reduction.
        let dust_diff = rad_open - rad_wp3;
        let expected_rad_diff = (red_atlas_shared::SPE_PEAK_ENVELOPE_MSV_H as f64)
            * (1.0 - 0.15)
            * (dt_open / 60.0);
        assert!(
            (dust_diff - expected_rad_diff).abs() < 1e-6,
            "WP3 SVF=0.15 must attenuate SPE radiation by 85%"
        );
    }

    #[test]
    fn test_incremental_dstar_repairs_hazard_update() {
        // Diamond graph: 0 -> 1 -> 3 (initially 150m total) vs 0 -> 2 -> 3 (220m total).
        let cells = vec![
            make_cell(100, 0.0, 0.0, 420.0, 0.75),
            make_cell(101, 0.0, 1.0, 420.0, 0.75),
            make_cell(102, 0.0, 1.0, 420.0, 0.75),
            make_cell(103, 0.0, 0.0, 420.0, 0.75),
        ];
        let adj = vec![
            vec![(1, 75.0), (2, 110.0)],
            vec![(3, 75.0)],
            vec![(3, 110.0)],
            vec![],
        ];
        let mut planner = MetabolicDStarPlanner::new(cells, adj);
        let hazards = nominal_hazards();
        let weights = CostWeights::default();

        let p1 = planner
            .plan_path(100, 103, &hazards, &weights)
            .expect("initial path must exist");
        assert_eq!(p1.path_h3, vec![100, 101, 103]);

        // Cell 101 suffers a fault rockslide (slope 34 deg > UNPASSABLE_SLOPE_DEG).
        let blocked = make_cell(101, 0.0, 34.0, 420.0, 0.75);
        planner.update_cell_hazard(101, blocked);

        let p2 = planner
            .plan_path(100, 103, &hazards, &weights)
            .expect("detour path via 102 must exist");
        assert_eq!(p2.path_h3, vec![100, 102, 103]);
    }

    #[test]
    fn test_t105_multi_hazard_dynamic_goal_switching_to_wp3() {
        // Nodes:
        // 0 = Base Habitat (2880 m from WP2 via node 1)
        // 1 = Canyon Midpoint East (SVF 0.75)
        // 2 = WP2 Fault Slope (current EVA-07 location: 110 TIU, 22 deg, SVF 0.75)
        // 3 = Escarpment Corridor (firm basalt 400 TIU, SVF 0.30, 300m from WP2)
        // 4 = WP3 Cliff Shelter (firm basalt 420 TIU, SVF 0.15, 300m from node 3 -> 600m total)
        let cells = vec![
            make_cell(10, 0.0, 0.0, 420.0, 0.75),
            make_cell(11, 0.0, 2.0, 390.0, 0.75),
            make_cell(12, 0.0, 22.0, 110.0, 0.75),
            make_cell(13, 0.0, 3.0, 400.0, 0.30),
            make_cell(14, 0.0, 1.0, 420.0, 0.15),
        ];
        let adj = vec![
            vec![(1, 1440.0)],
            vec![(0, 1440.0), (2, 1440.0)],
            vec![(1, 1440.0), (3, 300.0)],
            vec![(2, 300.0), (4, 300.0)],
            vec![(3, 300.0)],
        ];

        let mut planner = MetabolicDStarPlanner::new(cells, adj);

        // Nominal state before T+105: plenty of O2, water, battery, no SPE.
        let nominal_telemetry = PlssTelemetry {
            timestamp_s: 3600.0,
            o2_remaining_liters: 180.0,
            lcvg_water_remaining_min: 180.0,
            battery_remaining_min: 200.0,
            current_o2_rate_l_min: 1.0,
            cumulative_rad_msv: 0.0,
            mission_rad_limit_msv: red_atlas_shared::EVA_SPE_DOSE_BUDGET_MSV,
            heart_rate_bpm: 110,
        };
        let (status_nom, path_nom) = planner.evaluate_walkback_and_switch(
            12,
            10,
            14,
            &nominal_telemetry,
            &nominal_hazards(),
        );
        assert_eq!(status_nom.active_target, TargetGoal::BaseHabitat);
        assert!(!status_nom.dynamic_goal_switched);
        assert!(status_nom.base_feasible);
        assert_eq!(path_nom.expect("base path").path_h3.last().copied(), Some(10));

        // T+105 min 4-hazard scenario:
        // H1 dust tau=2.4 + wind 28 m/s, H2 SPE 8 mSv/h (design envelope peak), H3 110 TIU/22 deg,
        // H4 NLOS -125 dBm.
        let t105_hazards = ActiveHazards {
            h1_dust_storm: true,
            h2_spe_radiation: true,
            h3_regolith_slope: true,
            h4_nlos_offline: true,
            dust_tau: red_atlas_shared::DUST_TAU_STORM,
            wind_speed_ms: 28.0,
            spe_dose_rate_msv_h: red_atlas_shared::SPE_PEAK_ENVELOPE_MSV_H,
            rssi_dbm: -125.0,
        };
        let t105_telemetry = PlssTelemetry {
            timestamp_s: 6300.0,
            o2_remaining_liters: 95.0,
            lcvg_water_remaining_min: 75.0,
            battery_remaining_min: 90.0,
            current_o2_rate_l_min: 3.2,
            cumulative_rad_msv: 0.0,
            // Full 2 mSv SPE budget remaining -> 20 min at SVF=0.75 under 8 mSv/h.
            mission_rad_limit_msv: red_atlas_shared::EVA_SPE_DOSE_BUDGET_MSV,
            heart_rate_bpm: 158,
        };

        let base_only = planner
            .plan_path(12, 10, &t105_hazards, &CostWeights::default())
            .expect("base path exists even if lethal");

        let (status_emerg, escape_path) =
            planner.evaluate_walkback_and_switch(12, 10, 14, &t105_telemetry, &t105_hazards);

        assert_eq!(status_emerg.active_target, TargetGoal::Wp3Shelter);
        assert!(status_emerg.dynamic_goal_switched);
        assert!(!status_emerg.base_feasible);
        assert!(status_emerg.t_walkback_shelter_min < status_emerg.t_walkback_base_min);

        let escape = escape_path.expect("WP3 shelter escape path must be returned");
        assert_eq!(escape.path_h3, vec![12, 13, 14]);
        assert!(
            escape.estimated_rad_msv < 0.35 * base_only.estimated_rad_msv,
            "WP3 shelter route radiation ({}) must be < 35% of base route ({})",
            escape.estimated_rad_msv,
            base_only.estimated_rad_msv
        );
    }
}
