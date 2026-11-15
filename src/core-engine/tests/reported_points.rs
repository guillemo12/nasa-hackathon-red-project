//! Points reported during the EVA on P1's real res-12 grid: a HAZARD on the route makes the
//! planner detour around its exclusion zone, a HAZARD on a waypoint makes the leg unreachable
//! with a reason, a REFUGIO closer than WP3 becomes the shelter of the T+105 decision, and with
//! no points everything stays exactly as the nominal plan and the canonical decision.

use std::path::PathBuf;
use std::sync::OnceLock;

use red_atlas_core::h3_mars_grid::{h3_to_lat_lon, haversine_dist_m, H3MarsGrid};
use red_atlas_core::metabolic_dstar::{CostWeights, PathResult};
use red_atlas_core::mission::{compute_t105_walkback, P1_GRID_PARQUET_REL};
use red_atlas_core::reported_points::{
    hazards_on_route, min_distance_to_hazards, plan_leg, t105_decision_with_reports, ReportedKind,
    ReportedPoint,
};
use red_atlas_shared::{
    ActiveHazards, DUST_TAU_NOMINAL, GCR_SURFACE_RATE_MSV_H, REPORTED_HAZARD_EXCLUSION_RADIUS_M,
    SHELTER_SVF_MAX, SURVIVAL_TRIANGLE_SITE,
};

const CORRIDOR_M: f64 = 200.0;

fn grid() -> &'static H3MarsGrid {
    static GRID: OnceLock<H3MarsGrid> = OnceLock::new();
    GRID.get_or_init(|| {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join(P1_GRID_PARQUET_REL);
        H3MarsGrid::load_p1_parquet(&path).expect("P1 res-12 grid")
    })
}

fn node(i: usize) -> u64 {
    let s = &SURVIVAL_TRIANGLE_SITE[i];
    grid().nearest_cell(s.lat_deg, s.lon_deg).expect("node in grid").h3_index
}

fn nominal() -> ActiveHazards {
    ActiveHazards {
        h1_dust_storm: false,
        h2_spe_radiation: false,
        h3_regolith_slope: false,
        h4_nlos_offline: false,
        dust_tau: DUST_TAU_NOMINAL,
        spe_dose_rate_msv_h: GCR_SURFACE_RATE_MSV_H,
        ..ActiveHazards::default()
    }
}

fn point(id: u32, kind: ReportedKind, h3: u64) -> ReportedPoint {
    let (lat, lon) = h3_to_lat_lon(h3);
    ReportedPoint { id, kind, lat_deg: lat, lon_e_deg: lon, label: format!("{} {id}", kind.label()), t_min: None }
}

/// Nominal L1 (Base -> WP1) route.
fn l1_nominal() -> PathResult {
    plan_leg(grid(), node(0), node(1), &[], &nominal(), &CostWeights::default(), CORRIDOR_M, None)
        .path
        .expect("nominal L1 route")
}

/// Every cell the walker passes stays out of the exclusion zone of `p`.
fn assert_avoids(path: &PathResult, p: &ReportedPoint) {
    for h in path.path_h3.iter().copied().chain(path.profile.iter().map(|s| s.h3)) {
        let (la, lo) = h3_to_lat_lon(h);
        let d = haversine_dist_m(la, lo, p.lat_deg, p.lon_e_deg);
        assert!(d >= REPORTED_HAZARD_EXCLUSION_RADIUS_M, "route cell {h:x} is {d:.1} m from {}", p.label);
    }
}

#[test]
fn no_points_keep_the_nominal_leg() {
    let a = l1_nominal();
    let b = plan_leg(grid(), node(0), node(1), &[], &nominal(), &CostWeights::default(), CORRIDOR_M, None);
    assert_eq!(b.corridor_half_width_m, Some(CORRIDOR_M));
    let b = b.path.unwrap();
    assert_eq!(a.smoothed_h3, b.smoothed_h3);
    assert_eq!(a.estimated_time_min, b.estimated_time_min);
}

#[test]
fn hazard_on_the_route_makes_the_planner_detour() {
    let base = l1_nominal();
    // A hazard on the walked route, halfway along it.
    let mid = base.profile[base.profile.len() / 2].h3;
    let hazard = point(1, ReportedKind::Hazard, mid);
    let points = vec![hazard.clone()];
    assert_eq!(hazards_on_route(&base, &points).first().map(|h| h.0), Some(1));

    let out = plan_leg(grid(), node(0), node(1), &points, &nominal(), &CostWeights::default(), CORRIDOR_M, Some(&base));
    assert!(out.unreachable.is_none(), "{:?}", out.unreachable);
    assert_eq!(out.corridor_half_width_m, None, "with hazards the leg is searched on the full grid");
    let detour = out.path.expect("detour route");
    assert_avoids(&detour, &hazard);
    assert!(min_distance_to_hazards(&detour, &points) >= REPORTED_HAZARD_EXCLUSION_RADIUS_M);
    assert!(detour.length_m > base.length_m, "detour {:.1} m vs {:.1} m", detour.length_m, base.length_m);
    assert!(detour.estimated_time_min > base.estimated_time_min);
    assert_ne!(detour.smoothed_h3, base.smoothed_h3);
    // Off-route hazards do not change the route.
    let far = point(2, ReportedKind::Hazard, node(3));
    let same = plan_leg(grid(), node(0), node(1), &[far], &nominal(), &CostWeights::default(), CORRIDOR_M, Some(&base));
    assert_eq!(same.path.unwrap().smoothed_h3, base.smoothed_h3);
}

#[test]
fn hazard_on_the_destination_is_reported_as_unreachable() {
    let base = l1_nominal();
    let hazard = point(3, ReportedKind::Hazard, node(1));
    let out = plan_leg(grid(), node(0), node(1), &[hazard], &nominal(), &CostWeights::default(), CORRIDOR_M, Some(&base));
    assert!(out.path.is_none());
    let why = out.unreachable.expect("reason");
    assert!(why.reason.contains("destino"), "{}", why.reason);
    assert_eq!(why.blocking_points, vec![3]);
}

#[test]
fn no_points_reproduce_the_canonical_t105_decision() {
    let canon = compute_t105_walkback(grid(), P1_GRID_PARQUET_REL, Some(200.0)).expect("canonical");
    let d = t105_decision_with_reports(grid(), &[]).expect("decision");
    assert_eq!(d.chosen, 0);
    assert_eq!(d.candidates.len(), 1);
    assert_eq!(d.decision.status, canon.decision.status);
    let (a, b) = (d.decision.wp3_path.unwrap(), canon.decision.wp3_path.unwrap());
    assert_eq!(a.smoothed_h3, b.smoothed_h3);
    assert_eq!(a.estimated_time_min, b.estimated_time_min);
}

fn svf(h3: u64) -> f32 {
    grid().get_cell(h3).map_or(f32::NAN, |c| c.sky_view_factor)
}

#[test]
fn confirmed_shelter_closer_than_wp3_becomes_the_shelter() {
    let canon = t105_decision_with_reports(grid(), &[]).expect("decision");
    let escape = canon.decision.wp3_path.as_ref().expect("escape to WP3");
    // First cell of the escape route the DTM sees as a shelter (SVF <= 0.20) before WP3.
    let h = escape.profile[..escape.profile.len() - 1]
        .iter()
        .map(|s| s.h3)
        .find(|&h| svf(h) <= SHELTER_SVF_MAX)
        .expect("a sheltered cell before WP3");
    let refuge = point(4, ReportedKind::Shelter, h);
    let d = t105_decision_with_reports(grid(), &[refuge]).expect("decision");
    assert_eq!(d.candidates.len(), 2);
    assert!(d.candidates[1].dtm_confirms_shelter);
    assert_eq!(d.chosen, 1, "the reported shelter should win");
    let t_new = d.candidates[1].escape_path.as_ref().unwrap().estimated_time_min;
    let t_wp3 = d.candidates[0].escape_path.as_ref().unwrap().estimated_time_min;
    assert!(t_new < t_wp3, "{t_new} vs {t_wp3}");
    // The decision runs with the chosen shelter.
    let shelter_path = d.decision.wp3_path.as_ref().expect("shelter route");
    assert_eq!(*shelter_path.path_h3.last().unwrap(), h);
    assert!((d.decision.status.t_walkback_shelter_min as f64 - t_new).abs() < 1e-3);
}

#[test]
fn open_sky_shelter_is_only_a_fallback() {
    let canon = t105_decision_with_reports(grid(), &[]).expect("decision");
    let escape = canon.decision.wp3_path.as_ref().unwrap();
    // A refuge marked a third of the way to WP3, where the DTM sees open sky.
    let h = escape.profile[escape.profile.len() / 3].h3;
    assert!(svf(h) > SHELTER_SVF_MAX, "test cell should be open sky");
    let refuge = point(6, ReportedKind::Shelter, h);
    let d = t105_decision_with_reports(grid(), std::slice::from_ref(&refuge)).expect("decision");
    assert!(!d.candidates[1].dtm_confirms_shelter);
    assert!(d.candidates[1].escape_path.is_some(), "reachable");
    assert_eq!(d.chosen, 0, "WP3 (confirmed) must win over a closer open-sky point");

    // With WP3 inside a hazard exclusion zone, the open-sky refuge is the fallback.
    let wp3_hazard = point(7, ReportedKind::Hazard, node(3));
    let d = t105_decision_with_reports(grid(), &[refuge, wp3_hazard]).expect("decision");
    assert!(d.candidates[0].escape_path.is_none(), "WP3 unreachable");
    assert_eq!(d.chosen, 1);
    assert_eq!(*d.decision.wp3_path.as_ref().expect("route").path_h3.last().unwrap(), h);
}

#[test]
fn hazard_on_the_escape_route_moves_the_decision_route() {
    let canon = t105_decision_with_reports(grid(), &[]).expect("decision");
    let escape = canon.decision.wp3_path.as_ref().unwrap();
    let hazard = point(5, ReportedKind::Hazard, escape.profile[escape.profile.len() / 2].h3);
    let d = t105_decision_with_reports(grid(), std::slice::from_ref(&hazard)).expect("decision");
    // WP3 stays reachable around the zone (searched on the full grid, not only the corridor).
    let p = d.decision.wp3_path.as_ref().expect("detour to WP3");
    assert_eq!(d.chosen, 0);
    assert_avoids(p, &hazard);
    // Time and cost are measured on the smoothed polyline, not on the D* Lite chain the search
    // optimizes, so a detour is not always slower: only the route must change.
    assert_ne!(p.smoothed_h3, escape.smoothed_h3);
    assert!(d.decision.base_path.is_some(), "the Base stays reachable");
}
