//! H3 Mars 2000 Hierarchical Hexagonal Grid & Melas Chasma Synthetic Corridor.
//!
//! Implements Section 2 of `docs/03-system-architecture-ai/ENTREGABLE_3_ARQUITECTURA_E_IA.md`
//! and `src/shared/README.md`.
//!
//! Features:
//! - Real H3 indices (crate `h3o`, the same cells as the `h3` 4.x library used by P1's pipeline).
//!   H3 is a spherical grid; on Mars the topology is unchanged and every metric is rescaled to the
//!   MOLA reference sphere (IAU_2015:49900, R = 3,396.19 km): lengths by `H3_MARS_LINEAR_SCALE`
//!   (≈ 0.5331) and areas by `H3_MARS_AREA_SCALE` (≈ 0.2842). Geodesic distances are the
//!   great-circle angle times the Mars radius, which is the same thing.
//! - Public coordinates stay planetocentric latitude and **East longitude 0-360** (IAU/PDS, as in
//!   `red_atlas_shared`); the conversion to H3's −180..180 longitude happens inside this module.
//! - 6-neighbor topology (5 at pentagons), k-ring neighborhoods and Martian geodesic distances.
//! - `H3MarsGrid` spatial index: P1 Parquet loader (`load_p1_parquet`) for the real terrain grid
//!   (`data/nasa-layers/hexgrid_route_res12_hexcell64b.parquet`) and the synthetic Melas Chasma
//!   survival corridor (Base, WP1, WP2, WP3) used by the EVA-07 demo.
//! - WebGPU/Three.js 3-sector Spyglass slice query (CRISM water, THEMIS trap, MOLA slope/SVF/RSSI).
//!
//! Indices that are not valid H3 cells (e.g. the hand-made ids of unit-test graphs) are tolerated:
//! they have no neighbors, an empty k-ring, a `NaN` position and `NaN` distances.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;

use h3o::{CellIndex, LatLng, Resolution};
use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::record::Field;

pub use red_atlas_shared::{
    melas_chasma_survival_triangle, HexCellState64B, HAZARD_FLAG_ISRU_WATER, HAZARD_FLAG_NLOS,
    HAZARD_FLAG_REGOLITH_TRAP, HAZARD_FLAG_SHELTER, HAZARD_FLAG_SLOPE_CRITICAL,
    H3_MARS_AREA_SCALE, H3_MARS_LINEAR_SCALE, ISRU_WATER_MIN_PCT, LOW_TIU_TRAP_THRESHOLD,
    MARS_H3_REFERENCE_RADIUS_KM, NLOS_RSSI_THRESHOLD_DBM, SHELTER_SVF_MAX, SITE_REFERENCE_LAT_DEG,
    SITE_REFERENCE_LON_DEG, CRITICAL_SLOPE_DEG,
};
use red_atlas_shared::{
    is_no_data, uhf_link_rssi_dbm, CELL_NO_DATA, SURVIVAL_TRIANGLE_SITE, WP2_RAMP_SLOPE_DEG,
};
use crate::metabolic_dstar::pandolf_mars_metabolic_watts;
use serde::{Deserialize, Serialize};

/// Reference latitude of the site in degrees North (Base node, from shared).
pub const MELAS_CENTER_LAT_DEG: f64 = SITE_REFERENCE_LAT_DEG;

/// Reference Eastern longitude of the site in degrees 0-360 (Base node, from shared).
pub const MELAS_CENTER_LON_DEG: f64 = SITE_REFERENCE_LON_DEG;

/// Mars reference sphere radius in meters (3,396,190 m, MOLA / IAU_2015:49900).
pub const MARS_RADIUS_M: f64 = MARS_H3_REFERENCE_RADIUS_KM * 1000.0;

/// P1 scenario zone radii in m (`data/nasa-layers/SCHEMA_HEXGRID.md`, section 4).
const BASE_WP1_TIU_ZONE_M: f64 = 100.0;
const WP2_TIU_ZONE_M: f64 = 150.0;
const WP3_ALCOVE_ZONE_M: f64 = 40.0;
const WP1_WATER_ZONE_M: f64 = 100.0;

// ============================================================================
// 1. Mars Grid Resolution & Metrics
// ============================================================================

/// Metric properties of an H3 hexagonal grid cell rescaled to the Mars reference sphere.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MarsGridResolution {
    pub res: u8,
    /// Global mean hexagon edge length on Mars (m).
    pub edge_len_m: f64,
    /// Global mean hexagon area on Mars (m²). At the site (~10°S) cells are ~18% larger:
    /// use `cell_area_m2` for a specific cell.
    pub area_m2: f64,
}

/// Returns the mean edge length and area of an H3 resolution on Mars: the `h3o` (Earth) means
/// times `H3_MARS_LINEAR_SCALE` and `H3_MARS_AREA_SCALE`. Resolution 12 gives 5.77 m / 87.3 m²,
/// resolution 9 gives 107.0 m / 29,932 m², matching P1's `SCHEMA_HEXGRID.md` §2.
/// Resolutions above 15 do not exist in H3 and return `NaN` metrics.
pub fn resolution_metrics(res: u8) -> MarsGridResolution {
    let (edge_len_m, area_m2) = match Resolution::try_from(res) {
        Ok(r) => (
            r.edge_length_m() * H3_MARS_LINEAR_SCALE,
            r.area_m2() * H3_MARS_AREA_SCALE,
        ),
        Err(_) => (f64::NAN, f64::NAN),
    };
    MarsGridResolution {
        res,
        edge_len_m,
        area_m2,
    }
}

/// Exact area of one H3 cell on Mars (m²), or `NaN` for an invalid index.
pub fn cell_area_m2(h3: u64) -> f64 {
    to_cell(h3).map_or(f64::NAN, |c| c.area_m2() * H3_MARS_AREA_SCALE)
}

// ============================================================================
// 2. H3 indexing (h3o)
// ============================================================================

/// Converts an East longitude (0-360 or any wrap) to H3's −180..180 convention.
pub fn lon_east_to_lon180(lon_deg: f64) -> f64 {
    let mut lon = lon_deg.rem_euclid(360.0);
    if lon > 180.0 {
        lon -= 360.0;
    }
    lon
}

/// Converts a −180..180 longitude back to East 0-360.
pub fn lon180_to_lon_east(lon_deg: f64) -> f64 {
    lon_deg.rem_euclid(360.0)
}

/// Returns the `h3o` cell for a raw index, or `None` if it is not a valid H3 cell.
pub fn to_cell(h3: u64) -> Option<CellIndex> {
    CellIndex::try_from(h3).ok()
}

/// Resolution of a valid H3 cell index.
pub fn h3_resolution(h3: u64) -> Option<u8> {
    to_cell(h3).map(|c| u8::from(c.resolution()))
}

fn to_latlng(lat_deg: f64, lon_deg: f64) -> Option<LatLng> {
    LatLng::new(lat_deg, lon_east_to_lon180(lon_deg)).ok()
}

/// Converts Martian planetocentric latitude and East longitude (0-360) to an H3 index.
///
/// Returns 0 (never a valid H3 cell) for non-finite coordinates or a resolution above 15.
pub fn lat_lon_to_h3(lat_deg: f64, lon_deg: f64, res: u8) -> u64 {
    match (to_latlng(lat_deg, lon_deg), Resolution::try_from(res)) {
        (Some(ll), Ok(r)) => u64::from(ll.to_cell(r)),
        _ => 0,
    }
}

/// Converts an H3 index to the `(lat_deg, lon_east_deg 0-360)` of its center
/// (`(NaN, NaN)` for an invalid index).
pub fn h3_to_lat_lon(h3: u64) -> (f64, f64) {
    match to_cell(h3) {
        Some(c) => {
            let ll = LatLng::from(c);
            (ll.lat(), lon180_to_lon_east(ll.lng()))
        }
        None => (f64::NAN, f64::NAN),
    }
}

/// Returns the adjacent H3 cells (6, or 5 around a pentagon; empty for an invalid index).
pub fn neighbors(h3_index: u64) -> Vec<u64> {
    match to_cell(h3_index) {
        Some(c) => c
            .grid_disk::<Vec<_>>(1)
            .into_iter()
            .filter(|&n| n != c)
            .map(u64::from)
            .collect(),
        None => Vec::new(),
    }
}

/// Returns all H3 cells within `radius` grid steps of `center`, center included
/// (empty for an invalid index).
pub fn k_ring(center: u64, radius: u8) -> Vec<u64> {
    match to_cell(center) {
        Some(c) => c
            .grid_disk::<Vec<_>>(u32::from(radius))
            .into_iter()
            .map(u64::from)
            .collect(),
        None => Vec::new(),
    }
}

/// Great-circle distance in meters on the Mars sphere between two H3 cell centers
/// (`NaN` if either index is invalid).
pub fn geodesic_distance_m(a: u64, b: u64) -> f64 {
    if a == b {
        return if to_cell(a).is_some() { 0.0 } else { f64::NAN };
    }
    match (to_cell(a), to_cell(b)) {
        (Some(ca), Some(cb)) => LatLng::from(ca).distance_rads(LatLng::from(cb)) * MARS_RADIUS_M,
        _ => f64::NAN,
    }
}

/// Great-circle distance between two Martian coordinates in meters (East longitudes 0-360).
pub fn haversine_dist_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    match (to_latlng(lat1, lon1), to_latlng(lat2, lon2)) {
        (Some(a), Some(b)) => a.distance_rads(b) * MARS_RADIUS_M,
        _ => f64::NAN,
    }
}

/// Deterministic 32-bit horizon id for Canyon-TRN derived from the H3 index (FNV-1a over its
/// little-endian bytes). P1 has no equivalent and ships 0; the engine fills it on load.
pub fn horizon_hash_for_cell(h3: u64) -> u32 {
    let mut hash: u32 = 0x811C_9DC5;
    for byte in h3.to_le_bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/// Cells on the H3 grid line between two cells (inclusive). Falls back to the two end cells if
/// `h3o` cannot build a local IJ path (different base cells across a pentagon).
fn grid_line(start: CellIndex, end: CellIndex) -> Vec<CellIndex> {
    start
        .grid_path_cells(end)
        .ok()
        .and_then(|it| it.collect::<Result<Vec<_>, _>>().ok())
        .unwrap_or_else(|| vec![start, end])
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
///
/// Values are copied as stored: `CELL_NO_DATA` (NaN) means P1 has no value for that cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpyglassTriSectorSlice {
    pub center_h3: u64,
    pub crism_water_cells: Vec<(u64, f32)>,
    pub themis_trap_cells: Vec<(u64, f32)>,
    pub mola_slope_svf_cells: Vec<(u64, f32, f32, f32)>,
}

// ============================================================================
// 4. P1 Parquet loader errors
// ============================================================================

/// Error while loading P1's `HexCellState64B` Parquet table.
#[derive(Debug)]
pub enum GridLoadError {
    Io(std::io::Error),
    Parquet(String),
    /// Missing column or unexpected type / null in a non-nullable column.
    Schema(String),
    /// `h3_index` is not a valid H3 cell.
    InvalidCell(u64),
    /// The table mixes resolutions.
    MixedResolution { expected: u8, found: u8, h3: u64 },
    Empty,
}

impl fmt::Display for GridLoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Parquet(e) => write!(f, "Parquet error: {e}"),
            Self::Schema(e) => write!(f, "schema error: {e}"),
            Self::InvalidCell(h) => write!(f, "h3_index {h:#x} is not a valid H3 cell"),
            Self::MixedResolution { expected, found, h3 } => write!(
                f,
                "cell {h3:#x} has resolution {found}, table resolution is {expected}"
            ),
            Self::Empty => write!(f, "table has no rows"),
        }
    }
}

impl std::error::Error for GridLoadError {}

impl From<std::io::Error> for GridLoadError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<parquet::errors::ParquetError> for GridLoadError {
    fn from(e: parquet::errors::ParquetError) -> Self {
        Self::Parquet(e.to_string())
    }
}

/// Nullable `f32` column: Parquet `NULL` becomes `CELL_NO_DATA` explicitly.
fn field_f32_or_no_data(name: &str, field: &Field) -> Result<f32, GridLoadError> {
    match field {
        Field::Null => Ok(CELL_NO_DATA),
        Field::Float(v) => Ok(*v),
        Field::Double(v) => Ok(*v as f32),
        other => Err(GridLoadError::Schema(format!(
            "column {name}: expected float or null, found {other:?}"
        ))),
    }
}

fn field_u64(name: &str, field: &Field) -> Result<u64, GridLoadError> {
    match field {
        Field::ULong(v) => Ok(*v),
        Field::Long(v) => Ok(*v as u64),
        other => Err(GridLoadError::Schema(format!(
            "column {name}: expected uint64, found {other:?}"
        ))),
    }
}

fn field_u32(name: &str, field: &Field) -> Result<u32, GridLoadError> {
    match field {
        Field::UInt(v) => Ok(*v),
        Field::UShort(v) => Ok(u32::from(*v)),
        Field::Int(v) if *v >= 0 => Ok(*v as u32),
        other => Err(GridLoadError::Schema(format!(
            "column {name}: expected uint32, found {other:?}"
        ))),
    }
}

// ============================================================================
// 5. H3 Mars Grid Engine & Melas Chasma Corridor
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

    /// Loads P1's `HexCellState64B` table (`data/nasa-layers/hexgrid_route_res*_hexcell64b.parquet`).
    ///
    /// - `h3_index` must be a real H3 cell and all rows must share one resolution.
    /// - Parquet `NULL` in the `f32` columns becomes `CELL_NO_DATA` (NaN), never 0.
    /// - `hazard_bitmask` is kept as computed by P1 (P1 thresholds, NLOS from geometric LOS).
    /// - Fields P1 cannot provide today (NULL / 0 in the table) are filled by the engine's own
    ///   models; a non-null value from P1 is kept as is:
    ///   `los_base_rssi_dbm` = `uhf_link_rssi_dbm(distance to the Base, LOS = !NLOS flag)`;
    ///   `base_metabolic_cost` = level-ground cost at 1.0 m/s with the cell TIU (NaN TIU uses the
    ///   documented `TIU_NO_DATA_ASSUMED`); `horizon_hash_id` = `horizon_hash_for_cell`.
    ///   `roughness_hi` stays `CELL_NO_DATA` (no definition anywhere).
    /// - `padding_crc` is resealed by `insert`.
    pub fn load_p1_parquet(path: impl AsRef<Path>) -> Result<Self, GridLoadError> {
        let file = std::fs::File::open(path.as_ref())?;
        let reader = SerializedFileReader::new(file)?;
        let n_rows = reader.metadata().file_metadata().num_rows().max(0) as usize;
        let base = &SURVIVAL_TRIANGLE_SITE[0];

        let mut grid: Option<Self> = None;
        for row in reader.get_row_iter(None)? {
            let row = row?;
            let mut cell = HexCellState64B {
                h3_index: 0,
                elev_m: CELL_NO_DATA,
                slope_deg: CELL_NO_DATA,
                aspect_deg: CELL_NO_DATA,
                thermal_inertia_tiu: CELL_NO_DATA,
                roughness_hi: CELL_NO_DATA,
                isru_h2o_pct: CELL_NO_DATA,
                sky_view_factor: CELL_NO_DATA,
                los_base_rssi_dbm: CELL_NO_DATA,
                base_metabolic_cost: CELL_NO_DATA,
                horizon_hash_id: 0,
                hazard_bitmask: 0,
                padding_crc: [0u8; 14],
            };
            let mut seen = 0u16;
            for (name, field) in row.get_column_iter() {
                let n = name.as_str();
                match n {
                    "h3_index" => cell.h3_index = field_u64(n, field)?,
                    "elev_m" => cell.elev_m = field_f32_or_no_data(n, field)?,
                    "slope_deg" => cell.slope_deg = field_f32_or_no_data(n, field)?,
                    "aspect_deg" => cell.aspect_deg = field_f32_or_no_data(n, field)?,
                    "thermal_inertia_tiu" => {
                        cell.thermal_inertia_tiu = field_f32_or_no_data(n, field)?
                    }
                    "roughness_hi" => cell.roughness_hi = field_f32_or_no_data(n, field)?,
                    "isru_h2o_pct" => cell.isru_h2o_pct = field_f32_or_no_data(n, field)?,
                    "sky_view_factor" => cell.sky_view_factor = field_f32_or_no_data(n, field)?,
                    // Today always NULL in P1 (geometric LOS only); filled below if missing.
                    "los_base_rssi_dbm" => {
                        cell.los_base_rssi_dbm = field_f32_or_no_data(n, field)?
                    }
                    // Today always NULL in P1 (depends on speed and slip); filled below if missing.
                    "base_metabolic_cost" => {
                        cell.base_metabolic_cost = field_f32_or_no_data(n, field)?
                    }
                    // Today always 0 in P1; filled below if 0.
                    "horizon_hash_id" => cell.horizon_hash_id = field_u32(n, field)?,
                    "hazard_bitmask" => {
                        let v = field_u32(n, field)?;
                        cell.hazard_bitmask = u16::try_from(v).map_err(|_| {
                            GridLoadError::Schema(format!("hazard_bitmask {v} exceeds u16"))
                        })?;
                    }
                    "padding_crc" => {}
                    _ => continue,
                }
                seen += 1;
            }
            if seen != 13 {
                return Err(GridLoadError::Schema(format!(
                    "expected the 13 HexCellState64B columns, found {seen}"
                )));
            }

            let c = to_cell(cell.h3_index).ok_or(GridLoadError::InvalidCell(cell.h3_index))?;
            let res = u8::from(c.resolution());
            let g = grid.get_or_insert_with(|| {
                let mut g = Self::new(res);
                g.cells.reserve(n_rows);
                g
            });
            if res != g.res {
                return Err(GridLoadError::MixedResolution {
                    expected: g.res,
                    found: res,
                    h3: cell.h3_index,
                });
            }

            let ll = LatLng::from(c);
            let d_base = haversine_dist_m(
                ll.lat(),
                lon180_to_lon_east(ll.lng()),
                base.lat_deg,
                base.lon_deg,
            );
            if is_no_data(cell.los_base_rssi_dbm) {
                let los = cell.hazard_bitmask & HAZARD_FLAG_NLOS == 0;
                cell.los_base_rssi_dbm = uhf_link_rssi_dbm(d_base, los);
            }
            if is_no_data(cell.base_metabolic_cost) {
                cell.base_metabolic_cost =
                    pandolf_mars_metabolic_watts(0.0, cell.thermal_inertia_tiu, 1.0, 0.0) as f32;
            }
            if cell.horizon_hash_id == 0 {
                cell.horizon_hash_id = horizon_hash_for_cell(cell.h3_index);
            }
            g.insert(cell);
        }
        grid.ok_or(GridLoadError::Empty)
    }

    /// Returns all valid adjacent neighbor cells and their edge distances in meters.
    pub fn neighbor_edges(&self, h3: u64) -> Vec<(u64, f64)> {
        neighbors(h3)
            .into_iter()
            .filter(|n| self.cells.contains_key(n))
            .map(|n| (n, geodesic_distance_m(h3, n)))
            .collect()
    }

    /// Builds the dense index and adjacency lists used by `MetabolicDStarPlanner::new`.
    /// Cell order is sorted by H3 index so planner runs are reproducible.
    pub fn planner_graph(&self) -> (Vec<HexCellState64B>, Vec<Vec<(usize, f64)>>) {
        let mut cells: Vec<HexCellState64B> = self.cells.values().copied().collect();
        cells.sort_unstable_by_key(|c| c.h3_index);
        let idx: HashMap<u64, usize> = cells
            .iter()
            .enumerate()
            .map(|(i, c)| (c.h3_index, i))
            .collect();
        let adj = cells
            .iter()
            .map(|c| {
                self.neighbor_edges(c.h3_index)
                    .into_iter()
                    .filter_map(|(n, d)| idx.get(&n).map(|&j| (j, d)))
                    .collect()
            })
            .collect();
        (cells, adj)
    }

    /// Finds the grid cell containing the given coordinates (East longitude 0-360), or the
    /// geodesically nearest cell if that cell is not in the grid.
    pub fn nearest_cell(&self, lat_deg: f64, lon_deg: f64) -> Option<&HexCellState64B> {
        if self.cells.is_empty() {
            return None;
        }
        let target_h3 = lat_lon_to_h3(lat_deg, lon_deg, self.res);
        if let Some(cell) = self.cells.get(&target_h3) {
            return Some(cell);
        }
        let target = to_latlng(lat_deg, lon_deg)?;
        self.cells
            .values()
            .filter_map(|cell| {
                to_cell(cell.h3_index).map(|c| (cell, LatLng::from(c).distance_rads(target)))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(cell, _)| cell)
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

    /// Generates a synthetic Melas Chasma survival exploration corridor on real H3 cells.
    ///
    /// Covers the canonical "Survival Triangle":
    /// - **Base Habitat**: per-node values from `red_atlas_shared::SURVIVAL_TRIANGLE_SITE`
    ///   (320 TIU scenario, 2.8° DTM slope), LOS link to the Base antenna.
    /// - **WP1 (ISRU Water)**: Sulfate-rich layered deposits (12% structural H2O, scenario).
    /// - **WP2 (Fault Slope Trap)**: Landslide contact, 22° local ramp (scenario; 19.4° on the DTM),
    ///   soft regolith trap (110 TIU) and NLOS radio shadow (no geometric LOS to the Base).
    /// - **WP3 (Cliff Shelter)**: Alcove under an overhang on a 20.1° talus, Sky View Factor 0.15
    ///   (scenario, <= 0.20; 0.76 on the DTM), 85% SPE radiation attenuation, NLOS.
    ///
    /// Scenario zone radii follow P1 (`data/nasa-layers/SCHEMA_HEXGRID.md`): TIU discs of 100 m
    /// (Base, WP1), 150 m (WP2) and 40 m (WP3); water disc of 100 m (WP1); alcove disc of 40 m.
    /// Cells outside every zone keep P3's synthetic background values. For real terrain use
    /// `load_p1_parquet`.
    ///
    /// Every generated cell is sealed with `seal_crc()` to enable SEU bit-flip detection.
    pub fn generate_melas_chasma_corridor(res: u8) -> Self {
        let mut grid = Self::new(res);
        let waypoints = melas_chasma_survival_triangle();
        let Ok(resolution) = Resolution::try_from(res) else {
            return grid;
        };

        let base_wp = &waypoints[0];
        let wp1_wp = &waypoints[1];
        let wp2_wp = &waypoints[2];
        let wp3_wp = &waypoints[3];
        let [base_site, wp1_wp_site, wp2_site, wp3_site] = SURVIVAL_TRIANGLE_SITE;

        let node_cell = |lat: f64, lon: f64| {
            to_latlng(lat, lon)
                .expect("survival triangle coordinates are finite")
                .to_cell(resolution)
        };
        let base_cell = node_cell(base_wp.lat_deg, base_wp.lon_deg);
        let wp1_cell = node_cell(wp1_wp.lat_deg, wp1_wp.lon_deg);
        let wp2_cell = node_cell(wp2_wp.lat_deg, wp2_wp.lon_deg);
        let wp3_cell = node_cell(wp3_wp.lat_deg, wp3_wp.lon_deg);

        // Grid lines connecting the Survival Triangle (plus the WP1-WP3 diagonal).
        let legs = [
            (base_cell, wp1_cell),
            (wp1_cell, wp2_cell),
            (wp2_cell, wp3_cell),
            (wp3_cell, base_cell),
            (wp1_cell, wp3_cell),
        ];
        let mut path_cells = HashSet::new();
        for (start, end) in legs {
            path_cells.extend(grid_line(start, end));
        }

        // Buffer corridor width around paths and waypoints.
        let buffer_r: u32 = if res <= 11 { 2 } else { 1 };
        let mut full_cells: HashSet<CellIndex> = HashSet::new();
        for &pt in &path_cells {
            full_cells.extend(pt.grid_disk::<Vec<_>>(buffer_r));
        }

        // Expanded rings around critical waypoints.
        let wp_ring_r: u32 = if res <= 9 { 3 } else { 4 };
        for wp in [base_cell, wp1_cell, wp2_cell, wp3_cell] {
            full_cells.extend(wp.grid_disk::<Vec<_>>(wp_ring_r));
        }

        // Generate physical properties for each cell in the corridor.
        for c in full_cells {
            let h3_index = u64::from(c);
            let (lat, lon) = h3_to_lat_lon(h3_index);

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

            // 2. CRISM Structural Water ISRU (% by mass): P1 scenario disc of 100 m at WP1.
            let isru_h2o_pct = if c == wp1_cell || d_wp1 < WP1_WATER_ZONE_M {
                wp1_wp_site.h2o_wt_pct
            } else {
                1.2
            };

            // 3. Thermal Inertia Units (TIU): P1 scenario discs around the nodes.
            let thermal_inertia_tiu = if c == wp2_cell || d_wp2 < WP2_TIU_ZONE_M {
                wp2_site.thermal_inertia_tiu
            } else if c == base_cell || d_base < BASE_WP1_TIU_ZONE_M {
                base_site.thermal_inertia_tiu
            } else if c == wp1_cell || d_wp1 < BASE_WP1_TIU_ZONE_M {
                wp1_wp_site.thermal_inertia_tiu
            } else if c == wp3_cell || d_wp3 < WP3_ALCOVE_ZONE_M {
                wp3_site.thermal_inertia_tiu
            } else {
                360.0
            };

            // 4. Slope angle (degrees): DTM node slopes; WP2 carries the scenario ramp.
            let slope_deg = if c == wp2_cell {
                WP2_RAMP_SLOPE_DEG
            } else if d_wp2 < 120.0 {
                let factor = (d_wp2 / 120.0) as f32;
                WP2_RAMP_SLOPE_DEG - factor * (WP2_RAMP_SLOPE_DEG - wp2_site.slope_dem_deg)
            } else if c == base_cell || d_base < 100.0 {
                base_site.slope_dem_deg
            } else if c == wp1_cell || d_wp1 < 120.0 {
                wp1_wp_site.slope_dem_deg
            } else if c == wp3_cell || d_wp3 < 80.0 {
                wp3_site.slope_dem_deg
            } else {
                7.0
            };

            // 5. UHF radio level to the Base (dBm): P1 link budget; WP2 / WP3 zones have no
            //    geometric line of sight (DTM margins -24.7 m and -28.2 m).
            let nlos_zone = (!wp2_site.radio_los_base && d_wp2 < 150.0)
                || (!wp3_site.radio_los_base && d_wp3 < 80.0);
            let los_base_rssi_dbm = uhf_link_rssi_dbm(d_base, !nlos_zone);

            // 6. Sky View Factor (Psi_SVF): DTM node values; WP3 alcove scenario disc.
            let sky_view_factor = if c == wp3_cell || d_wp3 < WP3_ALCOVE_ZONE_M {
                wp3_site.sky_view_factor
            } else if d_wp2 < 150.0 {
                wp2_site.sky_view_factor
            } else {
                base_site.sky_view_factor
            };

            // 7. Slope Aspect
            let aspect_deg = if d_wp2 < 150.0 { 245.0 } else { 135.0 };

            // 8. Roughness Index
            let roughness_hi = if d_wp2 < 120.0 { 0.45 } else { 0.10 };

            // 9. Base Metabolic Cost
            // P1 model at the nominal 1.0 m/s on level ground with the cell TIU, without slip
            // (the planner recomputes the directed cost per edge).
            let base_metabolic_cost =
                pandolf_mars_metabolic_watts(0.0, thermal_inertia_tiu, 1.0, 0.0) as f32;

            // 10. Horizon id for Canyon-TRN, derived from the H3 index
            let horizon_hash_id = horizon_hash_for_cell(h3_index);

            // 11. Hazard Bitmask Flags
            let mut hazard_bitmask: u16 = 0;
            if slope_deg > CRITICAL_SLOPE_DEG {
                hazard_bitmask |= HAZARD_FLAG_SLOPE_CRITICAL;
            }
            if thermal_inertia_tiu < LOW_TIU_TRAP_THRESHOLD {
                hazard_bitmask |= HAZARD_FLAG_REGOLITH_TRAP;
            }
            if sky_view_factor <= SHELTER_SVF_MAX {
                hazard_bitmask |= HAZARD_FLAG_SHELTER;
            }
            if nlos_zone || los_base_rssi_dbm < NLOS_RSSI_THRESHOLD_DBM {
                hazard_bitmask |= HAZARD_FLAG_NLOS;
            }
            if isru_h2o_pct >= ISRU_WATER_MIN_PCT {
                hazard_bitmask |= HAZARD_FLAG_ISRU_WATER;
            }

            grid.insert(HexCellState64B {
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
            });
        }

        grid
    }
}

// ============================================================================
// 6. Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// P1 `SCHEMA_HEXGRID.md` §7: node cells computed by the `h3` Python library.
    const P1_NODE_CELLS_RES12: [u64; 4] =
        [0x8c8f591152cb1ff, 0x8c8f5911c103dff, 0x8c8f5911eaabdff, 0x8c8f5911e823bff];
    const P1_NODE_CELLS_RES9: [u64; 4] =
        [0x898f591152fffff, 0x898f5911c13ffff, 0x898f5911eabffff, 0x898f5911e83ffff];

    #[test]
    fn test_mars_resolution_metrics_scaling() {
        // Mean metrics of h3o rescaled to Mars (P1 SCHEMA_HEXGRID.md §2: 5.77 m / 87.3 m² at
        // res 12, 107.03 m / 29,932 m² at res 9).
        let r12 = resolution_metrics(12);
        assert_eq!(r12.res, 12);
        assert!((r12.edge_len_m - 5.77).abs() < 0.01, "{}", r12.edge_len_m);
        assert!((r12.area_m2 - 87.3).abs() < 0.1, "{}", r12.area_m2);

        let r9 = resolution_metrics(9);
        assert!((r9.edge_len_m - 107.03).abs() < 0.05, "{}", r9.edge_len_m);
        assert!((r9.area_m2 - 29_932.0).abs() < 5.0, "{}", r9.area_m2);

        // Aperture-7 hierarchy: each resolution step divides the area by ~7.
        let r11 = resolution_metrics(11);
        assert!((r11.area_m2 / r12.area_m2 - 7.0).abs() < 0.1);

        assert!(resolution_metrics(16).edge_len_m.is_nan());

        // Verify scaling constants match specifications
        assert!((H3_MARS_LINEAR_SCALE - 0.5331).abs() < 1e-4);
        assert!((H3_MARS_AREA_SCALE - 0.2842).abs() < 1e-4);
    }

    #[test]
    fn test_real_h3_indices_match_p1() {
        for (i, site) in SURVIVAL_TRIANGLE_SITE.iter().enumerate() {
            assert_eq!(
                lat_lon_to_h3(site.lat_deg, site.lon_deg, 12),
                P1_NODE_CELLS_RES12[i],
                "{} res 12",
                site.id
            );
            assert_eq!(
                lat_lon_to_h3(site.lat_deg, site.lon_deg, 9),
                P1_NODE_CELLS_RES9[i],
                "{} res 9",
                site.id
            );
            // East 0-360 and −180..180 inputs index the same cell.
            assert_eq!(
                lat_lon_to_h3(site.lat_deg, site.lon_deg - 360.0, 12),
                P1_NODE_CELLS_RES12[i]
            );
        }
        // The res-12 cell lies inside its res-9 parent.
        let parent = to_cell(P1_NODE_CELLS_RES12[0])
            .unwrap()
            .parent(Resolution::Nine)
            .unwrap();
        assert_eq!(u64::from(parent), P1_NODE_CELLS_RES9[0]);
    }

    #[test]
    fn test_lat_lon_h3_roundtrip() {
        let res = 11;
        let lat = SURVIVAL_TRIANGLE_SITE[1].lat_deg;
        let lon = SURVIVAL_TRIANGLE_SITE[1].lon_deg;

        let h3 = lat_lon_to_h3(lat, lon, res);
        let (recovered_lat, recovered_lon) = h3_to_lat_lon(h3);
        assert!(recovered_lon > 180.0, "East longitude 0-360 expected, got {recovered_lon}");

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
        let center = lat_lon_to_h3(SITE_REFERENCE_LAT_DEG, SITE_REFERENCE_LON_DEG, 11);
        let nbrs = neighbors(center);
        assert_eq!(nbrs.len(), 6);

        // Neighbors must all be unique and distinct from center; spacing ≈ √3 · edge.
        let spacing = 3f64.sqrt() * resolution_metrics(11).edge_len_m;
        let mut unique = HashSet::new();
        unique.insert(center);
        for n in nbrs {
            assert!(unique.insert(n), "Duplicate neighbor found");
            let d = geodesic_distance_m(center, n);
            assert!(
                d > 0.8 * spacing && d < 1.3 * spacing,
                "Neighbor distance unexpected: {d} m (spacing {spacing} m)"
            );
        }

        // k-ring sizes: 1, 7, 19, 37
        assert_eq!(k_ring(center, 0).len(), 1);
        assert_eq!(k_ring(center, 1).len(), 7);
        assert_eq!(k_ring(center, 2).len(), 19);
        assert_eq!(k_ring(center, 3).len(), 37);
    }

    #[test]
    fn test_invalid_index_is_tolerated() {
        for bogus in [0u64, 1, 42, u64::MAX] {
            assert!(to_cell(bogus).is_none());
            assert!(neighbors(bogus).is_empty());
            assert!(k_ring(bogus, 2).is_empty());
            let (lat, lon) = h3_to_lat_lon(bogus);
            assert!(lat.is_nan() && lon.is_nan());
            assert!(geodesic_distance_m(bogus, P1_NODE_CELLS_RES12[0]).is_nan());
            assert!(geodesic_distance_m(bogus, bogus).is_nan());
        }
        assert_eq!(lat_lon_to_h3(f64::NAN, 283.0, 12), 0);
        assert_eq!(lat_lon_to_h3(-9.9, 283.0, 16), 0);
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        assert!(grid.neighbor_edges(42).is_empty());
    }

    #[test]
    fn test_corridor_generation_and_crc_verification() {
        let grid = H3MarsGrid::generate_melas_chasma_corridor(11);
        assert!(grid.len() > 50, "Corridor should have substantial cells");

        // Verify CRC on every cell and that every index is a real H3 cell at res 11
        for cell in grid.all_cells() {
            assert!(
                cell.verify_crc(),
                "Cell {} failed CRC verification",
                cell.h3_index
            );
            assert_eq!(h3_resolution(cell.h3_index), Some(11));
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
            cell.isru_h2o_pct >= ISRU_WATER_MIN_PCT,
            "WP1 must have >= 12% structural water, found {}",
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
            cell.thermal_inertia_tiu < LOW_TIU_TRAP_THRESHOLD,
            "WP2 TIU must be < 150 (soft regolith trap), found {}",
            cell.thermal_inertia_tiu
        );
        assert!(
            cell.slope_deg > CRITICAL_SLOPE_DEG,
            "WP2 slope must be > 20 deg, found {}",
            cell.slope_deg
        );
        assert!(
            cell.los_base_rssi_dbm < NLOS_RSSI_THRESHOLD_DBM,
            "WP2 RSSI must be NLOS (< -100 dBm), found {}",
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
            cell.sky_view_factor <= SHELTER_SVF_MAX,
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
        let mut sorted: Vec<_> = grid.all_cells().map(|c| c.h3_index).collect();
        sorted.sort_unstable();
        let edges = grid.neighbor_edges(sorted[sorted.len() / 2]);
        // Corridor cells have at least one neighbor in the grid
        assert!(!edges.is_empty());
        for (nbr, dist) in edges {
            assert!(grid.get_cell(nbr).is_some());
            assert!(dist > 0.0);
        }

        let (cells, adj) = grid.planner_graph();
        assert_eq!(cells.len(), grid.len());
        assert!(cells.windows(2).all(|w| w[0].h3_index < w[1].h3_index));
        assert!(adj.iter().all(|a| a.len() <= 6));
    }
}
