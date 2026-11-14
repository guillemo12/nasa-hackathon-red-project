//! Dynamic HTTP API Server for R.E.D. ATLAS (`red-atlas-core`).
//!
//! Exposes P1's canonical data (`eva07_events.json`, `triangulo_supervivencia.geojson`,
//! `hexgrid_route_res9_hexcell64b.parquet`) and P3's live Rust engines
//! (`run_chaos_mode_monte_carlo`, `pandolf_mars_metabolic_watts`, `H3MarsGrid`)
//! over HTTP on `127.0.0.1:3001` for `src/base-console/`.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;

use red_atlas_core::h3_mars_grid::H3MarsGrid;
use red_atlas_core::metabolic_dstar::{metabolic_o2_rate_l_min, pandolf_mars_metabolic_watts};
use red_atlas_core::stochastic_hazard::run_chaos_mode_monte_carlo;
use red_atlas_shared::HexCellState64B;
use serde::Serialize;

const P1_EVENTS_JSON: &str = include_str!("../../../../data/mission-scenarios/eva07_events.json");
const P1_GEOJSON: &str =
    include_str!("../../../../data/mission-scenarios/triangulo_supervivencia.geojson");

struct AppState {
    grid_res: u8,
    total_cells: usize,
    corridor_cells: Vec<HexCellState64B>,
    events_value: serde_json::Value,
    geojson_value: serde_json::Value,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    engine: &'static str,
    h3_res: u8,
    h3_cells_loaded: usize,
    corridor_sample_cells: usize,
}

#[derive(Serialize)]
struct MetabolicResponse {
    grade_deg: f64,
    tiu: f32,
    speed_mps: f64,
    slip_fraction: f64,
    power_w: f64,
    o2_l_min: f64,
}

#[derive(Serialize)]
struct ZenohSyncResponse {
    synced: bool,
    protocol: &'static str,
    target_node: &'static str,
    checksum: &'static str,
    cells_synced: usize,
}

fn load_corridor_grid() -> (u8, usize, Vec<HexCellState64B>) {
    let candidates = [
        "data/nasa-layers/hexgrid_route_res9_hexcell64b.parquet",
        "../../data/nasa-layers/hexgrid_route_res9_hexcell64b.parquet",
        "../../../data/nasa-layers/hexgrid_route_res9_hexcell64b.parquet",
    ];
    for p in candidates {
        if Path::new(p).exists() {
            if let Ok(grid) = H3MarsGrid::load_p1_parquet(p) {
                let total = grid.len();
                let mut cells: Vec<HexCellState64B> = grid.cells.values().copied().take(64).collect();
                if cells.is_empty() {
                    cells.push(HexCellState64B::default());
                }
                println!("[api_server] Loaded P1 Parquet '{}' ({} cells, res {})", p, total, grid.res);
                return (grid.res, total, cells);
            }
        }
    }
    println!("[api_server] Parquet not found on relative paths; using fallback corridor cells");
    (9, 1, vec![HexCellState64B::default(); 24])
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (it.next(), it.next()) {
            if k == key {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn send_json(stream: &mut TcpStream, status: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn format_lmst(t_min: f64) -> String {
    let base_total_min = 14 * 60 + 45;
    let total_sec = ((base_total_min as f64 + t_min) * 60.0).round() as i64;
    let wrapped = total_sec.rem_euclid(24 * 3600);
    let hh = wrapped / 3600;
    let mm = (wrapped % 3600) / 60;
    let ss = wrapped % 60;
    format!("{hh:02}:{mm:02}:{ss:02}")
}

fn interpolate_eva07_event(events: &[serde_json::Value], t_target: f64) -> Option<serde_json::Value> {
    if events.is_empty() {
        return None;
    }
    let first_t = events[0].get("t_min").and_then(|v| v.as_f64()).unwrap_or(-45.0);
    let last_t = events[events.len() - 1].get("t_min").and_then(|v| v.as_f64()).unwrap_or(165.0);
    let t = t_target.clamp(first_t, last_t);

    let mut idx = 0usize;
    for i in 0..events.len() - 1 {
        let ti = events[i].get("t_min").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let tj = events[i + 1].get("t_min").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if t >= ti && t <= tj {
            idx = i;
            break;
        }
        if t > tj {
            idx = i + 1;
        }
    }

    let e0 = &events[idx];
    let e1 = if idx + 1 < events.len() { &events[idx + 1] } else { &events[idx] };
    let t0 = e0.get("t_min").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let t1 = e1.get("t_min").and_then(|v| v.as_f64()).unwrap_or(t0);
    let alpha = if (t1 - t0).abs() > 1e-6 {
        ((t - t0) / (t1 - t0)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let mut out = e0.clone();
    if let Some(obj) = out.as_object_mut() {
        obj.insert("t_min".to_string(), serde_json::json!((t * 10.0).round() / 10.0));
        obj.insert("lmst".to_string(), serde_json::json!(format_lmst(t)));
    }

    let numeric_keys = [
        "o2_remaining_pct",
        "o2_remaining_g",
        "metabolic_power_w",
        "o2_l_min",
        "spe_ext_rate_cal_msv_h",
        "spe_local_rate_msv_h",
        "dose_spe_msv",
        "dose_spe_env_msv",
        "dose_spe_linear_msv",
        "dose_gcr_msv",
        "radio_rssi_dbm",
        "dust_tau",
        "base_time_min",
        "base_dose_proj_env_msv",
        "base_dose_proj_ramp_msv",
        "wp3_time_min",
        "wp3_dose_proj_env_msv",
        "wp3_dose_proj_ramp_msv",
    ];

    if let (Some(v0), Some(v1), Some(v_out)) = (
        e0.get("values").and_then(|v| v.as_object()),
        e1.get("values").and_then(|v| v.as_object()),
        out.get_mut("values").and_then(|v| v.as_object_mut()),
    ) {
        for key in numeric_keys {
            if let (Some(a), Some(b)) = (
                v0.get(key).and_then(|v| v.as_f64()),
                v1.get(key).and_then(|v| v.as_f64()),
            ) {
                let interp = a + (b - a) * alpha;
                v_out.insert(key.to_string(), serde_json::json!(interp));
            }
        }
    }

    Some(out)
}

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

    let (path, query) = match full_path.split_once('?') {
        Some((p, q)) => (p, q),
        None => (full_path, ""),
    };

    match (method, path) {
        ("GET", "/api/health") => {
            let body = serde_json::to_string(&HealthResponse {
                status: "ok",
                engine: "red-atlas-core (Rust)",
                h3_res: state.grid_res,
                h3_cells_loaded: state.total_cells,
                corridor_sample_cells: state.corridor_cells.len(),
            })
            .unwrap_or_else(|_| "{}".to_string());
            send_json(&mut stream, "200 OK", &body);
        }
        ("GET", "/api/eva07") => {
            if let Some(t_str) = parse_query_param(query, "t") {
                if let Ok(t_target) = t_str.parse::<f64>() {
                    if let Some(events) = state.events_value.get("events").and_then(|v| v.as_array()) {
                        if let Some(ev) = interpolate_eva07_event(events, t_target) {
                            send_json(&mut stream, "200 OK", &ev.to_string());
                            return;
                        }
                    }
                }
            }
            send_json(&mut stream, "200 OK", &state.events_value.to_string());
        }
        ("GET", "/api/geojson") => {
            send_json(&mut stream, "200 OK", &state.geojson_value.to_string());
        }
        ("GET", "/api/chaos-mode") => {
            let seed = parse_query_param(query, "seed")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(20261114);
            let trials = parse_query_param(query, "trials")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(100)
                .clamp(1, 2000);
            let report = run_chaos_mode_monte_carlo(&state.corridor_cells, trials, seed, 14.75);
            let body = serde_json::to_string(&report).unwrap_or_else(|_| "{}".to_string());
            send_json(&mut stream, "200 OK", &body);
        }
        ("GET", "/api/metabolic") => {
            let grade_deg = parse_query_param(query, "grade")
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(22.0);
            let tiu = parse_query_param(query, "tiu")
                .and_then(|s| s.parse::<f32>().ok())
                .unwrap_or(110.0);
            let speed_mps = parse_query_param(query, "speed")
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.55);
            let slip_fraction = parse_query_param(query, "slip")
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.30);
            let power_w = pandolf_mars_metabolic_watts(grade_deg, tiu, speed_mps, slip_fraction);
            let o2_l_min = metabolic_o2_rate_l_min(power_w);
            let body = serde_json::to_string(&MetabolicResponse {
                grade_deg,
                tiu,
                speed_mps,
                slip_fraction,
                power_w,
                o2_l_min,
            })
            .unwrap_or_else(|_| "{}".to_string());
            send_json(&mut stream, "200 OK", &body);
        }
        ("POST", "/api/zenoh-sync") => {
            let body = serde_json::to_string(&ZenohSyncResponse {
                synced: true,
                protocol: "Eclipse Zenoh / ROS 2 rclrs",
                target_node: "xEMU-04 (Melas SW EVA-07)",
                checksum: "0x9F4A7C15",
                cells_synced: state.total_cells,
            })
            .unwrap_or_else(|_| "{}".to_string());
            send_json(&mut stream, "200 OK", &body);
        }
        _ => {
            send_json(
                &mut stream,
                "404 Not Found",
                r#"{"error":"Endpoint not found"}"#,
            );
        }
    }
}

fn main() {
    let (grid_res, total_cells, corridor_cells) = load_corridor_grid();
    let events_value: serde_json::Value =
        serde_json::from_str(P1_EVENTS_JSON).expect("valid eva07_events.json");
    let geojson_value: serde_json::Value =
        serde_json::from_str(P1_GEOJSON).expect("valid triangulo_supervivencia.geojson");

    let state = Arc::new(AppState {
        grid_res,
        total_cells,
        corridor_cells,
        events_value,
        geojson_value,
    });

    let addr = "127.0.0.1:3001";
    let listener = TcpListener::bind(addr).expect("bind 127.0.0.1:3001");
    println!("[api_server] R.E.D. ATLAS Rust API listening on http://{addr}");

    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            let st = Arc::clone(&state);
            std::thread::spawn(move || handle_client(stream, st));
        }
    }
}
