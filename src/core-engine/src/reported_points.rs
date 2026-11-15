//! Points the astronaut reports during the EVA ("Marcar punto" in the console) and how the
//! engine takes them into account.
//!
//! - **PELIGRO** (hazard): an exclusion zone of `REPORTED_HAZARD_EXCLUSION_RADIUS_M` (cells
//!   inside are impassable) and a caution ring up to `REPORTED_HAZARD_CAUTION_RADIUS_M` whose
//!   cells cost `REPORTED_HAZARD_CAUTION_COST_FACTOR` times more to enter. Only the legs whose
//!   nominal walked route enters a zone are replanned: raising costs off the optimal route
//!   cannot change it. With hazards, legs are planned on the full grid (≈ 0.4 s each in
//!   release), not in the ±200 m corridor of the nominal plan: a zone can block the corridor
//!   while a detour exists outside it. A leg without route is declared unreachable, with the
//!   reason.
//! - **REFUGIO** (shelter): a shelter candidate at the T+105 decision, next to WP3. Rule, in
//!   order: (1) among the reachable candidates the grid confirms as topographic shelter (cell
//!   SVF <= `SHELTER_SVF_MAX`; the same SVF the dose model uses, measured from the 20 m DTM or,
//!   for WP3's alcove, scenario value), the one with the shortest escape time at emergency pace; WP3
//!   wins ties; (2) only if none of those is reachable, the fastest reachable unconfirmed one.
//!   The decision is about an SPE storm: a point the grid gives as open sky does not replace
//!   a confirmed shelter just for being closer (the astronaut may see an overhang the DTM cannot
//!   resolve, so it stays as the fallback). The Walkback Limit Dual then runs with the chosen
//!   shelter.
//! - **ISRU**: a point of interest only. It is not added as a destination: an extra stop would
//!   change the O2 budget and the timeline of the EVA-07 scenario, which the engine does not
//!   replan. The grid values of its cell are reported.
//!
//! With no points, every function here gives exactly the nominal plan and the canonical T+105
//! decision (`tests/reported_points.rs`).

use red_atlas_shared::{
    ActiveHazards, PlssTelemetry, REPORTED_HAZARD_CAUTION_COST_FACTOR,
    REPORTED_HAZARD_CAUTION_RADIUS_M, REPORTED_HAZARD_EXCLUSION_RADIUS_M,
    REPORTED_POINT_SNAP_MAX_M, SHELTER_SVF_MAX, SURVIVAL_TRIANGLE_SITE, is_no_data,
};
use serde::{Deserialize, Serialize};

use crate::h3_mars_grid::{h3_to_lat_lon, haversine_dist_m, H3MarsGrid};
use crate::metabolic_dstar::{
    CostWeights, MetabolicDStarPlanner, PathResult, WalkbackDecision, ZonePenalty,
};
use crate::mission::{t105_decision_inputs, DECISION_CORRIDOR_HALF_WIDTH_M};

/// Kind of a reported point (the console's names).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReportedKind {
    #[serde(rename = "PELIGRO")]
    Hazard,
    #[serde(rename = "REFUGIO")]
    Shelter,
    #[serde(rename = "ISRU")]
    Isru,
}

impl ReportedKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "PELIGRO" => Some(Self::Hazard),
            "REFUGIO" => Some(Self::Shelter),
            "ISRU" => Some(Self::Isru),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::Hazard => "PELIGRO",
            Self::Shelter => "REFUGIO",
            Self::Isru => "ISRU",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Hazard => "Hazard",
            Self::Shelter => "Shelter",
            Self::Isru => "ISRU",
        }
    }
}

/// A point marked on the wrist map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportedPoint {
    pub id: u32,
    pub kind: ReportedKind,
    pub lat_deg: f64,
    /// East longitude 0-360.
    pub lon_e_deg: f64,
    pub label: String,
    /// Mission time when it was marked, minutes from T+0 (if the console sent it).
    pub t_min: Option<f64>,
}

/// Exclusion and caution zones of the HAZARD points.
pub fn hazard_zones(points: &[ReportedPoint]) -> Vec<ZonePenalty> {
    points
        .iter()
        .filter(|p| p.kind == ReportedKind::Hazard)
        .map(|p| ZonePenalty {
            lat_deg: p.lat_deg,
            lon_e_deg: p.lon_e_deg,
            exclusion_radius_m: REPORTED_HAZARD_EXCLUSION_RADIUS_M,
            caution_radius_m: REPORTED_HAZARD_CAUTION_RADIUS_M,
            caution_factor: REPORTED_HAZARD_CAUTION_COST_FACTOR,
        })
        .collect()
}

fn cell_distance_m(h3: u64, p: &ReportedPoint) -> f64 {
    let (la, lo) = h3_to_lat_lon(h3);
    haversine_dist_m(la, lo, p.lat_deg, p.lon_e_deg)
}

/// Every cell the walker passes: the D* Lite chain and the cells of the walked polyline.
fn walked_cells(path: &PathResult) -> impl Iterator<Item = u64> + '_ {
    path.path_h3.iter().copied().chain(path.profile.iter().map(|s| s.h3))
}

/// HAZARD points whose zone (caution radius) the route enters, with the closest approach (m).
pub fn hazards_on_route(path: &PathResult, points: &[ReportedPoint]) -> Vec<(u32, f64)> {
    points
        .iter()
        .filter(|p| p.kind == ReportedKind::Hazard)
        .filter_map(|p| {
            let d = walked_cells(path)
                .map(|h| cell_distance_m(h, p))
                .fold(f64::INFINITY, f64::min);
            (d < REPORTED_HAZARD_CAUTION_RADIUS_M).then_some((p.id, d))
        })
        .collect()
}

/// Closest approach of a route to any exclusion zone center, m (`INFINITY` without hazards).
pub fn min_distance_to_hazards(path: &PathResult, points: &[ReportedPoint]) -> f64 {
    points
        .iter()
        .filter(|p| p.kind == ReportedKind::Hazard)
        .flat_map(|p| walked_cells(path).map(move |h| cell_distance_m(h, p)))
        .fold(f64::INFINITY, f64::min)
}

/// Why a leg has no route.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Unreachable {
    pub reason: String,
    /// HAZARD points that cause it (the one whose exclusion zone covers an end of the leg, or
    /// the ones the nominal route crossed).
    pub blocking_points: Vec<u32>,
}

/// Result of planning one leg with the reported points.
#[derive(Debug, Clone)]
pub struct LegOutcome {
    pub path: Option<PathResult>,
    /// `Some(half width)` for a corridor search, `None` for the full grid.
    pub corridor_half_width_m: Option<f64>,
    pub unreachable: Option<Unreachable>,
}

/// Plans `from -> to` on `grid` with the HAZARD zones of `points`: without hazards in the
/// corridor of `half_width_m` (the nominal plan's search space), with hazards on the full grid.
/// Without route, says why.
#[allow(clippy::too_many_arguments)]
pub fn plan_leg(
    grid: &H3MarsGrid,
    from_h3: u64,
    to_h3: u64,
    points: &[ReportedPoint],
    hazards: &ActiveHazards,
    weights: &CostWeights,
    half_width_m: f64,
    nominal: Option<&PathResult>,
) -> LegOutcome {
    let zones = hazard_zones(points);
    let run = |g: &H3MarsGrid| {
        let (cells, adj) = g.planner_graph();
        let mut planner = MetabolicDStarPlanner::new(cells, adj);
        planner.set_zone_penalties(&zones);
        planner.plan_path(from_h3, to_h3, hazards, weights)
    };
    let corridor_half_width_m = zones.is_empty().then_some(half_width_m);
    let path = match corridor_half_width_m {
        Some(w) => run(&grid.corridor_around(from_h3, &[to_h3], w)),
        None => run(grid),
    };
    let unreachable = path.is_none().then(|| unreachable_reason(from_h3, to_h3, points, nominal));
    LegOutcome { path, corridor_half_width_m, unreachable }
}

fn unreachable_reason(
    from_h3: u64,
    to_h3: u64,
    points: &[ReportedPoint],
    nominal: Option<&PathResult>,
) -> Unreachable {
    let hazards: Vec<&ReportedPoint> = points.iter().filter(|p| p.kind == ReportedKind::Hazard).collect();
    for (end, what) in [(to_h3, "the destination"), (from_h3, "the origin")] {
        if let Some(p) = hazards
            .iter()
            .filter(|p| cell_distance_m(end, p) < REPORTED_HAZARD_EXCLUSION_RADIUS_M)
            .min_by(|a, b| cell_distance_m(end, a).total_cmp(&cell_distance_m(end, b)))
        {
            return Unreachable {
                reason: format!(
                    "{what} lies inside the exclusion zone of {} ({:.0} m from the point; radius {:.0} m)",
                    p.label,
                    cell_distance_m(end, p),
                    REPORTED_HAZARD_EXCLUSION_RADIUS_M
                ),
                blocking_points: vec![p.id],
            };
        }
    }
    if hazards.is_empty() {
        return Unreachable { reason: "no traversable path on the grid".into(), blocking_points: vec![] };
    }
    let blocking: Vec<u32> = nominal
        .map(|n| hazards_on_route(n, points).into_iter().map(|(id, _)| id).collect())
        .unwrap_or_default();
    Unreachable {
        reason: "the exclusion zones of the reported hazards, together with untraversable slopes, \
                 cut every path on the grid"
            .into(),
        blocking_points: blocking,
    }
}

/// One shelter candidate at the T+105 decision.
#[derive(Debug, Clone)]
pub struct ShelterCandidate {
    /// "WP3" or the id of the reported point ("P7").
    pub id: String,
    pub label: String,
    pub reported: bool,
    pub lat_deg: f64,
    pub lon_e_deg: f64,
    /// Cell the planner uses (`None` if the point is farther than `REPORTED_POINT_SNAP_MAX_M`
    /// from every grid cell).
    pub h3: Option<u64>,
    /// SVF of that cell in the grid, if any.
    pub cell_svf: Option<f64>,
    /// The grid gives the cell as a topographic shelter (SVF <= `SHELTER_SVF_MAX`).
    pub dtm_confirms_shelter: bool,
    /// Escape route from WP2 (emergency pace, storm and SPE hazards of T+105).
    pub escape_path: Option<PathResult>,
}

/// T+105 decision with the reported points.
pub struct ReportedDecision {
    pub candidates: Vec<ShelterCandidate>,
    /// Index of the candidate used as shelter.
    pub chosen: usize,
    pub decision: WalkbackDecision,
    pub telemetry: PlssTelemetry,
    pub hazards: ActiveHazards,
    pub wp2_h3: u64,
    pub base_h3: u64,
}

/// Index of the shelter to use (see the module doc): fastest reachable grid-confirmed
/// candidate (WP3, index 0, wins ties); if none is reachable, the fastest reachable one; if
/// nothing is reachable, WP3.
pub fn choose_shelter(candidates: &[ShelterCandidate]) -> usize {
    let fastest = |confirmed_only: bool| {
        candidates
            .iter()
            .enumerate()
            .filter(|(_, c)| !confirmed_only || c.dtm_confirms_shelter)
            .filter_map(|(i, c)| c.escape_path.as_ref().map(|p| (i, p.estimated_time_min)))
            .fold(None::<(usize, f64)>, |best, (i, t)| match best {
                Some((_, bt)) if bt <= t => best,
                _ => Some((i, t)),
            })
            .map(|(i, _)| i)
    };
    fastest(true).or_else(|| fastest(false)).unwrap_or(0)
}

/// Grid cell of a reported point, if one lies within `REPORTED_POINT_SNAP_MAX_M`.
pub fn snap_cell(grid: &H3MarsGrid, lat_deg: f64, lon_e_deg: f64) -> Option<u64> {
    let c = grid.nearest_cell(lat_deg, lon_e_deg)?;
    let (la, lo) = h3_to_lat_lon(c.h3_index);
    (haversine_dist_m(la, lo, lat_deg, lon_e_deg) <= REPORTED_POINT_SNAP_MAX_M).then_some(c.h3_index)
}

/// Walkback Limit Dual at T+105 (WP2) with WP3 and every REFUGIO point as shelter candidates
/// and the HAZARD zones applied to every route. See the module doc for the choice rule.
pub fn t105_decision_with_reports(
    grid: &H3MarsGrid,
    points: &[ReportedPoint],
) -> Result<ReportedDecision, String> {
    let node = |i: usize| {
        let s = &SURVIVAL_TRIANGLE_SITE[i];
        grid.nearest_cell(s.lat_deg, s.lon_deg)
            .map(|c| c.h3_index)
            .ok_or_else(|| format!("{} not found in the grid", s.id))
    };
    let (base_h3, wp2_h3, wp3_h3) = (node(0)?, node(2)?, node(3)?);
    let wp3 = &SURVIVAL_TRIANGLE_SITE[3];

    let svf_of = |h3: Option<u64>| {
        h3.and_then(|h| grid.get_cell(h))
            .map(|c| c.sky_view_factor)
            .filter(|v| !is_no_data(*v))
            .map(f64::from)
    };
    let mut candidates = vec![ShelterCandidate {
        id: "WP3".into(),
        label: "WP3 (planned shelter)".into(),
        reported: false,
        lat_deg: wp3.lat_deg,
        lon_e_deg: wp3.lon_deg,
        h3: Some(wp3_h3),
        cell_svf: svf_of(Some(wp3_h3)),
        dtm_confirms_shelter: false,
        escape_path: None,
    }];
    for p in points.iter().filter(|p| p.kind == ReportedKind::Shelter) {
        let h3 = snap_cell(grid, p.lat_deg, p.lon_e_deg);
        candidates.push(ShelterCandidate {
            id: format!("P{}", p.id),
            label: p.label.clone(),
            reported: true,
            lat_deg: p.lat_deg,
            lon_e_deg: p.lon_e_deg,
            h3,
            cell_svf: svf_of(h3),
            dtm_confirms_shelter: false,
            escape_path: None,
        });
    }
    for c in &mut candidates {
        c.dtm_confirms_shelter = c.cell_svf.is_some_and(|s| s <= SHELTER_SVF_MAX as f64);
    }

    // Search space: without hazards, the canonical decision corridor extended to every
    // candidate; with hazards, the full grid (a zone can block the corridor).
    let zones = hazard_zones(points);
    let corridor;
    let search: &H3MarsGrid = if zones.is_empty() {
        let mut dests = vec![base_h3, wp3_h3];
        dests.extend(candidates.iter().skip(1).filter_map(|c| c.h3));
        corridor = grid.corridor_around(wp2_h3, &dests, DECISION_CORRIDOR_HALF_WIDTH_M);
        &corridor
    } else {
        grid
    };
    let (cells, adj) = search.planner_graph();
    let mut planner = MetabolicDStarPlanner::new(cells, adj);
    planner.set_zone_penalties(&zones);

    let rssi_dbm = grid.get_cell(wp2_h3).map_or(f32::NAN, |c| c.los_base_rssi_dbm);
    let (telemetry, hazards) = t105_decision_inputs(rssi_dbm)?;
    let escape = CostWeights::emergency_escape();
    for c in &mut candidates {
        if let Some(h) = c.h3 {
            c.escape_path = planner.plan_path(wp2_h3, h, &hazards, &escape);
        }
    }
    let chosen = choose_shelter(&candidates);
    let shelter_h3 = candidates[chosen].h3.unwrap_or(wp3_h3);
    let decision = planner.evaluate_walkback_detailed(wp2_h3, base_h3, shelter_h3, &telemetry, &hazards);
    Ok(ReportedDecision { candidates, chosen, decision, telemetry, hazards, wp2_h3, base_h3 })
}
