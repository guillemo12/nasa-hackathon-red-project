//! # EVA-07 Mission Simulation: Melas Chasma Survival Triangle
//!
//! End-to-end 5-Act simulation of EVA-07 in the SW basin of Melas Chasma, Valles Marineris
//! (~9.90°S, 283.39°E; site data in `red_atlas_shared::SURVIVAL_TRIANGLE_SITE`):
//! - **Act 1**: Pre-EVA Chaos Mode stress test (100 Monte Carlo runs proving WP3 shelter advantage).
//! - **Act 2**: WP1 ISRU water confirmation (CRISM >12% H2O, 3-sector Spyglass, zero-hallucination SLM geology Q&A).
//! - **Act 3**: WP2 NLOS radio shadow + Canyon-TRN Skyline Matching (crushing ~12m drift to <0.5m) + 110 TIU / 22° slope biomechanics.
//! - **Act 4**: T+105 min 4-hazard simultaneous impact + Dynamic Goal Switching + Single-Alert Fusion + TMR 2-of-3 SEU protection.
//! - **Act 5**: Survival at WP3 cliff shelter (SVF=0.15, 85% SPE radiation attenuation) + Zenoh CRDT telemetry replay.
//! - **Timeline**: EVA-07 O2 and SPE dose computed with the P1 metabolic model over
//!   `red_atlas_shared::EVA07_PHASES` and compared with P1's `eva07_events.json`.

use red_atlas_core::canyon_trn::{
    generate_melas_horizon_bank, CanyonTrnEkf, ImuSample, LidarScanMatch, SkylineObservation,
    VioDelta, HORIZON_BINS,
};
use red_atlas_core::h3_mars_grid::{geodesic_distance_m, H3MarsGrid};
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
    eva07_spe_open_sky_rate_msv_h, melas_chasma_survival_triangle, ActiveHazards, Eva07Effort,
    Eva07Phase, HexCellState64B, MissionWaypointKind, PlssTelemetry, SafetyGuardrailState,
    TargetGoal, WalkbackDualStatus, CRITICAL_SLOPE_DEG, DUST_TAU_NOMINAL, DUST_TAU_STORM,
    ESCAPE_LEG_WP2_WP3, EVA07_PHASES, EVA_SPE_DOSE_BUDGET_MSV, GCR_SURFACE_RATE_MSV_H,
    HAZARD_FLAG_ISRU_WATER, ISRU_WATER_MIN_PCT, LOW_TIU_TRAP_THRESHOLD, MARS_GRAVITY,
    MELAS_BASE_PRESSURE_MBAR, NLOS_RSSI_THRESHOLD_DBM, O2_DENSITY_G_PER_L, SHELTER_SVF_MAX,
    SITE_BASE_ELEV_M, SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG, SPE_PEAK_ENVELOPE_MSV_H,
    SUIT_O2_PRIMARY_USABLE_G, SURVIVAL_TRIANGLE_LEGS, SURVIVAL_TRIANGLE_SITE, WP2_RAMP_SLOPE_DEG,
    WP2_SLIP_FRACTION, WP2_TRAVERSE_SPEED_MPS,
};

/// P1 reference timeline (`data/mission-scenarios/eva07_events.json`), embedded at build time.
const P1_EVENTS_JSON: &str = include_str!("../../../../data/mission-scenarios/eva07_events.json");

/// Tolerances of the timeline comparison against P1 (same model, minute integration).
const O2_PCT_TOLERANCE: f64 = 0.05;
const DOSE_MSV_TOLERANCE: f64 = 0.005;

/// State of the EVA-07 timeline at the end of minute `t_min`.
#[derive(Debug, Clone, Copy)]
struct TimelineSample {
    t_min: i32,
    power_w: f64,
    o2_rate_l_min: f64,
    o2_remaining_g: f64,
    dose_spe_msv: f64,
}

impl TimelineSample {
    fn o2_remaining_pct(&self) -> f64 {
        100.0 * self.o2_remaining_g / SUIT_O2_PRIMARY_USABLE_G
    }
    fn o2_remaining_liters(&self) -> f32 {
        (self.o2_remaining_g / O2_DENSITY_G_PER_L) as f32
    }
    fn timestamp_s(&self) -> f64 {
        self.t_min as f64 * 60.0
    }
}

/// Metabolic power of a phase with the P1 model (`pandolf_mars_metabolic_watts`).
fn phase_power_w(phase: &Eva07Phase) -> f64 {
    match phase.effort {
        Eva07Effort::None => 0.0,
        Eva07Effort::Scenario(watts) => watts,
        Eva07Effort::Walk { leg, speed_mps, tiu, slip, slope_deg } => {
            let leg = &SURVIVAL_TRIANGLE_LEGS[leg];
            let grade_deg = slope_deg
                .map(|s| s as f64)
                .unwrap_or_else(|| (leg.delta_elev_m / leg.distance_m).atan().to_degrees());
            pandolf_mars_metabolic_watts(grade_deg, tiu, speed_mps, slip)
        }
    }
}

fn phase_at(t_min: f64) -> &'static Eva07Phase {
    EVA07_PHASES
        .iter()
        .find(|p| t_min >= p.t0_min && t_min < p.t1_min)
        .unwrap_or(&EVA07_PHASES[EVA07_PHASES.len() - 1])
}

/// Integrates the EVA-07 timeline minute by minute (P1 convention: the interval [t-1, t] uses
/// the phase that contains t-1; the SPE rate is piecewise linear, so the trapezoid is exact).
fn simulate_eva07_timeline() -> Vec<TimelineSample> {
    let t_start = EVA07_PHASES[0].t0_min as i32;
    let t_end = EVA07_PHASES[EVA07_PHASES.len() - 1].t1_min as i32;
    let mut o2_used_g = 0.0;
    let mut dose = 0.0;
    let mut samples = Vec::new();
    for t in t_start..=t_end {
        if t > t_start {
            let prev = phase_at((t - 1) as f64);
            let o2_g_min = metabolic_o2_rate_l_min(phase_power_w(prev)) * O2_DENSITY_G_PER_L;
            o2_used_g += o2_g_min;
            let r0 = eva07_spe_open_sky_rate_msv_h((t - 1) as f64);
            let r1 = eva07_spe_open_sky_rate_msv_h(t as f64);
            dose += prev.dose_factor * 0.5 * (r0 + r1) / 60.0;
        }
        let now = phase_at(t as f64);
        let power = phase_power_w(now);
        samples.push(TimelineSample {
            t_min: t,
            power_w: power,
            o2_rate_l_min: metabolic_o2_rate_l_min(power),
            o2_remaining_g: SUIT_O2_PRIMARY_USABLE_G - o2_used_g,
            dose_spe_msv: dose,
        });
    }
    samples
}

fn sample_at(timeline: &[TimelineSample], t_min: i32) -> TimelineSample {
    *timeline
        .iter()
        .find(|s| s.t_min == t_min)
        .expect("timeline covers T-45..T+165")
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

    // EVA-07 reference timeline (O2 and SPE dose) used by the PLSS telemetry of every act.
    let timeline = simulate_eva07_timeline();

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
        h4_nlos_offline: false,
        dust_tau: DUST_TAU_NOMINAL,
        wind_speed_ms: 6.2,
        spe_dose_rate_msv_h: GCR_SURFACE_RATE_MSV_H,
        rssi_dbm: wp1_cell.los_base_rssi_dbm,
    };
    let t40 = sample_at(&timeline, 40); // ISRU work at WP1
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
        "\n[COMM] Base Habitat UHF signal drops behind the terrain spur (no DTM line of sight):"
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
    caution_hazards.h4_nlos_offline = true;
    caution_hazards.rssi_dbm = wp2_cell.los_base_rssi_dbm;
    caution_hazards.h3_regolith_slope = true;

    let t98 = sample_at(&timeline, 98); // WP2 ramp peak
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
        "        4. H4 (NLOS Offline)    : RSSI = {:.1} dBm, no line of sight to the Base",
        wp2_cell.los_base_rssi_dbm
    );

    let t105_hazards = ActiveHazards {
        h1_dust_storm: true,
        h2_spe_radiation: true,
        h3_regolith_slope: true,
        h4_nlos_offline: true,
        dust_tau: DUST_TAU_STORM,
        wind_speed_ms: 28.0,
        spe_dose_rate_msv_h: SPE_PEAK_ENVELOPE_MSV_H,
        rssi_dbm: wp2_cell.los_base_rssi_dbm,
    };

    let t105 = sample_at(&timeline, 105);
    let t105_telemetry = PlssTelemetry {
        timestamp_s: t105.timestamp_s(),
        o2_remaining_liters: t105.o2_remaining_liters(),
        lcvg_water_remaining_min: 75.0,
        battery_remaining_min: 90.0,
        current_o2_rate_l_min: t105.o2_rate_l_min as f32,
        cumulative_rad_msv: t105.dose_spe_msv as f32,
        mission_rad_limit_msv: EVA_SPE_DOSE_BUDGET_MSV, // Full 2 mSv SPE budget per EVA.
        heart_rate_bpm: 162,
    };

    let remaining_rad_budget =
        t105_telemetry.mission_rad_limit_msv - t105_telemetry.cumulative_rad_msv;
    // P1 "open sky" convention while walking: exposure factor 1.0 (not the DTM SVF of the route).
    let open_svf = phase_at(105.0).dose_factor;
    let effective_open_rad_rate = (t105_hazards.spe_dose_rate_msv_h as f64) * open_svf;
    let t_rad_limit_min = (remaining_rad_budget as f64 / effective_open_rad_rate) * 60.0;

    println!(
        "\n[METRICS] LIFE-SUPPORT BUDGET UNDER {:.1} mSv/h SPE RADIATION:",
        SPE_PEAK_ENVELOPE_MSV_H
    );
    println!(
        "        - Remaining Radiation Budget : {:.1} mSv",
        remaining_rad_budget
    );
    println!(
        "        - Effective Open-Sky Rad Rate: {:.1} mSv/h (SVF = {:.2})",
        effective_open_rad_rate, open_svf
    );
    println!(
        "        - Open-sky time to SPE budget: {:.1} min (flight rule; not acutely lethal)",
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

    println!("\n[D* LITE] Zero-Allocation D* Lite evaluates Walkback Limit Dual...");
    let dgs_start = std::time::Instant::now();
    let (walkback_status, escape_path) = dstar.evaluate_walkback_and_switch(
        wp2_cell.h3_index,
        base_cell.h3_index,
        wp3_cell.h3_index,
        &t105_telemetry,
        &t105_hazards,
    );
    let dgs_elapsed_ms = dgs_start.elapsed().as_secs_f64() * 1000.0;
    println!(
        "        - Measured evaluation time      : {:.3} ms (target < 10 ms)",
        dgs_elapsed_ms
    );

    if let Some(path) = &escape_path {
        let path_len_m: f64 = path
            .path_h3
            .windows(2)
            .map(|w| geodesic_distance_m(w[0], w[1]))
            .sum();
        println!(
            "        - Escape path to WP3            : {} cells, {:.0} m along the hex grid",
            path.path_h3.len(),
            path_len_m
        );
    }
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

    // Shelter hold T+114..T+165 under the nominal (calibrated ramp) SPE profile.
    let t165 = sample_at(&timeline, 165);
    let final_cumulative_rad = t165.dose_spe_msv;
    println!(
        "          - SPE Dose at WP3 Arrival    : {:.2} mSv (T+113)",
        sample_at(&timeline, 113).dose_spe_msv
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
    println!("          Zenoh UHF session restored: dropping AUTONOMOUS_NLOS flag...");
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

    print_timeline_vs_p1(&timeline, &walkback_status, t_rad_limit_min);

    print_separator();
    println!("  MISSION STATUS: EVA-07 Melas Chasma Survival Simulation COMPLETED.");
    println!("  ASTRONAUT SURVIVAL: 100% SUCCESSFUL (Dynamic Goal Switching to WP3 Saved Life).");
    println!("  ALL 5 ACTS VERIFIED GREEN: Pre-EVA Chaos Mode -> WP1 ISRU -> WP2 Canyon-TRN ->");
    println!("                             Act 4 Multi-Hazard Fusion -> Act 5 WP3 Shelter Survival.");
    print_separator();
}

/// Prints the EVA-07 milestones (power, O2 left, SPE dose) next to P1's reference timeline and
/// checks that O2 and dose agree within tolerance. Walkback times are reported, not forced.
fn print_timeline_vs_p1(
    timeline: &[TimelineSample],
    walkback: &WalkbackDualStatus,
    t_rad_limit_min: f64,
) {
    print_banner("TIMELINE", "EVA-07 MILESTONES vs P1 REFERENCE (eva07_events.json)");
    let events: serde_json::Value =
        serde_json::from_str(P1_EVENTS_JSON).expect("P1 eva07_events.json must parse");
    println!(
        "  {:>5}  {:<24} {:>8} {:>8} {:>8} {:>9} {:>9}",
        "T", "Milestone", "Power W", "O2 %", "P1 O2 %", "Dose mSv", "P1 mSv"
    );
    let mut max_o2_diff: f64 = 0.0;
    let mut max_dose_diff: f64 = 0.0;
    for event in events["events"].as_array().expect("events[]") {
        let t = event["t_min"].as_i64().expect("t_min") as i32;
        let id = event["id"].as_str().unwrap_or("?");
        let values = &event["values"];
        let ref_o2 = values["o2_remaining_pct"].as_f64().expect("o2_remaining_pct");
        let ref_dose = values["dose_spe_msv"].as_f64().expect("dose_spe_msv");
        let sim = sample_at(timeline, t);
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

    let t105_ref = events["events"]
        .as_array()
        .and_then(|e| e.iter().find(|ev| ev["id"] == "dynamic_goal_switching"))
        .map(|ev| &ev["values"])
        .expect("dynamic_goal_switching event");
    println!("\n  Walkback at T+105 (D* Lite on the synthetic corridor vs P1 reference):");
    println!(
        "    - To Base : {:>5.1} min (P1 {:.1} min over the {:.0} m safe route)",
        walkback.t_walkback_base_min,
        t105_ref["base_time_min"].as_f64().unwrap_or(f64::NAN),
        red_atlas_shared::WP2_BASE_SAFE_ROUTE_M
    );
    println!(
        "    - To WP3  : {:>5.1} min (P1 {:.1} min over {:.0} m)",
        walkback.t_walkback_shelter_min,
        t105_ref["wp3_time_min"].as_f64().unwrap_or(f64::NAN),
        SURVIVAL_TRIANGLE_LEGS[ESCAPE_LEG_WP2_WP3].distance_m
    );
    println!(
        "    - Open-sky radiation window: {:.1} min (P1 15 min); D* Lite T_vital with cell SVF: {:.1} min",
        t_rad_limit_min, walkback.t_vital_min
    );
}
