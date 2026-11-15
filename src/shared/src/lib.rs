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

/// Reference sphere radius of the NASA datasets (MOLA, CRS IAU_2015:49900) in km.
/// This is the radius used to scale the H3 grid (defined by P1).
pub const MARS_H3_REFERENCE_RADIUS_KM: f64 = MARS_EQ_RADIUS_KM;

/// Earth authalic radius used by the original H3 grid, in km.
pub const EARTH_H3_AUTHALIC_RADIUS_KM: f64 = 6371.0088;

/// Linear scale factor of Mars vs. Earth for H3 grid resolution calibration
/// (3396.19 / 6371.0088 ≈ 0.5331).
pub const H3_MARS_LINEAR_SCALE: f64 = MARS_H3_REFERENCE_RADIUS_KM / EARTH_H3_AUTHALIC_RADIUS_KM;

/// Surface area scale factor of Mars vs. Earth for H3 hexagonal cells (0.5331² ≈ 0.2842).
pub const H3_MARS_AREA_SCALE: f64 = H3_MARS_LINEAR_SCALE * H3_MARS_LINEAR_SCALE;

/// Mass of the astronaut in kg (P1).
pub const ASTRO_MASS_KG: f64 = 80.0;

/// Mass of the pressurized EVA spacesuit and PLSS backpack in kg (P1: ~90 kg including the PLSS backpack).
pub const SUIT_MASS_KG: f64 = 90.0;

/// Total mass of astronaut plus suit (170 kg total).
pub const TOTAL_EVA_MASS_KG: f64 = ASTRO_MASS_KG + SUIT_MASS_KG;

/// Energy equivalent of metabolic oxygen consumption in Joules per Liter (STPD).
/// 20 100 J/L ⇒ 1 L/min of O2 = 335 W (P1).
pub const O2_ENERGY_JOULES_PER_LITER: f64 = 20100.0;

/// Safety margin factor for Walkback Limit (0.85 = 15% mandatory reserve).
pub const WALKBACK_SAFETY_FACTOR: f32 = 0.85;

/// Communication radio shadow (NLOS) threshold in dBm: red below -100 dBm (P1).
pub const NLOS_RSSI_THRESHOLD_DBM: f32 = -100.0;

/// Radio amber threshold in dBm: amber between -85 and -100 dBm (P1).
pub const RSSI_AMBER_THRESHOLD_DBM: f32 = -85.0;

/// Critical slope angle threshold in degrees where mobility is severely impaired (P1: red > 20 deg).
pub const CRITICAL_SLOPE_DEG: f32 = 20.0;

/// Slope amber threshold in degrees (P1: amber 10-20 deg).
pub const SLOPE_AMBER_DEG: f32 = 10.0;

/// Unpassable slope threshold in degrees for pressurized spacesuit walking.
pub const UNPASSABLE_SLOPE_DEG: f32 = 30.0;

/// Low Thermal Inertia Unit (TIU) threshold indicating treacherous soft regolith trap (P1: red < 150 TIU).
pub const LOW_TIU_TRAP_THRESHOLD: f32 = 150.0;

/// Thermal inertia amber threshold (P1: green > 400 TIU, amber 150-400 TIU).
pub const TIU_AMBER_THRESHOLD: f32 = 400.0;

/// Solar Particle Event (SPE) critical (red) dose rate threshold in mSv/h (P1: red > 1.0 mSv/h).
pub const SPE_CRITICAL_RATE_MSV_H: f32 = 1.0;

/// Dose rate amber threshold in mSv/h (P1: amber 0.05-1.0 mSv/h).
pub const SPE_AMBER_RATE_MSV_H: f32 = 0.05;

/// Open-sky peak of the design SPE envelope in mSv/h (P1, scenario value).
pub const SPE_PEAK_ENVELOPE_MSV_H: f32 = 8.0;

/// Maximum SPE dose budget per EVA in mSv (P1 flight rule: 2 mSv => 15 min under open sky).
pub const EVA_SPE_DOSE_BUDGET_MSV: f32 = 2.0;

/// Surface GCR background measured by RAD at Gale, in mSv/h (P1: ~0.64 mSv/day).
pub const GCR_SURFACE_RATE_MSV_H: f32 = 0.027;

/// Dust optical depth tau (880 nm) amber threshold (P1: amber 1.0-2.0).
pub const DUST_TAU_AMBER: f32 = 1.0;

/// Dust optical depth tau (880 nm) red threshold (P1: red > 2.0).
pub const DUST_TAU_RED: f32 = 2.0;

/// Wind speed amber threshold in m/s (P1: amber 10-20 m/s).
pub const WIND_AMBER_M_S: f32 = 10.0;

/// Wind speed red threshold in m/s (P1: red > 20 m/s).
pub const WIND_RED_M_S: f32 = 20.0;

/// O2 consumption amber threshold in L/min STPD (P1: amber 1.35-1.75).
pub const O2_RATE_AMBER_L_MIN: f32 = 1.35;

/// O2 consumption red threshold in L/min STPD (P1: red > 1.75 sustained; peak 3.2).
pub const O2_RATE_RED_L_MIN: f32 = 1.75;

/// Minimum structural water content to flag a cell as ISRU resource (P1: > 12% H2O).
pub const ISRU_WATER_MIN_PCT: f32 = 12.0;

/// Maximum Sky View Factor for a cell to count as topographic shelter.
pub const SHELTER_SVF_MAX: f32 = 0.20;

// ----------------------------------------------------------------------------
// 1a. Points reported by the astronaut during the EVA (supuesto de diseño, declarado)
// ----------------------------------------------------------------------------

/// Radius of the exclusion zone around a reported HAZARD point, m: the planner treats every
/// cell whose center is closer than this as impassable. Design assumption: 2.5 pixels of the
/// 20 m CTX DTM (the smallest feature the terrain model resolves) plus ~10 m for where the
/// astronaut places the mark on the wrist map.
pub const REPORTED_HAZARD_EXCLUSION_RADIUS_M: f64 = 50.0;
/// Outer radius of the caution ring around a reported HAZARD point, m (design assumption:
/// twice the exclusion radius). Cells in the ring stay passable at a higher cost.
pub const REPORTED_HAZARD_CAUTION_RADIUS_M: f64 = 100.0;
/// Cost multiplier of an edge that enters the caution ring (design assumption). Time, O2 and
/// dose are not changed: only the planner's preference.
pub const REPORTED_HAZARD_CAUTION_COST_FACTOR: f64 = 3.0;
/// Largest distance from the reported point to the cell the planner uses for a reported
/// SHELTER or ISRU point, m (it snaps to the nearest grid cell).
pub const REPORTED_POINT_SNAP_MAX_M: f64 = 30.0;

// ----------------------------------------------------------------------------
// 1b. P1 reference metabolic model
//     M = 120 + eta*0.285*W*v + W*v*sin(theta) / (0.25*(1 - s))   [W],  W = mass*g_Mars
// ----------------------------------------------------------------------------

/// Suited resting metabolic term in W.
pub const METABOLIC_REST_W: f64 = 120.0;

/// Level-walking coefficient (dimensionless), multiplied by eta*W*v.
pub const METABOLIC_LEVEL_COEF: f64 = 0.285;

/// Muscular efficiency of the climbing work term.
pub const METABOLIC_CLIMB_EFFICIENCY: f64 = 0.25;

/// Lower TIU bound (exclusive) of the eta = 1.3 band (P1: eta = 1.3 for 250 < TIU <= 400;
/// exactly 250 TIU belongs to the 1.6 band, as in P1's `eta_from_tiu`).
pub const TIU_ETA_MID_THRESHOLD: f32 = 250.0;

/// P1 terrain factors eta: [> 400 TIU, 250-400, 150-250, < 150].
pub const TERRAIN_ETA_BY_TIU_BAND: [f64; 4] = [1.0, 1.3, 1.6, 2.1];

// ============================================================================
// 2. Hazard Bitmask Flags (u16)
// ============================================================================

/// Slope exceeds critical threshold (> 20 deg).
pub const HAZARD_FLAG_SLOPE_CRITICAL: u16 = 1 << 0; // 0x0001

/// Thermal inertia indicates fine dust / soft regolith sinkage trap (< 150 TIU).
pub const HAZARD_FLAG_REGOLITH_TRAP: u16  = 1 << 1; // 0x0002

/// Cell is within topographic cliff alcove shelter (Sky View Factor <= 0.20, `SHELTER_SVF_MAX`).
pub const HAZARD_FLAG_SHELTER: u16        = 1 << 2; // 0x0004

/// Cell is in non-line-of-sight UHF radio shadow (< -100 dBm, `NLOS_RSSI_THRESHOLD_DBM`).
pub const HAZARD_FLAG_NLOS: u16           = 1 << 3; // 0x0008

/// Cell contains significant hydrated sulfates for water ISRU (>= 12% H2O, `ISRU_WATER_MIN_PCT`).
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

/// "No data" sentinel for the `f32` fields of `HexCellState64B` (P1 Parquet `NULL`s, e.g. TIU
/// outside the scenario zones). NaN never satisfies a threshold comparison, so a missing value
/// never raises a hazard flag. `serde_json` writes NaN as `null`; `f32_or_no_data` reads it back.
pub const CELL_NO_DATA: f32 = f32::NAN;

/// True when an `f32` cell field carries the `CELL_NO_DATA` sentinel.
#[inline]
pub fn is_no_data(value: f32) -> bool {
    value.is_nan()
}

/// Returns `value`, or `assumed` when it is `CELL_NO_DATA`. Every consumer that turns a cell field
/// into a cost or a rate must go through this (or an explicit `is_no_data` branch): a raw NaN
/// would poison D* Lite keys and Poisson rates.
#[inline]
pub fn or_assumed(value: f32, assumed: f32) -> f32 {
    if is_no_data(value) {
        assumed
    } else {
        value
    }
}

/// Planner assumption for a cell without thermal inertia (P1 `NULL`: 139,978 of the 141,313
/// resolution-12 cells, since TIU only exists inside the scenario discs). Mid band 250-400 TIU
/// (eta 1.3): neither firm ground (> 400) nor regolith trap (< 150); it is also the band of P3's
/// synthetic background (360 TIU). Hazard flags and trap checks keep using the raw value, so a
/// missing TIU never raises `REGOLITH_TRAP`. Open decision for P1 (no quantitative THEMIS TI).
pub const TIU_NO_DATA_ASSUMED: f32 = 325.0;

/// Planner assumption for a cell without Sky View Factor: open sky (1.0), the worst case for dose.
pub const SVF_NO_DATA_ASSUMED: f32 = 1.0;

/// Deserializes an `f32` that may be `null` (no data) into `CELL_NO_DATA`.
fn f32_or_no_data<'de, D>(deserializer: D) -> Result<f32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<f32>::deserialize(deserializer).map(|v| v.unwrap_or(CELL_NO_DATA))
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
    #[serde(deserialize_with = "f32_or_no_data")]
    pub elev_m: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
    pub slope_deg: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
    pub aspect_deg: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
    pub thermal_inertia_tiu: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
    pub roughness_hi: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
    pub isru_h2o_pct: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
    pub sky_view_factor: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
    pub los_base_rssi_dbm: f32,
    #[serde(deserialize_with = "f32_or_no_data")]
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

/// Static site record of a Survival Triangle node (single source of truth for site data).
///
/// Provenance (P1, `data/mission-scenarios/triangulo_supervivencia.geojson`): coordinates and
/// slopes derived from the CTX 20 m DTM, elevations measured on it; TIU, water and the WP3
/// alcove SVF are design-scenario values.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaypointSite {
    pub id: &'static str,
    pub kind: MissionWaypointKind,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub elev_m: f32,
    /// Local slope of the node on the CTX 20 m DTM, degrees (derived).
    pub slope_dem_deg: f32,
    /// Design-scenario thermal inertia, TIU (J m^-2 K^-1 s^-1/2).
    pub thermal_inertia_tiu: f32,
    /// Effective Sky View Factor used by the engine (WP3: 0.15 alcove under overhang, scenario).
    pub sky_view_factor: f32,
    /// Sky View Factor derived from the DTM (a 2.5D DEM cannot represent the WP3 overhang).
    pub sky_view_factor_dem: f32,
    /// Structural water content in wt% (scenario; `CELL_NO_DATA` where P1 gives no value).
    pub h2o_wt_pct: f32,
    /// Geometric radio line of sight to the Base antenna (derived from the DTM).
    pub radio_los_base: bool,
    pub description: &'static str,
}

/// A planned or contingency leg between two Survival Triangle nodes (indices into
/// `SURVIVAL_TRIANGLE_SITE`). Distances, elevation deltas and bearings from the P1 GeoJSON.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SurvivalLeg {
    pub id: &'static str,
    pub from: usize,
    pub to: usize,
    pub distance_m: f64,
    pub delta_elev_m: f64,
    pub bearing_deg: f32,
}

// ============================================================================
// 4b. Site data (SINGLE place for waypoint coordinates, elevations and pressure)
// ----------------------------------------------------------------------------
// Relocated P1 site (2026-11-14): SW basin of Melas Chasma, at the foot of the SW wall,
// 13.6 km SW of the original 9.8S 283.6E placement. CRS IAU_2015:49900, lon East 0-360,
// elevations on the MOLA areoid.
// ============================================================================

/// The 4 canonical nodes of the Melas Chasma Survival Triangle (lon East 0-360, MOLA datum).
pub const SURVIVAL_TRIANGLE_SITE: [WaypointSite; 4] = [
    WaypointSite {
        id: "BASE_HABITAT",
        kind: MissionWaypointKind::BaseHabitat,
        lat_deg: -9.89646,
        lon_deg: 283.38920,
        elev_m: -1660.0,
        slope_dem_deg: 2.8,
        thermal_inertia_tiu: 320.0,
        sky_view_factor: 0.85,
        sky_view_factor_dem: 0.85,
        h2o_wt_pct: CELL_NO_DATA,
        radio_los_base: true,
        description: "Melas Chasma Base Habitat on a distal alluvial-fan terrace of the SW basin floor",
    },
    WaypointSite {
        id: "WP1_ISRU_WATER",
        kind: MissionWaypointKind::Wp1IsruWater,
        lat_deg: -9.918797,
        lon_deg: 283.401259,
        elev_m: -1582.0,
        slope_dem_deg: 6.7,
        thermal_inertia_tiu: 410.0,
        sky_view_factor: 0.85,
        sky_view_factor_dem: 0.85,
        h2o_wt_pct: 12.0,
        radio_los_base: true,
        description: "Light-toned layered deposit with polyhydrated and monohydrated sulfates (>= 12% H2O resource target)",
    },
    WaypointSite {
        id: "WP2_FAULT_SLOPE",
        kind: MissionWaypointKind::Wp2FaultSlope,
        lat_deg: -9.932611,
        lon_deg: 283.386234,
        elev_m: -1464.0,
        slope_dem_deg: 19.4,
        thermal_inertia_tiu: 110.0,
        sky_view_factor: 0.84,
        sky_view_factor_dem: 0.84,
        h2o_wt_pct: CELL_NO_DATA,
        radio_los_base: false,
        description: "Landslide lobe / normal fault contact with fine dust banks: 22 deg local ramp (scenario), soft regolith trap (<150 TIU) and NLOS radio shadow",
    },
    WaypointSite {
        id: "WP3_CLIFF_SHELTER",
        kind: MissionWaypointKind::Wp3CliffShelter,
        lat_deg: -9.922858,
        lon_deg: 283.383486,
        elev_m: -1520.0,
        slope_dem_deg: 20.1,
        thermal_inertia_tiu: 620.0,
        sky_view_factor: 0.15,
        sky_view_factor_dem: 0.76,
        h2o_wt_pct: CELL_NO_DATA,
        radio_los_base: false,
        description: "Alcove under an overhang at the base of a layered-basalt scarp: 85% SPE shielding (scenario SVF 0.15; DTM SVF 0.76), below WP2",
    },
];

/// Legs of the Survival Triangle (P1 GeoJSON): L1 Base->WP1, L2 WP1->WP2, L3 WP2->WP3 (escape),
/// L4 WP3->Base and R1 WP2->Base (straight-line contingency return).
pub const SURVIVAL_TRIANGLE_LEGS: [SurvivalLeg; 5] = [
    SurvivalLeg { id: "L1", from: 0, to: 1, distance_m: 1500.0, delta_elev_m: 78.0, bearing_deg: 152.0 },
    SurvivalLeg { id: "L2", from: 1, to: 2, distance_m: 1200.0, delta_elev_m: 118.0, bearing_deg: 227.0 },
    SurvivalLeg { id: "L3", from: 2, to: 3, distance_m: 600.0, delta_elev_m: -56.0, bearing_deg: 344.0 },
    SurvivalLeg { id: "L4", from: 3, to: 0, distance_m: 1600.0, delta_elev_m: -140.0, bearing_deg: 12.0 },
    SurvivalLeg { id: "R1", from: 2, to: 0, distance_m: 2150.0, delta_elev_m: -196.0, bearing_deg: 5.0 },
];

/// Index of the WP2 -> WP3 escape leg (L3) in `SURVIVAL_TRIANGLE_LEGS`.
pub const ESCAPE_LEG_WP2_WP3: usize = 2;

/// Reference latitude of the local grid projection (Base Habitat node), degrees North.
pub const SITE_REFERENCE_LAT_DEG: f64 = SURVIVAL_TRIANGLE_SITE[0].lat_deg;

/// Reference East longitude of the local grid projection (Base Habitat node), degrees.
pub const SITE_REFERENCE_LON_DEG: f64 = SURVIVAL_TRIANGLE_SITE[0].lon_deg;

/// Base Habitat elevation (MOLA datum) in m.
pub const SITE_BASE_ELEV_M: f32 = SURVIVAL_TRIANGLE_SITE[0].elev_m;

/// Base atmospheric pressure in mbar (P1: P = 610 Pa * exp(-z / 11.1 km) = 708 Pa at -1,660 m;
/// CO2 column 19.0 g/cm^2). Still above the water triple point (611 Pa).
pub const MELAS_BASE_PRESSURE_MBAR: f64 = 7.08;

/// EVA-07 scenario: dust optical depth before the storm front (P1: tau 0.7 -> 2.4).
pub const DUST_TAU_NOMINAL: f32 = 0.7;

/// EVA-07 scenario: dust optical depth during the storm front (P1: tau 0.7 -> 2.4).
pub const DUST_TAU_STORM: f32 = 2.4;

/// EVA-07 scenario: local ramp slope at WP2 in degrees (P1 shared figure, scenario value;
/// the real DTM slope of the node is `SURVIVAL_TRIANGLE_SITE[2].slope_dem_deg` = 19.4 deg).
pub const WP2_RAMP_SLOPE_DEG: f32 = 22.0;

/// EVA-07 scenario: walking speed on the WP2 ramp in m/s (P1).
pub const WP2_TRAVERSE_SPEED_MPS: f64 = 0.55;

/// EVA-07 scenario: slip fraction on the WP2 ramp (P1: 30%).
pub const WP2_SLIP_FRACTION: f64 = 0.30;

// ----------------------------------------------------------------------------
// 4c. Radio link budget (P1 `scenario/constants.py` and `SCHEMA_HEXGRID.md` §9)
// ----------------------------------------------------------------------------
// Primary data link (the Zenoh session): S band, 2.4 GHz, 1 W, isotropic antennas. It is the
// link that drops behind the relief (WP2 -103.1 dBm, WP3 -107.9 dBm on P1's grid, knife-edge
// diffraction over the CTX DTM). UHF 435 MHz, 1 W stays as a low-rate beacon that survives
// degraded (-81.0 / -85.7 dBm) and the system does not depend on it.

/// Primary data link carrier frequency, MHz (S band).
pub const RADIO_PRIMARY_FREQ_MHZ: f64 = 2400.0;

/// Primary data link transmitter power, dBm (1 W).
pub const RADIO_TX_POWER_DBM: f64 = 30.0;

/// Antenna gain at each end, dBi (isotropic: P1 gives no gains).
pub const RADIO_ANTENNA_GAIN_DBI: f64 = 0.0;

/// Diffraction loss without line of sight when no per-cell value is available, dB (P1: mean of
/// the 2.4 GHz single knife-edge losses at WP2 and WP3, 26.4 and 33.8 dB). The real grid carries
/// its own per-cell level in `los_base_rssi_dbm`; this value only fills NULL cells and the
/// synthetic corridor.
pub const RADIO_NLOS_DIFFRACTION_DB: f64 = 30.0;

/// Minimum distance used in the free-space loss, in m (avoids log(0) at the Base antenna).
pub const RADIO_MIN_DISTANCE_M: f64 = 10.0;

/// Low-rate UHF beacon carrier frequency, MHz.
pub const RADIO_BEACON_FREQ_MHZ: f64 = 435.0;

/// Low-rate UHF beacon transmitter power, dBm (1 W).
pub const RADIO_BEACON_TX_DBM: f64 = 30.0;

/// Free-space loss in dB at `distance_m` (clamped to `RADIO_MIN_DISTANCE_M`) and `freq_mhz`.
pub fn free_space_loss_db(distance_m: f64, freq_mhz: f64) -> f64 {
    let d_km = distance_m.max(RADIO_MIN_DISTANCE_M) / 1000.0;
    20.0 * d_km.log10() + 20.0 * freq_mhz.log10() + 32.44
}

/// Received level of the primary S-band link in dBm: free space at `distance_m`, minus
/// `RADIO_NLOS_DIFFRACTION_DB` without line of sight.
pub fn primary_link_rssi_dbm(distance_m: f64, line_of_sight: bool) -> f32 {
    let diffraction = if line_of_sight { 0.0 } else { RADIO_NLOS_DIFFRACTION_DB };
    (RADIO_TX_POWER_DBM + 2.0 * RADIO_ANTENNA_GAIN_DBI
        - free_space_loss_db(distance_m, RADIO_PRIMARY_FREQ_MHZ)
        - diffraction) as f32
}

/// Received level of the UHF beacon in dBm with a given diffraction loss.
pub fn beacon_rssi_dbm(distance_m: f64, diffraction_db: f64) -> f32 {
    (RADIO_BEACON_TX_DBM + 2.0 * RADIO_ANTENNA_GAIN_DBI
        - free_space_loss_db(distance_m, RADIO_BEACON_FREQ_MHZ)
        - diffraction_db) as f32
}

// ----------------------------------------------------------------------------
// 4d. EVA-07 reference timeline (P1 `eva07_events.json`; minutes after departure, 14:45 LMST)
// ----------------------------------------------------------------------------

/// Usable primary O2 mass carried by the suit at departure, in g (P1, scenario).
pub const SUIT_O2_PRIMARY_USABLE_G: f64 = 800.0;

/// O2 density at STPD in g/L.
pub const O2_DENSITY_G_PER_L: f64 = 1.429;

/// Usable primary O2 volume at STPD, L (800 g / 1.429 g/L = 559.8 L).
pub const SUIT_O2_PRIMARY_USABLE_L: f64 = SUIT_O2_PRIMARY_USABLE_G / O2_DENSITY_G_PER_L;

/// Primary O2 amber band starts at or below this percentage of the usable tank
/// (P1 `eva_thresholds.json` `o2_primary_pct`: green > 50, amber 30-50, red < 30).
pub const O2_PRIMARY_AMBER_PCT: f64 = 50.0;
/// Primary O2 red band (abort / change of destination) below this percentage of the tank.
pub const O2_PRIMARY_RED_PCT: f64 = 30.0;
/// Red primary O2 level in litres: 30 % of 559.8 L = 167.9 L.
pub const O2_PRIMARY_RED_L: f64 = SUIT_O2_PRIMARY_USABLE_L * O2_PRIMARY_RED_PCT / 100.0;

/// Sustained red limit of metabolic power in W (P1 `eva_thresholds.json`: > 585 W sustained).
pub const METABOLIC_RED_SUSTAINED_W: f64 = 585.0;

/// Light ISRU sampling work at WP1 in W (P1, scenario).
pub const ISRU_WORK_POWER_W: f64 = 250.0;

/// Pressurized rest inside the WP3 shelter in W (P1, scenario).
pub const SHELTER_REST_POWER_W: f64 = 130.0;

/// Minute of the T+105 alert: SPE + dust, Dynamic Goal Switching and start of the escape.
/// The escape duration and power are NOT constants: they come from the D* Lite planner on the
/// real terrain at run time (`red_atlas_core::mission`), see `eva07_phases`.
pub const EVA07_DECISION_T_MIN: f64 = 105.0;

// --- Planner pace rule (single definition) ------------------------------------------------
// On every edge the planner walks at the highest speed that satisfies BOTH a speed cap and a
// metabolic power cap, with the shared P1 metabolic model (edge grade, terrain eta from TIU,
// slip). Nothing here is tuned to hit a published time.

/// Emergency escape speed cap in m/s (P1 `ESCAPE_SPEED_M_S`, WP2 -> WP3 urgent march).
pub const ESCAPE_SPEED_CAP_MPS: f64 = 1.25;
/// Emergency escape metabolic power cap in W (team decision: short emergency effort).
pub const ESCAPE_POWER_CAP_W: f64 = 650.0;
/// Sustained return speed cap in m/s before dust visibility (the planner's nominal walk speed).
pub const RETURN_SPEED_CAP_MPS: f64 = 1.0;
/// Sustained return metabolic power cap in W: the sustained red limit of `eva_thresholds.json`.
pub const RETURN_POWER_CAP_W: f64 = METABOLIC_RED_SUSTAINED_W;
/// Slip fraction applied on loose-regolith trap edges (TIU < 150 and cell slope > 20 deg),
/// P1's WP2 value. Elsewhere s = 0.
pub const REGOLITH_TRAP_SLIP_FRACTION: f64 = WP2_SLIP_FRACTION;
/// Floor speed in m/s so that a capped edge is slow but never divides by zero.
pub const PACE_MIN_SPEED_MPS: f64 = 0.05;

/// Speed / power caps of one walking regime.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PaceProfile {
    pub speed_cap_mps: f64,
    pub power_cap_w: f64,
    /// Whether the dust visibility factor `1 / (1 + 0.15 (tau - 0.5)+)` lowers the speed cap.
    pub dust_visibility_limits_speed: bool,
}

/// Emergency escape to the shelter: 1.25 m/s and 650 W (no visibility cap: P1 escape rule).
pub const PACE_EMERGENCY_ESCAPE: PaceProfile = PaceProfile {
    speed_cap_mps: ESCAPE_SPEED_CAP_MPS,
    power_cap_w: ESCAPE_POWER_CAP_W,
    dust_visibility_limits_speed: false,
};

/// Sustained return to the Base: 585 W and the visibility-limited 1.0 m/s cap.
pub const PACE_SUSTAINED_RETURN: PaceProfile = PaceProfile {
    speed_cap_mps: RETURN_SPEED_CAP_MPS,
    power_cap_w: RETURN_POWER_CAP_W,
    dust_visibility_limits_speed: true,
};

/// Metabolic effort of an EVA-07 phase.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Eva07Effort {
    /// Astronaut at the Base console: no primary O2 consumption.
    None,
    /// Scenario power in W (no walking model).
    Scenario(f64),
    /// P1 metabolic model. `slope_deg = None` uses the leg grade atan(dz / d) of `leg`
    /// (downhill grades earn no credit in the model).
    Walk {
        leg: usize,
        speed_mps: f64,
        tiu: f32,
        slip: f64,
        slope_deg: Option<f32>,
    },
}

/// One phase `[t0_min, t1_min)` of the EVA-07 reference timeline (boundaries may be
/// fractional: arrival at WP3 at T+114.4).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Eva07Phase {
    pub id: &'static str,
    pub t0_min: f64,
    pub t1_min: f64,
    pub effort: Eva07Effort,
    /// Exposure factor applied to the open-sky SPE rate: 1.0 while walking (P1 "open sky"
    /// convention), the WP3 alcove SVF once under the overhang.
    pub dose_factor: f64,
}

const fn mean_tiu(a: usize, b: usize) -> f32 {
    (SURVIVAL_TRIANGLE_SITE[a].thermal_inertia_tiu + SURVIVAL_TRIANGLE_SITE[b].thermal_inertia_tiu) / 2.0
}

/// EVA-07 phases (P1 `SCHEMA_EVA07.md` section 4). Walking speeds of L1 and L2 are the means
/// imposed by the fixed milestones (L1 1,500 m in 28 min, L2 1,200 m in 23 min) and eta comes
/// from the mean TIU of the two leg nodes; the 110 TIU bank (eta 2.1) applies on the WP2 ramp
/// (T+98-105). These are the phases up to the T+105 decision; they do not depend on the planner.
pub const EVA07_PRE_DECISION_PHASES: [Eva07Phase; 7] = [
    Eva07Phase { id: "A1_consola", t0_min: -45.0, t1_min: 0.0, effort: Eva07Effort::None, dose_factor: 1.0 },
    Eva07Phase {
        id: "A2_marcha_L1", t0_min: 0.0, t1_min: 28.0,
        effort: Eva07Effort::Walk { leg: 0, speed_mps: 1500.0 / (28.0 * 60.0), tiu: mean_tiu(0, 1), slip: 0.0, slope_deg: None },
        dose_factor: 1.0,
    },
    Eva07Phase { id: "A2_isru_wp1", t0_min: 28.0, t1_min: 75.0, effort: Eva07Effort::Scenario(ISRU_WORK_POWER_W), dose_factor: 1.0 },
    Eva07Phase {
        id: "A3_marcha_L2", t0_min: 75.0, t1_min: 92.0,
        effort: Eva07Effort::Walk { leg: 1, speed_mps: 1200.0 / (23.0 * 60.0), tiu: mean_tiu(1, 2), slip: 0.0, slope_deg: None },
        dose_factor: 1.0,
    },
    Eva07Phase {
        id: "A3_marcha_L2_nlos", t0_min: 92.0, t1_min: 98.0,
        effort: Eva07Effort::Walk { leg: 1, speed_mps: 1200.0 / (23.0 * 60.0), tiu: mean_tiu(1, 2), slip: 0.0, slope_deg: None },
        dose_factor: 1.0,
    },
    Eva07Phase {
        id: "A3_rampa_pico", t0_min: 98.0, t1_min: 101.0,
        effort: Eva07Effort::Walk {
            leg: 1, speed_mps: WP2_TRAVERSE_SPEED_MPS, tiu: SURVIVAL_TRIANGLE_SITE[2].thermal_inertia_tiu,
            slip: WP2_SLIP_FRACTION, slope_deg: Some(WP2_RAMP_SLOPE_DEG),
        },
        dose_factor: 1.0,
    },
    // Pace regulated so that the power stays at the sustained red limit (P1: 0.268 m/s).
    Eva07Phase { id: "A3_rampa_lenta", t0_min: 101.0, t1_min: 105.0, effort: Eva07Effort::Scenario(METABOLIC_RED_SUSTAINED_W), dose_factor: 1.0 },
];

/// Full EVA-07 phases (P1 `SCHEMA_EVA07.md` section 4): the pre-decision phases, then the
/// escape to WP3 that the D* Lite planner computes at T+105 (`escape_time_min`, mean power
/// `escape_mean_power_w`; open-sky exposure while walking, P1 convention), then the shelter
/// hold under the WP3 overhang (SVF 0.15) until T+165. The escape is assumed to end before
/// T+125 (checked: `escape_time_min` is clamped to that window).
pub fn eva07_phases(escape_time_min: f64, escape_mean_power_w: f64) -> [Eva07Phase; 12] {
    let t0 = EVA07_DECISION_T_MIN;
    let t1 = (t0 + escape_time_min.max(0.0)).min(125.0);
    let svf_wp3 = SURVIVAL_TRIANGLE_SITE[3].sky_view_factor as f64;
    let p = EVA07_PRE_DECISION_PHASES;
    [
        p[0], p[1], p[2], p[3], p[4], p[5], p[6],
        Eva07Phase { id: "A4_huida_L3", t0_min: t0, t1_min: t1, effort: Eva07Effort::Scenario(escape_mean_power_w), dose_factor: 1.0 },
        Eva07Phase { id: "A4_refugio", t0_min: t1, t1_min: 125.0, effort: Eva07Effort::Scenario(SHELTER_REST_POWER_W), dose_factor: svf_wp3 },
        Eva07Phase { id: "A4_refugio_pico", t0_min: 125.0, t1_min: 140.0, effort: Eva07Effort::Scenario(SHELTER_REST_POWER_W), dose_factor: svf_wp3 },
        Eva07Phase { id: "A5_permanencia", t0_min: 140.0, t1_min: 158.0, effort: Eva07Effort::Scenario(SHELTER_REST_POWER_W), dose_factor: svf_wp3 },
        Eva07Phase { id: "A5_zenoh", t0_min: 158.0, t1_min: 165.0, effort: Eva07Effort::Scenario(SHELTER_REST_POWER_W), dose_factor: svf_wp3 },
    ]
}

/// Nominal open-sky SPE rate profile ("rampa calibrada"), piecewise linear knots
/// `(T min, mSv/h)`; zero before the first knot and constant after the last one.
/// The (108, 5) knot is a free parameter fitted by P1 to the ~0.6 mSv dose on arrival at WP3.
pub const EVA07_SPE_CALIBRATED_KNOTS: [(f64, f64); 5] =
    [(105.0, 0.0), (108.0, 5.0), (125.0, 8.0), (140.0, 8.0), (165.0, 2.0)];

/// Open-sky SPE rate of the nominal profile at time `t_min`, in mSv/h.
pub fn eva07_spe_open_sky_rate_msv_h(t_min: f64) -> f64 {
    let knots = &EVA07_SPE_CALIBRATED_KNOTS;
    if t_min < knots[0].0 {
        return 0.0;
    }
    for pair in knots.windows(2) {
        let ((t0, r0), (t1, r1)) = (pair[0], pair[1]);
        if t_min <= t1 {
            return r0 + (r1 - r0) * (t_min - t0) / (t1 - t0);
        }
    }
    knots[knots.len() - 1].1
}

/// Returns the 4 canonical nodes defining the Melas Chasma Survival Triangle.
pub fn melas_chasma_survival_triangle() -> Vec<MissionWaypoint> {
    SURVIVAL_TRIANGLE_SITE
        .iter()
        .map(|site| MissionWaypoint {
            id: site.id.to_string(),
            kind: site.kind,
            lat_deg: site.lat_deg,
            lon_deg: site.lon_deg,
            elev_m: site.elev_m,
            description: site.description.to_string(),
        })
        .collect()
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
            spe_dose_rate_msv_h: GCR_SURFACE_RATE_MSV_H,
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
            // Full usable primary tank at departure (800 g = 559.8 L STPD).
            o2_remaining_liters: SUIT_O2_PRIMARY_USABLE_L as f32,
            lcvg_water_remaining_min: 240.0,
            battery_remaining_min: 300.0,
            current_o2_rate_l_min: 0.8,
            cumulative_rad_msv: 0.1,
            mission_rad_limit_msv: EVA_SPE_DOSE_BUDGET_MSV,
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
            SITE_BASE_ELEV_M,
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
            SITE_BASE_ELEV_M,
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

        // Relocated P1 site: SW basin of Melas Chasma (~9.9 S, 283.39 E), basin floor ~ -1.5 km.
        for wp in &waypoints {
            assert!(
                wp.lat_deg < -9.85 && wp.lat_deg > -9.95,
                "Latitude should be within the SW Melas basin: {}",
                wp.lat_deg
            );
            assert!(
                wp.lon_deg > 283.36 && wp.lon_deg < 283.42,
                "Longitude should be within the SW Melas basin: {}",
                wp.lon_deg
            );
            assert!(
                wp.elev_m < -1400.0 && wp.elev_m > -1800.0,
                "Elevation should be on the SW basin floor (-1,800..-1,400 m): {}",
                wp.elev_m
            );
        }
        // The shelter lies downhill from WP2 (escape is downhill).
        assert!(waypoints[3].elev_m < waypoints[2].elev_m);
        // Legs close the perimeter (4,900 m) and their elevation deltas match the node elevations.
        let perimeter: f64 = SURVIVAL_TRIANGLE_LEGS[..4].iter().map(|l| l.distance_m).sum();
        assert!((perimeter - 4900.0).abs() < 1e-9);
        for leg in &SURVIVAL_TRIANGLE_LEGS {
            let dz = (SURVIVAL_TRIANGLE_SITE[leg.to].elev_m - SURVIVAL_TRIANGLE_SITE[leg.from].elev_m) as f64;
            assert!((dz - leg.delta_elev_m).abs() < 1e-9, "leg {} dz", leg.id);
        }
    }

    #[test]
    fn test_radio_link_budget_and_spe_profile() {
        // P1 free-space figures: S band 108.0 dB at 2.5 km (about -78 dBm with LOS),
        // UHF beacon 93.2 dB (about -63 dBm).
        assert!((free_space_loss_db(2500.0, RADIO_PRIMARY_FREQ_MHZ) - 108.0).abs() < 0.05);
        assert!((free_space_loss_db(2500.0, RADIO_BEACON_FREQ_MHZ) - 93.2).abs() < 0.05);
        assert!((primary_link_rssi_dbm(2500.0, true) - (-78.0)).abs() < 0.05);
        assert!((primary_link_rssi_dbm(2500.0, false) - (-108.0)).abs() < 0.05);
        assert!((beacon_rssi_dbm(2500.0, 0.0) - (-63.2)).abs() < 0.05);
        // Without LOS the primary link is red (< -100 dBm) at WP3 (1.6 km) and WP2 (2.15 km).
        assert!(primary_link_rssi_dbm(1600.0, false) < NLOS_RSSI_THRESHOLD_DBM);
        assert!(primary_link_rssi_dbm(2150.0, false) < NLOS_RSSI_THRESHOLD_DBM);
        // Calibrated SPE ramp: 0 before T+105, 5 mSv/h at T+108, 8 mSv/h plateau, 2 at T+165.
        assert_eq!(eva07_spe_open_sky_rate_msv_h(100.0), 0.0);
        assert!((eva07_spe_open_sky_rate_msv_h(108.0) - 5.0).abs() < 1e-12);
        assert!((eva07_spe_open_sky_rate_msv_h(130.0) - 8.0).abs() < 1e-12);
        assert!((eva07_spe_open_sky_rate_msv_h(165.0) - 2.0).abs() < 1e-12);
        // Phases are contiguous from T-45 to T+165 for any planned escape duration.
        for escape in [0.0, 9.4478, 19.9] {
            let phases = eva07_phases(escape, 548.0);
            for pair in phases.windows(2) {
                assert_eq!(pair[0].t1_min, pair[1].t0_min);
            }
            assert_eq!(phases[0].t0_min, -45.0);
            assert_eq!(phases[6].t1_min, EVA07_DECISION_T_MIN);
            assert!((phases[7].t1_min - (EVA07_DECISION_T_MIN + escape)).abs() < 1e-12);
            assert_eq!(phases[phases.len() - 1].t1_min, 165.0);
        }
    }

    #[test]
    fn test_no_data_sentinel_roundtrip() {
        let cell = HexCellState64B::new(
            1, SITE_BASE_ELEV_M, 2.8, 0.0, CELL_NO_DATA, CELL_NO_DATA, CELL_NO_DATA, 0.85,
            CELL_NO_DATA, CELL_NO_DATA, 0, 0,
        );
        let json = serde_json::to_string(&cell).expect("Serialization failed");
        assert!(json.contains("\"thermal_inertia_tiu\":null"));
        let back: HexCellState64B = serde_json::from_str(&json).expect("null must read back as no data");
        assert!(back.thermal_inertia_tiu.is_nan() && back.isru_h2o_pct.is_nan());
        assert!(back.verify_crc());
        // A missing value never satisfies a hazard threshold.
        let trap = back.thermal_inertia_tiu < LOW_TIU_TRAP_THRESHOLD;
        let water = back.isru_h2o_pct >= ISRU_WATER_MIN_PCT;
        assert!(!trap && !water);
        // Consumers substitute the documented assumption explicitly.
        assert!(is_no_data(back.thermal_inertia_tiu) && !is_no_data(back.sky_view_factor));
        assert_eq!(or_assumed(back.thermal_inertia_tiu, TIU_NO_DATA_ASSUMED), TIU_NO_DATA_ASSUMED);
        assert_eq!(or_assumed(back.sky_view_factor, SVF_NO_DATA_ASSUMED), 0.85);
        const { assert!(TIU_NO_DATA_ASSUMED > TIU_ETA_MID_THRESHOLD && TIU_NO_DATA_ASSUMED <= TIU_AMBER_THRESHOLD) };
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
        assert!((TOTAL_EVA_MASS_KG - 170.0).abs() < 1e-5);
        assert!((O2_ENERGY_JOULES_PER_LITER / 60.0 - 335.0).abs() < 1e-9);
        assert!((H3_MARS_LINEAR_SCALE - 0.5331).abs() < 1e-4);
        assert!((H3_MARS_AREA_SCALE - 0.2842).abs() < 1e-4);
        assert!((WALKBACK_SAFETY_FACTOR - 0.85).abs() < 1e-5);
        assert!((NLOS_RSSI_THRESHOLD_DBM - (-100.0)).abs() < 1e-5);
        assert!((RSSI_AMBER_THRESHOLD_DBM - (-85.0)).abs() < 1e-5);
        assert!((CRITICAL_SLOPE_DEG - 20.0).abs() < 1e-5);
        assert!((UNPASSABLE_SLOPE_DEG - 30.0).abs() < 1e-5);
        assert!((LOW_TIU_TRAP_THRESHOLD - 150.0).abs() < 1e-5);
        assert!((SPE_CRITICAL_RATE_MSV_H - 1.0).abs() < 1e-5);
        assert!((SPE_AMBER_RATE_MSV_H - 0.05).abs() < 1e-5);
        assert!((SPE_PEAK_ENVELOPE_MSV_H - 8.0).abs() < 1e-5);
        assert!((EVA_SPE_DOSE_BUDGET_MSV - 2.0).abs() < 1e-5);
        // Open-sky radiation window: 2 mSv / 8 mSv/h = 15 min.
        assert!((EVA_SPE_DOSE_BUDGET_MSV / SPE_PEAK_ENVELOPE_MSV_H * 60.0 - 15.0).abs() < 1e-4);
    }

    #[test]
    fn test_serde_json_roundtrip() {
        let cell = HexCellState64B::new(
            0x8848a39a09fffff,
            SITE_BASE_ELEV_M,
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
            target_bearing_deg: SURVIVAL_TRIANGLE_LEGS[ESCAPE_LEG_WP2_WP3].bearing_deg,
            target_distance_m: SURVIVAL_TRIANGLE_LEGS[ESCAPE_LEG_WP2_WP3].distance_m as f32,
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

    /// Numbers in a threshold string such as ">585 sostenido; pico 1072", "10-20" or
    /// "-85 a -100" (a '-' right after a digit is a range separator, not a sign).
    fn threshold_numbers(text: &str) -> Vec<f64> {
        let chars: Vec<char> = text.chars().collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            let sign_ok = chars[i] == '-'
                && i + 1 < chars.len()
                && chars[i + 1].is_ascii_digit()
                && (i == 0 || !chars[i - 1].is_ascii_digit());
            if chars[i].is_ascii_digit() || sign_ok {
                let start = i;
                i += 1;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
                out.push(chars[start..i].iter().collect::<String>().parse().unwrap());
            } else {
                i += 1;
            }
        }
        out
    }

    /// Fails if a radio constant of `src/shared` diverges from P1's validator
    /// (`data/pipeline/src/red_atlas_p1/scenario/constants.py`, where P1 keeps them).
    #[test]
    fn test_radio_constants_match_p1_validator() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/pipeline/src/red_atlas_p1/scenario/constants.py");
        let text = std::fs::read_to_string(path).expect("P1 constants.py readable");
        let value = |name: &str| -> f64 {
            text.lines()
                .find_map(|l| {
                    let (k, v) = l.split_once('=')?;
                    (k.trim() == name).then(|| v.split('#').next().unwrap().trim().parse::<f64>().ok())?
                })
                .unwrap_or_else(|| panic!("{name} not found in constants.py"))
        };
        let pairs = [
            ("RADIO_FREQ_MHZ", RADIO_PRIMARY_FREQ_MHZ),
            ("RADIO_TX_DBM", RADIO_TX_POWER_DBM),
            ("RADIO_ANTENNA_GAIN_DBI", RADIO_ANTENNA_GAIN_DBI),
            ("RADIO_DIFFRACTION_DB", RADIO_NLOS_DIFFRACTION_DB),
            ("RADIO_MIN_DISTANCE_M", RADIO_MIN_DISTANCE_M),
            ("RADIO_BEACON_FREQ_MHZ", RADIO_BEACON_FREQ_MHZ),
            ("RADIO_BEACON_TX_DBM", RADIO_BEACON_TX_DBM),
        ];
        let bad: Vec<String> = pairs
            .iter()
            .filter(|(k, v)| (value(k) - v).abs() > 1e-9)
            .map(|(k, v)| format!("{k}: src/shared {v} != constants.py {}", value(k)))
            .collect();
        assert!(bad.is_empty(), "radio constants diverge from P1:\n{}", bad.join("\n"));
    }

    /// Fails if any `src/shared` constant that has a counterpart in P1's
    /// `data/mission-scenarios/eva_thresholds.json` diverges from it.
    #[test]
    fn test_constants_match_p1_eva_thresholds_json() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/mission-scenarios/eva_thresholds.json");
        let text = std::fs::read_to_string(path).expect("eva_thresholds.json readable");
        let doc: serde_json::Value = serde_json::from_str(&text).expect("valid JSON");

        let constant = |key: &str| {
            doc["constants"][key]
                .as_f64()
                .unwrap_or_else(|| panic!("constants.{key} missing"))
        };
        let band = |id: &str, field: &str| -> Vec<f64> {
            let t = doc["thresholds"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["id"] == id)
                .unwrap_or_else(|| panic!("threshold {id} missing"));
            threshold_numbers(t[field].as_str().unwrap_or_else(|| panic!("{id}.{field}")))
        };
        let mut failures = Vec::new();
        let mut check = |name: &str, rust: f64, json: f64| {
            if (rust - json).abs() > 1e-6 * json.abs().max(1.0) {
                failures.push(format!("{name}: src/shared {rust} != eva_thresholds.json {json}"));
            }
        };

        // Physical constants and pace caps.
        check("MARS_GRAVITY", MARS_GRAVITY, constant("g_mars_m_s2"));
        check("TOTAL_EVA_MASS_KG", TOTAL_EVA_MASS_KG, constant("suited_mass_kg"));
        check("O2_ENERGY_JOULES_PER_LITER / 60", O2_ENERGY_JOULES_PER_LITER / 60.0, constant("o2_energy_equiv_w_per_l_min"));
        check("O2_DENSITY_G_PER_L", O2_DENSITY_G_PER_L, constant("o2_density_g_per_l_stpd"));
        check("MELAS_BASE_PRESSURE_MBAR * 100", MELAS_BASE_PRESSURE_MBAR * 100.0, constant("surface_pressure_pa_site"));
        check("ESCAPE_SPEED_CAP_MPS", ESCAPE_SPEED_CAP_MPS, constant("escape_speed_cap_m_s"));
        check("ESCAPE_POWER_CAP_W", ESCAPE_POWER_CAP_W, constant("escape_power_cap_w"));
        check("RETURN_SPEED_CAP_MPS", RETURN_SPEED_CAP_MPS, constant("sustained_return_speed_cap_m_s"));
        check("RETURN_POWER_CAP_W", RETURN_POWER_CAP_W, constant("sustained_return_power_cap_w"));

        // Green / amber / red bands.
        check("SLOPE_AMBER_DEG", SLOPE_AMBER_DEG as f64, band("slope_deg", "amber")[0]);
        check("CRITICAL_SLOPE_DEG", CRITICAL_SLOPE_DEG as f64, band("slope_deg", "red")[0]);
        check("METABOLIC_RED_SUSTAINED_W", METABOLIC_RED_SUSTAINED_W, band("metabolic_rate_w", "red")[0]);
        check("O2_RATE_AMBER_L_MIN", O2_RATE_AMBER_L_MIN as f64, band("o2_consumption_l_min", "amber")[0]);
        check("O2_RATE_RED_L_MIN", O2_RATE_RED_L_MIN as f64, band("o2_consumption_l_min", "red")[0]);
        check("TIU_AMBER_THRESHOLD", TIU_AMBER_THRESHOLD as f64, band("thermal_inertia_tiu", "green")[0]);
        check("LOW_TIU_TRAP_THRESHOLD", LOW_TIU_TRAP_THRESHOLD as f64, band("thermal_inertia_tiu", "red")[0]);
        check("TERRAIN_ETA_BY_TIU_BAND[0]", TERRAIN_ETA_BY_TIU_BAND[0], band("terrain_factor_eta", "green")[0]);
        let eta_amber = band("terrain_factor_eta", "amber");
        check("TERRAIN_ETA_BY_TIU_BAND[1]", TERRAIN_ETA_BY_TIU_BAND[1], eta_amber[0]);
        check("TERRAIN_ETA_BY_TIU_BAND[2]", TERRAIN_ETA_BY_TIU_BAND[2], eta_amber[1]);
        check("TERRAIN_ETA_BY_TIU_BAND[3]", TERRAIN_ETA_BY_TIU_BAND[3], band("terrain_factor_eta", "red")[0]);
        check("DUST_TAU_AMBER", DUST_TAU_AMBER as f64, band("dust_tau_880nm", "amber")[0]);
        check("DUST_TAU_RED", DUST_TAU_RED as f64, band("dust_tau_880nm", "red")[0]);
        check("WIND_AMBER_M_S", WIND_AMBER_M_S as f64, band("wind_speed_m_s", "amber")[0]);
        check("WIND_RED_M_S", WIND_RED_M_S as f64, band("wind_speed_m_s", "red")[0]);
        check("SPE_AMBER_RATE_MSV_H", SPE_AMBER_RATE_MSV_H as f64, band("dose_rate_msv_h", "amber")[0]);
        check("SPE_CRITICAL_RATE_MSV_H", SPE_CRITICAL_RATE_MSV_H as f64, band("dose_rate_msv_h", "red")[0]);
        check("EVA_SPE_DOSE_BUDGET_MSV", EVA_SPE_DOSE_BUDGET_MSV as f64, band("eva_spe_dose_budget_msv", "red")[0]);
        check("RSSI_AMBER_THRESHOLD_DBM", RSSI_AMBER_THRESHOLD_DBM as f64, band("radio_rssi_dbm", "green")[0]);
        check("NLOS_RSSI_THRESHOLD_DBM", NLOS_RSSI_THRESHOLD_DBM as f64, band("radio_rssi_dbm", "red")[0]);
        check("SHELTER_SVF_MAX", SHELTER_SVF_MAX as f64, band("shelter_sky_view_factor", "green")[1]);
        check("ISRU_WATER_MIN_PCT", ISRU_WATER_MIN_PCT as f64, band("isru_h2o_wt_pct", "green")[0]);
        check("O2_PRIMARY_AMBER_PCT", O2_PRIMARY_AMBER_PCT, band("o2_primary_pct", "green")[0]);
        check("O2_PRIMARY_RED_PCT", O2_PRIMARY_RED_PCT, band("o2_primary_pct", "red")[0]);

        assert!(failures.is_empty(), "constants diverge from P1:\n{}", failures.join("\n"));
        assert_eq!(threshold_numbers("-85 a -100"), vec![-85.0, -100.0]);
        assert_eq!(threshold_numbers("10-20"), vec![10.0, 20.0]);
    }
}
