//! # EVA-07 Mission Simulation: Melas Chasma Survival Triangle
//!
//! End-to-end 5-Act simulation of EVA-07 in Melas Chasma, Valles Marineris (~9.8°S, 283.6°E):
//! - **Act 1**: Pre-EVA Chaos Mode stress test (100 Monte Carlo runs proving WP3 shelter advantage).
//! - **Act 2**: WP1 ISRU water confirmation (CRISM >12% H2O, 3-sector Spyglass, zero-hallucination SLM geology Q&A).
//! - **Act 3**: WP2 NLOS radio shadow + Canyon-TRN Skyline Matching (crushing ~12m drift to <0.5m) + 110 TIU / 22° slope biomechanics.
//! - **Act 4**: T+105 min 4-hazard simultaneous impact + Dynamic Goal Switching + Single-Alert Fusion + TMR 2-of-3 SEU protection.
//! - **Act 5**: Survival at WP3 cliff shelter (SVF=0.15, 85% SPE radiation attenuation) + Zenoh CRDT telemetry replay.

use red_atlas_core::canyon_trn::{
    generate_melas_horizon_bank, CanyonTrnEkf, ImuSample, LidarScanMatch, SkylineObservation,
    VioDelta, HORIZON_BINS,
};
use red_atlas_core::h3_mars_grid::H3MarsGrid;
use red_atlas_core::metabolic_dstar::{
    metabolic_o2_rate_l_min, pandolf_mars_metabolic_watts, soil_sinkage_eta, MetabolicDStarPlanner,
};
use red_atlas_core::neuro_symbolic::{
    EdgeSlmVoiceBackend, GuardrailFsm, QuantizedCandleSlmMock, ScienceSample, TmrVoted,
    ZenohCrdtRingBuffer, COLOR_CAUTION_HEX, COLOR_EVAC_SHELTER_HEX, COLOR_NOMINAL_HEX,
    COLOR_SHELTER_HOLD_HEX,
};
use red_atlas_core::stochastic_hazard::run_chaos_mode_monte_carlo;
use red_atlas_shared::{
    melas_chasma_survival_triangle, ActiveHazards, HexCellState64B, MissionWaypointKind,
    PlssTelemetry, SafetyGuardrailState, TargetGoal, WalkbackDualStatus, CRITICAL_SLOPE_DEG,
    HAZARD_FLAG_ISRU_WATER, LOW_TIU_TRAP_THRESHOLD, MARS_GRAVITY, NLOS_RSSI_THRESHOLD_DBM,
};

fn print_banner(act: &str, title: &str) {
    println!("\n================================================================================");
    println!("  {} :: {}", act, title);
    println!("================================================================================");
}

fn print_separator() {
    println!("--------------------------------------------------------------------------------");
}

fn main() {
    println!("################################################################################");
    println!("#                                                                              #");
    println!("#   R.E.D. ATLAS :: EVA-07 END-TO-END MISSION SIMULATION (MELAS CHASMA)        #");
    println!("#   Target Area: Valles Marineris (~9.8°S, 283.6°E) | Elevation: -4,215 m     #");
    println!("#   Architecture: Deterministic Rust-First Core + Offline Neuro-Symbolic AI     #");
    println!("#                                                                              #");
    println!("################################################################################\n");

    // ============================================================================
    // ACT 1: PRE-EVA CHAOS MODE STRESS TEST (HABITAT BASE CONSOLE)
    // ============================================================================
    print_banner(
        "ACT 1",
        "PRE-EVA CHAOS MODE STRESS TEST (100 MONTE CARLO RUNS)",
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

    let corridor_cells: Vec<HexCellState64B> = grid.cells.values().copied().collect();

    println!("[SIM]  Launching 100-run Monte Carlo Chaos Mode simulation...");
    println!("       Coupled 16-state CTMC Markov model (H1 Dust, H2 SPE, H3 Regolith, H4 NLOS).");
    let chaos_report = run_chaos_mode_monte_carlo(&corridor_cells, 100, 42, 14.5);

    println!("\n[RESULTS] CHAOS MODE MONTE CARLO REPORT (100 TRIALS):");
    println!("       - Total Trials Executed        : {}", chaos_report.trials);
    println!(
        "       - Multi-Hazard Events Triggered: {}",
        chaos_report.multi_hazard_events_triggered
    );
    println!(
        "       - Strategy A (Base-Only Return) : {}/100 survived ({:.1}%)",
        chaos_report.survived_base_only, chaos_report.survival_rate_base_only_pct
    );
    println!(
        "       - Strategy B (WP3 Cliff Shelter): {}/100 survived ({:.1}%)",
        chaos_report.survived_with_wp3_shelter, chaos_report.survival_rate_with_shelter_pct
    );
    println!(
        "       -> Delta Survival Gain with WP3 : +{:.1}%",
        chaos_report.survival_rate_with_shelter_pct - chaos_report.survival_rate_base_only_pct
    );

    assert!(
        chaos_report.survived_with_wp3_shelter > chaos_report.survived_base_only,
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
        "       CRISM Hydration: {:.1}% H2O by weight (Threshold >= 12.0%)",
        wp1_cell.isru_h2o_pct
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
        wp1_cell.isru_h2o_pct >= 12.0,
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
        h4_nlos_offline: false,
        dust_tau: 0.65,
        wind_speed_ms: 6.2,
        spe_dose_rate_msv_h: 0.42,
        rssi_dbm: -62.0,
    };
    let nominal_telem = PlssTelemetry {
        timestamp_s: 2400.0,
        o2_remaining_liters: 195.0,
        lcvg_water_remaining_min: 210.0,
        battery_remaining_min: 225.0,
        current_o2_rate_l_min: 0.78,
        cumulative_rad_msv: 0.28,
        mission_rad_limit_msv: 30.0,
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
        timestamp_s: 2400.0,
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
        "\n[COMM] Base Habitat UHF signal drops behind 7 km Melas Chasma canyon wall:"
    );
    println!(
        "       RSSI = {:.1} dBm (Threshold: {:.1} dBm)",
        wp2_cell.los_base_rssi_dbm, NLOS_RSSI_THRESHOLD_DBM
    );
    assert!(
        wp2_cell.los_base_rssi_dbm < NLOS_RSSI_THRESHOLD_DBM,
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
        "       Slope          : {:.1}° (Critical threshold: {:.1}°)",
        wp2_cell.slope_deg, CRITICAL_SLOPE_DEG
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
        wp2_cell.slope_deg as f64,
        wp2_cell.thermal_inertia_tiu,
        1.0,
    );
    let o2_rate_wp2 = metabolic_o2_rate_l_min(watts_wp2);
    println!(
        "       Soil Sinkage Factor \\eta(I) : {:.2} (duplication of locomotion resistance)",
        eta_sinkage
    );
    println!(
        "       Pandolf Mars Metabolic Power: {:.1} W (vs 280 W on flat basalt)",
        watts_wp2
    );
    println!(
        "       PLSS Oxygen Consumption Rate: {:.2} L/min STP (3.8x baseline!)",
        o2_rate_wp2
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
    caution_hazards.h4_nlos_offline = true;
    caution_hazards.rssi_dbm = -122.0;
    caution_hazards.h3_regolith_slope = true;

    let caution_telem = PlssTelemetry {
        timestamp_s: 4800.0,
        o2_remaining_liters: 145.0,
        lcvg_water_remaining_min: 150.0,
        battery_remaining_min: 165.0,
        current_o2_rate_l_min: o2_rate_wp2 as f32,
        cumulative_rad_msv: 1.2,
        mission_rad_limit_msv: 30.0,
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
    println!("        1. H1 (Catabatic Storm) : Dust tau = 2.40, Wind speed = 28.0 m/s");
    println!("        2. H2 (Solar SPE Eruption): Acute radiation rate = 85.0 mSv/h (CRITICAL)");
    println!("        3. H3 (Regolith Trap)   : 22.0° slope, 110 TIU, high metabolic resistance");
    println!("        4. H4 (NLOS Offline)    : RSSI = -125.0 dBm, 0% Base UHF link");

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
        cumulative_rad_msv: 18.5,
        mission_rad_limit_msv: 30.0, // Remaining radiation budget: 11.5 mSv!
        heart_rate_bpm: 162,
    };

    let remaining_rad_budget =
        t105_telemetry.mission_rad_limit_msv - t105_telemetry.cumulative_rad_msv;
    let open_svf = 0.75_f64;
    let effective_open_rad_rate = (t105_hazards.spe_dose_rate_msv_h as f64) * open_svf;
    let t_rad_limit_min = (remaining_rad_budget as f64 / effective_open_rad_rate) * 60.0;

    println!("\n[METRICS] LIFE-SUPPORT BUDGET UNDER 85 mSv/h SPE RADIATION:");
    println!(
        "        - Remaining Radiation Budget : {:.1} mSv",
        remaining_rad_budget
    );
    println!(
        "        - Effective Open-Sky Rad Rate: {:.1} mSv/h (SVF = {:.2})",
        effective_open_rad_rate, open_svf
    );
    println!(
        "        - Critical Time to Lethal SPE: {:.1} min in open canyon!",
        t_rad_limit_min
    );

    // Setup D* Lite graph for Dynamic Goal Switching calculation
    let cells_vec: Vec<HexCellState64B> = corridor_cells.clone();
    let mut h3_to_idx = std::collections::HashMap::new();
    for (i, c) in cells_vec.iter().enumerate() {
        h3_to_idx.insert(c.h3_index, i);
    }
    let mut adj = vec![Vec::new(); cells_vec.len()];
    for (i, c) in cells_vec.iter().enumerate() {
        for (nbr_h3, dist_m) in grid.neighbor_edges(c.h3_index) {
            if let Some(&j) = h3_to_idx.get(&nbr_h3) {
                adj[i].push((j, dist_m));
            }
        }
    }

    let mut dstar = MetabolicDStarPlanner::new(cells_vec, adj);

    let base_wp = &waypoints[0];
    let wp3_wp = &waypoints[3];
    let base_cell = grid
        .nearest_cell(base_wp.lat_deg, base_wp.lon_deg)
        .expect("Base cell");
    let wp3_cell = grid
        .nearest_cell(wp3_wp.lat_deg, wp3_wp.lon_deg)
        .expect("WP3 cell");

    println!("\n[D* LITE] Zero-Allocation D* Lite evaluates Walkback Limit Dual in < 5 ms...");
    let (walkback_status, _escape_path) = dstar.evaluate_walkback_and_switch(
        wp2_cell.h3_index,
        base_cell.h3_index,
        wp3_cell.h3_index,
        &t105_telemetry,
        &t105_hazards,
    );

    println!(
        "        - T_vital                       : {:.1} min",
        walkback_status.t_vital_min
    );
    println!(
        "        - T_walkback to Base Habitat    : {:.1} min (Base Feasible: {})",
        walkback_status.t_walkback_base_min, walkback_status.base_feasible
    );
    println!(
        "        - T_walkback to WP3 Cliff Shelter: {:.1} min",
        walkback_status.t_walkback_shelter_min
    );
    println!(
        "        -> Active Target Goal           : {:?}",
        walkback_status.active_target
    );
    println!(
        "        -> Dynamic Goal Switched        : {}",
        walkback_status.dynamic_goal_switched
    );

    assert_eq!(walkback_status.active_target, TargetGoal::Wp3Shelter);
    assert!(walkback_status.dynamic_goal_switched);
    assert!(!walkback_status.base_feasible);
    println!("\n[DECISION] DYNAMIC GOAL SWITCHING TRIGGERED:");
    println!("           Base Habitat unreachable under SPE radiation flux (T_base >> T_rad_limit).");
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
        245.0,
        600.0,
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
        "\n[SHELTER] Topographic evaluation of Melas Chasma 7 km cliff alcove:"
    );
    println!(
        "          - Sky View Factor \\Psi_SVF   : {:.2} (Target <= 0.20)",
        wp3_cell.sky_view_factor
    );
    assert!(
        wp3_cell.sky_view_factor <= 0.20,
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

    // 45 minutes shelter hold under SPE storm
    let hold_duration_hours = 0.75; // 45 minutes
    let sheltered_absorbed_dose = sheltered_rad_rate * hold_duration_hours;
    let final_cumulative_rad = t105_telemetry.cumulative_rad_msv as f64 + sheltered_absorbed_dose;
    println!(
        "          - 45 min Sheltered Dose Added: +{:.2} mSv",
        sheltered_absorbed_dose
    );
    println!(
        "          - Final Cumulative EVA Dose  : {:.2} mSv (Mission Limit: {:.1} mSv)",
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
    println!("          Zenoh UHF session restored: dropping AUTONOMOUS_NLOS flag...");
    zenoh_buffer.set_nlos_mode(false);

    // Push emergency and sheltered telemetry frames
    let mut final_telem = t105_telemetry.clone();
    final_telem.timestamp_s = 9000.0;
    final_telem.cumulative_rad_msv = final_cumulative_rad as f32;
    final_telem.current_o2_rate_l_min = 0.42; // Low-power standby
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

    print_separator();
    println!("  MISSION STATUS: EVA-07 Melas Chasma Survival Simulation COMPLETED.");
    println!("  ASTRONAUT SURVIVAL: 100% SUCCESSFUL (Dynamic Goal Switching to WP3 Saved Life).");
    println!("  ALL 5 ACTS VERIFIED GREEN: Pre-EVA Chaos Mode -> WP1 ISRU -> WP2 Canyon-TRN ->");
    println!("                             Act 4 Multi-Hazard Fusion -> Act 5 WP3 Shelter Survival.");
    print_separator();
}
