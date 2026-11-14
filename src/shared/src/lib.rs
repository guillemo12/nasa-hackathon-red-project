//! # R.E.D. ATLAS Shared Library (`red-atlas-shared`)
//!
//! Martian physical constants, geodetic parameters, cache-line aligned
//! 64-byte hexagonal cell state vectors, and mission contracts shared between
//! the base station server (`base-console`), EVA tactical unit (`eva-tactical-hud`),
//! and the mission-critical core engine (`core-engine`).

use serde::{Deserialize, Serialize};

// ============================================================================
// 1. Martian Physical, Geodetic & Biomechanical Constants
// ============================================================================

/// Martian surface gravitational acceleration in m/s² (0.3794 Earth g).
pub const MARS_GRAVITY: f64 = 3.72076;

/// Standard Earth gravitational acceleration in m/s².
pub const EARTH_GRAVITY: f64 = 9.80665;

/// Martian equatorial radius in km (IAU Mars 2000 ellipsoid).
pub const MARS_EQ_RADIUS_KM: f64 = 3396.19;

/// Martian polar radius in km (IAU Mars 2000 ellipsoid).
pub const MARS_POLAR_RADIUS_KM: f64 = 3376.20;

/// Martian mean volumetric radius in km (used for H3 indexing scaling).
pub const MARS_MEAN_RADIUS_KM: f64 = 3389.50;

/// Linear scale factor of Mars vs. Earth for H3 grid resolution calibration.
pub const H3_MARS_LINEAR_SCALE: f64 = 0.5320;

/// Surface area scale factor of Mars vs. Earth for H3 hexagonal cells.
pub const H3_MARS_AREA_SCALE: f64 = 0.2830;

/// Base atmospheric pressure in Melas Chasma canyon floor (~ -4.2 km elevation) in mbar.
pub const MELAS_BASE_PRESSURE_MBAR: f64 = 9.6;

/// Mass of the astronaut in kg.
pub const ASTRO_MASS_KG: f64 = 75.0;

/// Mass of the pressurized EVA spacesuit and PLSS backpack in kg.
pub const SUIT_MASS_KG: f64 = 55.0;

/// Total mass of astronaut plus suit (130 kg total).
pub const TOTAL_EVA_MASS_KG: f64 = 130.0;

/// Energy equivalent of metabolic oxygen consumption in Joules per Liter (STP).
pub const O2_ENERGY_JOULES_PER_LITER: f64 = 20920.0;

/// Safety margin factor for Walkback Limit (0.85 = 15% mandatory reserve).
pub const WALKBACK_SAFETY_FACTOR: f32 = 0.85;

/// Communication radio shadow (NLOS) threshold in dBm.
pub const NLOS_RSSI_THRESHOLD_DBM: f32 = -115.0;

/// Critical slope angle threshold in degrees where mobility is severely impaired.
pub const CRITICAL_SLOPE_DEG: f32 = 20.0;

/// Unpassable slope threshold in degrees for pressurized spacesuit walking.
pub const UNPASSABLE_SLOPE_DEG: f32 = 30.0;

/// Low Thermal Inertia Unit (TIU) threshold indicating treacherous soft regolith trap.
pub const LOW_TIU_TRAP_THRESHOLD: f32 = 150.0;

/// Solar Particle Event (SPE) critical radiation dose rate threshold in mSv/h.
pub const SPE_CRITICAL_RATE_MSV_H: f32 = 25.0;

// ============================================================================
// 2. Hazard Bitmask Flags (u16)
// ============================================================================

/// Slope exceeds critical threshold (> 20 deg).
pub const HAZARD_FLAG_SLOPE_CRITICAL: u16 = 1 << 0; // 0x0001

/// Thermal inertia indicates fine dust / soft regolith sinkage trap (< 150 TIU).
pub const HAZARD_FLAG_REGOLITH_TRAP: u16  = 1 << 1; // 0x0002

/// Cell is within topographic cliff alcove shelter (Sky View Factor <= 0.20).
pub const HAZARD_FLAG_SHELTER: u16        = 1 << 2; // 0x0004

/// Cell is in non-line-of-sight UHF radio shadow (< -115 dBm).
pub const HAZARD_FLAG_NLOS: u16           = 1 << 3; // 0x0008

/// Cell contains significant polyhydrated sulfates for water ISRU (> 10% H2O).
pub const HAZARD_FLAG_ISRU_WATER: u16     = 1 << 4; // 0x0010

// ============================================================================
// 3. 64-Byte Cache-Line Aligned Hexagonal Cell State Vector
// ============================================================================

/// CRC-16-CCITT implementation for SEU (Single Event Upset) detection.
fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if (crc & 0x8000) != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// A 64-byte, cache-line aligned spatial tensor state record for a single H3
/// hexagonal cell in the Melas Chasma corridor.
///
/// Layout (64 bytes total):
/// - `h3_index`: 8 bytes (offset 0..8)
/// - `elev_m`: 4 bytes (offset 8..12)
/// - `slope_deg`: 4 bytes (offset 12..16)
/// - `aspect_deg`: 4 bytes (offset 16..20)
/// - `thermal_inertia_tiu`: 4 bytes (offset 20..24)
/// - `roughness_hi`: 4 bytes (offset 24..28)
/// - `isru_h2o_pct`: 4 bytes (offset 28..32)
/// - `sky_view_factor`: 4 bytes (offset 32..36)
/// - `los_base_rssi_dbm`: 4 bytes (offset 36..40)
/// - `base_metabolic_cost`: 4 bytes (offset 40..44)
/// - `horizon_hash_id`: 4 bytes (offset 44..48)
/// - `hazard_bitmask`: 2 bytes (offset 48..50)
/// - `padding_crc`: 14 bytes (offset 50..64, where [12..14] stores CRC-16)
#[repr(C, align(64))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HexCellState64B {
    pub h3_index: u64,
    pub elev_m: f32,
    pub slope_deg: f32,
    pub aspect_deg: f32,
    pub thermal_inertia_tiu: f32,
    pub roughness_hi: f32,
    pub isru_h2o_pct: f32,
    pub sky_view_factor: f32,
    pub los_base_rssi_dbm: f32,
    pub base_metabolic_cost: f32,
    pub horizon_hash_id: u32,
    pub hazard_bitmask: u16,
    pub padding_crc: [u8; 14],
}

impl HexCellState64B {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        h3_index: u64,
        elev_m: f32,
        slope_deg: f32,
        aspect_deg: f32,
        thermal_inertia_tiu: f32,
        roughness_hi: f32,
        isru_h2o_pct: f32,
        sky_view_factor: f32,
        los_base_rssi_dbm: f32,
        base_metabolic_cost: f32,
        horizon_hash_id: u32,
        hazard_bitmask: u16,
    ) -> Self {
        let mut cell = Self {
            h3_index,
            elev_m,
            slope_deg,
            aspect_deg,
            thermal_inertia_tiu,
            roughness_hi,
            isru_h2o_pct,
            sky_view_factor,
            los_base_rssi_dbm,
            base_metabolic_cost,
            horizon_hash_id,
            hazard_bitmask,
            padding_crc: [0u8; 14],
        };
        cell.seal_crc();
        cell
    }

    /// Computes CRC-16 over the first 62 bytes of the struct (excluding CRC field).
    pub fn compute_crc16(&self) -> u16 {
        let bytes: &[u8] = unsafe {
            std::slice::from_raw_parts((self as *const Self) as *const u8, 62)
        };
        crc16_ccitt(bytes)
    }

    /// Computes and writes the CRC-16 into `padding_crc[12..14]`.
    pub fn seal_crc(&mut self) {
        let crc = self.compute_crc16();
        let bytes = crc.to_le_bytes();
        self.padding_crc[12] = bytes[0];
        self.padding_crc[13] = bytes[1];
    }

    /// Verifies whether the stored CRC matches the recomputed CRC.
    /// Returns false if any bit (SEU) has been flipped.
    pub fn verify_crc(&self) -> bool {
        let stored_crc = u16::from_le_bytes([self.padding_crc[12], self.padding_crc[13]]);
        stored_crc == self.compute_crc16()
    }
}

impl Default for HexCellState64B {
    fn default() -> Self {
        let mut cell = Self {
            h3_index: 0,
            elev_m: 0.0,
            slope_deg: 0.0,
            aspect_deg: 0.0,
            thermal_inertia_tiu: 0.0,
            roughness_hi: 0.0,
            isru_h2o_pct: 0.0,
            sky_view_factor: 1.0,
            los_base_rssi_dbm: 0.0,
            base_metabolic_cost: 0.0,
            horizon_hash_id: 0,
            hazard_bitmask: 0,
            padding_crc: [0u8; 14],
        };
        cell.seal_crc();
        cell
    }
}

// ============================================================================
// 4. Mission Structs & Enums
// ============================================================================

/// Categories of mission waypoints in the Survival Triangle scenario.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MissionWaypointKind {
    BaseHabitat,
    Wp1IsruWater,
    Wp2FaultSlope,
    Wp3CliffShelter,
}

/// A physical waypoint in the Melas Chasma exploration corridor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MissionWaypoint {
    pub id: String,
    pub kind: MissionWaypointKind,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub elev_m: f32,
    pub description: String,
}

/// Returns the 4 canonical nodes defining the Melas Chasma Survival Triangle.
pub fn melas_chasma_survival_triangle() -> Vec<MissionWaypoint> {
    vec![
        MissionWaypoint {
            id: "BASE_HABITAT".to_string(),
            kind: MissionWaypointKind::BaseHabitat,
            lat_deg: -9.8000,
            lon_deg: 283.6000,
            elev_m: -4215.0,
            description: "Melas Chasma Base Habitat on stable alluvial terrace with firm basalt (>400 TIU) and active LOS link".to_string(),
        },
        MissionWaypoint {
            id: "WP1_ISRU_WATER".to_string(),
            kind: MissionWaypointKind::Wp1IsruWater,
            lat_deg: -9.8120,
            lon_deg: 283.6150,
            elev_m: -4230.0,
            description: "Interior Layered Deposit rich in polyhydrated sulfates (>12% H2O structural resource target)".to_string(),
        },
        MissionWaypoint {
            id: "WP2_FAULT_SLOPE".to_string(),
            kind: MissionWaypointKind::Wp2FaultSlope,
            lat_deg: -9.8250,
            lon_deg: 283.6280,
            elev_m: -4180.0,
            description: "Tectonic fault contact and landslide lobe with steep slope (>20 deg), soft regolith trap (<150 TIU), and NLOS radio shadow".to_string(),
        },
        MissionWaypoint {
            id: "WP3_CLIFF_SHELTER".to_string(),
            kind: MissionWaypointKind::Wp3CliffShelter,
            lat_deg: -9.8210,
            lon_deg: 283.6220,
            elev_m: -4150.0,
            description: "Topographic cliff shelter alcove offering 85% SPE radiation shielding (Sky View Factor <= 0.20) and dust storm protection".to_string(),
        },
    ]
}

/// State of active environmental hazards in the operational zone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActiveHazards {
    pub h1_dust_storm: bool,
    pub h2_spe_radiation: bool,
    pub h3_regolith_slope: bool,
    pub h4_nlos_offline: bool,
    pub dust_tau: f32,
    pub wind_speed_ms: f32,
    pub spe_dose_rate_msv_h: f32,
    pub rssi_dbm: f32,
}

impl Default for ActiveHazards {
    fn default() -> Self {
        Self {
            h1_dust_storm: false,
            h2_spe_radiation: false,
            h3_regolith_slope: false,
            h4_nlos_offline: false,
            dust_tau: 0.5,
            wind_speed_ms: 5.0,
            spe_dose_rate_msv_h: 0.05,
            rssi_dbm: -75.0,
        }
    }
}

/// Real-time telemetry from the Portable Life Support System (PLSS).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlssTelemetry {
    pub timestamp_s: f64,
    pub o2_remaining_liters: f32,
    pub lcvg_water_remaining_min: f32,
    pub battery_remaining_min: f32,
    pub current_o2_rate_l_min: f32,
    pub cumulative_rad_msv: f32,
    pub mission_rad_limit_msv: f32,
    pub heart_rate_bpm: u16,
}

impl Default for PlssTelemetry {
    fn default() -> Self {
        Self {
            timestamp_s: 0.0,
            o2_remaining_liters: 120.0,
            lcvg_water_remaining_min: 240.0,
            battery_remaining_min: 300.0,
            current_o2_rate_l_min: 0.8,
            cumulative_rad_msv: 0.1,
            mission_rad_limit_msv: 50.0,
            heart_rate_bpm: 75,
        }
    }
}

/// Operational target goal of the current EVA phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetGoal {
    BaseHabitat,
    Wp1Isru,
    Wp2Fault,
    Wp3Shelter,
}

/// Dual status of the walkback limit monitoring system (Base vs. Shelter).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WalkbackDualStatus {
    pub t_vital_min: f32,
    pub t_walkback_base_min: f32,
    pub t_walkback_shelter_min: f32,
    pub active_target: TargetGoal,
    pub dynamic_goal_switched: bool,
    pub base_feasible: bool,
}

impl Default for WalkbackDualStatus {
    fn default() -> Self {
        Self {
            t_vital_min: 120.0,
            t_walkback_base_min: 25.0,
            t_walkback_shelter_min: 10.0,
            active_target: TargetGoal::BaseHabitat,
            dynamic_goal_switched: false,
            base_feasible: true,
        }
    }
}

/// FSM state codes emitted by the deterministic Safety Guardrail.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SafetyGuardrailState {
    Nominal = 0x01,
    Caution = 0x02,
    MultiHazard = 0x03,
    EvacShelter = 0x04,
    ShelterHold = 0x05,
}

/// Unified tactical alert frame generated by the Single-Alert Fusion engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SingleAlertFrame {
    pub state: SafetyGuardrailState,
    pub ar_path_color_hex: String,
    pub primary_cause: String,
    pub target_bearing_deg: f32,
    pub target_distance_m: f32,
    pub target_eta_min: f32,
    pub nlos_autonomous: bool,
    pub voice_summary_slots: Vec<String>,
}

// ============================================================================
// 5. Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{align_of, size_of};

    #[test]
    fn test_hex_cell_size_and_alignment() {
        assert_eq!(
            size_of::<HexCellState64B>(),
            64,
            "HexCellState64B must be exactly 64 bytes"
        );
        assert_eq!(
            align_of::<HexCellState64B>(),
            64,
            "HexCellState64B must be 64-byte cache-line aligned"
        );
    }

    #[test]
    fn test_hex_cell_crc_seal_and_verify() {
        let mut cell = HexCellState64B::new(
            0x8848a39a09fffff,
            -4215.4,
            12.5,
            180.0,
            380.0,
            0.15,
            0.02,
            0.85,
            -85.0,
            280.0,
            42,
            0,
        );

        // Newly created cell has sealed CRC
        assert!(
            cell.verify_crc(),
            "CRC must verify immediately after creation"
        );

        // Verify that resealing preserves validity
        cell.seal_crc();
        assert!(cell.verify_crc());
    }

    #[test]
    fn test_hex_cell_seu_bit_flip_detection() {
        let mut cell = HexCellState64B::new(
            0x8848a39a09fffff,
            -4215.4,
            12.5,
            180.0,
            380.0,
            0.15,
            0.02,
            0.85,
            -85.0,
            280.0,
            42,
            0,
        );
        assert!(cell.verify_crc());

        // 1. Bit flip in elevation (float field)
        let original_elev = cell.elev_m;
        cell.elev_m += 1.0;
        assert!(
            !cell.verify_crc(),
            "SEU bit-flip in elev_m must invalidate CRC"
        );
        cell.elev_m = original_elev;
        assert!(cell.verify_crc());

        // 2. Bit flip in H3 index (u64 field)
        cell.h3_index ^= 0x01;
        assert!(
            !cell.verify_crc(),
            "SEU bit-flip in h3_index must invalidate CRC"
        );
        cell.h3_index ^= 0x01;
        assert!(cell.verify_crc());

        // 3. Bit flip in hazard bitmask (u16 field)
        cell.hazard_bitmask ^= HAZARD_FLAG_SLOPE_CRITICAL;
        assert!(
            !cell.verify_crc(),
            "SEU bit-flip in hazard_bitmask must invalidate CRC"
        );
        cell.hazard_bitmask ^= HAZARD_FLAG_SLOPE_CRITICAL;
        assert!(cell.verify_crc());

        // 4. Bit flip in stored CRC byte
        cell.padding_crc[12] ^= 0xFF;
        assert!(
            !cell.verify_crc(),
            "Corruption in stored CRC byte must invalidate CRC"
        );
        cell.padding_crc[12] ^= 0xFF;
        assert!(cell.verify_crc());

        // 5. Bit flip in padding byte
        cell.padding_crc[0] ^= 0xAA;
        assert!(
            !cell.verify_crc(),
            "SEU bit-flip in padding bytes must invalidate CRC"
        );
        cell.padding_crc[0] ^= 0xAA;
        assert!(cell.verify_crc());
    }

    #[test]
    fn test_survival_triangle_waypoints() {
        let waypoints = melas_chasma_survival_triangle();
        assert_eq!(waypoints.len(), 4, "Survival Triangle must have 4 nodes");

        assert_eq!(waypoints[0].kind, MissionWaypointKind::BaseHabitat);
        assert_eq!(waypoints[1].kind, MissionWaypointKind::Wp1IsruWater);
        assert_eq!(waypoints[2].kind, MissionWaypointKind::Wp2FaultSlope);
        assert_eq!(waypoints[3].kind, MissionWaypointKind::Wp3CliffShelter);

        // Check realistic Melas Chasma coordinates (~ -9.8 S, 283.6 E)
        for wp in &waypoints {
            assert!(
                wp.lat_deg < -9.7 && wp.lat_deg > -9.9,
                "Latitude should be within Melas Chasma region: {}",
                wp.lat_deg
            );
            assert!(
                wp.lon_deg > 283.5 && wp.lon_deg < 283.7,
                "Longitude should be within Melas Chasma region: {}",
                wp.lon_deg
            );
            assert!(
                wp.elev_m < -4000.0,
                "Elevation should be in deep canyon floor (< -4000m): {}",
                wp.elev_m
            );
        }
    }

    #[test]
    fn test_hazard_bitmask_flags() {
        let all_flags = HAZARD_FLAG_SLOPE_CRITICAL
            | HAZARD_FLAG_REGOLITH_TRAP
            | HAZARD_FLAG_SHELTER
            | HAZARD_FLAG_NLOS
            | HAZARD_FLAG_ISRU_WATER;

        assert_eq!(all_flags & HAZARD_FLAG_SLOPE_CRITICAL, HAZARD_FLAG_SLOPE_CRITICAL);
        assert_eq!(all_flags & HAZARD_FLAG_REGOLITH_TRAP, HAZARD_FLAG_REGOLITH_TRAP);
        assert_eq!(all_flags & HAZARD_FLAG_SHELTER, HAZARD_FLAG_SHELTER);
        assert_eq!(all_flags & HAZARD_FLAG_NLOS, HAZARD_FLAG_NLOS);
        assert_eq!(all_flags & HAZARD_FLAG_ISRU_WATER, HAZARD_FLAG_ISRU_WATER);

        // Ensure flags are independent
        assert_eq!(HAZARD_FLAG_SLOPE_CRITICAL & HAZARD_FLAG_REGOLITH_TRAP, 0);
        assert_eq!(HAZARD_FLAG_REGOLITH_TRAP & HAZARD_FLAG_SHELTER, 0);
        assert_eq!(HAZARD_FLAG_SHELTER & HAZARD_FLAG_NLOS, 0);
        assert_eq!(HAZARD_FLAG_NLOS & HAZARD_FLAG_ISRU_WATER, 0);
    }

    #[test]
    fn test_physical_constants() {
        assert!((MARS_GRAVITY - 3.72076).abs() < 1e-5);
        assert!((TOTAL_EVA_MASS_KG - 130.0).abs() < 1e-5);
        assert!((WALKBACK_SAFETY_FACTOR - 0.85).abs() < 1e-5);
        assert!((NLOS_RSSI_THRESHOLD_DBM - (-115.0)).abs() < 1e-5);
        assert!((CRITICAL_SLOPE_DEG - 20.0).abs() < 1e-5);
        assert!((UNPASSABLE_SLOPE_DEG - 30.0).abs() < 1e-5);
        assert!((LOW_TIU_TRAP_THRESHOLD - 150.0).abs() < 1e-5);
        assert!((SPE_CRITICAL_RATE_MSV_H - 25.0).abs() < 1e-5);
    }

    #[test]
    fn test_serde_json_roundtrip() {
        let cell = HexCellState64B::new(
            0x8848a39a09fffff,
            -4215.4,
            12.5,
            180.0,
            380.0,
            0.15,
            0.02,
            0.85,
            -85.0,
            280.0,
            42,
            HAZARD_FLAG_ISRU_WATER,
        );

        let json = serde_json::to_string(&cell).expect("Serialization failed");
        let deserialized: HexCellState64B =
            serde_json::from_str(&json).expect("Deserialization failed");

        assert_eq!(cell, deserialized);
        assert!(deserialized.verify_crc());

        let frame = SingleAlertFrame {
            state: SafetyGuardrailState::EvacShelter,
            ar_path_color_hex: "#FF2A2A".to_string(),
            primary_cause: "SPE_AND_DUST_STORM".to_string(),
            target_bearing_deg: 245.0,
            target_distance_m: 600.0,
            target_eta_min: 8.0,
            nlos_autonomous: true,
            voice_summary_slots: vec![
                "SPE_ALERT".to_string(),
                "EVAC_TO_WP3_SHELTER".to_string(),
            ],
        };

        let frame_json = serde_json::to_string(&frame).expect("Frame serialize failed");
        let frame_deserialized: SingleAlertFrame =
            serde_json::from_str(&frame_json).expect("Frame deserialize failed");
        assert_eq!(frame, frame_deserialized);
    }
}
