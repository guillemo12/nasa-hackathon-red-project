//! H3 Mars 2000 Hierarchical Hexagonal Grid & Melas Chasma Synthetic Corridor.
//!
//! Implements Section 2 of `docs/03-system-architecture-ai/ENTREGABLE_3_ARQUITECTURA_E_IA.md`
//! and `src/shared/README.md`.
//!
//! Features:
//! - Hexagonal axial coordinate system calibrated to the IAU Mars 2000 ellipsoid
//!   (mean volumetric radius R_Mars = 3,389.50 km, scale factor 0.5320x linear, 0.2830x area).
//! - Deterministic, reversible packing into 64-bit `h3_index` across Resolutions 7..=14.
//! - Centered on Melas Chasma (-9.8°S, 283.6°E / Valles Marineris).
//! - 6-neighbor topology, k-ring radial neighborhoods, and Martian geodesic distance calculations.
//! - `H3MarsGrid` spatial index with Melas Chasma survival corridor generation (Base, WP1, WP2, WP3).
//! - WebGPU/Three.js 3-sector Spyglass slice query (CRISM water, THEMIS trap, MOLA slope/SVF/RSSI).

use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

pub use red_atlas_shared::{
    melas_chasma_survival_triangle, HexCellState64B, HAZARD_FLAG_ISRU_WATER, HAZARD_FLAG_NLOS,
    HAZARD_FLAG_REGOLITH_TRAP, HAZARD_FLAG_SHELTER, HAZARD_FLAG_SLOPE_CRITICAL,
    H3_MARS_AREA_SCALE, H3_MARS_LINEAR_SCALE, MARS_MEAN_RADIUS_KM,
};
use serde::{Deserialize, Serialize};

/// Reference latitude for Melas Chasma center in degrees North (-9.8°S).
pub const MELAS_CENTER_LAT_DEG: f64 = -9.8;

/// Reference Eastern longitude for Melas Chasma center in degrees (283.6°E).
pub const MELAS_CENTER_LON_DEG: f64 = 283.6;

/// Martian mean volumetric radius in meters (3,389,500 m).
pub const MARS_RADIUS_M: f64 = MARS_MEAN_RADIUS_KM * 1000.0;

// ============================================================================
// 1. Mars Grid Resolution & Metrics
// ============================================================================

/// Metric properties of an H3 hexagonal grid cell calibrated to IAU Mars 2000.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MarsGridResolution {
    pub res: u8,
    pub edge_len_m: f64,
    pub area_m2: f64,
}

/// Returns calibrated edge length and area for a given H3 resolution (7..=14) on Mars.
///
/// Scaled from Earth H3 by `H3_MARS_LINEAR_SCALE` (0.5320) and `H3_MARS_AREA_SCALE` (0.2830).
pub fn resolution_metrics(res: u8) -> MarsGridResolution {
    let (edge_len_m, area_m2) = match res {
        7 => (650.0, 1.46e6),
        8 => (245.68, 208_571.0),
        9 => (92.86, 29_796.0),
        10 => (35.10, 4_256.5),
        11 => (13.26, 608.1),
        12 => (5.01, 86.87),
        13 => (1.895, 12.41),
        14 => (0.716, 1.773),
        _ => {
            let diff = res as f64 - 7.0;
            (
                650.0 * 7.0_f64.powf(-diff / 2.0),
                1.46e6 * 7.0_f64.powf(-diff),
            )
        }
    };
    MarsGridResolution {
        res,
        edge_len_m,
        area_m2,
    }
}

// ============================================================================
// 2. Axial Hexagonal Coordinates & u64 H3 Index Packing
// ============================================================================

/// Discrete axial hexagonal coordinate `(q, r)` at a specific resolution `res`.
///
/// Uses pointy-topped hexagonal orientation where:
/// - `+q` extends East-South-East
/// - `+r` extends South
/// - Cube coordinate `z = -q - r`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AxialCoord {
    pub q: i32,
    pub r: i32,
    pub res: u8,
}

impl AxialCoord {
    /// Constructs a new axial coordinate.
    pub const fn new(q: i32, r: i32, res: u8) -> Self {
        Self { q, r, res }
    }

    /// Packs this axial coordinate into a deterministic 64-bit `H3Index`.
    ///
    /// Bit layout:
    /// - Bits 56..64 (8 bits): Resolution (0..15)
    /// - Bits 28..56 (28 bits): Signed `q` coordinate
    /// - Bits  0..28 (28 bits): Signed `r` coordinate
    pub fn to_h3_index(&self) -> u64 {
        axial_to_h3(*self)
    }

    /// Unpacks an `AxialCoord` from a 64-bit `H3Index`.
    pub fn from_h3_index(h3: u64) -> Self {
        h3_to_axial(h3)
    }

    /// Converts this axial coordinate to Martian planetocentric `(lat_deg, lon_deg)`.
    pub fn to_lat_lon(&self) -> (f64, f64) {
        axial_to_lat_lon(*self)
    }

    /// Converts Martian planetocentric `(lat_deg, lon_deg)` to the nearest `AxialCoord`.
    pub fn from_lat_lon(lat_deg: f64, lon_deg: f64, res: u8) -> Self {
        lat_lon_to_axial(lat_deg, lon_deg, res)
    }

    /// Hexagonal distance in discrete steps to another axial coordinate at the same resolution.
    pub fn distance_to(&self, other: &Self) -> u32 {
        let dq = (self.q - other.q).abs();
        let dr = (self.r - other.r).abs();
        let ds = ((self.q + self.r) - (other.q + other.r)).abs();
        ((dq + dr + ds) / 2) as u32
    }

    /// Returns the 6 adjacent axial neighbor coordinates.
    pub fn neighbors(&self) -> [AxialCoord; 6] {
        const DELTAS: [(i32, i32); 6] = [
            (1, 0),   // East
            (1, -1),  // North-East
            (0, -1),  // North-West
            (-1, 0),  // West
            (-1, 1),  // South-West
            (0, 1),   // South-East
        ];
        let mut out = [*self; 6];
        for (i, (dq, dr)) in DELTAS.iter().enumerate() {
            out[i] = AxialCoord {
                q: self.q + dq,
                r: self.r + dr,
                res: self.res,
            };
        }
        out
    }
}

/// Packs an `AxialCoord` into a 64-bit integer index.
pub fn axial_to_h3(coord: AxialCoord) -> u64 {
    let q_u = (coord.q as i64 & 0x0FFF_FFFF) as u64;
    let r_u = (coord.r as i64 & 0x0FFF_FFFF) as u64;
    let res_u = (coord.res as u64) & 0xFF;
    (res_u << 56) | (q_u << 28) | r_u
}

/// Decodes a 64-bit integer index back into an `AxialCoord`.
pub fn h3_to_axial(h3: u64) -> AxialCoord {
    let res = ((h3 >> 56) & 0xFF) as u8;
    let mut q_raw = ((h3 >> 28) & 0x0FFF_FFFF) as i32;
    if (q_raw & 0x0800_0000) != 0 {
        q_raw |= !0x0FFF_FFFF;
    }
    let mut r_raw = (h3 & 0x0FFF_FFFF) as i32;
    if (r_raw & 0x0800_0000) != 0 {
        r_raw |= !0x0FFF_FFFF;
    }
    AxialCoord {
        q: q_raw,
        r: r_raw,
        res,
    }
}

/// Converts Martian latitude and Eastern longitude to the nearest `AxialCoord`.
pub fn lat_lon_to_axial(lat_deg: f64, lon_deg: f64, res: u8) -> AxialCoord {
    let metrics = resolution_metrics(res);
    let s = metrics.edge_len_m;
    let ref_lat_rad = MELAS_CENTER_LAT_DEG.to_radians();

    let mut d_lon = lon_deg - MELAS_CENTER_LON_DEG;
    while d_lon > 180.0 {
        d_lon -= 360.0;
    }
    while d_lon < -180.0 {
        d_lon += 360.0;
    }

    let d_lat = lat_deg - MELAS_CENTER_LAT_DEG;

    let x = MARS_RADIUS_M * d_lon.to_radians() * ref_lat_rad.cos();
    let y = MARS_RADIUS_M * d_lat.to_radians();

    let sqrt3 = 3.0_f64.sqrt();
    let q_f = (sqrt3 / 3.0 * x - (1.0 / 3.0) * y) / s;
    let r_f = ((2.0 / 3.0) * y) / s;

    let x_c = q_f;
    let z_c = r_f;
    let y_c = -x_c - z_c;

    let mut rx = x_c.round();
    let ry = y_c.round();
    let mut rz = z_c.round();

    let x_diff = (rx - x_c).abs();
    let y_diff = (ry - y_c).abs();
    let z_diff = (rz - z_c).abs();

    if x_diff > y_diff && x_diff > z_diff {
        rx = -ry - rz;
    } else if !(y_diff > z_diff) {
        rz = -rx - ry;
    }

    AxialCoord {
        q: rx as i32,
        r: rz as i32,
        res,
    }
}

/// Converts an `AxialCoord` to Martian planetocentric `(lat_deg, lon_deg)`.
pub fn axial_to_lat_lon(coord: AxialCoord) -> (f64, f64) {
    let metrics = resolution_metrics(coord.res);
    let s = metrics.edge_len_m;
    let sqrt3 = 3.0_f64.sqrt();

    let q = coord.q as f64;
    let r = coord.r as f64;

    let x = s * (sqrt3 * q + (sqrt3 / 2.0) * r);
    let y = s * (1.5 * r);

    let ref_lat_rad = MELAS_CENTER_LAT_DEG.to_radians();
    let d_lat = (y / MARS_RADIUS_M) * (180.0 / PI);
    let d_lon = (x / (MARS_RADIUS_M * ref_lat_rad.cos())) * (180.0 / PI);

    let lat = MELAS_CENTER_LAT_DEG + d_lat;
    let mut lon = MELAS_CENTER_LON_DEG + d_lon;
    while lon >= 360.0 {
        lon -= 360.0;
    }
    while lon < 0.0 {
        lon += 360.0;
    }

    (lat, lon)
}

/// Converts Martian `(lat_deg, lon_deg, res)` directly to an H3 `u64` index.
pub fn lat_lon_to_h3(lat_deg: f64, lon_deg: f64, res: u8) -> u64 {
    axial_to_h3(lat_lon_to_axial(lat_deg, lon_deg, res))
}

/// Converts an H3 `u64` index directly to Martian `(lat_deg, lon_deg)`.
pub fn h3_to_lat_lon(h3: u64) -> (f64, f64) {
    axial_to_lat_lon(h3_to_axial(h3))
}

/// Returns the 6 adjacent H3 cell indices for the given cell index.
pub fn neighbors(h3_index: u64) -> [u64; 6] {
    let coord = h3_to_axial(h3_index);
    let nbr_coords = coord.neighbors();
    let mut result = [0u64; 6];
    for (i, c) in nbr_coords.iter().enumerate() {
        result[i] = axial_to_h3(*c);
    }
    result
}

/// Returns all H3 cell indices within a topological hexagonal radius (`k_ring`) of `center`.
pub fn k_ring(center: u64, radius: u8) -> Vec<u64> {
    let center_coord = h3_to_axial(center);
    let r = radius as i32;
    let capacity = (1 + 3 * r * (r + 1)) as usize;
    let mut cells = Vec::with_capacity(capacity);

    for dq in -r..=r {
        let r_min = (-r).max(-dq - r);
        let r_max = r.min(-dq + r);
        for dr in r_min..=r_max {
            let nbr_coord = AxialCoord {
                q: center_coord.q + dq,
                r: center_coord.r + dr,
                res: center_coord.res,
            };
            cells.push(axial_to_h3(nbr_coord));
        }
    }
    cells
}

/// Computes the great-circle geodesic distance in meters on Mars between two H3 cells.
pub fn geodesic_distance_m(a: u64, b: u64) -> f64 {
    if a == b {
        return 0.0;
    }
    let (lat1, lon1) = h3_to_lat_lon(a);
    let (lat2, lon2) = h3_to_lat_lon(b);
    haversine_dist_m(lat1, lon1, lat2, lon2)
}

/// Helper function to compute great-circle distance between two Martian coordinates in meters.
fn haversine_dist_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let delta_phi = (lat2 - lat1).to_radians();

    let mut delta_lambda = (lon2 - lon1).to_radians();
    while delta_lambda > PI {
        delta_lambda -= 2.0 * PI;
    }
    while delta_lambda < -PI {
        delta_lambda += 2.0 * PI;
    }

    let sin_dphi = (delta_phi / 2.0).sin();
    let sin_dlambda = (delta_lambda / 2.0).sin();

    let a_val = sin_dphi * sin_dphi + phi1.cos() * phi2.cos() * sin_dlambda * sin_dlambda;
    let c_val = 2.0 * a_val.sqrt().atan2((1.0 - a_val).max(0.0).sqrt());

    MARS_RADIUS_M * c_val
}

// ============================================================================
// 3. Spyglass Tri-Sector Slice Data Structure
// ============================================================================

/// A spatial query result formatted for the WebGPU / Three.js 3-sector Spyglass shader.
///
/// Sectors:
/// - North Sector (120°): `crism_water_cells` (H3, isru_h2o_pct)
/// - Right Sector (120°): `themis_trap_cells` (H3, thermal_inertia_tiu)
/// - Left Sector (120°): `mola_slope_svf_cells` (H3, slope_deg, sky_view_factor, los_base_rssi_dbm)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpyglassTriSectorSlice {
    pub center_h3: u64,
    pub crism_water_cells: Vec<(u64, f32)>,
    pub themis_trap_cells: Vec<(u64, f32)>,
    pub mola_slope_svf_cells: Vec<(u64, f32, f32, f32)>,
}

// ============================================================================
// 4. H3 Mars Grid Engine & Melas Chasma Corridor
// ============================================================================

/// In-memory spatial index and graph of 64-byte Martian hexagonal cells.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct H3MarsGrid {
    pub res: u8,
    pub cells: HashMap<u64, HexCellState64B>,
}

impl H3MarsGrid {
    /// Creates an empty grid at the given resolution.
    pub fn new(res: u8) -> Self {
        Self {
            res,
            cells: HashMap::new(),
        }
    }

    /// Inserts a cell into the grid, sealing its CRC before storing.
    pub fn insert(&mut self, mut cell: HexCellState64B) {
        cell.seal_crc();
        self.cells.insert(cell.h3_index, cell);
    }

    /// Number of active cells in the grid.
    pub fn len(&self) -> usize {
        self.cells.len()
    }

    /// Returns true if the grid contains no cells.
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    /// Retrieves an immutable reference to the cell with the given H3 index.
    pub fn get_cell(&self, h3: u64) -> Option<&HexCellState64B> {
        self.cells.get(&h3)
    }

    /// Retrieves a mutable reference to the cell with the given H3 index.
    pub fn get_cell_mut(&mut self, h3: u64) -> Option<&mut HexCellState64B> {
        self.cells.get_mut(&h3)
    }

    /// Returns an iterator over all cells in the grid.
    pub fn all_cells(&self) -> impl Iterator<Item = &HexCellState64B> {
        self.cells.values()
    }

    /// Returns all valid adjacent neighbor cells and their edge distances in meters.
    pub fn neighbor_edges(&self, h3: u64) -> Vec<(u64, f64)> {
        let nbrs = neighbors(h3);
        let mut edges = Vec::with_capacity(6);
        for &n_h3 in &nbrs {
            if self.cells.contains_key(&n_h3) {
                let dist = geodesic_distance_m(h3, n_h3);
                edges.push((n_h3, dist));
            }
        }
        edges
    }

    /// Finds the nearest cell in the grid to the given planetary coordinates.
    pub fn nearest_cell(&self, lat_deg: f64, lon_deg: f64) -> Option<&HexCellState64B> {
        if self.cells.is_empty() {
            return None;
        }
        let target_h3 = lat_lon_to_h3(lat_deg, lon_deg, self.res);
        if let Some(cell) = self.cells.get(&target_h3) {
            return Some(cell);
        }

        // Geodesic distance search across active cells
        let mut best_cell = None;
        let mut min_dist = f64::MAX;
        for cell in self.cells.values() {
            let (c_lat, c_lon) = h3_to_lat_lon(cell.h3_index);
            let dist = haversine_dist_m(lat_deg, lon_deg, c_lat, c_lon);
            if dist < min_dist {
                min_dist = dist;
                best_cell = Some(cell);
            }
        }
        best_cell
    }

    /// Queries the 3-sector Spyglass slice within a `k_radius` around `center_h3`.
    pub fn query_spyglass_sectors(&self, center_h3: u64, k_radius: u8) -> SpyglassTriSectorSlice {
        let candidate_h3s = k_ring(center_h3, k_radius);
        let mut crism_water_cells = Vec::new();
        let mut themis_trap_cells = Vec::new();
        let mut mola_slope_svf_cells = Vec::new();

        for h3 in candidate_h3s {
            if let Some(cell) = self.cells.get(&h3) {
                crism_water_cells.push((cell.h3_index, cell.isru_h2o_pct));
                themis_trap_cells.push((cell.h3_index, cell.thermal_inertia_tiu));
                mola_slope_svf_cells.push((
                    cell.h3_index,
                    cell.slope_deg,
                    cell.sky_view_factor,
                    cell.los_base_rssi_dbm,
                ));
            }
        }

        SpyglassTriSectorSlice {
            center_h3,
            crism_water_cells,
            themis_trap_cells,
            mola_slope_svf_cells,
        }
    }

    /// Generates a realistic Melas Chasma survival exploration corridor.
    ///
    /// Covers the canonical "Survival Triangle":
    /// - **Base Habitat**: -4215 m elevation, firm basalt (>400 TIU), active LOS (RSSI > -60 dBm).
    /// - **WP1 (ISRU Water)**: Sulfate-rich layered deposits (>12% structural H2O, CRISM target).
    /// - **WP2 (Fault Slope Trap)**: Landslide contact, 22° steep slope, soft regolith trap (110 TIU),
    ///   and NLOS radio shadow (< -118 dBm).
    /// - **WP3 (Cliff Shelter)**: Topographic alcove under 7 km canyon wall, Sky View Factor 0.15 (<= 0.20),
    ///   85% SPE radiation attenuation, firm access.
    ///
    /// Every generated cell is sealed with `seal_crc()` to enable SEU bit-flip detection.
    pub fn generate_melas_chasma_corridor(res: u8) -> Self {
        let mut grid = Self::new(res);
        let waypoints = melas_chasma_survival_triangle();

        let base_wp = &waypoints[0];
        let wp1_wp = &waypoints[1];
        let wp2_wp = &waypoints[2];
        let wp3_wp = &waypoints[3];

        let base_coord = lat_lon_to_axial(base_wp.lat_deg, base_wp.lon_deg, res);
        let wp1_coord = lat_lon_to_axial(wp1_wp.lat_deg, wp1_wp.lon_deg, res);
        let wp2_coord = lat_lon_to_axial(wp2_wp.lat_deg, wp2_wp.lon_deg, res);
        let wp3_coord = lat_lon_to_axial(wp3_wp.lat_deg, wp3_wp.lon_deg, res);

        // Interpolate paths connecting the Survival Triangle
        let mut path_coords = HashSet::new();

        let legs = [
            (base_coord, wp1_coord),
            (wp1_coord, wp2_coord),
            (wp2_coord, wp3_coord),
            (wp3_coord, base_coord),
            (wp1_coord, wp3_coord),
        ];

        for (start, end) in legs {
            for pt in axial_line(start, end) {
                path_coords.insert(pt);
            }
        }

        // Buffer corridor width around paths and waypoints
        let buffer_r: u8 = if res <= 9 {
            2
        } else if res <= 11 {
            2
        } else {
            1
        };

        let mut full_coords = HashSet::new();
        for &pt in &path_coords {
            let h3 = axial_to_h3(pt);
            for nbr_h3 in k_ring(h3, buffer_r) {
                full_coords.insert(h3_to_axial(nbr_h3));
            }
        }

        // Expanded rings around critical waypoints
        let wp_ring_r: u8 = if res <= 9 { 3 } else { 4 };
        for wp_coord in [base_coord, wp1_coord, wp2_coord, wp3_coord] {
            let h3 = axial_to_h3(wp_coord);
            for nbr_h3 in k_ring(h3, wp_ring_r) {
                full_coords.insert(h3_to_axial(nbr_h3));
            }
        }

        // Ensure key waypoints are explicitly included
        full_coords.insert(base_coord);
        full_coords.insert(wp1_coord);
        full_coords.insert(wp2_coord);
        full_coords.insert(wp3_coord);

        // Generate physical properties for each cell in the corridor
        for coord in full_coords {
            let h3_index = axial_to_h3(coord);
            let (lat, lon) = axial_to_lat_lon(coord);

            let d_base = haversine_dist_m(lat, lon, base_wp.lat_deg, base_wp.lon_deg);
            let d_wp1 = haversine_dist_m(lat, lon, wp1_wp.lat_deg, wp1_wp.lon_deg);
            let d_wp2 = haversine_dist_m(lat, lon, wp2_wp.lat_deg, wp2_wp.lon_deg);
            let d_wp3 = haversine_dist_m(lat, lon, wp3_wp.lat_deg, wp3_wp.lon_deg);

            // 1. Elevation: inverse distance weighting between waypoints
            let eps = 1.0;
            let w_base = 1.0 / (d_base + eps).powi(2);
            let w_wp1 = 1.0 / (d_wp1 + eps).powi(2);
            let w_wp2 = 1.0 / (d_wp2 + eps).powi(2);
            let w_wp3 = 1.0 / (d_wp3 + eps).powi(2);
            let sum_w = w_base + w_wp1 + w_wp2 + w_wp3;
            let elev_m = ((w_base * (base_wp.elev_m as f64)
                + w_wp1 * (wp1_wp.elev_m as f64)
                + w_wp2 * (wp2_wp.elev_m as f64)
                + w_wp3 * (wp3_wp.elev_m as f64))
                / sum_w) as f32;

            // 2. CRISM Structural Water ISRU (% by mass)
            let isru_h2o_pct = if coord == wp1_coord {
                14.2
            } else if d_wp1 < 160.0 {
                let factor = (1.0 - (d_wp1 / 160.0)).max(0.0) as f32;
                1.2 + 13.0 * factor
            } else {
                1.2
            };

            // 3. THEMIS Thermal Inertia Units (TIU)
            let thermal_inertia_tiu = if coord == wp2_coord {
                110.0
            } else if d_wp2 < 120.0 {
                let factor = (d_wp2 / 120.0) as f32;
                110.0 + factor * 35.0
            } else if coord == base_coord || d_base < 100.0 {
                450.0
            } else if coord == wp3_coord || d_wp3 < 80.0 {
                430.0
            } else {
                360.0
            };

            // 4. MOLA/HiRISE Maximum Slope Angle (degrees)
            let slope_deg = if coord == wp2_coord {
                22.0
            } else if d_wp2 < 120.0 {
                let factor = (d_wp2 / 120.0) as f32;
                22.0 - factor * 1.5
            } else if coord == base_coord || d_base < 100.0 {
                2.2
            } else if coord == wp1_coord || d_wp1 < 120.0 {
                4.5
            } else if coord == wp3_coord || d_wp3 < 80.0 {
                5.5
            } else {
                7.0
            };

            // 5. UHF LOS Base Radio RSSI (dBm)
            let los_base_rssi_dbm = if coord == wp2_coord {
                -122.0
            } else if d_wp2 < 150.0 {
                -120.0
            } else if coord == wp3_coord || d_wp3 < 80.0 {
                -124.0
            } else if coord == base_coord {
                -45.0
            } else {
                let ratio = (d_base / 2500.0).min(1.0) as f32;
                -50.0 - ratio * 45.0
            };

            // 6. Sky View Factor (Psi_SVF in [0.05, 1.0])
            let sky_view_factor = if coord == wp3_coord {
                0.15
            } else if d_wp3 < 80.0 {
                let factor = (d_wp3 / 80.0) as f32;
                0.15 + factor * 0.04
            } else {
                0.78
            };

            // 7. Slope Aspect
            let aspect_deg = if d_wp2 < 150.0 { 245.0 } else { 135.0 };

            // 8. Roughness Index
            let roughness_hi = if d_wp2 < 120.0 { 0.45 } else { 0.10 };

            // 9. Base Metabolic Cost
            let base_metabolic_cost = if d_wp2 < 120.0 { 850.0 } else { 280.0 };

            // 10. Synthetic Horizon Hash ID for Canyon-TRN
            let horizon_hash_id =
                ((coord.q as u64 & 0xFFFF) << 16 | (coord.r as u64 & 0xFFFF)) as u32;

            // 11. Hazard Bitmask Flags
            let mut hazard_bitmask: u16 = 0;
            if slope_deg > 20.0 {
                hazard_bitmask |= HAZARD_FLAG_SLOPE_CRITICAL;
            }
            if thermal_inertia_tiu < 150.0 {
                hazard_bitmask |= HAZARD_FLAG_REGOLITH_TRAP;
            }
            if sky_view_factor <= 0.20 {
                hazard_bitmask |= HAZARD_FLAG_SHELTER;
            }
            if los_base_rssi_dbm < -115.0 {
                hazard_bitmask |= HAZARD_FLAG_NLOS;
            }
            if isru_h2o_pct > 10.0 {
                hazard_bitmask |= HAZARD_FLAG_ISRU_WATER;
            }

            let mut cell = HexCellState64B {
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
            grid.cells.insert(h3_index, cell);
        }

        grid
    }
}

/// Helper function to interpolate a discrete straight hex line between two axial coordinates.
fn axial_line(start: AxialCoord, end: AxialCoord) -> Vec<AxialCoord> {
    let q1 = start.q;
    let r1 = start.r;
    let q2 = end.q;
    let r2 = end.r;

    let dist = ((q1 - q2).abs() + (q1 + r1 - q2 - r2).abs() + (r1 - r2).abs()) / 2;
    if dist == 0 {
        return vec![start];
    }

    let mut line = Vec::with_capacity((dist + 1) as usize);
    let n = dist as f64;
    for i in 0..=dist {
        let t = (i as f64) / n;
        let q_f = (1.0 - t) * (q1 as f64) + t * (q2 as f64);
        let r_f = (1.0 - t) * (r1 as f64) + t * (r2 as f64);

        let x_c = q_f;
        let z_c = r_f;
        let y_c = -x_c - z_c;

        let mut rx = x_c.round();
        let ry = y_c.round();
        let mut rz = z_c.round();

        let x_diff = (rx - x_c).abs();
        let y_diff = (ry - y_c).abs();
        let z_diff = (rz - z_c).abs();

        if x_diff > y_diff && x_diff > z_diff {
            rx = -ry - rz;
        } else if !(y_diff > z_diff) {
            rz = -rx - ry;
        }

        line.push(AxialCoord {
            q: rx as i32,
            r: rz as i32,
            res: start.res,
        });
    }
    line
}

// ============================================================================
// 5. Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mars_resolution_metrics_scaling() {
        let r7 = resolution_metrics(7);
        assert_eq!(r7.res, 7);
        assert!((r7.edge_len_m - 650.0).abs() < 1e-3);
        assert!((r7.area_m2 - 1.46e6).abs() < 1e-3);

        let r9 = resolution_metrics(9);
        assert_eq!(r9.res, 9);
        assert!((r9.edge_len_m - 92.86).abs() < 0.1);
        assert!((r9.area_m2 - 29_796.0).abs() < 10.0);

        let r11 = resolution_metrics(11);
        assert_eq!(r11.res, 11);
        assert!((r11.edge_len_m - 13.26).abs() < 0.1);
        assert!((r11.area_m2 - 608.1).abs() < 1.0);

        let r13 = resolution_metrics(13);
        assert_eq!(r13.res, 13);
        assert!((r13.edge_len_m - 1.895).abs() < 0.05);
        assert!((r13.area_m2 - 12.41).abs() < 0.1);

        let r14 = resolution_metrics(14);
        assert_eq!(r14.res, 14);
        assert!((r14.edge_len_m - 0.716).abs() < 0.05);
        assert!((r14.area_m2 - 1.773).abs() < 0.05);

        // Verify scaling constants match specifications
        assert!((H3_MARS_LINEAR_SCALE - 0.5320).abs() < 1e-4);
        assert!((H3_MARS_AREA_SCALE - 0.2830).abs() < 1e-4);
    }

    #[test]
    fn test_axial_h3_packing_roundtrip() {
        let test_cases = [
            (0, 0, 7),
            (15, -42, 9),
            (-128, 256, 11),
            (3500, -8400, 13),
            (-12345, -67890, 14),
        ];

        for (q, r, res) in test_cases {
            let coord = AxialCoord::new(q, r, res);
            let h3 = coord.to_h3_index();
            let recovered = AxialCoord::from_h3_index(h3);
            assert_eq!(coord, recovered, "Failed for ({q}, {r}, {res})");
        }
    }

    #[test]
    fn test_lat_lon_axial_roundtrip() {
        let res = 11;
        let lat = -9.8150;
        let lon = 283.6100;

        let coord = lat_lon_to_axial(lat, lon, res);
        let (recovered_lat, recovered_lon) = axial_to_lat_lon(coord);

        let dist = haversine_dist_m(lat, lon, recovered_lat, recovered_lon);
        let metrics = resolution_metrics(res);
        assert!(
            dist <= metrics.edge_len_m * 1.5,
            "Recovered coords too far: dist={dist} m, edge={}",
            metrics.edge_len_m
        );
    }

    #[test]
    fn test_neighbors_and_k_ring_topology() {
        let center = lat_lon_to_h3(-9.8, 283.6, 11);
        let nbrs = neighbors(center);
        assert_eq!(nbrs.len(), 6);

        // Neighbors must all be unique and distinct from center
        let mut unique = HashSet::new();
        unique.insert(center);
        for n in nbrs {
            assert!(unique.insert(n), "Duplicate neighbor found");
            let d = geodesic_distance_m(center, n);
            assert!(d > 0.0 && d < 35.0, "Neighbor distance unexpected: {d} m");
        }

        // k-ring sizes: 1, 7, 19, 37
        assert_eq!(k_ring(center, 0).len(), 1);
        assert_eq!(k_ring(center, 1).len(), 7);
        assert_eq!(k_ring(center, 2).len(), 19);
        assert_eq!(k_ring(center, 3).len(), 37);
    }

    #[test]
    fn test_corridor_generation_and_crc_verification() {
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        assert!(grid.len() > 50, "Corridor should have substantial cells");

        // Verify CRC on every cell
        for cell in grid.all_cells() {
            assert!(
                cell.verify_crc(),
                "Cell {} failed CRC verification",
                cell.h3_index
            );
        }

        // Test SEU bit-flip detection
        let mut corrupted_cell = *grid.all_cells().next().unwrap();
        assert!(corrupted_cell.verify_crc());
        // Flip a bit in elevation
        let raw_bytes = unsafe {
            std::slice::from_raw_parts_mut(
                (&mut corrupted_cell as *mut HexCellState64B) as *mut u8,
                64,
            )
        };
        raw_bytes[10] ^= 0x01;
        assert!(
            !corrupted_cell.verify_crc(),
            "Corrupted cell should fail CRC verification"
        );
    }

    #[test]
    fn test_wp1_isru_water_properties() {
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        let waypoints = melas_chasma_survival_triangle();
        let wp1 = &waypoints[1];

        let cell = grid
            .nearest_cell(wp1.lat_deg, wp1.lon_deg)
            .expect("WP1 cell present");

        assert!(
            cell.isru_h2o_pct > 10.0,
            "WP1 must have > 10% structural water, found {}",
            cell.isru_h2o_pct
        );
        assert!(
            cell.hazard_bitmask & HAZARD_FLAG_ISRU_WATER != 0,
            "WP1 cell missing HAZARD_FLAG_ISRU_WATER flag"
        );
        assert!(cell.verify_crc());
    }

    #[test]
    fn test_wp2_regolith_trap_and_nlos() {
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        let waypoints = melas_chasma_survival_triangle();
        let wp2 = &waypoints[2];

        let cell = grid
            .nearest_cell(wp2.lat_deg, wp2.lon_deg)
            .expect("WP2 cell present");

        assert!(
            cell.thermal_inertia_tiu < 150.0,
            "WP2 TIU must be < 150 (soft regolith trap), found {}",
            cell.thermal_inertia_tiu
        );
        assert!(
            cell.slope_deg > 20.0,
            "WP2 slope must be > 20 deg, found {}",
            cell.slope_deg
        );
        assert!(
            cell.los_base_rssi_dbm < -115.0,
            "WP2 RSSI must be NLOS (< -115 dBm), found {}",
            cell.los_base_rssi_dbm
        );
        assert!(
            cell.hazard_bitmask & HAZARD_FLAG_REGOLITH_TRAP != 0,
            "WP2 missing HAZARD_FLAG_REGOLITH_TRAP"
        );
        assert!(
            cell.hazard_bitmask & HAZARD_FLAG_SLOPE_CRITICAL != 0,
            "WP2 missing HAZARD_FLAG_SLOPE_CRITICAL"
        );
        assert!(
            cell.hazard_bitmask & HAZARD_FLAG_NLOS != 0,
            "WP2 missing HAZARD_FLAG_NLOS"
        );
        assert!(cell.verify_crc());
    }

    #[test]
    fn test_wp3_cliff_shelter_svf() {
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        let waypoints = melas_chasma_survival_triangle();
        let wp3 = &waypoints[3];

        let cell = grid
            .nearest_cell(wp3.lat_deg, wp3.lon_deg)
            .expect("WP3 cell present");

        assert!(
            cell.sky_view_factor <= 0.20,
            "WP3 SVF must be <= 0.20 (80%+ SPE shielding), found {}",
            cell.sky_view_factor
        );
        assert!(
            cell.thermal_inertia_tiu > 400.0,
            "WP3 must have firm access (> 400 TIU), found {}",
            cell.thermal_inertia_tiu
        );
        assert!(
            cell.hazard_bitmask & HAZARD_FLAG_SHELTER != 0,
            "WP3 missing HAZARD_FLAG_SHELTER"
        );
        assert!(cell.verify_crc());
    }

    #[test]
    fn test_spyglass_three_sector_lookup() {
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        let waypoints = melas_chasma_survival_triangle();
        let wp1 = &waypoints[1];

        let wp1_cell = grid
            .nearest_cell(wp1.lat_deg, wp1.lon_deg)
            .expect("WP1 cell present");

        let slice = grid.query_spyglass_sectors(wp1_cell.h3_index, 2);
        assert_eq!(slice.center_h3, wp1_cell.h3_index);
        assert!(!slice.crism_water_cells.is_empty());
        assert_eq!(
            slice.crism_water_cells.len(),
            slice.themis_trap_cells.len()
        );
        assert_eq!(
            slice.crism_water_cells.len(),
            slice.mola_slope_svf_cells.len()
        );

        // WP1 itself must be present in the query slice
        let wp1_in_slice = slice
            .crism_water_cells
            .iter()
            .find(|(h3, _)| *h3 == wp1_cell.h3_index);
        assert!(wp1_in_slice.is_some());
        assert!(wp1_in_slice.unwrap().1 > 10.0);
    }

    #[test]
    fn test_neighbor_edges_in_corridor() {
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        let cell = grid.all_cells().next().unwrap();
        let edges = grid.neighbor_edges(cell.h3_index);
        // Interior corridor cells have at least one neighbor in the grid
        assert!(!edges.is_empty());
        for (nbr, dist) in edges {
            assert!(grid.get_cell(nbr).is_some());
            assert!(dist > 0.0);
        }
    }
}
