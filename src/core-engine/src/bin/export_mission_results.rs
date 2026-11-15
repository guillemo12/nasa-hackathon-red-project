//! Regenerates the engine's versioned mission results:
//!
//! - `data/mission-scenarios/planner_walkback.json`: T+105 Walkback Limit Dual on the real
//!   res-12 terrain (routes, times, mean speed and power, O2, projected SPE dose, T_vital, open-sky
//!   window, pace parameters, grid fingerprint).
//! - `data/mission-scenarios/chaos_mode_results.json`: 10,000 seeded Chaos Mode trials.
//!
//! Usage (from `src/core-engine`):
//!
//! ```text
//! cargo run --release --bin export_mission_results            # write both files
//! cargo run --release --bin export_mission_results -- --check # exit 1 if a file is stale
//! ```
//!
//! The output is deterministic (no timestamps, no timings). `tests/mission_exports.rs` fails if
//! the committed files differ from what the engine computes.

use std::process::ExitCode;

use red_atlas_core::mission::{
    compute_chaos_export, compute_t105_walkback, json_mismatch, load_grid, repo_path, to_json,
    CHAOS_MODE_JSON_REL, DECISION_CORRIDOR_HALF_WIDTH_M, GRID_PARQUET_REL,
    PLANNER_WALKBACK_JSON_REL,
};

fn run(check: bool) -> Result<bool, String> {
    let grid = load_grid(&repo_path(GRID_PARQUET_REL))?;
    let walkback = compute_t105_walkback(
        &grid,
        GRID_PARQUET_REL,
        Some(DECISION_CORRIDOR_HALF_WIDTH_M),
    )?;
    let outputs = [
        (PLANNER_WALKBACK_JSON_REL, to_json(&walkback.report)?),
        (CHAOS_MODE_JSON_REL, to_json(&compute_chaos_export())?),
    ];
    let mut all_ok = true;
    for (rel, text) in outputs {
        let path = repo_path(rel);
        if check {
            let current = std::fs::read_to_string(&path)
                .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
            let parse = |t: &str| {
                serde_json::from_str::<serde_json::Value>(t).map_err(|e| format!("{rel}: {e}"))
            };
            match json_mismatch(&parse(&current)?, &parse(&text)?, 1e-9) {
                Some(diff) => {
                    eprintln!("STALE {rel}: {diff}");
                    all_ok = false;
                }
                None => println!("ok    {rel}"),
            }
        } else {
            std::fs::write(&path, &text).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
            println!("wrote {rel}");
        }
    }
    Ok(all_ok)
}

fn main() -> ExitCode {
    let check = std::env::args().any(|a| a == "--check");
    match run(check) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("export_mission_results: {e}");
            ExitCode::from(2)
        }
    }
}
