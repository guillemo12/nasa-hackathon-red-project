//! The versioned mission results must match what the engine computes now. Regenerate with
//! `cargo run --release --bin export_mission_results` (from `src/core-engine`).

use red_atlas_core::mission::{
    compute_chaos_export, compute_t105_walkback, json_mismatch, load_grid, repo_path,
    CHAOS_MODE_JSON_REL, DECISION_CORRIDOR_HALF_WIDTH_M, GRID_PARQUET_REL,
    PLANNER_WALKBACK_JSON_REL,
};

fn committed(rel: &str) -> serde_json::Value {
    let path = repo_path(rel);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e} (run export_mission_results)", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{rel} is not valid JSON: {e}"))
}

#[test]
fn planner_walkback_json_matches_the_planner() {
    let grid = load_grid(&repo_path(GRID_PARQUET_REL)).unwrap();
    let run = compute_t105_walkback(
        &grid,
        GRID_PARQUET_REL,
        Some(DECISION_CORRIDOR_HALF_WIDTH_M),
    )
    .unwrap();
    let now = serde_json::to_value(&run.report).unwrap();
    if let Some(diff) = json_mismatch(&committed(PLANNER_WALKBACK_JSON_REL), &now, 1e-9) {
        panic!("{PLANNER_WALKBACK_JSON_REL} is stale ({diff}); run export_mission_results");
    }
}

#[test]
fn chaos_mode_json_matches_the_monte_carlo() {
    let now = serde_json::to_value(compute_chaos_export()).unwrap();
    if let Some(diff) = json_mismatch(&committed(CHAOS_MODE_JSON_REL), &now, 1e-9) {
        panic!("{CHAOS_MODE_JSON_REL} is stale ({diff}); run export_mission_results");
    }
}
