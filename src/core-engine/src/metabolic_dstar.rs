//! Metabolic D* Lite Pathplanner, Mars Pandolf Biomechanical Cost Function,
//! Walkback Limit Dual calculator, and Dynamic Goal Switching for R.E.D. ATLAS.
//!
//! Implements Sections 3.2-3.4 of `docs/03-system-architecture-ai/ENTREGABLE_3_ARQUITECTURA_E_IA.md`.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

use red_atlas_shared::{
    ActiveHazards, ASTRO_MASS_KG, EARTH_GRAVITY, HexCellState64B, MARS_GRAVITY,
    O2_ENERGY_JOULES_PER_LITER, PlssTelemetry, SPE_CRITICAL_RATE_MSV_H, SUIT_MASS_KG,
    TOTAL_EVA_MASS_KG, TargetGoal, UNPASSABLE_SLOPE_DEG, WALKBACK_SAFETY_FACTOR,
    WalkbackDualStatus,
};
use serde::{Deserialize, Serialize};

const NOMINAL_WALK_SPEED_MPS: f64 = 1.0;
const WIND_DRAG_BETA: f64 = 0.05;
const LOW_TIU_REGOLITH_THRESHOLD: f32 = 150.0;
const CRITICAL_SLOPE_THRESHOLD_DEG: f64 = 20.0;
const REGOLITH_TRAP_SPEED_FACTOR: f64 = 0.45;
const RADIATION_SWITCH_RATIO: f64 = 0.35;
const MIN_SVF: f64 = 0.05;

/// Multi-criteria edge cost weights combining metabolic O2, SPE radiation, and dust drag.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CostWeights {
    pub w_metabolic: f64,
    pub w_radiation: f64,
    pub w_dust: f64,
}

impl Default for CostWeights {
    fn default() -> Self {
        Self {
            w_metabolic: 1.0,
            w_radiation: 1.5,
            w_dust: 0.3,
        }
    }
}

/// Output of a planned EVA route across the `h3o` hexagonal terrain graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathResult {
    pub path_h3: Vec<u64>,
    pub total_cost: f64,
    pub estimated_time_min: f64,
    pub estimated_o2_liters: f64,
    pub estimated_rad_msv: f64,
}

/// THEMIS-derived soil sinkage factor:
/// `\eta(I) = 1.0 + 1.8 * exp(-max(0.0, I - 60.0) / 90.0)`.
pub fn soil_sinkage_eta(thermal_inertia_tiu: f32) -> f64 {
    let tiu = thermal_inertia_tiu as f64;
    let excess = (tiu - 60.0).max(0.0);
    1.0 + 1.8 * (-excess / 90.0).exp()
}

/// Asymmetric slope factor `\Phi_slope(G)` in percent grade.
/// Penalizes uphill climbs (`G > 0`) and eccentric braking on steep descents (`G < -12%`).
fn asymmetric_slope_phi(grade_pct: f64, gravity_ratio: f64) -> f64 {
    if grade_pct >= 0.0 {
        0.5 * gravity_ratio * grade_pct
    } else if grade_pct < -12.0 {
        0.25 * gravity_ratio * (-grade_pct - 12.0)
    } else {
        0.0
    }
}

/// Adapted Mars Pandolf biomechanical metabolic power equation (Watts).
///
/// Calibrated so flat firm basalt (`>= 400 TIU`, `0 deg`, `1.0 m/s`) is ~280 W (~0.80 L/min O2),
/// and a `22 deg` slope on `110 TIU` loose regolith jumps >1000 W (~2.9-3.3 L/min O2).
pub fn pandolf_mars_metabolic_watts(
    slope_deg: f64,
    thermal_inertia_tiu: f32,
    walk_speed_mps: f64,
) -> f64 {
    let v = walk_speed_mps.max(0.0);
    let m_astro = ASTRO_MASS_KG as f64;
    let m_suit = SUIT_MASS_KG as f64;
    let m_total = TOTAL_EVA_MASS_KG as f64;
    let g_ratio = (MARS_GRAVITY as f64) / (EARTH_GRAVITY as f64);

    let resting_term = 1.5 * m_total * g_ratio.powf(0.65);
    let suit_load_term = 2.0 * m_total * (m_suit / m_astro).powi(2) * g_ratio;

    let eta = soil_sinkage_eta(thermal_inertia_tiu);
    let grade_pct = 100.0 * slope_deg.to_radians().tan();
    let phi_slope = asymmetric_slope_phi(grade_pct, g_ratio);

    let locomotion_term =
        eta * m_total * (1.5 * g_ratio.sqrt() * v * v + 0.35 * v * phi_slope);

    resting_term + suit_load_term + locomotion_term
}

/// Converts metabolic power (Watts) into oxygen consumption rate (L/min STP).
pub fn metabolic_o2_rate_l_min(watts: f64) -> f64 {
    (watts.max(0.0) * 60.0) / (O2_ENERGY_JOULES_PER_LITER as f64)
}

/// Evaluates the dynamic multi-criteria edge cost `C(u, v, t)` between adjacent hex cells.
///
/// Returns `(total_cost, delta_t_min, o2_liters)`.
/// Returns `(f64::INFINITY, f64::INFINITY, f64::INFINITY)` if the slope exceeds `UNPASSABLE_SLOPE_DEG`.
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
    if dist_m == 0.0 {
        return (0.0, 0.0, 0.0);
    }

    let dz = (v.elev_m - u.elev_m) as f64;
    let geom_slope_deg = (dz / dist_m).atan().to_degrees();
    let cell_slope_deg = v.slope_deg as f64;
    let unpassable = UNPASSABLE_SLOPE_DEG as f64;

    if geom_slope_deg.abs() > unpassable || cell_slope_deg.abs() > unpassable {
        return (f64::INFINITY, f64::INFINITY, f64::INFINITY);
    }

    // Use directed geometric slope when elevation differs; fall back to cell slope for flat-elev test graphs.
    let effective_slope_deg = if dz.abs() > 1e-3 {
        geom_slope_deg
    } else {
        cell_slope_deg
    };

    let watts = pandolf_mars_metabolic_watts(
        effective_slope_deg,
        v.thermal_inertia_tiu,
        NOMINAL_WALK_SPEED_MPS,
    );
    let o2_rate_l_min = metabolic_o2_rate_l_min(watts);

    let tau = hazards.dust_tau.max(0.0) as f64;
    let delta_vis = 1.0 / (1.0 + 0.15 * (tau - 0.5).max(0.0));

    let regolith_factor = if (hazards.h3_regolith_slope
        || v.thermal_inertia_tiu < LOW_TIU_REGOLITH_THRESHOLD)
        && v.thermal_inertia_tiu < LOW_TIU_REGOLITH_THRESHOLD
        && effective_slope_deg.abs() > CRITICAL_SLOPE_THRESHOLD_DEG
    {
        REGOLITH_TRAP_SPEED_FACTOR
    } else {
        1.0
    };

    let effective_speed_mps = (NOMINAL_WALK_SPEED_MPS * delta_vis * regolith_factor).max(0.1);
    let delta_t_min = (dist_m / effective_speed_mps) / 60.0;
    let o2_liters = o2_rate_l_min * delta_t_min;

    let svf = (v.sky_view_factor as f64).clamp(MIN_SVF, 1.0);
    let spe_rate = hazards.spe_dose_rate_msv_h.max(0.0) as f64;
    let rad_msv = spe_rate * svf * (delta_t_min / 60.0);

    let wind = hazards.wind_speed_ms.max(0.0) as f64;
    let dust_cost = (tau + WIND_DRAG_BETA * wind) * delta_t_min;

    let total_cost = weights.w_metabolic * o2_liters
        + weights.w_radiation * rad_msv
        + weights.w_dust * dust_cost;

    (total_cost, delta_t_min, o2_liters)
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
                let (c, _, _) = edge_cost(&self.cells[u], &self.cells[v], dist_m, hazards, weights);
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
            if !self.dirty_mark[idx] {
                self.dirty_mark[idx] = true;
                self.dirty_nodes.push(idx);
            }
            for &(p, _) in &self.rev_adj[idx] {
                if !self.dirty_mark[p] {
                    self.dirty_mark[p] = true;
                    self.dirty_nodes.push(p);
                }
            }
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
        let mut path_h3 = Vec::with_capacity(n.min(64));
        path_h3.push(self.cells[start_idx].h3_index);

        let mut cur = start_idx;
        let mut total_cost = 0.0;
        let mut estimated_time_min = 0.0;
        let mut estimated_o2_liters = 0.0;
        let mut estimated_rad_msv = 0.0;

        for _ in 0..n {
            if cur == goal_idx {
                return Some(PathResult {
                    path_h3,
                    total_cost,
                    estimated_time_min,
                    estimated_o2_liters,
                    estimated_rad_msv,
                });
            }

            let mut best_next = None;
            let mut best_f = f64::INFINITY;
            let mut best_metrics = (0.0, 0.0, 0.0);

            for &(v, dist_m) in &self.adj[cur] {
                let gv = self.g_score[v];
                if !gv.is_finite() {
                    continue;
                }
                let (c, dt_min, o2_l) =
                    edge_cost(&self.cells[cur], &self.cells[v], dist_m, hazards, weights);
                if c.is_finite() {
                    let f = c + gv;
                    if f < best_f {
                        best_f = f;
                        best_next = Some(v);
                        best_metrics = (c, dt_min, o2_l);
                    }
                }
            }

            let next = best_next?;
            let (c, dt_min, o2_l) = best_metrics;
            let svf = (self.cells[next].sky_view_factor as f64).clamp(MIN_SVF, 1.0);
            let spe_rate = hazards.spe_dose_rate_msv_h.max(0.0) as f64;
            let rad_msv = spe_rate * svf * (dt_min / 60.0);

            total_cost += c;
            estimated_time_min += dt_min;
            estimated_o2_liters += o2_l;
            estimated_rad_msv += rad_msv;

            path_h3.push(self.cells[next].h3_index);
            cur = next;
        }

        None
    }

    /// Evaluates the Walkback Limit Dual (`T_vital` vs `T_walkback_Base` vs `T_walkback_Shelter`)
    /// and applies the deterministic Dynamic Goal Switching rule.
    pub fn evaluate_walkback_and_switch(
        &mut self,
        current_h3: u64,
        base_h3: u64,
        wp3_shelter_h3: u64,
        telemetry: &PlssTelemetry,
        hazards: &ActiveHazards,
    ) -> (WalkbackDualStatus, Option<PathResult>) {
        let weights = CostWeights::default();

        let o2_rate = (telemetry.current_o2_rate_l_min as f64).max(0.05);
        let t_o2_min = (telemetry.o2_remaining_liters.max(0.0) as f64) / o2_rate;
        let t_lcvg_min = telemetry.lcvg_water_remaining_min.max(0.0) as f64;
        let t_batt_min = telemetry.battery_remaining_min.max(0.0) as f64;

        let remaining_rad_budget =
            (telemetry.mission_rad_limit_msv - telemetry.cumulative_rad_msv).max(0.0) as f64;
        let current_svf = self
            .h3_to_idx
            .get(&current_h3)
            .map(|&idx| (self.cells[idx].sky_view_factor as f64).clamp(MIN_SVF, 1.0))
            .unwrap_or(1.0);
        let local_rad_rate_msv_h = (hazards.spe_dose_rate_msv_h.max(0.0) as f64) * current_svf;
        let t_rad_min = if local_rad_rate_msv_h > 1e-6 {
            (remaining_rad_budget / local_rad_rate_msv_h) * 60.0
        } else {
            f64::INFINITY
        };

        let t_vital = t_o2_min.min(t_lcvg_min).min(t_batt_min).min(t_rad_min);

        let base_path = self.plan_path(current_h3, base_h3, hazards, &weights);
        let wp3_path = self.plan_path(current_h3, wp3_shelter_h3, hazards, &weights);

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
        let spe_critical = SPE_CRITICAL_RATE_MSV_H as f64;

        let time_switch =
            t_walkback_base > safety_factor * t_vital && t_walkback_shelter < t_walkback_base;
        let rad_switch = rad_to_base > remaining_rad_budget
            && rad_to_wp3 < RADIATION_SWITCH_RATIO * rad_to_base
            && (hazards.spe_dose_rate_msv_h as f64) > spe_critical;

        let switch_to_shelter = time_switch || rad_switch;

        let base_feasible = base_path.is_some()
            && t_walkback_base <= safety_factor * t_vital
            && !(rad_to_base > remaining_rad_budget
                && (hazards.spe_dose_rate_msv_h as f64) > spe_critical);

        let (active_target, selected_path) = if switch_to_shelter {
            (TargetGoal::Wp3Shelter, wp3_path)
        } else {
            (TargetGoal::BaseHabitat, base_path)
        };

        let status = WalkbackDualStatus {
            t_vital_min: t_vital as f32,
            t_walkback_base_min: t_walkback_base as f32,
            t_walkback_shelter_min: t_walkback_shelter as f32,
            active_target,
            dynamic_goal_switched: switch_to_shelter,
            base_feasible,
        };

        (status, selected_path)
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
        let eta_basalt = soil_sinkage_eta(400.0);
        assert!(
            (eta_basalt - 1.041).abs() < 0.01,
            "Expected basalt eta ~1.04, got {eta_basalt}"
        );

        let eta_wp2_regolith = soil_sinkage_eta(110.0);
        assert!(
            (eta_wp2_regolith - 2.033).abs() < 0.01,
            "Expected 110 TIU regolith eta ~2.03, got {eta_wp2_regolith}"
        );

        let eta_ultra_soft = soil_sinkage_eta(40.0);
        assert!((eta_ultra_soft - 2.8).abs() < 1e-6);
    }

    #[test]
    fn test_pandolf_flat_basalt_vs_wp2_regolith_trap() {
        let flat_watts = pandolf_mars_metabolic_watts(0.0, 420.0, 1.0);
        let flat_o2 = metabolic_o2_rate_l_min(flat_watts);
        assert!(
            (260.0..=300.0).contains(&flat_watts),
            "Flat basalt watts should be ~280 W, got {flat_watts}"
        );
        assert!(
            (0.75..=0.86).contains(&flat_o2),
            "Flat basalt O2 rate should be ~0.80 L/min, got {flat_o2}"
        );

        let wp2_watts = pandolf_mars_metabolic_watts(22.0, 110.0, 1.0);
        let wp2_o2 = metabolic_o2_rate_l_min(wp2_watts);
        assert!(
            wp2_watts > 1000.0,
            "WP2 22 deg / 110 TIU watts should jump >1000 W, got {wp2_watts}"
        );
        assert!(
            (2.9..=3.3).contains(&wp2_o2),
            "WP2 O2 rate should be 2.9-3.3 L/min, got {wp2_o2}"
        );
    }

    #[test]
    fn test_edge_cost_unpassable_and_svf_attenuation() {
        let weights = CostWeights::default();
        let mut hazards = nominal_hazards();
        hazards.h2_spe_radiation = true;
        hazards.spe_dose_rate_msv_h = 85.0;

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
        let expected_rad_diff = 85.0 * (1.0 - 0.15) * (dt_open / 60.0);
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
        // 0 = Base Habitat (2880m from WP2 via nodes 1, 2 -> ~48 min at 1 m/s)
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
            cumulative_rad_msv: 1.0,
            mission_rad_limit_msv: 50.0,
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
        // H1 dust tau=2.4 + wind 28 m/s, H2 SPE 85 mSv/h, H3 110 TIU/22 deg, H4 NLOS -125 dBm.
        let t105_hazards = ActiveHazards {
            h1_dust_storm: true,
            h2_spe_radiation: true,
            h3_regolith_slope: true,
            h4_nlos_offline: true,
            dust_tau: 2.4,
            wind_speed_ms: 28.0,
            spe_dose_rate_msv_h: 85.0,
            rssi_dbm: -125.0,
        };
        let t105_telemetry = PlssTelemetry {
            timestamp_s: 6300.0,
            o2_remaining_liters: 95.0,
            lcvg_water_remaining_min: 75.0,
            battery_remaining_min: 90.0,
            current_o2_rate_l_min: 3.2,
            cumulative_rad_msv: 34.0,
            mission_rad_limit_msv: 50.0, // 16 mSv remaining -> ~15 min at SVF=0.75, 85 mSv/h
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
