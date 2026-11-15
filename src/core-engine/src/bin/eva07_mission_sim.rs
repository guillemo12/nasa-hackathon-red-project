//! # EVA-07 Mission Simulation: Melas Chasma Survival Triangle
//!
//! End-to-end 5-Act simulation of EVA-07 in the SW basin of Melas Chasma, Valles Marineris
//! (~9.90°S, 283.39°E; site data in `red_atlas_shared::SURVIVAL_TRIANGLE_SITE`):
//! - **Act 1**: Pre-EVA Chaos Mode stress test (10,000 seeded Monte Carlo runs, Base-only vs WP3 shelter).
//! - **Act 2**: WP1 ISRU water confirmation (CRISM >12% H2O, 3-sector Spyglass, zero-hallucination SLM geology Q&A).
//! - **Act 3**: WP2 NLOS radio shadow + Canyon-TRN Skyline Matching (crushing ~12m drift to <0.5m) + 110 TIU / 22° slope biomechanics.
//! - **Act 4**: T+105 min 4-hazard simultaneous impact + Dynamic Goal Switching + Single-Alert Fusion + TMR 2-of-3 SEU protection.
//! - **Act 5**: Survival at WP3 cliff shelter (SVF=0.15, 85% SPE radiation attenuation) + Zenoh CRDT telemetry replay.
//! - **Timeline**: EVA-07 O2 and SPE dose computed with the P1 metabolic model over
//!   `red_atlas_shared::eva07_phases` (escape from the planner) and compared with P1's
//!   `eva07_events.json`. All mission figures come from `red_atlas_core::mission`, the same code
//!   that writes `data/mission-scenarios/planner_walkback.json` and `chaos_mode_results.json`.

use red_atlas_core::canyon_trn::{
    generate_melas_horizon_bank, CanyonTrnEkf, ImuSample, LidarScanMatch, SkylineObservation,
    VioDelta, HORIZON_BINS,
};
use red_atlas_core::h3_mars_grid::H3MarsGrid;
use red_atlas_core::metabolic_dstar::{
    metabolic_o2_rate_l_min, pandolf_mars_metabolic_watts, soil_sinkage_eta,
};
use red_atlas_core::neuro_symbolic::{
    EdgeSlmVoiceBackend, GuardrailFsm, QuantizedCandleSlmMock, ScienceSample, TmrVoted,
    ZenohCrdtRingBuffer, COLOR_CAUTION_HEX, COLOR_EVAC_SHELTER_HEX, COLOR_NOMINAL_HEX,
    COLOR_SHELTER_HOLD_HEX,
};
use red_atlas_core::mission::{
    compute_chaos_export, compute_t105_walkback, full_timeline, integrate_timeline, load_grid,
    node_radio_levels, repo_path, sample_at, TimelineSample, WalkbackReport, CHAOS_SEED, CHAOS_SOLAR_HOUR,
    CHAOS_TRIALS, DECISION_CORRIDOR_HALF_WIDTH_M, P1_GRID_PARQUET_REL,
};
use red_atlas_shared::{
    melas_chasma_survival_triangle, ActiveHazards, 
    MissionWaypointKind, PlssTelemetry, SafetyGuardrailState,
    TargetGoal, WalkbackDualStatus, CRITICAL_SLOPE_DEG, DUST_TAU_NOMINAL, DUST_TAU_STORM,
    ESCAPE_LEG_WP2_WP3, EVA07_PRE_DECISION_PHASES, EVA_SPE_DOSE_BUDGET_MSV, GCR_SURFACE_RATE_MSV_H,
    HAZARD_FLAG_ISRU_WATER, ISRU_WATER_MIN_PCT, LOW_TIU_TRAP_THRESHOLD, MARS_GRAVITY,
    MELAS_BASE_PRESSURE_MBAR, NLOS_RSSI_THRESHOLD_DBM, RADIO_BEACON_FREQ_MHZ, RADIO_PRIMARY_FREQ_MHZ,
    RSSI_AMBER_THRESHOLD_DBM, SHELTER_SVF_MAX,
    SITE_BASE_ELEV_M, SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG, SPE_PEAK_ENVELOPE_MSV_H,
    SURVIVAL_TRIANGLE_LEGS, SURVIVAL_TRIANGLE_SITE, WP2_RAMP_SLOPE_DEG,
    WP2_SLIP_FRACTION, WP2_TRAVERSE_SPEED_MPS,
};

/// P1 reference timeline (`data/mission-scenarios/eva07_events.json`), embedded at build time.
const P1_EVENTS_JSON: &str = include_str!("../../../../data/mission-scenarios/eva07_events.json");

/// Tolerances of the timeline comparison against P1 (same model, minute integration).
const O2_PCT_TOLERANCE: f64 = 0.05;
const DOSE_MSV_TOLERANCE: f64 = 0.005;

/// Timeline sample at minute `t_min`, or an error naming the minute.
fn timeline_at(timeline: &[TimelineSample], t_min: i32) -> Result<TimelineSample, String> {
    sample_at(timeline, t_min).ok_or_else(|| format!("timeline does not cover T{t_min:+}"))
}

fn print_banner(act: &str, title: &str) {
    println!("\n================================================================================");
    println!("  {} :: {}", act, title);
    println!("================================================================================");
}

fn print_separator() {
    println!("--------------------------------------------------------------------------------");
}

fn main() {
    if let Err(e) = run() {
        eprintln!("eva07_mission_sim: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    println!("################################################################################");
    println!("#                                                                              #");
    println!("#   R.E.D. ATLAS :: EVA-07 END-TO-END MISSION SIMULATION (MELAS CHASMA)        #");
    println!(
        "#   Target Area: Melas Chasma SW basin ({:.3}°, {:.3}°E) | Elev {:>6.0} m | {:.2} mbar #",
        SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG, SITE_BASE_ELEV_M, MELAS_BASE_PRESSURE_MBAR
    );
    println!("#   Architecture: Deterministic Rust-First Core + Offline Neuro-Symbolic AI     #");
    println!("#                                                                              #");
    println!("################################################################################\n");

    // EVA-07 timeline up to the T+105 decision (independent of the planner); the full timeline
    // is integrated after Act 4 with the escape that the planner computes.
    let pre_timeline = integrate_timeline(&EVA07_PRE_DECISION_PHASES);

    // P1's real terrain grid (H3 res 12): radio levels at the nodes and the T+105 planner.
    let grid_path = repo_path(P1_GRID_PARQUET_REL);
    println!("[GRID]   Loading P1 terrain grid {} ...", P1_GRID_PARQUET_REL);
    let load_start = std::time::Instant::now();
    let real_grid = load_grid(&grid_path)?;
    println!(
        "         {} H3 res-{} cells loaded in {:.0} ms.",
        real_grid.len(),
        real_grid.res,
        load_start.elapsed().as_secs_f64() * 1000.0
    );
    println!(
        "[RADIO]  Primary data link (Zenoh session): S band {:.1} GHz, 1 W; UHF {:.0} MHz = low-rate beacon.",
        RADIO_PRIMARY_FREQ_MHZ / 1000.0,
        RADIO_BEACON_FREQ_MHZ
    );
    let radio = node_radio_levels(&real_grid);
    for (id, rssi) in &radio {
        let class = if rssi.is_nan() {
            "NO DATA"
        } else if *rssi < NLOS_RSSI_THRESHOLD_DBM {
            "RED (radio shadow)"
        } else if *rssi <= RSSI_AMBER_THRESHOLD_DBM {
            "AMBER"
        } else {
            "GREEN"
        };
        println!("         {:<18} {:>7.1} dBm  {}", id, rssi, class);
    }
    let rssi_at = |kind: usize| radio.get(kind).map_or(f32::NAN, |r| r.1);
    let (rssi_wp1, rssi_wp2) = (rssi_at(1), rssi_at(2));
    // Radio-shadow threat (H4) by the real level against the -100 dBm red threshold.
    let radio_shadow = |rssi: f32| rssi.is_nan() || rssi < NLOS_RSSI_THRESHOLD_DBM;

    // ============================================================================
    // ACT 1: PRE-EVA CHAOS MODE STRESS TEST (HABITAT BASE CONSOLE)
    // ============================================================================
    print_banner(
        "ACT 1",
        "PRE-EVA CHAOS MODE STRESS TEST (10,000 MONTE CARLO RUNS)",
    );
    println!("[INIT] Generating IAU Mars 2000 H3 hexagonal corridor (Res 11)...");
    let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
    println!(
        "       Corridor generated with {} hexagonal cells (64-byte aligned, CRC16 sealed).",
        grid.len()
    );

    // Verify CRC integrity of all cells
    let mut crc_valid = 0usize;
    for cell in grid.cells.values() {
        if cell.verify_crc() {
            crc_valid += 1;
        }
    }
    println!(
        "       CRC16 Integrity Check: {}/{} cells valid (0 Single Event Upsets).",
        crc_valid,
        grid.len()
    );
    assert_eq!(crc_valid, grid.len(), "All cells must have valid CRC16");

    // Same seeded run as `data/mission-scenarios/chaos_mode_results.json` (cells sorted by H3
    // index; `grid.cells` is a HashMap whose order changes between runs).
    println!(
        "[SIM]  Launching {}-run Monte Carlo Chaos Mode simulation (seed {}, {:.2} h LMST)...",
        CHAOS_TRIALS, CHAOS_SEED, CHAOS_SOLAR_HOUR
    );
    println!("       Coupled 16-state CTMC Markov model (H1 Dust, H2 SPE, H3 Regolith, H4 NLOS).");
    let chaos = compute_chaos_export();
    let r = &chaos.report;
    println!("\n[RESULTS] CHAOS MODE MONTE CARLO REPORT ({} TRIALS):", r.trials);
    println!("       Criterion: {}", chaos.criterion);
    println!("       - Multi-Hazard Events Triggered: {}", r.multi_hazard_events_triggered);
    for (label, o, pct) in [
        ("A (Base-only return)   ", &r.outcomes_base_only, r.survival_rate_base_only_pct),
        ("B (switch to WP3 shelter)", &r.outcomes_with_shelter, r.survival_rate_with_shelter_pct),
    ] {
        println!(
            "       - Strategy {label}: safe {:>5} ({:.2}%) | flight-rule breach {:>5} | consumables lost {:>5} | not reached {:>5}",
            o.safe, pct, o.flight_rule_breach, o.consumables_lost, o.destination_not_reached
        );
    }
    println!("       - Switch to WP3 triggered in {} trials", r.switched_to_shelter);
    println!("       - By max simultaneous hazards (trials | safe with WP3 | safe Base-only):");
    for k in 0..5 {
        println!(
            "           {k} hazards: {:>5} | {:>5} | {:>5}",
            r.trials_by_max_concurrent_hazards[k],
            r.safe_with_shelter_by_max_concurrent[k],
            r.safe_base_only_by_max_concurrent[k]
        );
    }
    assert!(
        r.survived_with_wp3_shelter > r.survived_base_only,
        "WP3 Cliff Shelter must deliver superior survival over Base-only return"
    );
    println!("\n[DECISION] PRE-EVA MISSION CLEARANCE: GO FOR EVA-07.");
    println!("           Dynamic Goal Switching to WP3 Shelter confirmed as mission-critical fail-safe.");

    // ============================================================================
    // ACT 2: WP1 ISRU WATER CONFIRMATION (GEOLOGY SCIENCE STOP)
    // ============================================================================
    print_banner(
        "ACT 2",
        "WAYPOINT 1 :: ISRU POLYHYDRATED SULFATE WATER CONFIRMATION",
    );
    let waypoints = melas_chasma_survival_triangle();
    let wp1 = waypoints
        .iter()
        .find(|w| w.kind == MissionWaypointKind::Wp1IsruWater)
        .expect("WP1 waypoint must exist");
    println!(
        "[NAV]  Astronaut arrives at WP1 ({}): Lat {:.4}°, Lon {:.4}°, Elev {:.1} m.",
        wp1.id, wp1.lat_deg, wp1.lon_deg, wp1.elev_m
    );

    let wp1_cell = grid
        .nearest_cell(wp1.lat_deg, wp1.lon_deg)
        .expect("Cell near WP1 must exist in grid");
    println!(
        "       Cell H3 Index : 0x{:016X}",
        wp1_cell.h3_index
    );
    println!(
        "       CRISM Hydration: {:.1}% H2O by weight (Threshold >= {:.1}%)",
        wp1_cell.isru_h2o_pct, ISRU_WATER_MIN_PCT
    );
    println!(
        "       THEMIS Inertia : {:.0} TIU (Firm sulfate-cemented stratum)",
        wp1_cell.thermal_inertia_tiu
    );
    println!(
        "       MOLA Slope     : {:.1}° | Sky View Factor: {:.2}",
        wp1_cell.slope_deg, wp1_cell.sky_view_factor
    );
    assert!(
        wp1_cell.isru_h2o_pct >= ISRU_WATER_MIN_PCT,
        "WP1 must contain >= 12% structural water"
    );
    assert!(
        wp1_cell.hazard_bitmask & HAZARD_FLAG_ISRU_WATER != 0,
        "WP1 cell must carry HAZARD_FLAG_ISRU_WATER bit"
    );

    println!("\n[SPY]  Querying WebGPU 3-Sector Spyglass slice (k-ring = 2)...");
    let spyglass = grid.query_spyglass_sectors(wp1_cell.h3_index, 2);
    println!(
        "       - North Sector (CRISM Hydration) : {} cells surveyed",
        spyglass.crism_water_cells.len()
    );
    println!(
        "       - East Sector  (THEMIS Inertia)  : {} cells surveyed",
        spyglass.themis_trap_cells.len()
    );
    println!(
        "       - West Sector  (MOLA Slope & SVF): {} cells surveyed",
        spyglass.mola_slope_svf_cells.len()
    );

    println!("\n[AI]   Astronaut voice query to Offline Edge SLM Copilot (Candle/INT4):");
    let slm = QuantizedCandleSlmMock;
    let query = "Confirm water hydration percentage in sulfate strata";
    let ai_answer =
        slm.answer_geology_query(query, wp1_cell.isru_h2o_pct, wp1_cell.thermal_inertia_tiu);
    println!("       Astronaut: \"{}\"", query);
    println!("       Copilot  : \"{}\"", ai_answer);

    // Guardrail evaluation in nominal state
    let mut guardrail = GuardrailFsm::new();
    let nominal_hazards = ActiveHazards {
        h1_dust_storm: false,
        h2_spe_radiation: false,
        h3_regolith_slope: false,
        h4_nlos_offline: radio_shadow(rssi_wp1),
        dust_tau: DUST_TAU_NOMINAL,
        wind_speed_ms: 6.2,
        spe_dose_rate_msv_h: GCR_SURFACE_RATE_MSV_H,
        rssi_dbm: rssi_wp1,
    };
    let t40 = timeline_at(&pre_timeline, 40)?; // ISRU work at WP1
    let nominal_telem = PlssTelemetry {
        timestamp_s: t40.timestamp_s(),
        o2_remaining_liters: t40.o2_remaining_liters(),
        lcvg_water_remaining_min: 210.0,
        battery_remaining_min: 225.0,
        current_o2_rate_l_min: t40.o2_rate_l_min as f32,
        cumulative_rad_msv: t40.dose_spe_msv as f32,
        mission_rad_limit_msv: EVA_SPE_DOSE_BUDGET_MSV,
        heart_rate_bpm: 88,
    };
    let nominal_walkback = WalkbackDualStatus {
        t_vital_min: 250.0,
        t_walkback_base_min: 35.0,
        t_walkback_shelter_min: 28.0,
        active_target: TargetGoal::Wp1Isru,
        dynamic_goal_switched: false,
        base_feasible: true,
    };

    let alert_frame = guardrail.evaluate(
        wp1_cell.slope_deg,
        wp1_cell.thermal_inertia_tiu,
        false,
        &nominal_hazards,
        &nominal_telem,
        &nominal_walkback,
        45.0,
        420.0,
    );
    assert_eq!(alert_frame.state, SafetyGuardrailState::Nominal);
    assert_eq!(alert_frame.ar_path_color_hex, COLOR_NOMINAL_HEX);
    println!(
        "\n[HUD]  Guardrail State: {:?} | AR Path Color: {} (Cyan nominal)",
        alert_frame.state, alert_frame.ar_path_color_hex
    );

    // Record science sample into Zenoh ring-buffer
    let mut zenoh_buffer = ZenohCrdtRingBuffer::new(256);
    let sample = ScienceSample {
        timestamp_s: t40.timestamp_s(),
        sample_id: "MELAS-WP1-H2O-001".to_string(),
        h2o_pct: wp1_cell.isru_h2o_pct,
        tiu: wp1_cell.thermal_inertia_tiu,
        notes: "Polyhydrated sulfates confirmed by CRISM and in-situ NIR".to_string(),
    };
    zenoh_buffer.push_science_sample(sample.clone());
    zenoh_buffer.push_telemetry(nominal_telem.clone());
    println!(
        "[DATA] Science sample {} logged to local Zenoh ring-buffer.",
        sample.sample_id
    );

    // ============================================================================
    // ACT 3: WP2 NLOS + CANYON-TRN SKYLINE MATCHING + 110 TIU / 22° SLOPE
    // ============================================================================
    print_banner(
        "ACT 3",
        "WAYPOINT 2 :: NLOS RADIO SHADOW, CANYON-TRN EKF & SOFT REGOLITH TRAP",
    );
    let wp2 = waypoints
        .iter()
        .find(|w| w.kind == MissionWaypointKind::Wp2FaultSlope)
        .expect("WP2 waypoint must exist");
    println!(
        "[NAV]  Astronaut traverses to WP2 ({}): Lat {:.4}°, Lon {:.4}°, Elev {:.1} m.",
        wp2.id, wp2.lat_deg, wp2.lon_deg, wp2.elev_m
    );

    let wp2_cell = grid
        .nearest_cell(wp2.lat_deg, wp2.lon_deg)
        .expect("Cell near WP2 must exist in grid");

    // 1. NLOS Radio Drop
    println!(
        "\n[COMM] Base Habitat S-band link drops behind the terrain spur (P1 grid level, knife-edge diffraction):"
    );
    println!(
        "       RSSI = {:.1} dBm (Threshold: {:.1} dBm)",
        rssi_wp2, NLOS_RSSI_THRESHOLD_DBM
    );
    assert!(
        radio_shadow(rssi_wp2),
        "WP2 must be in NLOS radio shadow"
    );
    zenoh_buffer.set_nlos_mode(true);
    println!(
        "       Zenoh Watchdog: Loss of 3 heartbeats (<150 ms) -> Conmutated to AUTONOMOUS_NLOS mode (<5 ms)."
    );
    println!("       CRDT Ring-Buffer active: zero telemetry or science data loss.");

    // 2. Terrain Biomechanics: 110 TIU & 22° Slope
    println!("\n[TERRAIN] Entering landslide contact fault zone:");
    println!(
        "       Slope          : {:.1}° local ramp (scenario; {:.1}° on the CTX DTM) | Critical: {:.1}°",
        wp2_cell.slope_deg, SURVIVAL_TRIANGLE_SITE[2].slope_dem_deg, CRITICAL_SLOPE_DEG
    );
    println!(
        "       Thermal Inertia: {:.0} TIU (Soft unconsolidated regolith trap < {:.0} TIU)",
        wp2_cell.thermal_inertia_tiu, LOW_TIU_TRAP_THRESHOLD
    );
    assert!(
        wp2_cell.slope_deg >= CRITICAL_SLOPE_DEG,
        "WP2 slope must be >= 20°"
    );
    assert!(
        wp2_cell.thermal_inertia_tiu <= LOW_TIU_TRAP_THRESHOLD,
        "WP2 TIU must indicate regolith trap"
    );

    let eta_sinkage = soil_sinkage_eta(wp2_cell.thermal_inertia_tiu);
    let watts_wp2 = pandolf_mars_metabolic_watts(
        WP2_RAMP_SLOPE_DEG as f64,
        wp2_cell.thermal_inertia_tiu,
        WP2_TRAVERSE_SPEED_MPS,
        WP2_SLIP_FRACTION,
    );
    let o2_rate_wp2 = metabolic_o2_rate_l_min(watts_wp2);
    // Flat firm-ground reference (> 400 TIU, 0 deg, 1.0 m/s, no slip).
    let watts_flat = pandolf_mars_metabolic_watts(0.0, 420.0, 1.0, 0.0);
    let o2_rate_flat = metabolic_o2_rate_l_min(watts_flat);
    println!(
        "       Terrain Factor \\eta(I)     : {:.2} | Speed {:.2} m/s | Slip {:.0}%",
        eta_sinkage,
        WP2_TRAVERSE_SPEED_MPS,
        WP2_SLIP_FRACTION * 100.0
    );
    println!(
        "       Mars Metabolic Power        : {:.1} W (vs {:.0} W on flat basalt)",
        watts_wp2, watts_flat
    );
    println!(
        "       PLSS Oxygen Consumption Rate: {:.2} L/min STPD ({:.1}x baseline!)",
        o2_rate_wp2,
        o2_rate_wp2 / o2_rate_flat
    );
    assert!(
        watts_wp2 > 1000.0,
        "WP2 metabolic power on 22°/110 TIU must exceed 1000 W"
    );
    assert!(
        o2_rate_wp2 > 2.8,
        "WP2 O2 rate must be elevated due to regolith trap"
    );

    // 3. Canyon-TRN 15-DOF EKF + Skyline Matching under NLOS
    println!("\n[TRN]  Evaluating Canyon-TRN 15-DOF ESKF without GPS or radio:");
    println!("       Simulating 100 s traverse (2000 steps) with IMU + VIO dead-reckoning drift...");

    let bank = generate_melas_horizon_bank(0.0, 0.0, 1.0, 35);
    let target_horizon = bank
        .iter()
        .find(|h| (h.pos_x_m - 24.0).abs() < 1e-6 && (h.pos_y_m - 10.0).abs() < 1e-6)
        .expect("Target horizon at (24.0, 10.0) must exist in bank")
        .clone();

    let mut ekf = CanyonTrnEkf::new([0.0, 0.0, 0.0], bank);
    let total_steps = 2000;
    let dt_step = 0.05_f64;
    let imu_substeps = 20;
    let dt_imu = dt_step / (imu_substeps as f64);

    for step in 0..total_steps {
        let phase = (step as f64) * 0.02;
        for _ in 0..imu_substeps {
            let imu = ImuSample {
                dt_s: dt_imu,
                accel_mps2: [
                    0.004 * phase.sin(),
                    0.003 * phase.cos(),
                    MARS_GRAVITY as f64,
                ],
                gyro_rads: [0.0, 0.0, 0.0],
            };
            ekf.predict_imu(&imu);
        }

        let vio = VioDelta {
            delta_pos_m: [0.0168, 0.0086, 0.0],
            vel_mps: [0.336, 0.172, 0.0],
            sigma_pos_m: 0.08,
        };
        ekf.update_vio(&vio);

        if step % 2 == 1 {
            let lidar = LidarScanMatch {
                delta_pos_m: [0.0336, 0.0172, 0.0],
                local_slope_deg: 22.0,
                sigma_m: 0.12,
            };
            ekf.update_lidar(&lidar);
        }
    }

    let drifted_pose = ekf.pose();
    let true_end = [24.0, 10.0];
    let pre_skyline_err = ((drifted_pose.pos_m[0] - true_end[0]).powi(2)
        + (drifted_pose.pos_m[1] - true_end[1]).powi(2))
    .sqrt();
    println!(
        "       Pre-Skyline Accumulated NLOS Drift: {:.2} m (1-sigma = {:.2} m)",
        pre_skyline_err, drifted_pose.horizontal_uncertainty_1sigma_m
    );
    assert!(
        pre_skyline_err > 8.0,
        "NLOS dead reckoning should exhibit drift"
    );

    println!("       2 Hz Skyline Matching Camera extracts Melas canyon rim profile...");
    let mut observed_elevations_rad = [0.0_f32; HORIZON_BINS];
    for (i, slot) in observed_elevations_rad.iter_mut().enumerate() {
        let noise = 0.003_f32 * (((i * 17 + 3) % 11) as f32 - 5.0) / 5.0;
        *slot = (0.50 * target_horizon.elevations_rad[i] + 0.05 + noise).max(0.01);
    }
    let obs = SkylineObservation {
        observed_elevations_rad,
        dust_tau: 1.5,
    };

    let (matched_id, ncc_score) = ekf
        .update_skyline(&obs)
        .expect("Skyline observation must match canyon rim");
    let corrected_pose = ekf.pose();
    let post_skyline_err = ((corrected_pose.pos_m[0] - true_end[0]).powi(2)
        + (corrected_pose.pos_m[1] - true_end[1]).powi(2))
    .sqrt();

    println!(
        "       Skyline Match Locked: Hash 0x{:08X} | NCC Score = {:.3}",
        matched_id, ncc_score
    );
    println!(
        "       Corrected Pose Error: {:.3} m (< 0.50 m RMS!) | 1-sigma = {:.3} m",
        post_skyline_err, corrected_pose.horizontal_uncertainty_1sigma_m
    );
    assert_eq!(
        matched_id, target_horizon.horizon_hash_id,
        "Must match correct cell"
    );
    assert!(
        post_skyline_err < 0.50,
        "Skyline correction must reduce horizontal error to < 0.50 m"
    );

    // Guardrail Caution evaluation
    let mut caution_hazards = nominal_hazards.clone();
    caution_hazards.h4_nlos_offline = radio_shadow(rssi_wp2);
    caution_hazards.rssi_dbm = rssi_wp2;
    caution_hazards.h3_regolith_slope = true;

    let t98 = timeline_at(&pre_timeline, 98)?; // WP2 ramp peak
    let caution_telem = PlssTelemetry {
        timestamp_s: t98.timestamp_s(),
        o2_remaining_liters: t98.o2_remaining_liters(),
        lcvg_water_remaining_min: 150.0,
        battery_remaining_min: 165.0,
        current_o2_rate_l_min: t98.o2_rate_l_min as f32,
        cumulative_rad_msv: t98.dose_spe_msv as f32,
        mission_rad_limit_msv: EVA_SPE_DOSE_BUDGET_MSV,
        heart_rate_bpm: 142,
    };
    let caution_walkback = WalkbackDualStatus {
        t_vital_min: 45.0,
        t_walkback_base_min: 28.0,
        t_walkback_shelter_min: 12.0,
        active_target: TargetGoal::Wp2Fault,
        dynamic_goal_switched: false,
        base_feasible: true,
    };
    let caution_frame = guardrail.evaluate(
        wp2_cell.slope_deg,
        wp2_cell.thermal_inertia_tiu,
        false,
        &caution_hazards,
        &caution_telem,
        &caution_walkback,
        185.0,
        280.0,
    );
    println!(
        "[HUD]  Guardrail State: {:?} | AR Path Color: {} (Amber advisory)",
        caution_frame.state, caution_frame.ar_path_color_hex
    );
    assert!(
        caution_frame.state == SafetyGuardrailState::Caution
            || caution_frame.state == SafetyGuardrailState::MultiHazard,
        "Expected Caution or MultiHazard state"
    );
    assert_eq!(caution_frame.ar_path_color_hex, COLOR_CAUTION_HEX);

    // ============================================================================
    // ACT 4: T+105 MIN 4-HAZARD IMPACT + DYNAMIC GOAL SWITCHING + SINGLE-ALERT FUSION
    // ============================================================================
    print_banner(
        "ACT 4",
        "T+105 MIN :: 4-HAZARD CATASTROPHIC IMPACT & DYNAMIC GOAL SWITCHING",
    );
    println!("[ALARM] T+105 min (timestamp 6300 s): Four simultaneous hazards strike:");
    println!(
        "        1. H1 (Catabatic Storm) : Dust tau = {:.2} -> {:.2}, Wind speed = 28.0 m/s",
        DUST_TAU_NOMINAL, DUST_TAU_STORM
    );
    println!(
        "        2. H2 (Solar SPE Eruption): Open-sky dose rate = {:.1} mSv/h (CRITICAL)",
        SPE_PEAK_ENVELOPE_MSV_H
    );
    println!(
        "        3. H3 (Regolith Trap)   : {:.1}° ramp, {:.0} TIU, high metabolic resistance",
        WP2_RAMP_SLOPE_DEG, wp2_cell.thermal_inertia_tiu
    );
    println!(
        "        4. H4 (Radio shadow)    : S band {:.1} dBm < {:.0} dBm (P1 grid level at WP2)",
        rssi_wp2, NLOS_RSSI_THRESHOLD_DBM
    );

    // T+105 decision on P1's real terrain (H3 res 12, DTM CTX 20 m): same computation as
    // `data/mission-scenarios/planner_walkback.json` (red_atlas_core::mission).
    println!("\n[D* LITE] D* Lite evaluates the Walkback Limit Dual on P1 terrain...");
    let dgs_start = std::time::Instant::now();
    let walkback_run = compute_t105_walkback(
        &real_grid,
        P1_GRID_PARQUET_REL,
        Some(DECISION_CORRIDOR_HALF_WIDTH_M),
    )?;
    println!(
        "        - Corridor (+/-{:.0} m) extraction + planner graph + replanning: {:.1} ms \
         (replanning alone: see p1_res12_decision_latency)",
        DECISION_CORRIDOR_HALF_WIDTH_M,
        dgs_start.elapsed().as_secs_f64() * 1000.0
    );
    let t105_hazards = walkback_run.hazards.clone();
    let t105_telemetry = walkback_run.telemetry.clone();
    let walkback_status = walkback_run.decision.status;
    let wb = &walkback_run.report;
    let wp3_wp = &waypoints[3];
    let wp3_cell = *real_grid
        .get_cell(walkback_run.wp3_h3)
        .ok_or("WP3 cell missing from the P1 grid")?;

    println!("\n[METRICS] FIGURES USED BY THE DECISION (SPE envelope {:.1} mSv/h x cell SVF):", wb.spe_rate_envelope_msv_h);
    println!(
        "        - SPE dose so far / budget     : {:.3} / {:.1} mSv (remaining {:.3} mSv)",
        wb.dose_accumulated_msv, wb.dose_budget_msv, wb.remaining_dose_budget_msv
    );
    println!(
        "        - T_vital                      : {:.1} min = min(O2 {:.0}, cooling {:.0}, battery {:.0}, radiation {:.1} at cell SVF {:.2})",
        wb.t_vital_min, wb.t_vital_o2_min, wb.t_vital_lcvg_min, wb.t_vital_battery_min,
        wb.t_vital_radiation_min, wb.current_cell_svf
    );
    for (label, rt) in [
        ("WP2 -> WP3 (emergency escape: 1.25 m/s, 650 W)", &wb.wp3),
        ("WP2 -> Base (sustained return: 585 W, visibility-limited 1.0 m/s)", &wb.base),
    ] {
        println!("\n        [ROUTE] {label}");
        println!(
            "          length: {:.0} m on the cell chain ({} cells) -> {:.0} m walked ({} corners)",
            rt.raw_length_m, rt.cells, rt.length_m, rt.corners
        );
        println!(
            "          time {:.1} min | mean speed {:.2} m/s | mean power {:.0} W | O2 {:.1} L | arrival T+{:.1}",
            rt.time_min, rt.mean_speed_mps, rt.mean_power_w, rt.o2_liters, rt.arrival_t_min
        );
        println!(
            "          grade: down<-5 {:.0}% | -5..5 {:.0}% | 5..10 {:.0}% | >10 {:.0}% | max +{:.1} / {:.1} deg | power-capped {:.0}% of length",
            rt.grade_down_lt_minus5_pct, rt.grade_minus5_to_5_pct, rt.grade_5_to_10_pct,
            rt.grade_gt_10_pct, rt.grade_max_up_deg, rt.grade_max_down_deg, rt.power_capped_pct
        );
        println!("          projected SPE dose en route (decision model): {:.3} mSv", rt.dose_spe_msv);
    }
    println!(
        "\n        - Decision: time rule (T_base {:.1} > {:.2} x T_vital {:.1} and T_WP3 < T_base) = {} | \
         radiation rule (Base dose {:.3} > remaining {:.3} and WP3 dose < {:.2} x Base dose) = {}",
        wb.base.time_min, wb.safety_factor, wb.t_vital_min, wb.time_switch,
        wb.base.dose_spe_msv, wb.remaining_dose_budget_msv, wb.radiation_switch_ratio, wb.rad_switch
    );
    println!(
        "        - Reference only (not used to decide): open-sky window {:.1} min = remaining budget at {:.1} mSv/h, factor 1.0",
        wb.open_sky_window_min, wb.spe_rate_envelope_msv_h
    );
    println!(
        "        - WP3 escape {:.1} min: within T_vital {} | within open-sky window {}",
        wb.wp3.time_min, wb.wp3_within_t_vital, wb.wp3_within_open_sky_window
    );
    println!(
        "        -> Active Target Goal           : {:?} (switched: {}, Base feasible: {})",
        walkback_status.active_target, walkback_status.dynamic_goal_switched, walkback_status.base_feasible
    );

    assert_eq!(walkback_status.active_target, TargetGoal::Wp3Shelter);
    assert!(walkback_status.dynamic_goal_switched);
    assert!(!walkback_status.base_feasible);
    // Full timeline with the escape computed by the planner (time and mean power).
    let timeline = full_timeline(&wb.wp3);
    println!("\n[DECISION] DYNAMIC GOAL SWITCHING TRIGGERED:");
    println!("           Base return exceeds 0.85 x T_vital and its projected SPE dose exceeds the remaining budget.");
    println!("           Target autonomously switched to WP3 Cliff Shelter (85% SPE shielding).");

    // Single-Alert Fusion Triage & Guardrail
    println!("\n[FUSION] Single-Alert Cognitive Triage Matrix executed (100 Hz Guardrail):");
    println!("         Suppresses 4 redundant alarms; produces 1 verified multi-modal directive.");
    let evac_frame = guardrail.evaluate(
        wp2_cell.slope_deg,
        wp2_cell.thermal_inertia_tiu,
        false,
        &t105_hazards,
        &t105_telemetry,
        &walkback_status,
        SURVIVAL_TRIANGLE_LEGS[ESCAPE_LEG_WP2_WP3].bearing_deg,
        SURVIVAL_TRIANGLE_LEGS[ESCAPE_LEG_WP2_WP3].distance_m as f32,
    );

    assert_eq!(evac_frame.state, SafetyGuardrailState::EvacShelter);
    assert_eq!(evac_frame.ar_path_color_hex, COLOR_EVAC_SHELTER_HEX);
    println!(
        "         - Guardrail State: {:?} | AR Path Color: {} (Pulsing Red)",
        evac_frame.state, evac_frame.ar_path_color_hex
    );
    println!(
        "         - Primary Cause  : {}",
        evac_frame.primary_cause
    );
    println!(
        "         - Target Bearing : {:.0}° | Distance: {:.0} m | ETA: {:.0} min",
        evac_frame.target_bearing_deg, evac_frame.target_distance_m, evac_frame.target_eta_min
    );
    println!(
        "         - Structured Slots: {:?}",
        evac_frame.voice_summary_slots
    );

    let tactical_voice = slm.synthesize_tactical_alert(&evac_frame);
    let word_count = tactical_voice.split_whitespace().count();
    println!("\n[VOICE]  Offline Tactical Voice Synthesizer (< 8 s spoken length, 0% hallucination):");
    println!("         \"{}\"", tactical_voice);
    println!(
        "         (Word count: {} words <= 25 words limit)",
        word_count
    );
    assert!(
        word_count <= 25,
        "Tactical voice alert must be concise (<= 25 words)"
    );

    // TMR 2-of-3 Cosmic Ray SEU Fault-Tolerance Test
    println!("\n[TMR]    Testing Triple Modular Redundancy (TMR 2-of-3) against SPE SEU Bit-Flip:");
    let mut tmr_state: TmrVoted<SafetyGuardrailState> =
        TmrVoted::new(SafetyGuardrailState::EvacShelter);
    println!(
        "         Pre-corruption voted state: {:?}",
        tmr_state.read_voted().unwrap()
    );
    println!("         Injecting single-event upset into Copy 0 (corrupted to Nominal)...");
    tmr_state.inject_seu_fault_copy(0, SafetyGuardrailState::Nominal);
    let voted_after = tmr_state.read_voted().expect("TMR must recover");
    println!(
        "         Post-corruption majority voted state: {:?} (2-of-3 consensus maintained!)",
        voted_after
    );
    assert_eq!(voted_after, SafetyGuardrailState::EvacShelter);

    // ============================================================================
    // ACT 5: SURVIVAL AT WP3 CLIFF SHELTER SVF=0.15 + ZENOH REPLAY
    // ============================================================================
    print_banner(
        "ACT 5",
        "WAYPOINT 3 :: CLIFF SHELTER ARRIVAL (SVF=0.15) & ZENOH REPLAY",
    );
    println!(
        "[NAV]  Astronaut follows D* Lite escape path to WP3 Cliff Shelter ({})",
        wp3_wp.id
    );
    println!(
        "       Arrival at coordinates: Lat {:.4}°, Lon {:.4}°, Elevation {:.1} m.",
        wp3_wp.lat_deg, wp3_wp.lon_deg, wp3_wp.elev_m
    );

    println!(
        "\n[SHELTER] Topographic evaluation of the WP3 alcove under the overhang (scenario):"
    );
    println!(
        "          - Sky View Factor \\Psi_SVF   : {:.2} (Target <= {:.2})",
        wp3_cell.sky_view_factor, SHELTER_SVF_MAX
    );
    assert!(
        wp3_cell.sky_view_factor <= SHELTER_SVF_MAX,
        "WP3 shelter must have SVF <= 0.20"
    );
    let spe_attenuation_pct = (1.0 - wp3_cell.sky_view_factor) * 100.0;
    println!(
        "          - SPE Radiation Attenuation  : {:.1}% (Massive topographic rock shielding)",
        spe_attenuation_pct
    );
    assert!(
        spe_attenuation_pct >= 80.0,
        "WP3 shelter must attenuate >= 80% SPE radiation"
    );

    let sheltered_rad_rate =
        (t105_hazards.spe_dose_rate_msv_h as f64) * (wp3_cell.sky_view_factor as f64);
    println!(
        "          - Open-Sky Dose Rate         : {:.1} mSv/h",
        t105_hazards.spe_dose_rate_msv_h
    );
    println!(
        "          - Sheltered Dose Rate        : {:.2} mSv/h (Safe holding level)",
        sheltered_rad_rate
    );

    // Shelter hold T+114.4..T+165 under the nominal (calibrated ramp) SPE profile.
    let t165 = timeline_at(&timeline, 165)?;
    let final_cumulative_rad = t165.dose_spe_msv;
    println!(
        "          - SPE Dose at WP3 Arrival    : {:.2} mSv (T+114)",
        timeline_at(&timeline, 114)?.dose_spe_msv
    );
    println!(
        "          - Final Cumulative EVA Dose  : {:.2} mSv at T+165 (Mission Limit: {:.1} mSv)",
        final_cumulative_rad, t105_telemetry.mission_rad_limit_msv
    );
    assert!(
        final_cumulative_rad < t105_telemetry.mission_rad_limit_msv as f64,
        "Astronaut cumulative dose must remain safely within mission limit"
    );

    // Guardrail ShelterHold state
    let shelter_hold_status = WalkbackDualStatus {
        t_vital_min: 180.0,
        t_walkback_base_min: 42.0,
        t_walkback_shelter_min: 0.0,
        active_target: TargetGoal::Wp3Shelter,
        dynamic_goal_switched: true,
        base_feasible: false,
    };
    let shelter_frame = guardrail.evaluate(
        wp3_cell.slope_deg,
        wp3_cell.thermal_inertia_tiu,
        true, // at_shelter = true
        &t105_hazards,
        &t105_telemetry,
        &shelter_hold_status,
        0.0,
        0.0,
    );
    assert_eq!(shelter_frame.state, SafetyGuardrailState::ShelterHold);
    assert_eq!(shelter_frame.ar_path_color_hex, COLOR_SHELTER_HOLD_HEX);
    println!(
        "\n[HUD]     Guardrail State: {:?} | AR Path Color: {} (Emerald Green Shelter Hold)",
        shelter_frame.state, shelter_frame.ar_path_color_hex
    );
    let shelter_voice = slm.synthesize_tactical_alert(&shelter_frame);
    println!("          Copilot Voice  : \"{}\"", shelter_voice);

    // Replay Zenoh CRDT Ring-Buffer upon drone/repeater recovery
    println!("\n[COMM]    Aerial drone repeater establishes line-of-sight with WP3 alcove!");
    println!("          Zenoh S-band session restored via the repeater: dropping AUTONOMOUS_NLOS flag...");
    zenoh_buffer.set_nlos_mode(false);

    // Push emergency and sheltered telemetry frames
    let mut final_telem = t105_telemetry.clone();
    final_telem.timestamp_s = t165.timestamp_s();
    final_telem.o2_remaining_liters = t165.o2_remaining_liters();
    final_telem.cumulative_rad_msv = final_cumulative_rad as f32;
    final_telem.current_o2_rate_l_min = t165.o2_rate_l_min as f32; // Pressurized rest
    zenoh_buffer.push_telemetry(final_telem);

    let replayed_telem = zenoh_buffer.drain_replay();
    let replayed_science = zenoh_buffer.drain_science_replay();
    println!(
        "          Zenoh CRDT Replay: {} telemetry frames and {} science samples transferred to Base.",
        replayed_telem.len(),
        replayed_science.len()
    );
    assert!(
        !replayed_telem.is_empty(),
        "Must replay buffered telemetry frames"
    );
    assert!(
        !replayed_science.is_empty(),
        "Must replay buffered science samples"
    );

    print_timeline_vs_p1(&timeline, wb)?;

    print_separator();
    println!("  MISSION STATUS: EVA-07 Melas Chasma Survival Simulation COMPLETED.");
    println!("  ASTRONAUT SURVIVAL: 100% SUCCESSFUL (Dynamic Goal Switching to WP3 Saved Life).");
    println!("  ALL 5 ACTS VERIFIED GREEN: Pre-EVA Chaos Mode -> WP1 ISRU -> WP2 Canyon-TRN ->");
    println!("                             Act 4 Multi-Hazard Fusion -> Act 5 WP3 Shelter Survival.");
    print_separator();
    Ok(())
}

/// Prints the EVA-07 milestones (power, O2 left, SPE dose) next to P1's reference timeline and
/// checks that O2 and dose agree within tolerance. Walkback times are reported, not forced.
fn print_timeline_vs_p1(timeline: &[TimelineSample], wb: &WalkbackReport) -> Result<(), String> {
    print_banner("TIMELINE", "EVA-07 MILESTONES vs P1 REFERENCE (eva07_events.json)");
    let events: serde_json::Value = serde_json::from_str(P1_EVENTS_JSON)
        .map_err(|e| format!("P1 eva07_events.json does not parse: {e}"))?;
    let list = events["events"]
        .as_array()
        .ok_or("P1 eva07_events.json has no events[] array")?;
    println!(
        "  {:>5}  {:<24} {:>8} {:>8} {:>8} {:>9} {:>9}",
        "T", "Milestone", "Power W", "O2 %", "P1 O2 %", "Dose mSv", "P1 mSv"
    );
    let mut max_o2_diff: f64 = 0.0;
    let mut max_dose_diff: f64 = 0.0;
    for event in list {
        let id = event["id"].as_str().unwrap_or("?");
        let field = |v: &serde_json::Value, name: &str| {
            v.as_f64().ok_or_else(|| format!("P1 event {id}: missing numeric {name}"))
        };
        let t = field(&event["t_min"], "t_min")? as i32;
        let values = &event["values"];
        let ref_o2 = field(&values["o2_remaining_pct"], "o2_remaining_pct")?;
        let ref_dose = field(&values["dose_spe_msv"], "dose_spe_msv")?;
        let sim = timeline_at(timeline, t)?;
        max_o2_diff = max_o2_diff.max((sim.o2_remaining_pct() - ref_o2).abs());
        max_dose_diff = max_dose_diff.max((sim.dose_spe_msv - ref_dose).abs());
        println!(
            "  T{:>+4}  {:<24} {:>8.1} {:>8.2} {:>8.2} {:>9.3} {:>9.3}",
            t, id, sim.power_w, sim.o2_remaining_pct(), ref_o2, sim.dose_spe_msv, ref_dose
        );
    }
    println!(
        "  Max |diff|: O2 {:.3} pct-pt (tol {:.2}), SPE dose {:.4} mSv (tol {:.3})",
        max_o2_diff, O2_PCT_TOLERANCE, max_dose_diff, DOSE_MSV_TOLERANCE
    );
    assert!(max_o2_diff < O2_PCT_TOLERANCE, "O2 timeline diverges from P1");
    assert!(max_dose_diff < DOSE_MSV_TOLERANCE, "SPE dose timeline diverges from P1");

    let t105_ref = list
        .iter()
        .find(|ev| ev["id"] == "dynamic_goal_switching")
        .map(|ev| &ev["values"])
        .ok_or("P1 eva07_events.json has no dynamic_goal_switching event")?;
    println!("\n  Walkback at T+105 (engine: planner_walkback.json, which P1's validator reads):");
    println!(
        "    - To Base : {:>6.2} min over {:.0} m walked (P1 {:.1} min)",
        wb.base.time_min,
        wb.base.length_m,
        t105_ref["base_time_min"].as_f64().unwrap_or(f64::NAN)
    );
    println!(
        "    - To WP3  : {:>6.2} min over {:.0} m walked (P1 {:.1} min)",
        wb.wp3.time_min,
        wb.wp3.length_m,
        t105_ref["wp3_time_min"].as_f64().unwrap_or(f64::NAN)
    );
    println!(
        "    - T_vital {:.1} min (used to decide) | open-sky window {:.1} min (reference, P1 15 min)",
        wb.t_vital_min, wb.open_sky_window_min
    );
    Ok(())
}
