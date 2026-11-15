//! Dynamic HTTP API Server for R.E.D. ATLAS (`red-atlas-core`).
//!
//! Serves P1's canonical data (`data/mission-scenarios/*.json`, `data/nasa-layers/*.parquet`)
//! and P3's Rust engines (`GuardrailFsm`, `MetabolicDStarPlanner`, `run_chaos_mode_monte_carlo`,
//! `H3MarsGrid`) over HTTP on `127.0.0.1:3001` for `src/base-console/`.
//!
//! Every figure comes from the data files or from `red_atlas_shared`; nothing is hard-coded to
//! match an expected output. Paths are resolved from the repository root, so the server runs
//! from any working directory (`cargo run --bin api_server` in `src/core-engine`).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, OnceLock};

use h3o::{CellIndex, Resolution};
use red_atlas_core::h3_mars_grid::{h3_to_lat_lon, lat_lon_to_h3, H3MarsGrid, MARS_RADIUS_M};
use red_atlas_core::metabolic_dstar::{
    metabolic_o2_rate_l_min, pandolf_mars_metabolic_watts, CostWeights, MetabolicDStarPlanner,
};
use red_atlas_core::mission::{
    chaos_corridor_cells, repo_path, CHAOS_CORRIDOR_RES, CHAOS_MODE_JSON_REL, CHAOS_SEED,
    CHAOS_SOLAR_HOUR, CHAOS_TRIALS, DECISION_BATTERY_REMAINING_MIN, DECISION_LCVG_REMAINING_MIN,
    DECISION_WIND_M_S, P1_GRID_PARQUET_REL, PLANNER_WALKBACK_JSON_REL,
};
use red_atlas_core::neuro_symbolic::GuardrailFsm;
use red_atlas_core::stochastic_hazard::run_chaos_mode_monte_carlo;
use red_atlas_shared::{
    is_no_data, ActiveHazards, HexCellState64B, PlssTelemetry, SafetyGuardrailState, TargetGoal,
    WalkbackDualStatus, DUST_TAU_NOMINAL, EVA_SPE_DOSE_BUDGET_MSV,
    GCR_SURFACE_RATE_MSV_H, HAZARD_FLAG_ISRU_WATER, HAZARD_FLAG_NLOS, HAZARD_FLAG_REGOLITH_TRAP,
    HAZARD_FLAG_SHELTER, HAZARD_FLAG_SLOPE_CRITICAL, O2_DENSITY_G_PER_L, SPE_PEAK_ENVELOPE_MSV_H,
    SUIT_O2_PRIMARY_USABLE_G, SURVIVAL_TRIANGLE_LEGS, SURVIVAL_TRIANGLE_SITE, WP2_RAMP_SLOPE_DEG,
};
use serde_json::{json, Value};

const EVENTS_JSON_REL: &str = "data/mission-scenarios/eva07_events.json";
const GEOJSON_REL: &str = "data/mission-scenarios/triangulo_supervivencia.geojson";
const LAYERS_CATALOG_REL: &str = "data/nasa-layers/layers_catalog.json";
const GRID_RES9_REL: &str = "data/nasa-layers/hexgrid_route_res9_hexcell64b.parquet";

/// Compile-time copies, used only if the runtime files cannot be read.
const EVENTS_JSON_FALLBACK: &str = include_str!("../../../../data/mission-scenarios/eva07_events.json");
const GEOJSON_FALLBACK: &str =
    include_str!("../../../../data/mission-scenarios/triangulo_supervivencia.geojson");

/// Mars sol / Earth day: Earth minutes are divided by this to get Mars local minutes.
const MARS_SOL_OVER_EARTH_DAY: f64 = 88_775.244 / 86_400.0;
/// LMST at T+0 (P1: departure 14:45 LMST), in Mars local minutes.
const DEPARTURE_LMST_MIN: f64 = 14.0 * 60.0 + 45.0;
/// Spacing of the terrain heightfield served to the 3D twin, m.
const TERRAIN_SPACING_M: f64 = 30.0;
/// Half-width of the planner corridor around each leg, m (same as the T+105 decision).
const ROUTE_CORRIDOR_HALF_WIDTH_M: f64 = 200.0;
/// Largest Spyglass radius the API answers, m.
const SPYGLASS_MAX_RADIUS_M: f64 = 200.0;

struct AppState {
    events_doc: Value,
    geojson: Value,
    chaos_reference: Option<Value>,
    walkback_reference: Option<Value>,
    grid9: H3MarsGrid,
    grid12: Option<Arc<H3MarsGrid>>,
    aoi: Aoi,
    chaos_cells: Vec<HexCellState64B>,
    terrain_json: OnceLock<String>,
    hexgrid_json: OnceLock<String>,
    route_plan: OnceLock<Value>,
    bundle: Bundle,
}

#[derive(Clone, Copy)]
struct Aoi {
    lat_min: f64,
    lat_max: f64,
    lon_min: f64,
    lon_max: f64,
}

struct Bundle {
    sha256_hex: String,
    bytes: usize,
    files: Vec<String>,
}

// ============================================================================
// Small helpers
// ============================================================================

fn read_json(rel: &str, fallback: Option<&str>) -> Option<Value> {
    match std::fs::read_to_string(repo_path(rel)) {
        Ok(text) => serde_json::from_str(&text).ok(),
        Err(_) => fallback.and_then(|f| serde_json::from_str(f).ok()),
    }
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| v.to_string())
    })
}

fn query_f64(query: &str, key: &str) -> Option<f64> {
    parse_query_param(query, key)
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite())
}

fn send_json(stream: &mut TcpStream, status: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn f(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn round_to(x: f64, decimals: i32) -> f64 {
    let k = 10f64.powi(decimals);
    (x * k).round() / k
}

/// JSON number rounded to `decimals`, or `null` for a missing (`NaN`) cell attribute.
fn num(x: f32, decimals: i32) -> Value {
    if is_no_data(x) || !x.is_finite() {
        Value::Null
    } else {
        json!(round_to(x as f64, decimals))
    }
}

fn flags_json(mask: u16) -> Value {
    json!({
        "slope_critical": mask & HAZARD_FLAG_SLOPE_CRITICAL != 0,
        "regolith_trap": mask & HAZARD_FLAG_REGOLITH_TRAP != 0,
        "shelter": mask & HAZARD_FLAG_SHELTER != 0,
        "nlos": mask & HAZARD_FLAG_NLOS != 0,
        "isru_water": mask & HAZARD_FLAG_ISRU_WATER != 0,
    })
}

fn cell_json(c: &HexCellState64B) -> Value {
    let (lat, lon_e) = h3_to_lat_lon(c.h3_index);
    json!({
        "h3_hex": format!("{:x}", c.h3_index),
        "lat": round_to(lat, 6),
        "lon_e": round_to(lon_e, 6),
        "elev_m": num(c.elev_m, 1),
        "slope_deg": num(c.slope_deg, 1),
        "aspect_deg": num(c.aspect_deg, 0),
        "thermal_inertia_tiu": num(c.thermal_inertia_tiu, 0),
        "isru_h2o_pct": num(c.isru_h2o_pct, 1),
        "sky_view_factor": num(c.sky_view_factor, 2),
        "los_base_rssi_dbm": num(c.los_base_rssi_dbm, 1),
        "flags": flags_json(c.hazard_bitmask),
    })
}

// ============================================================================
// SHA-256 (FIPS 180-4), implemented here so the crate needs no new dependency
// ============================================================================

fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    // The padded message length is a multiple of 64 bytes by construction.
    for block_start in (0..msg.len()).step_by(64) {
        let block = &msg[block_start..block_start + 64];
        let mut w = [0u32; 64];
        for (i, word) in w.iter_mut().enumerate().take(16) {
            let j = i * 4;
            *word = u32::from_be_bytes([block[j], block[j + 1], block[j + 2], block[j + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for (hi, vi) in h.iter_mut().zip(v) {
            *hi = hi.wrapping_add(vi);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// Digest of the files the pre-EVA `bundle_sync` would carry (`src/shared/README.md` §3):
/// the res-12 `h3o` sub-grid, the route GeoJSON and the EVA-07 scenario.
fn compute_bundle() -> Bundle {
    let rels = [P1_GRID_PARQUET_REL, GEOJSON_REL, EVENTS_JSON_REL];
    let mut all = Vec::new();
    let mut files = Vec::new();
    for rel in rels {
        if let Ok(bytes) = std::fs::read(repo_path(rel)) {
            all.extend_from_slice(&bytes);
            files.push(rel.to_string());
        }
    }
    Bundle { sha256_hex: sha256_hex(&all), bytes: all.len(), files }
}

// ============================================================================
// EVA-07 timeline sampling (P1 `eva07_events.json`: events + phases)
// ============================================================================

/// Local Mean Solar Time `hh:mm` at `t_min` Earth minutes from departure (truncated to the
/// minute, as P1 writes it in `eva07_events.json`).
fn format_lmst(t_min: f64) -> String {
    let mars_min = (DEPARTURE_LMST_MIN + t_min / MARS_SOL_OVER_EARTH_DAY).rem_euclid(24.0 * 60.0);
    let whole = (mars_min + 1e-9).floor() as i64;
    format!("{:02}:{:02}", whole / 60, whole % 60)
}

/// Mission elapsed time `T+hh:mm` / `T-hh:mm` in Earth minutes from departure.
fn format_met(t_min: f64) -> String {
    let sign = if t_min < 0.0 { '-' } else { '+' };
    let whole = t_min.abs().floor() as i64;
    format!("T{sign}{:02}:{:02}", whole / 60, whole % 60)
}

fn phase_at(phases: &[Value], t: f64) -> &Value {
    phases
        .iter()
        .find(|p| t >= f(p, "t0") && t < f(p, "t1"))
        .unwrap_or(&phases[phases.len() - 1])
}

/// Piecewise-linear open-sky SPE rate from `[[t_min, mSv/h], ...]` knots: zero before the first
/// knot, constant after the last one.
fn knots_rate(knots: &[(f64, f64)], t: f64) -> f64 {
    let Some(first) = knots.first() else { return 0.0 };
    if t < first.0 {
        return 0.0;
    }
    for pair in knots.windows(2) {
        let ((t0, r0), (t1, r1)) = (pair[0], pair[1]);
        if t <= t1 {
            return if t1 > t0 { r0 + (r1 - r0) * (t - t0) / (t1 - t0) } else { r1 };
        }
    }
    knots[knots.len() - 1].1
}

fn profile_knots(doc: &Value, profile: &str) -> Vec<(f64, f64)> {
    doc.get("spe_profile_comparison")
        .and_then(|c| c.get(profile))
        .and_then(|p| p.get("knots_t_min_msv_h"))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|k| Some((k.get(0)?.as_f64()?, k.get(1)?.as_f64()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// Trapezoid integral of `g` over `[a, b]` minutes with a 0.01 min step (the integrands are
/// piecewise linear with breakpoints on phase boundaries and profile knots).
fn integrate(a: f64, b: f64, g: impl Fn(f64) -> f64) -> f64 {
    if b <= a {
        return 0.0;
    }
    let n = (((b - a) / 0.01).ceil() as usize).max(1);
    let h = (b - a) / n as f64;
    // Midpoint rule: exact on each linear piece and never samples a discontinuity twice.
    (0..n).map(|i| g(a + (i as f64 + 0.5) * h)).sum::<f64>() * h
}

/// Where the astronaut is at `t`: a node, or a fraction along a leg (`"A→B"` locations span
/// every consecutive phase with that location).
struct Location {
    from: String,
    to: String,
    frac: f64,
}

fn location_at(phases: &[Value], t: f64) -> Location {
    let idx = phases
        .iter()
        .position(|p| t >= f(p, "t0") && t < f(p, "t1"))
        .unwrap_or(phases.len() - 1);
    let loc = s(&phases[idx], "location");
    match loc.split_once('→') {
        None => Location { from: loc.to_string(), to: loc.to_string(), frac: 0.0 },
        Some((a, b)) => {
            let (mut i0, mut i1) = (idx, idx);
            while i0 > 0 && s(&phases[i0 - 1], "location") == loc {
                i0 -= 1;
            }
            while i1 + 1 < phases.len() && s(&phases[i1 + 1], "location") == loc {
                i1 += 1;
            }
            let (t0, t1) = (f(&phases[i0], "t0"), f(&phases[i1], "t1"));
            let frac = if t1 > t0 { ((t - t0) / (t1 - t0)).clamp(0.0, 1.0) } else { 0.0 };
            Location { from: a.to_string(), to: b.to_string(), frac }
        }
    }
}

/// P1 node ids (`node_id` of the GeoJSON, `location` / `goal` of the phases), in the order of
/// `SURVIVAL_TRIANGLE_SITE`.
const NODE_IDS: [&str; 4] = ["BASE", "WP1", "WP2", "WP3"];
/// Index of the WP2 node (the 22° scenario ramp) in `SURVIVAL_TRIANGLE_SITE`.
const WP2_INDEX: usize = 2;

fn site_index(id: &str) -> Option<usize> {
    NODE_IDS.iter().position(|n| *n == id)
}

fn leg_between(from: usize, to: usize) -> Option<usize> {
    SURVIVAL_TRIANGLE_LEGS.iter().position(|l| l.from == from && l.to == to)
}

/// Bearing in degrees from North between two points (great circle, initial bearing).
fn bearing_deg(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dl = (lon2 - lon1).to_radians();
    let y = dl.sin() * p2.cos();
    let x = p1.cos() * p2.sin() - p1.sin() * p2.cos() * dl.cos();
    y.atan2(x).to_degrees().rem_euclid(360.0)
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let (dp, dl) = (p2 - p1, (lon2 - lon1).to_radians());
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * MARS_RADIUS_M * a.sqrt().atan2((1.0 - a).sqrt())
}

fn state_code(state: SafetyGuardrailState) -> (&'static str, &'static str) {
    match state {
        SafetyGuardrailState::Nominal => ("0x01_NOMINAL", "NOMINAL"),
        SafetyGuardrailState::Caution => ("0x02_CAUTION", "CAUTION"),
        SafetyGuardrailState::MultiHazard => ("0x03_MULTI_HAZARD", "MULTI_HAZARD"),
        SafetyGuardrailState::EvacShelter => ("0x04_EVAC_SHELTER", "EVAC_SHELTER"),
        SafetyGuardrailState::ShelterHold => ("0x05_SHELTER_HOLD", "SHELTER_HOLD"),
    }
}

/// State of EVA-07 at `t_target` Earth minutes from departure.
///
/// - Text fields, radio, dust and viability: last milestone at or before `t` (two milestones
///   share T+105: at exactly T+105 the first one titles the instant).
/// - Metabolic power, O2 rate, active threats, location and goal: the phase that contains `t`
///   (P1's phases are steps, not ramps).
/// - O2 left and accumulated doses: integrated from the last milestone with the phase rates and
///   the SPE profiles of the JSON (`spe_profile_comparison`), so every milestone is reproduced.
/// - Walkback times, routes and O2 needs: linear between milestones (the astronaut is walking);
///   dose projections only inside the SPE window.
/// - Guardrail state: `GuardrailFsm::evaluate` of the Rust core with those inputs.
fn sample_eva07(doc: &Value, t_target: f64) -> Option<Value> {
    let events = doc.get("events")?.as_array()?;
    let phases = doc.get("phases")?.as_array()?;
    if events.is_empty() || phases.is_empty() {
        return None;
    }
    let first_t = f(&events[0], "t_min");
    let last_t = f(&events[events.len() - 1], "t_min");
    let t = t_target.clamp(first_t, last_t);

    let i0 = events.iter().rposition(|e| f(e, "t_min") <= t).unwrap_or(0);
    let e0 = &events[i0];
    let t0 = f(e0, "t_min");
    let title_idx = if (t - t0).abs() < 1e-9 {
        events.iter().position(|e| (f(e, "t_min") - t0).abs() < 1e-9).unwrap_or(i0)
    } else {
        i0
    };
    let e_title = &events[title_idx];
    let e1 = events.get(i0 + 1);
    let phase = phase_at(phases, t);
    let v0 = e0.get("values")?;

    let mut values = v0.clone();
    let out = values.as_object_mut()?;

    // Steps from the phase.
    let power_w = f(phase, "power_w");
    let o2_l_min = f(phase, "o2_l_min");
    out.insert("metabolic_power_w".into(), json!(power_w));
    out.insert("o2_l_min".into(), json!(o2_l_min));

    // Integrated consumables and doses from the last milestone.
    let o2_used_l = integrate(t0, t, |tau| f(phase_at(phases, tau), "o2_l_min"));
    let o2_g = (f(v0, "o2_remaining_g") - o2_used_l * O2_DENSITY_G_PER_L).max(0.0);
    out.insert("o2_remaining_g".into(), json!(o2_g));
    out.insert("o2_remaining_pct".into(), json!(100.0 * o2_g / SUIT_O2_PRIMARY_USABLE_G));

    let factor = |tau: f64| {
        phase_at(phases, tau).get("dose_factor").and_then(Value::as_f64).unwrap_or(1.0)
    };
    let cal = profile_knots(doc, "rampa_calibrada");
    for (key, profile) in [
        ("dose_spe_msv", "rampa_calibrada"),
        ("dose_spe_env_msv", "envolvente"),
        ("dose_spe_linear_msv", "rampa_lineal"),
    ] {
        let knots = profile_knots(doc, profile);
        let add = integrate(t0, t, |tau| knots_rate(&knots, tau) * factor(tau)) / 60.0;
        out.insert(key.into(), json!(f(v0, key) + add));
    }
    let ext_rate = knots_rate(&cal, t);
    out.insert("spe_ext_rate_cal_msv_h".into(), json!(ext_rate));
    out.insert("spe_local_rate_msv_h".into(), json!(ext_rate * factor(t)));

    // Linear between milestones.
    if let Some(e1) = e1 {
        let t1 = f(e1, "t_min");
        if let (Some(v1), true) = (e1.get("values"), t1 > t0) {
            let alpha = ((t - t0) / (t1 - t0)).clamp(0.0, 1.0);
            let lerp = |key: &str| f(v0, key) + (f(v1, key) - f(v0, key)) * alpha;
            for key in [
                "dose_gcr_msv",
                "base_route_m",
                "base_time_min",
                "base_o2_need_g",
                "wp3_route_m",
                "wp3_time_min",
                "wp3_o2_need_g",
            ] {
                out.insert(key.into(), json!(lerp(key)));
            }
            let has_spe = |e: &Value| {
                e.get("active_threats")
                    .and_then(Value::as_array)
                    .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("spe")))
            };
            if has_spe(e0) && has_spe(e1) {
                for key in ["base_dose_proj_msv", "wp3_dose_proj_msv"] {
                    out.insert(key.into(), json!(lerp(key)));
                }
            }
        }
    }

    let threats: Vec<String> = phase
        .get("active_threats")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let has = |name: &str| threats.iter().any(|x| x == name);

    // Position, target and bearing.
    let loc = location_at(phases, t);
    let from_i = site_index(&loc.from);
    let to_i = site_index(&loc.to);
    let goal = s(phase, "goal").to_string();
    let goal_i = site_index(&goal);
    let (lat, lon_e) = match (from_i, to_i) {
        (Some(a), Some(b)) => {
            let (sa, sb) = (&SURVIVAL_TRIANGLE_SITE[a], &SURVIVAL_TRIANGLE_SITE[b]);
            (
                sa.lat_deg + (sb.lat_deg - sa.lat_deg) * loc.frac,
                sa.lon_deg + (sb.lon_deg - sa.lon_deg) * loc.frac,
            )
        }
        _ => (f64::NAN, f64::NAN),
    };
    let on_leg = loc.from != loc.to;
    let at_goal = !on_leg && loc.from == goal;
    let (target_bearing, target_dist_m) = match goal_i {
        Some(g) if !at_goal && lat.is_finite() => {
            let site = &SURVIVAL_TRIANGLE_SITE[g];
            // Leg bearing of P1 where the astronaut is on (or at the start of) a canonical leg.
            let leg = from_i.and_then(|a| leg_between(a, g));
            let bearing = match leg {
                Some(l) => SURVIVAL_TRIANGLE_LEGS[l].bearing_deg as f64,
                None => bearing_deg(lat, lon_e, site.lat_deg, site.lon_deg),
            };
            let dist = match goal.as_str() {
                "WP3" => f(&values, "wp3_route_m"),
                "BASE" => f(&values, "base_route_m"),
                _ => match leg {
                    Some(l) => SURVIVAL_TRIANGLE_LEGS[l].distance_m * (1.0 - loc.frac),
                    None => haversine_m(lat, lon_e, site.lat_deg, site.lon_deg),
                },
            };
            (bearing, dist)
        }
        _ => (f64::NAN, 0.0),
    };

    // Terrain under the astronaut for the guardrail (P1's own phase model): node values at a
    // node (the 22° ramp at WP2), leg grade and mean TIU of the two nodes on a leg.
    let (cell_slope, cell_tiu, cell_svf) = match (from_i, to_i) {
        (Some(a), Some(b)) if a == b => {
            let site = &SURVIVAL_TRIANGLE_SITE[a];
            let slope = if a == WP2_INDEX { WP2_RAMP_SLOPE_DEG } else { site.slope_dem_deg };
            (slope, site.thermal_inertia_tiu, site.sky_view_factor)
        }
        (Some(a), Some(b)) => {
            let (sa, sb) = (&SURVIVAL_TRIANGLE_SITE[a], &SURVIVAL_TRIANGLE_SITE[b]);
            let grade = leg_between(a, b)
                .map(|l| {
                    let leg = &SURVIVAL_TRIANGLE_LEGS[l];
                    (leg.delta_elev_m / leg.distance_m).atan().to_degrees().abs() as f32
                })
                .unwrap_or(0.0);
            (
                grade,
                (sa.thermal_inertia_tiu + sb.thermal_inertia_tiu) / 2.0,
                phase.get("svf_geo").and_then(Value::as_f64).unwrap_or(1.0) as f32,
            )
        }
        _ => (0.0, f32::NAN, 1.0),
    };

    let pre_eva = t < 0.0;
    let guardrail = if pre_eva {
        json!({
            "state": "PRE_EVA",
            "state_code": "PRE_EVA",
            "primary_cause": "PRE_EVA",
            "engine": "sin evaluar: astronauta en la Base (fase de consola)",
        })
    } else {
        let spe_rate = if has("spe") { SPE_PEAK_ENVELOPE_MSV_H } else { GCR_SURFACE_RATE_MSV_H };
        let hazards = ActiveHazards {
            h1_dust_storm: has("polvo"),
            h2_spe_radiation: has("spe"),
            h3_regolith_slope: has("trampa_regolito"),
            h4_nlos_offline: has("sombra_radio"),
            dust_tau: f(&values, "dust_tau") as f32,
            wind_speed_ms: if has("polvo") { DECISION_WIND_M_S } else { ActiveHazards::default().wind_speed_ms },
            spe_dose_rate_msv_h: spe_rate,
            rssi_dbm: f(&values, "radio_rssi_dbm") as f32,
        };
        let dose = f(&values, "dose_spe_msv") as f32;
        // P1 gives no time model for cooling water or battery: the engine only has their
        // autonomy at the T+105 decision. They are passed as those fixed inputs (the guardrail
        // does not read them) and are left out of T_vital, which here is O2 and radiation.
        let telemetry = PlssTelemetry {
            timestamp_s: t * 60.0,
            o2_remaining_liters: (o2_g / O2_DENSITY_G_PER_L) as f32,
            lcvg_water_remaining_min: DECISION_LCVG_REMAINING_MIN,
            battery_remaining_min: DECISION_BATTERY_REMAINING_MIN,
            current_o2_rate_l_min: o2_l_min as f32,
            cumulative_rad_msv: dose,
            mission_rad_limit_msv: EVA_SPE_DOSE_BUDGET_MSV,
            ..PlssTelemetry::default()
        };
        // T_vital with the O2 and radiation terms of
        // `MetabolicDStarPlanner::evaluate_walkback_detailed`.
        let t_o2 = telemetry.o2_remaining_liters as f64 / (o2_l_min.max(0.05));
        let local_rate = if has("spe") { spe_rate as f64 * (cell_svf as f64).clamp(0.05, 1.0) } else { 0.0 };
        let t_rad = if local_rate > 1e-6 {
            ((EVA_SPE_DOSE_BUDGET_MSV - dose).max(0.0) as f64 / local_rate) * 60.0
        } else {
            f64::INFINITY
        };
        let t_vital = t_o2.min(t_rad);
        let to_wp3 = s(&values, "viable_destination") == "WP3";
        let walkback = WalkbackDualStatus {
            t_vital_min: t_vital as f32,
            t_walkback_base_min: f(&values, "base_time_min") as f32,
            t_walkback_shelter_min: f(&values, "wp3_time_min") as f32,
            active_target: if to_wp3 { TargetGoal::Wp3Shelter } else { TargetGoal::BaseHabitat },
            dynamic_goal_switched: to_wp3,
            base_feasible: values.get("base_viable").and_then(Value::as_bool).unwrap_or(true),
        };
        let at_shelter = !on_leg && loc.from == "WP3";
        let frame = GuardrailFsm::new().evaluate(
            cell_slope,
            cell_tiu,
            at_shelter,
            &hazards,
            &telemetry,
            &walkback,
            if target_bearing.is_finite() { target_bearing as f32 } else { 0.0 },
            target_dist_m as f32,
        );
        let (code, name) = state_code(frame.state);
        json!({
            "state": name,
            "state_code": code,
            "primary_cause": frame.primary_cause,
            "ar_path_color_hex_engine": frame.ar_path_color_hex,
            "target_eta_min": round_to(frame.target_eta_min as f64, 2),
            "nlos_autonomous": frame.nlos_autonomous,
            "voice_summary_slots": frame.voice_summary_slots,
            "t_vital_min": if t_vital.is_finite() { json!(round_to(t_vital, 2)) } else { Value::Null },
            "engine": "GuardrailFsm::evaluate (red-atlas-core, Rust)",
            "inputs": {
                "cell_slope_deg": round_to(cell_slope as f64, 2),
                "cell_tiu": num(cell_tiu, 0),
                "cell_svf": round_to(cell_svf as f64, 2),
                "wind_m_s": hazards.wind_speed_ms,
                "spe_rate_msv_h": round_to(spe_rate as f64, 3),
                "t_vital_o2_min": round_to(t_o2.min(9999.0), 1),
                "t_vital_radiation_min": if t_rad.is_finite() { json!(round_to(t_rad, 1)) } else { Value::Null },
            },
        })
    };

    Some(json!({
        "t_min": round_to(t, 2),
        "lmst": format_lmst(t),
        "met": format_met(t),
        "id": s(e_title, "id"),
        "title": s(e_title, "title"),
        "threat": e_title.get("threat").cloned().unwrap_or(Value::Null),
        "active_threats": threats,
        "phase_id": s(phase, "phase_id"),
        "phase": {
            "description": s(phase, "description"),
            "location": s(phase, "location"),
            "goal": goal,
            "power_source": s(phase, "power_source"),
            "svf_geo": phase.get("svf_geo").cloned().unwrap_or(Value::Null),
            "dose_factor": phase.get("dose_factor").cloned().unwrap_or(Value::Null),
        },
        "position": {
            "from": loc.from,
            "to": loc.to,
            "frac": round_to(loc.frac, 4),
            "lat": if lat.is_finite() { json!(round_to(lat, 6)) } else { Value::Null },
            "lon_e": if lon_e.is_finite() { json!(round_to(lon_e, 6)) } else { Value::Null },
            "at_goal": at_goal,
            "target_bearing_deg": if target_bearing.is_finite() { json!(round_to(target_bearing, 0)) } else { Value::Null },
            "target_distance_m": round_to(target_dist_m, 0),
        },
        "values": values,
        "guardrail": guardrail,
        "source": "api",
    }))
}

// ============================================================================
// Terrain, hex grid, Spyglass and routes on P1's real grid
// ============================================================================

fn load_aoi(grid9: &H3MarsGrid) -> Aoi {
    if let Some(a) = read_json(LAYERS_CATALOG_REL, None).and_then(|c| c.get("aoi").cloned()) {
        let aoi = Aoi {
            lat_min: f(&a, "lat_min"),
            lat_max: f(&a, "lat_max"),
            lon_min: f(&a, "lon_e_min"),
            lon_max: f(&a, "lon_e_max"),
        };
        if aoi.lat_max > aoi.lat_min && aoi.lon_max > aoi.lon_min {
            return aoi;
        }
    }
    let mut aoi = Aoi { lat_min: f64::MAX, lat_max: f64::MIN, lon_min: f64::MAX, lon_max: f64::MIN };
    for c in grid9.cells.values() {
        let (lat, lon) = h3_to_lat_lon(c.h3_index);
        aoi.lat_min = aoi.lat_min.min(lat);
        aoi.lat_max = aoi.lat_max.max(lat);
        aoi.lon_min = aoi.lon_min.min(lon);
        aoi.lon_max = aoi.lon_max.max(lon);
    }
    aoi
}

/// Regular heightfield over the AOI: each node takes, without interpolation, the attributes of
/// the grid cell that contains it (res 12 if loaded, else res 9). Row 0 is the northern edge.
fn build_terrain_json(state: &AppState) -> String {
    let aoi = state.aoi;
    let (grid, res, source): (&H3MarsGrid, u8, &str) = match &state.grid12 {
        Some(g) => (g, 12, P1_GRID_PARQUET_REL),
        None => (&state.grid9, 9, GRID_RES9_REL),
    };
    let m_per_deg_lat = MARS_RADIUS_M.to_radians();
    let mid_lat = 0.5 * (aoi.lat_min + aoi.lat_max);
    let m_per_deg_lon = m_per_deg_lat * mid_lat.to_radians().cos();
    let height_m = (aoi.lat_max - aoi.lat_min) * m_per_deg_lat;
    let width_m = (aoi.lon_max - aoi.lon_min) * m_per_deg_lon;
    let rows = (height_m / TERRAIN_SPACING_M).round() as usize + 1;
    let cols = (width_m / TERRAIN_SPACING_M).round() as usize + 1;
    let n = rows * cols;
    let (mut elev, mut slope, mut svf, mut tiu, mut h2o, mut rssi, mut flags) = (
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
        Vec::with_capacity(n),
    );
    let (mut elev_min, mut elev_max) = (f32::MAX, f32::MIN);
    for r in 0..rows {
        let lat = aoi.lat_max - (aoi.lat_max - aoi.lat_min) * r as f64 / (rows - 1) as f64;
        for c in 0..cols {
            let lon = aoi.lon_min + (aoi.lon_max - aoi.lon_min) * c as f64 / (cols - 1) as f64;
            match grid.cells.get(&lat_lon_to_h3(lat, lon, res)) {
                Some(cell) => {
                    if !is_no_data(cell.elev_m) {
                        elev_min = elev_min.min(cell.elev_m);
                        elev_max = elev_max.max(cell.elev_m);
                    }
                    elev.push(num(cell.elev_m, 1));
                    slope.push(num(cell.slope_deg, 1));
                    svf.push(num(cell.sky_view_factor, 2));
                    tiu.push(num(cell.thermal_inertia_tiu, 0));
                    h2o.push(num(cell.isru_h2o_pct, 1));
                    rssi.push(num(cell.los_base_rssi_dbm, 0));
                    flags.push(json!(cell.hazard_bitmask));
                }
                None => {
                    for v in [&mut elev, &mut slope, &mut svf, &mut tiu, &mut h2o, &mut rssi] {
                        v.push(Value::Null);
                    }
                    flags.push(json!(0));
                }
            }
        }
    }
    json!({
        "source": source,
        "h3_res": res,
        "grid_cells": grid.len(),
        "crs": "IAU_2015:49900",
        "note": "Cada nodo toma sin interpolar los atributos de la celda H3 que lo contiene. Cota, pendiente, SVF y RSSI derivan del DTM CTX de 20 m; TIU y H2O solo existen en las zonas de escenario [E] de P1.",
        "aoi": { "lat_min": aoi.lat_min, "lat_max": aoi.lat_max, "lon_e_min": aoi.lon_min, "lon_e_max": aoi.lon_max },
        "rows": rows,
        "cols": cols,
        "spacing_m": TERRAIN_SPACING_M,
        "width_m": round_to(width_m, 1),
        "height_m": round_to(height_m, 1),
        "elev_min_m": num(elev_min, 1),
        "elev_max_m": num(elev_max, 1),
        "elev_m": elev,
        "slope_deg": slope,
        "sky_view_factor": svf,
        "thermal_inertia_tiu": tiu,
        "isru_h2o_pct": h2o,
        "los_base_rssi_dbm": rssi,
        "flags": flags,
        "flag_bits": {
            "slope_critical": HAZARD_FLAG_SLOPE_CRITICAL,
            "regolith_trap": HAZARD_FLAG_REGOLITH_TRAP,
            "shelter": HAZARD_FLAG_SHELTER,
            "nlos": HAZARD_FLAG_NLOS,
            "isru_water": HAZARD_FLAG_ISRU_WATER,
        },
    })
    .to_string()
}

/// The res-9 cells of P1 with their real H3 hexagon outlines.
fn build_hexgrid_json(state: &AppState) -> String {
    let mut cells: Vec<&HexCellState64B> = state.grid9.cells.values().collect();
    cells.sort_unstable_by_key(|c| c.h3_index);
    let out: Vec<Value> = cells
        .iter()
        .filter_map(|c| {
            let ci = CellIndex::try_from(c.h3_index).ok()?;
            let boundary: Vec<Value> = ci
                .boundary()
                .iter()
                .map(|ll| {
                    let lon_e = ll.lng().rem_euclid(360.0);
                    json!([round_to(ll.lat(), 6), round_to(lon_e, 6)])
                })
                .collect();
            let mut v = cell_json(c);
            v.as_object_mut()?.insert("boundary".into(), json!(boundary));
            Some(v)
        })
        .collect();
    json!({
        "source": GRID_RES9_REL,
        "h3_res": state.grid9.res,
        "cells": out,
    })
    .to_string()
}

/// Spyglass query on the res-12 grid with the three geometric 120° sectors of the engine
/// (`H3MarsGrid::query_spyglass_radius`).
fn spyglass_json(state: &AppState, lat: f64, lon_e: f64, radius_m: f64) -> Result<Value, &'static str> {
    let aoi = state.aoi;
    if lat < aoi.lat_min || lat > aoi.lat_max || lon_e < aoi.lon_min || lon_e > aoi.lon_max {
        return Err("outside_grid");
    }
    let grid: &H3MarsGrid = match &state.grid12 {
        Some(g) => g,
        None => &state.grid9,
    };
    let center = grid.nearest_cell(lat, lon_e).ok_or("outside_grid")?;
    let (c_lat, c_lon) = h3_to_lat_lon(center.h3_index);
    let radius_m = radius_m.clamp(0.0, SPYGLASS_MAX_RADIUS_M);
    let slice = grid.query_spyglass_radius(center.h3_index, radius_m);
    let m_per_deg = MARS_RADIUS_M.to_radians();
    let offset = |h3: u64| {
        let (la, lo) = h3_to_lat_lon(h3);
        (
            round_to((lo - c_lon) * m_per_deg * c_lat.to_radians().cos(), 1),
            round_to((la - c_lat) * m_per_deg, 1),
        )
    };
    let finite = |x: f32| !is_no_data(x) && x.is_finite();

    let water: Vec<Value> = slice
        .crism_water_cells
        .iter()
        .map(|&(h3, v)| {
            let (e, n) = offset(h3);
            json!([e, n, num(v, 1)])
        })
        .collect();
    let water_vals: Vec<f32> = slice.crism_water_cells.iter().map(|c| c.1).filter(|v| finite(*v)).collect();
    let traps: Vec<Value> = slice
        .themis_trap_cells
        .iter()
        .map(|&(h3, v)| {
            let (e, n) = offset(h3);
            json!([e, n, num(v, 0)])
        })
        .collect();
    let tiu_vals: Vec<f32> = slice.themis_trap_cells.iter().map(|c| c.1).filter(|v| finite(*v)).collect();
    let mola: Vec<Value> = slice
        .mola_slope_svf_cells
        .iter()
        .map(|&(h3, sl, sv, _)| {
            let (e, n) = offset(h3);
            json!([e, n, num(sl, 1), num(sv, 2)])
        })
        .collect();
    let slopes: Vec<f32> = slice.mola_slope_svf_cells.iter().map(|c| c.1).filter(|v| finite(*v)).collect();
    let svfs: Vec<f32> = slice.mola_slope_svf_cells.iter().map(|c| c.2).filter(|v| finite(*v)).collect();
    let max_of = |v: &[f32]| v.iter().copied().fold(f32::NAN, f32::max);
    let min_of = |v: &[f32]| v.iter().copied().fold(f32::NAN, f32::min);

    let parent9 = CellIndex::try_from(center.h3_index)
        .ok()
        .and_then(|c| c.parent(Resolution::Nine))
        .and_then(|p| state.grid9.get_cell(u64::from(p)))
        .map(cell_json)
        .unwrap_or(Value::Null);

    Ok(json!({
        "query": { "lat": lat, "lon_e": lon_e, "radius_m": radius_m },
        "h3_res": grid.res,
        "center": cell_json(center),
        "res9_parent": parent9,
        "sectors": {
            "north_h2o": {
                "bearing": "300°–60°",
                "cells": water.len(),
                "with_data": water_vals.len(),
                "max_pct": num(max_of(&water_vals), 1),
                "cells_ge_isru_min": water_vals.iter().filter(|v| **v >= red_atlas_shared::ISRU_WATER_MIN_PCT).count(),
                "points": water,
            },
            "right_tiu": {
                "bearing": "60°–180°",
                "cells": traps.len(),
                "with_data": tiu_vals.len(),
                "min_tiu": num(min_of(&tiu_vals), 0),
                "cells_trap": tiu_vals.iter().filter(|v| **v < red_atlas_shared::LOW_TIU_TRAP_THRESHOLD).count(),
                "points": traps,
            },
            "left_mola": {
                "bearing": "180°–300°",
                "cells": mola.len(),
                "max_slope_deg": num(max_of(&slopes), 1),
                "cells_slope_critical": slopes.iter().filter(|v| **v > red_atlas_shared::CRITICAL_SLOPE_DEG).count(),
                "min_svf": num(min_of(&svfs), 2),
                "cells_shelter": svfs.iter().filter(|v| **v <= red_atlas_shared::SHELTER_SVF_MAX).count(),
                "points": mola,
            },
        },
    }))
}

/// D* Lite plan of every canonical leg on P1's res-12 terrain at the sustained pace, under
/// nominal conditions (τ 0.7, GCR only). `spe_envelope_dose_msv` is what the same path would
/// cost under the 8 mSv/h design envelope (rate × SVF of each cell walked).
fn compute_route_plan(grid: &H3MarsGrid) -> Value {
    let nominal = ActiveHazards {
        h1_dust_storm: false,
        h2_spe_radiation: false,
        h3_regolith_slope: false,
        h4_nlos_offline: false,
        dust_tau: DUST_TAU_NOMINAL,
        wind_speed_ms: ActiveHazards::default().wind_speed_ms,
        spe_dose_rate_msv_h: GCR_SURFACE_RATE_MSV_H,
        rssi_dbm: ActiveHazards::default().rssi_dbm,
    };
    let weights = CostWeights::default();
    let mut legs = Vec::new();
    for leg in SURVIVAL_TRIANGLE_LEGS.iter() {
        let (a, b) = (&SURVIVAL_TRIANGLE_SITE[leg.from], &SURVIVAL_TRIANGLE_SITE[leg.to]);
        let (Some(ca), Some(cb)) = (
            grid.nearest_cell(a.lat_deg, a.lon_deg).map(|c| c.h3_index),
            grid.nearest_cell(b.lat_deg, b.lon_deg).map(|c| c.h3_index),
        ) else {
            continue;
        };
        let sub = grid.corridor_around(ca, &[cb], ROUTE_CORRIDOR_HALF_WIDTH_M);
        let (cells, adj) = sub.planner_graph();
        let mut planner = MetabolicDStarPlanner::new(cells, adj);
        let Some(path) = planner.plan_path(ca, cb, &nominal, &weights) else {
            legs.push(json!({ "leg_id": leg.id, "from": NODE_IDS[leg.from], "to": NODE_IDS[leg.to], "error": "sin ruta en la malla" }));
            continue;
        };
        let mut samples = Vec::with_capacity(path.profile.len() + 1);
        let start = grid.get_cell(ca);
        samples.push(json!({
            "d_m": 0.0, "t_min": 0.0,
            "elev_m": start.map_or(Value::Null, |c| num(c.elev_m, 1)),
            "grade_deg": Value::Null, "speed_mps": Value::Null, "power_w": Value::Null,
            "tiu": start.map_or(Value::Null, |c| num(c.thermal_inertia_tiu, 0)),
            "svf": start.map_or(Value::Null, |c| num(c.sky_view_factor, 2)),
            "rssi_dbm": start.map_or(Value::Null, |c| num(c.los_base_rssi_dbm, 1)),
            "lat": round_to(a.lat_deg, 6), "lon_e": round_to(a.lon_deg, 6),
        }));
        let mut envelope_dose = 0.0;
        let mut prev_t = 0.0;
        let step_keep = (path.profile.len() / 160).max(1);
        for (i, smp) in path.profile.iter().enumerate() {
            let cell = grid.get_cell(smp.h3);
            let svf = cell
                .map(|c| c.sky_view_factor)
                .filter(|v| !is_no_data(*v))
                .unwrap_or(1.0) as f64;
            envelope_dose += SPE_PEAK_ENVELOPE_MSV_H as f64 * svf.clamp(0.0, 1.0) * (smp.cum_time_min - prev_t) / 60.0;
            prev_t = smp.cum_time_min;
            if i % step_keep == 0 || i + 1 == path.profile.len() {
                let (lat, lon) = h3_to_lat_lon(smp.h3);
                samples.push(json!({
                    "d_m": round_to(smp.cum_dist_m, 1),
                    "t_min": round_to(smp.cum_time_min, 2),
                    "elev_m": cell.map_or(Value::Null, |c| num(c.elev_m, 1)),
                    "grade_deg": round_to(smp.grade_deg, 1),
                    "speed_mps": round_to(smp.speed_mps, 2),
                    "power_w": round_to(smp.power_w, 0),
                    "tiu": cell.map_or(Value::Null, |c| num(c.thermal_inertia_tiu, 0)),
                    "svf": cell.map_or(Value::Null, |c| num(c.sky_view_factor, 2)),
                    "rssi_dbm": cell.map_or(Value::Null, |c| num(c.los_base_rssi_dbm, 1)),
                    "lat": round_to(lat, 6), "lon_e": round_to(lon, 6),
                }));
            }
        }
        legs.push(json!({
            "leg_id": leg.id,
            "from": NODE_IDS[leg.from],
            "to": NODE_IDS[leg.to],
            "straight_distance_m": leg.distance_m,
            "bearing_deg": leg.bearing_deg,
            "length_m": round_to(path.length_m, 1),
            "time_min": round_to(path.estimated_time_min, 2),
            "mean_speed_mps": round_to(path.mean_speed_mps(), 3),
            "mean_power_w": round_to(path.mean_power_w(), 1),
            "o2_liters": round_to(path.estimated_o2_liters, 2),
            "o2_grams": round_to(path.estimated_o2_liters * O2_DENSITY_G_PER_L, 1),
            "gcr_dose_msv": round_to(path.estimated_rad_msv, 4),
            "spe_envelope_dose_msv": round_to(envelope_dose, 3),
            "cells": path.path_h3.len(),
            "profile": samples,
        }));
    }
    json!({
        "engine": "MetabolicDStarPlanner::plan_path (red-atlas-core, Rust)",
        "grid": { "path": P1_GRID_PARQUET_REL, "resolution": grid.res, "cells": grid.len(),
                  "planner_fingerprint": format!("{:016x}", grid.planner_fingerprint()) },
        "pace": { "speed_cap_mps": weights.pace.speed_cap_mps, "power_cap_w": weights.pace.power_cap_w },
        "conditions": "nominales: τ 0,7, solo GCR, ritmo de retorno sostenido",
        "corridor_half_width_m": ROUTE_CORRIDOR_HALF_WIDTH_M,
        "spe_envelope_msv_h": SPE_PEAK_ENVELOPE_MSV_H,
        "legs": legs,
    })
}

/// P1's route GeoJSON with the per-leg figures the shared contract asks for
/// (`src/shared/README.md` §2): metabolic cost, expected SPE dose and estimated time.
fn enriched_geojson(state: &AppState) -> Value {
    let mut out = state.geojson.clone();
    let plan = state.route_plan.get();
    if let Some(features) = out.get_mut("features").and_then(Value::as_array_mut) {
        for feat in features {
            let Some(props) = feat.get_mut("properties").and_then(Value::as_object_mut) else {
                continue;
            };
            let Some(leg_id) = props.get("leg_id").and_then(Value::as_str).map(str::to_string) else {
                continue;
            };
            let planned = plan
                .and_then(|p| p.get("legs"))
                .and_then(Value::as_array)
                .and_then(|legs| legs.iter().find(|l| s(l, "leg_id") == leg_id));
            // Figures of the T+105 decision (escape pace to WP3, sustained return to the Base)
            // exported by the engine: these are the canonical ones for the emergency.
            let decision = match leg_id.as_str() {
                "L3" => state.walkback_reference.as_ref().and_then(|w| w.get("wp3")),
                "R1" => state.walkback_reference.as_ref().and_then(|w| w.get("base")),
                _ => None,
            };
            if let Some(d) = decision {
                props.insert(
                    "decision_t105".into(),
                    json!({
                        "source": PLANNER_WALKBACK_JSON_REL,
                        "conditions": "decisión en T+105: envolvente SPE de 8 mSv/h × SVF de cada celda; ritmo de escape a WP3, retorno sostenido a la Base",
                        "walked_length_m": d.get("length_m"),
                        "estimated_time_min": d.get("time_min"),
                        "mean_power_w": d.get("mean_power_w"),
                        "metabolic_cost_o2_l": d.get("o2_liters"),
                        "expected_dose_spe_msv": d.get("dose_spe_msv"),
                    }),
                );
            }
            if let Some(l) = planned.filter(|l| l.get("error").is_none()) {
                props.insert(
                    "planner".into(),
                    json!({
                        "engine": "D* Lite metabólico (red-atlas-core) sobre la malla H3 res 12 de P1",
                        "conditions": "nominales: τ 0,7, solo GCR, ritmo sostenido (1,0 m/s y 585 W de tope)",
                        "walked_length_m": l.get("length_m"),
                        "estimated_time_min": l.get("time_min"),
                        "mean_power_w": l.get("mean_power_w"),
                        "metabolic_cost_o2_l": l.get("o2_liters"),
                        "metabolic_cost_o2_g": l.get("o2_grams"),
                        "expected_dose_gcr_msv": l.get("gcr_dose_msv"),
                        "expected_dose_spe_envelope_msv": l.get("spe_envelope_dose_msv"),
                    }),
                );
            }
        }
    }
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "export".into(),
            json!({
                "generated_by": "red-atlas-core api_server",
                "route_plan_available": plan.is_some(),
                "grid_parquet": P1_GRID_PARQUET_REL,
                "bundle_sha256": state.bundle.sha256_hex,
                "bundle_bytes": state.bundle.bytes,
                "bundle_files": state.bundle.files,
            }),
        );
    }
    out
}

// ============================================================================
// HTTP
// ============================================================================

fn handle_client(mut stream: TcpStream, state: Arc<AppState>) {
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let full_path = parts.next().unwrap_or("/");

    if method == "OPTIONS" {
        send_json(&mut stream, "204 No Content", "");
        return;
    }

    let (path, query) = full_path.split_once('?').unwrap_or((full_path, ""));

    match (method, path) {
        ("GET", "/api/health") => {
            let body = json!({
                "status": "ok",
                "engine": "red-atlas-core (Rust)",
                "h3_res": state.grid9.res,
                "h3_cells_loaded": state.grid9.len(),
                "h3_res12_cells": state.grid12.as_ref().map_or(0, |g| g.len()),
                "events": state.events_doc.get("events").and_then(Value::as_array).map_or(0, Vec::len),
                "route_plan_ready": state.route_plan.get().is_some(),
            });
            send_json(&mut stream, "200 OK", &body.to_string());
        }
        ("GET", "/api/eva07") => match query_f64(query, "t") {
            Some(t) => match sample_eva07(&state.events_doc, t) {
                Some(ev) => send_json(&mut stream, "200 OK", &ev.to_string()),
                None => send_json(&mut stream, "500 Internal Server Error", r#"{"error":"bad_events_json"}"#),
            },
            None => send_json(&mut stream, "200 OK", &state.events_doc.to_string()),
        },
        ("GET", "/api/geojson") => {
            send_json(&mut stream, "200 OK", &enriched_geojson(&state).to_string());
        }
        ("GET", "/api/terrain") => {
            let body = state.terrain_json.get_or_init(|| build_terrain_json(&state));
            send_json(&mut stream, "200 OK", body);
        }
        ("GET", "/api/hexgrid") => {
            let body = state.hexgrid_json.get_or_init(|| build_hexgrid_json(&state));
            send_json(&mut stream, "200 OK", body);
        }
        ("GET", "/api/spyglass") => {
            match (query_f64(query, "lat"), query_f64(query, "lon")) {
                (Some(lat), Some(lon)) => {
                    let radius = query_f64(query, "radius_m").unwrap_or(60.0);
                    match spyglass_json(&state, lat, lon, radius) {
                        Ok(v) => send_json(&mut stream, "200 OK", &v.to_string()),
                        Err(e) => send_json(&mut stream, "404 Not Found", &json!({ "error": e }).to_string()),
                    }
                }
                _ => send_json(&mut stream, "400 Bad Request", r#"{"error":"lat_lon_required"}"#),
            }
        }
        ("GET", "/api/route-plan") => match state.route_plan.get() {
            Some(plan) => send_json(&mut stream, "200 OK", &plan.to_string()),
            None if state.grid12.is_none() => {
                send_json(&mut stream, "503 Service Unavailable", r#"{"error":"res12_grid_not_loaded"}"#)
            }
            None => send_json(&mut stream, "503 Service Unavailable", r#"{"error":"route_plan_computing"}"#),
        },
        ("GET", "/api/chaos-mode") => {
            let seed = parse_query_param(query, "seed")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(CHAOS_SEED);
            let trials = parse_query_param(query, "trials")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(100)
                .clamp(1, CHAOS_TRIALS);
            let report = run_chaos_mode_monte_carlo(&state.chaos_cells, trials, seed, CHAOS_SOLAR_HOUR);
            let body = json!({
                "engine": "run_chaos_mode_monte_carlo (red-atlas-core, Rust)",
                "seed": seed,
                "trials": trials,
                "mars_solar_hour": CHAOS_SOLAR_HOUR,
                "corridor": format!("corredor sintético de Melas Chasma, H3 res {CHAOS_CORRIDOR_RES}, celdas ordenadas por índice"),
                "corridor_cells": state.chaos_cells.len(),
                "dose_budget_msv": EVA_SPE_DOSE_BUDGET_MSV,
                "report": report,
            });
            send_json(&mut stream, "200 OK", &body.to_string());
        }
        ("GET", "/api/chaos-reference") => match &state.chaos_reference {
            Some(v) => send_json(&mut stream, "200 OK", &v.to_string()),
            None => send_json(&mut stream, "404 Not Found", r#"{"error":"chaos_mode_results_missing"}"#),
        },
        ("GET", "/api/walkback") => match &state.walkback_reference {
            Some(v) => send_json(&mut stream, "200 OK", &v.to_string()),
            None => send_json(&mut stream, "404 Not Found", r#"{"error":"planner_walkback_missing"}"#),
        },
        ("GET", "/api/metabolic") => {
            let grade_deg = query_f64(query, "grade").unwrap_or(WP2_RAMP_SLOPE_DEG as f64);
            let tiu = query_f64(query, "tiu").unwrap_or(SURVIVAL_TRIANGLE_SITE[WP2_INDEX].thermal_inertia_tiu as f64) as f32;
            let speed_mps = query_f64(query, "speed").unwrap_or(red_atlas_shared::WP2_TRAVERSE_SPEED_MPS);
            let slip_fraction = query_f64(query, "slip").unwrap_or(red_atlas_shared::WP2_SLIP_FRACTION);
            let power_w = pandolf_mars_metabolic_watts(grade_deg, tiu, speed_mps, slip_fraction);
            let body = json!({
                "grade_deg": grade_deg,
                "tiu": tiu,
                "speed_mps": speed_mps,
                "slip_fraction": slip_fraction,
                "power_w": power_w,
                "o2_l_min": metabolic_o2_rate_l_min(power_w),
            });
            send_json(&mut stream, "200 OK", &body.to_string());
        }
        ("POST", "/api/zenoh-sync") => {
            // The demo has no Zenoh session: the bundle is prepared and hashed, not transmitted.
            let body = json!({
                "synced": true,
                "simulated": true,
                "transport": "sin sesión Zenoh real en la demo: paquete preparado y verificado en la consola",
                "key_expr": "redatlas/eva07/mission/bundle_sync",
                "checksum_algo": "SHA-256",
                "checksum": state.bundle.sha256_hex,
                "bundle_bytes": state.bundle.bytes,
                "bundle_files": state.bundle.files,
                "cells_synced": state.grid12.as_ref().map_or(state.grid9.len(), |g| g.len()),
                "h3_res": state.grid12.as_ref().map_or(state.grid9.res, |g| g.res),
            });
            send_json(&mut stream, "200 OK", &body.to_string());
        }
        _ => {
            send_json(&mut stream, "404 Not Found", r#"{"error":"not_found"}"#);
        }
    }
}

fn main() {
    let events_doc = read_json(EVENTS_JSON_REL, Some(EVENTS_JSON_FALLBACK)).expect("valid eva07_events.json");
    let geojson = read_json(GEOJSON_REL, Some(GEOJSON_FALLBACK)).expect("valid triangulo_supervivencia.geojson");

    let grid9 = H3MarsGrid::load_p1_parquet(repo_path(GRID_RES9_REL)).expect("load P1 res-9 parquet");
    println!("[api_server] Malla P1 res 9: {} celdas ({GRID_RES9_REL})", grid9.len());
    let grid12 = match H3MarsGrid::load_p1_parquet(repo_path(P1_GRID_PARQUET_REL)) {
        Ok(g) => {
            println!("[api_server] Malla P1 res 12: {} celdas ({P1_GRID_PARQUET_REL})", g.len());
            Some(Arc::new(g))
        }
        Err(e) => {
            println!("[api_server] AVISO: sin malla res 12 ({e}); terreno y lupa caen a res 9, sin plan de ruta");
            None
        }
    };
    let aoi = load_aoi(&grid9);

    let state = Arc::new(AppState {
        events_doc,
        geojson,
        chaos_reference: read_json(CHAOS_MODE_JSON_REL, None),
        walkback_reference: read_json(PLANNER_WALKBACK_JSON_REL, None),
        grid9,
        grid12,
        aoi,
        chaos_cells: chaos_corridor_cells(),
        terrain_json: OnceLock::new(),
        hexgrid_json: OnceLock::new(),
        route_plan: OnceLock::new(),
        bundle: compute_bundle(),
    });

    // The per-leg D* Lite plans take a few seconds: compute them in the background.
    if let Some(grid) = state.grid12.clone() {
        let st = Arc::clone(&state);
        std::thread::spawn(move || {
            let started = std::time::Instant::now();
            let plan = compute_route_plan(&grid);
            let _ = st.route_plan.set(plan);
            println!("[api_server] Plan de ruta D* Lite listo en {:.1} s", started.elapsed().as_secs_f64());
        });
    }

    let listener = TcpListener::bind("127.0.0.1:3001").expect("bind 127.0.0.1:3001");
    println!("[api_server] R.E.D. ATLAS Rust API listening on http://127.0.0.1:3001");

    for stream in listener.incoming().flatten() {
        let st = Arc::clone(&state);
        std::thread::spawn(move || handle_client(stream, st));
    }
}

// Kept reachable for the unit tests below (reference figures of the exported run).
#[cfg(test)]
fn events_doc() -> Value {
    read_json(EVENTS_JSON_REL, Some(EVENTS_JSON_FALLBACK)).expect("valid eva07_events.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_fips_vectors() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // Two-block message (56 bytes force a second padding block).
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn lmst_reproduces_every_p1_milestone() {
        let doc = events_doc();
        for e in doc["events"].as_array().unwrap() {
            assert_eq!(format_lmst(f(e, "t_min")), s(e, "lmst"), "T{:+}", f(e, "t_min"));
        }
    }

    #[test]
    fn sampling_reproduces_every_p1_milestone() {
        let doc = events_doc();
        for e in doc["events"].as_array().unwrap() {
            let t = f(e, "t_min");
            let smp = sample_eva07(&doc, t).unwrap();
            let (v, w) = (&smp["values"], &e["values"]);
            for key in ["o2_remaining_g", "dose_spe_msv", "dose_spe_env_msv", "dose_spe_linear_msv",
                        "metabolic_power_w", "o2_l_min", "base_time_min", "wp3_time_min", "dust_tau"] {
                assert!((f(v, key) - f(w, key)).abs() < 1e-2, "T{t:+} {key}: {} vs {}", f(v, key), f(w, key));
            }
            assert_eq!(s(v, "radio_class"), s(w, "radio_class"), "T{t:+}");
        }
        // Titles at the exact milestones (two milestones share T+105: the first one titles it).
        let title = |t: f64| sample_eva07(&doc, t).unwrap()["title"].as_str().unwrap().to_string();
        assert!(title(28.0).starts_with("Llegada a WP1"));
        assert!(title(92.0).starts_with("Amenaza 1"));
        assert!(title(98.0).starts_with("Amenaza 2"));
        assert!(title(105.0).starts_with("Amenazas 3 y 4"));
        assert!(title(106.0).starts_with("Dynamic Goal Switching"));
        assert!(title(114.0).starts_with("Llegada a WP3"));
    }

    #[test]
    fn phase_values_are_steps_not_ramps() {
        let doc = events_doc();
        let v = |t: f64, key: &str| f(&sample_eva07(&doc, t).unwrap()["values"], key);
        assert!((v(95.0, "metabolic_power_w") - 539.08).abs() < 0.1);
        assert!((v(100.0, "metabolic_power_w") - 1072.91).abs() < 0.1);
        assert!((v(103.0, "metabolic_power_w") - 585.0).abs() < 0.1);
        assert!((v(100.0, "dust_tau") - 0.7).abs() < 1e-9);
        assert!((v(104.0, "dust_tau") - 0.7).abs() < 1e-9);
        assert!((v(105.0, "dust_tau") - 2.4).abs() < 1e-9);
        assert_eq!(v(104.9, "base_dose_proj_msv"), 0.0);
    }

    #[test]
    fn guardrail_states_follow_the_shared_fsm() {
        let doc = events_doc();
        let state = |t: f64| sample_eva07(&doc, t).unwrap()["guardrail"]["state"].as_str().unwrap().to_string();
        println!("T      estado          causa");
        for t in [-45.0, 0.0, 10.0, 28.0, 50.0, 75.0, 85.0, 92.0, 95.0, 98.0, 100.0, 104.0, 105.0,
                  110.0, 114.0, 114.5, 115.0, 125.0, 140.0, 158.0, 165.0] {
            let smp = sample_eva07(&doc, t).unwrap();
            println!("{t:6.1} {:15} {}", s(&smp["guardrail"], "state"), s(&smp["guardrail"], "primary_cause"));
        }
        assert_eq!(state(-10.0), "PRE_EVA");
        assert_eq!(state(10.0), "CAUTION"); // mean TIU of L1 (365) is in the amber band
        assert_eq!(state(50.0), "NOMINAL");
        assert_eq!(state(95.0), "CAUTION");
        assert_eq!(state(100.0), "MULTI_HAZARD");
        assert_eq!(state(104.0), "MULTI_HAZARD");
        assert_eq!(state(105.0), "EVAC_SHELTER");
        assert_eq!(state(110.0), "EVAC_SHELTER");
        assert_eq!(state(120.0), "SHELTER_HOLD");
        assert_eq!(state(165.0), "SHELTER_HOLD");
    }

    #[test]
    fn evacuation_points_to_the_canonical_bearing() {
        let doc = events_doc();
        let smp = sample_eva07(&doc, 105.0).unwrap();
        let escape = &SURVIVAL_TRIANGLE_LEGS[red_atlas_shared::ESCAPE_LEG_WP2_WP3];
        assert_eq!(f(&smp["position"], "target_bearing_deg"), escape.bearing_deg as f64);
        assert_eq!(s(&smp["phase"], "goal"), "WP3");
    }

    #[test]
    fn chaos_mode_reproduces_the_exported_reference() {
        let reference = read_json(CHAOS_MODE_JSON_REL, None).expect("chaos_mode_results.json");
        let cells = chaos_corridor_cells();
        let report = run_chaos_mode_monte_carlo(&cells, CHAOS_TRIALS, CHAOS_SEED, CHAOS_SOLAR_HOUR);
        assert_eq!(report.survived_with_wp3_shelter as f64, f(&reference["report"], "survived_with_wp3_shelter"));
        assert_eq!(report.survived_base_only as f64, f(&reference["report"], "survived_base_only"));
    }
}
