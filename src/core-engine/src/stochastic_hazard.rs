//! Multi-Hazard Stochastic Engine for R.E.D. ATLAS (Melas Chasma).
//!
//! Implements Section 3.1 of `ENTREGABLE_3_ARQUITECTURA_E_IA.md`:
//! - Deterministic zero-dependency [`XorShift64`] PRNG for reproducible Chaos Mode runs
//!   on both native ARM64/RISC-V EVA suits and WebAssembly (`WASM`) Habitat Console.
//! - Non-Homogeneous Spatial-Temporal Poisson onset rates ($\lambda_1..\lambda_4$)
//!   conditioned on hexagonal terrain state ([`HexCellState64B`]), Mars solar hour,
//!   solar particle activity, and atmospheric dust opacity $\tau$.
//! - 16-state Continuous-Time Markov Chain (CTMC) over $\mathbf{H}(t) \in \{0,1\}^4$
//!   with explicit cross-hazard coupling multipliers ($\mu_{3|1} = 2.4$, $\mu_{4|1} = 1.8$,
//!   $\mu_{2|3} = 1.65$) solved exactly over $\Delta t$ via Gillespie SSA.
//! - 100-run Monte Carlo "Chaos Mode" simulator quantifying how Dynamic Goal Switching
//!   to the WP3 Cliff Shelter ($\Psi_{\text{SVF}} \approx 0.15$) rescues EVA survival
//!   compared to Base-only return.

use red_atlas_shared::{
    ActiveHazards, HexCellState64B, DUST_TAU_NOMINAL, DUST_TAU_STORM, EVA_SPE_DOSE_BUDGET_MSV,
    GCR_SURFACE_RATE_MSV_H, LOW_TIU_TRAP_THRESHOLD, NLOS_RSSI_THRESHOLD_DBM,
    SPE_PEAK_ENVELOPE_MSV_H,
};
use serde::{Deserialize, Serialize};

/// Martian solar day (sol) duration in hours.
pub const MARS_SOL_HOURS: f64 = 24.66;

/// Bit flag for H1 (Dust storm / catabatic wind) in the 4-bit CTMC state mask.
pub const MASK_H1_DUST: u8 = 0b0001;
/// Bit flag for H2 (Solar Particle Event radiation) in the 4-bit CTMC state mask.
pub const MASK_H2_SPE: u8 = 0b0010;
/// Bit flag for H3 (Regolith trap / steep slope instability) in the 4-bit CTMC state mask.
pub const MASK_H3_REGOLITH: u8 = 0b0100;
/// Bit flag for H4 (NLOS radio shadow / offline link) in the 4-bit CTMC state mask.
pub const MASK_H4_NLOS: u8 = 0b1000;

/// Cross-hazard coupling multiplier: dust storm ($H_1$) increases regolith trap risk ($H_3$).
pub const MU_3_GIVEN_1: f64 = 2.4;
/// Cross-hazard coupling multiplier: dust storm ($H_1$) increases NLOS link drop risk ($H_4$).
pub const MU_4_GIVEN_1: f64 = 1.8;
/// Cross-hazard coupling multiplier: regolith entrapment ($H_3$) slows traverse by ~55%,
/// amplifying exposure transition into critical SPE ($H_2$).
pub const MU_2_GIVEN_3: f64 = 1.65;
/// Cross-hazard coupling multiplier: NLOS offline state ($H_4$) removes Base guidance,
/// mildly elevating regolith trap entry ($H_3$).
pub const MU_3_GIVEN_4: f64 = 1.25;

// Calibrated Non-Homogeneous Poisson base rates (per minute).
const LAMBDA_1_BASE: f64 = 0.008;
const KAPPA_1_SOLAR_PEAK: f64 = 1.25;
const PEAK_CATABATIC_SOLAR_HOUR: f64 = 15.5;
const GAMMA_CANYON_SLOPE: f64 = 1.5;

const LAMBDA_2_BASE: f64 = 0.006;

const LAMBDA_3_BASE: f64 = 0.055;
const ALPHA_TIU: f64 = 0.08;
const ALPHA_SLOPE: f64 = 0.6;
const TIU_TRAP_CENTER: f64 = 150.0;
const SLOPE_TRAP_CENTER_DEG: f64 = 18.0;

const LAMBDA_4_NLOS_DROP: f64 = 3.5;
const BETA_TAU_ATTEN: f64 = 0.12;
const TAU_ATTEN_THRESHOLD: f64 = 1.5;

// Baseline CTMC hazard recovery rates (per minute).
const GAMMA_1_RECOVER: f64 = 0.025;
const GAMMA_2_RECOVER: f64 = 0.030;
const GAMMA_3_RECOVER_FIRM: f64 = 0.12;
const GAMMA_3_RECOVER_TRAP: f64 = 0.02;
const GAMMA_4_RECOVER_LOS: f64 = 0.85;
const GAMMA_4_RECOVER_NLOS: f64 = 0.01;

/// Deterministic zero-dependency 64-bit XorShift PRNG.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct XorShift64 {
    state: u64,
}

impl XorShift64 {
    /// Creates a new PRNG from `seed`. A zero seed is remapped to a non-zero
    /// golden-ratio constant so the generator never stalls.
    pub fn new(seed: u64) -> Self {
        let safe_seed = if seed == 0 {
            0x9E37_79B9_7F4A_7C15
        } else {
            seed
        };
        Self { state: safe_seed }
    }

    /// Generates the next pseudo-random `u64` value.
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        x
    }

    /// Generates a uniform floating-point number in `[0.0, 1.0)`.
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        // Use top 53 bits for exact IEEE-754 f64 mantissa precision in [0, 1).
        const INV_2_POW_53: f64 = 1.0 / ((1u64 << 53) as f64);
        ((self.next_u64() >> 11) as f64) * INV_2_POW_53
    }
}

/// Instantaneous Poisson onset rates (per minute) for the four Mars hazards.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HazardRates {
    /// $H_1$: Catabatic wind / dust storm onset rate ($\text{min}^{-1}$).
    pub lambda1_dust: f64,
    /// $H_2$: Solar Particle Event (SPE) onset rate ($\text{min}^{-1}$).
    pub lambda2_spe: f64,
    /// $H_3$: Regolith trap / geomorphological slide onset rate ($\text{min}^{-1}$).
    pub lambda3_regolith: f64,
    /// $H_4$: NLOS radio link drop onset rate ($\text{min}^{-1}$).
    pub lambda4_nlos: f64,
}

/// 16-state Continuous-Time Markov Chain (CTMC) hazard engine over $\mathbf{H}(t) \in \{0,1\}^4$.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MarkovHazardModel {
    /// 4-bit hazard state mask in `0..16`:
    /// bit 0 = $H_1$ (Dust), bit 1 = $H_2$ (SPE), bit 2 = $H_3$ (Regolith), bit 3 = $H_4$ (NLOS).
    pub current_mask: u8,
    /// Current atmospheric dust optical depth $\tau$ (880 nm).
    pub current_tau: f32,
    /// Current local wind speed ($\text{m/s}$).
    pub current_wind_ms: f32,
    /// Current unattenuated SPE radiation dose rate ($\text{mSv/h}$).
    pub current_spe_dose_rate_msv_h: f32,
}

impl Default for MarkovHazardModel {
    fn default() -> Self {
        Self::new()
    }
}

impl MarkovHazardModel {
    /// Initializes the CTMC in the nominal hazard-free state (`current_mask = 0`).
    pub fn new() -> Self {
        Self {
            current_mask: 0,
            current_tau: DUST_TAU_NOMINAL,
            current_wind_ms: 6.5,
            current_spe_dose_rate_msv_h: GCR_SURFACE_RATE_MSV_H,
        }
    }

    /// Initializes the CTMC with a specific 4-bit state mask (`0..16`).
    pub fn with_mask(mask: u8) -> Self {
        let clamped_mask = mask & 0x0F;
        let h1 = (clamped_mask & MASK_H1_DUST) != 0;
        let h2 = (clamped_mask & MASK_H2_SPE) != 0;
        Self {
            current_mask: clamped_mask,
            current_tau: if h1 { DUST_TAU_STORM } else { DUST_TAU_NOMINAL },
            current_wind_ms: if h1 { 28.0 } else { 6.5 },
            current_spe_dose_rate_msv_h: if h2 { SPE_PEAK_ENVELOPE_MSV_H } else { GCR_SURFACE_RATE_MSV_H },
        }
    }

    /// Evaluates the Non-Homogeneous Spatial-Temporal Poisson onset rates ($\text{min}^{-1}$)
    /// for a given hexagonal cell, Mars solar hour, solar activity factor, and dust opacity $\tau$.
    pub fn compute_poisson_rates(
        cell: &HexCellState64B,
        mars_solar_hour: f64,
        solar_activity_factor: f64,
        current_tau: f32,
    ) -> HazardRates {
        // 1. H1: Catabatic wind / dust storm peaks around 15.5h solar time & grows with slope gradient.
        let phase =
            2.0 * std::f64::consts::PI * (mars_solar_hour - PEAK_CATABATIC_SOLAR_HOUR) / MARS_SOL_HOURS;
        let slope_clamped_deg = (cell.slope_deg as f64).clamp(0.0, 85.0);
        let grad_norm = slope_clamped_deg.to_radians().tan();
        let lambda1_dust =
            LAMBDA_1_BASE * (KAPPA_1_SOLAR_PEAK * phase.cos()).exp() * (1.0 + GAMMA_CANYON_SLOPE * grad_norm);

        // 2. H2: Exogenous Solar Particle Event (SPE) scales with solar activity factor.
        let lambda2_spe = LAMBDA_2_BASE * solar_activity_factor.max(0.0);

        // 3. H3: Regolith trap / landslide sigmoid product for low TIU (<150) and steep slope (>18 deg).
        let sig_tiu = sigmoid(ALPHA_TIU * (TIU_TRAP_CENTER - cell.thermal_inertia_tiu as f64));
        let sig_slope = sigmoid(ALPHA_SLOPE * ((cell.slope_deg as f64) - SLOPE_TRAP_CENTER_DEG));
        let lambda3_regolith = LAMBDA_3_BASE * sig_tiu * sig_slope;

        // 4. H4: Topographic NLOS obstruction + UHF dust attenuation term.
        let obstructed = if cell.los_base_rssi_dbm < NLOS_RSSI_THRESHOLD_DBM {
            1.0
        } else {
            0.0
        };
        let dust_excess = ((current_tau as f64) - TAU_ATTEN_THRESHOLD).max(0.0);
        let lambda4_nlos = obstructed * LAMBDA_4_NLOS_DROP + BETA_TAU_ATTEN * dust_excess;

        HazardRates {
            lambda1_dust,
            lambda2_spe,
            lambda3_regolith,
            lambda4_nlos,
        }
    }

    /// Computes the state-conditioned onset rates applying cross-hazard coupling multipliers
    /// ($\mu_{3|1} = 2.4$, $\mu_{4|1} = 1.8$, $\mu_{2|3} = 1.65$, $\mu_{3|4} = 1.25$) for `self.current_mask`.
    pub fn coupled_poisson_rates(
        &self,
        cell: &HexCellState64B,
        mars_solar_hour: f64,
        solar_activity_factor: f64,
    ) -> HazardRates {
        let mut rates = Self::compute_poisson_rates(
            cell,
            mars_solar_hour,
            solar_activity_factor,
            self.current_tau,
        );

        let h1 = (self.current_mask & MASK_H1_DUST) != 0;
        let h3 = (self.current_mask & MASK_H3_REGOLITH) != 0;
        let h4 = (self.current_mask & MASK_H4_NLOS) != 0;

        if h1 {
            rates.lambda3_regolith *= MU_3_GIVEN_1;
            rates.lambda4_nlos *= MU_4_GIVEN_1;
        }
        if h3 {
            rates.lambda2_spe *= MU_2_GIVEN_3;
        }
        if h4 {
            rates.lambda3_regolith *= MU_3_GIVEN_4;
        }

        rates
    }

    /// Advances the 16-state CTMC by `dt_min` minutes using exact Gillespie stochastic simulation
    /// over the infinitesimal generator $Q$, updating `current_mask` and returning [`ActiveHazards`].
    pub fn step_ctmc(
        &mut self,
        cell: &HexCellState64B,
        mars_solar_hour: f64,
        solar_activity_factor: f64,
        dt_min: f64,
        rng: &mut XorShift64,
    ) -> ActiveHazards {
        let dt = dt_min.max(0.0);
        let mut elapsed = 0.0;
        let mut iterations = 0usize;
        const MAX_SSA_STEPS: usize = 64;

        while elapsed < dt && iterations < MAX_SSA_STEPS {
            iterations += 1;
            let rates = self.coupled_poisson_rates(cell, mars_solar_hour, solar_activity_factor);

            let r0 = if (self.current_mask & MASK_H1_DUST) == 0 {
                rates.lambda1_dust
            } else {
                GAMMA_1_RECOVER
            };
            let r1 = if (self.current_mask & MASK_H2_SPE) == 0 {
                rates.lambda2_spe
            } else {
                GAMMA_2_RECOVER
            };
            let r2 = if (self.current_mask & MASK_H3_REGOLITH) == 0 {
                rates.lambda3_regolith
            } else if cell.thermal_inertia_tiu < 150.0 && cell.slope_deg > 18.0 {
                GAMMA_3_RECOVER_TRAP
            } else {
                GAMMA_3_RECOVER_FIRM
            };
            let r3 = if (self.current_mask & MASK_H4_NLOS) == 0 {
                rates.lambda4_nlos
            } else if cell.los_base_rssi_dbm < NLOS_RSSI_THRESHOLD_DBM {
                GAMMA_4_RECOVER_NLOS
            } else {
                GAMMA_4_RECOVER_LOS
            };

            let total_rate = r0 + r1 + r2 + r3;
            if total_rate <= 1e-12 {
                break;
            }

            // Sample exponential holding time: -ln(1 - u) / total_rate.
            let u_time = rng.next_f64().min(1.0 - 1e-15);
            let tau_step = -(1.0 - u_time).ln() / total_rate;
            if elapsed + tau_step > dt {
                break;
            }
            elapsed += tau_step;

            // Choose which hazard bit flips proportional to its outgoing CTMC rate.
            let pick = rng.next_f64() * total_rate;
            if pick < r0 {
                self.current_mask ^= MASK_H1_DUST;
            } else if pick < r0 + r1 {
                self.current_mask ^= MASK_H2_SPE;
            } else if pick < r0 + r1 + r2 {
                self.current_mask ^= MASK_H3_REGOLITH;
            } else {
                self.current_mask ^= MASK_H4_NLOS;
            }

            // Keep tau updated instantaneously so intra-step H1 transitions modulate H4.
            self.current_tau = if (self.current_mask & MASK_H1_DUST) != 0 {
                DUST_TAU_STORM
            } else {
                DUST_TAU_NOMINAL
            };
        }

        self.build_active_hazards(cell)
    }

    /// Projects the current CTMC state and cell telemetry into an [`ActiveHazards`] snapshot.
    pub fn build_active_hazards(&mut self, cell: &HexCellState64B) -> ActiveHazards {
        let h1 = (self.current_mask & MASK_H1_DUST) != 0;
        let h2 = (self.current_mask & MASK_H2_SPE) != 0;
        let h3 = (self.current_mask & MASK_H3_REGOLITH) != 0;
        let h4 = (self.current_mask & MASK_H4_NLOS) != 0;

        self.current_tau = if h1 { DUST_TAU_STORM } else { DUST_TAU_NOMINAL };
        self.current_wind_ms = if h1 { 28.0 } else { 6.5 };
        self.current_spe_dose_rate_msv_h = if h2 { SPE_PEAK_ENVELOPE_MSV_H } else { GCR_SURFACE_RATE_MSV_H };

        let dust_atten_db = if h1 { 6.5 } else { 0.0 };
        let rssi_dbm = if h4 {
            (cell.los_base_rssi_dbm - dust_atten_db).min(NLOS_RSSI_THRESHOLD_DBM - 6.0)
        } else {
            cell.los_base_rssi_dbm - dust_atten_db
        };

        ActiveHazards {
            h1_dust_storm: h1,
            h2_spe_radiation: h2,
            h3_regolith_slope: h3,
            h4_nlos_offline: h4,
            dust_tau: self.current_tau,
            wind_speed_ms: self.current_wind_ms,
            spe_dose_rate_msv_h: self.current_spe_dose_rate_msv_h,
            rssi_dbm,
        }
    }
}

/// Summary report produced by [`run_chaos_mode_monte_carlo`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ChaosModeReport {
    /// Total number of simulated EVA trials.
    pub trials: usize,
    /// Number of trials where the astronaut survived using WP3 Cliff Shelter Dynamic Goal Switching.
    pub survived_with_wp3_shelter: usize,
    /// Number of trials where the astronaut survived when forced to return only to Base Habitat.
    pub survived_base_only: usize,
    /// Survival percentage with WP3 Cliff Shelter (`0.0..=100.0`).
    pub survival_rate_with_shelter_pct: f64,
    /// Survival percentage when forced to return only to Base (`0.0..=100.0`).
    pub survival_rate_base_only_pct: f64,
    /// Total number of multi-hazard states ($\ge 2$ concurrent hazards) triggered across all trials.
    pub multi_hazard_events_triggered: usize,
}

/// Runs a `trials`-iteration Monte Carlo "Chaos Mode" EVA traverse over `corridor_cells`
/// starting at `mars_solar_hour`, comparing Base-only return vs Dynamic Goal Switching to
/// the WP3 Cliff Shelter.
pub fn run_chaos_mode_monte_carlo(
    corridor_cells: &[HexCellState64B],
    trials: usize,
    seed: u64,
    mars_solar_hour: f64,
) -> ChaosModeReport {
    if trials == 0 || corridor_cells.is_empty() {
        return ChaosModeReport {
            trials,
            survived_with_wp3_shelter: 0,
            survived_base_only: 0,
            survival_rate_with_shelter_pct: 0.0,
            survival_rate_base_only_pct: 0.0,
            multi_hazard_events_triggered: 0,
        };
    }

    let mut rng = XorShift64::new(seed);

    // Identify lowest Sky View Factor cell in corridor as WP3 Cliff Shelter shielding (default 0.15).
    let shelter_svf = corridor_cells
        .iter()
        .map(|c| c.sky_view_factor)
        .filter(|&svf| svf > 0.0)
        .fold(f32::INFINITY, f32::min);
    let effective_shelter_svf = if shelter_svf.is_finite() && shelter_svf <= 0.30 {
        shelter_svf as f64
    } else {
        0.15
    };

    // Build a deterministic 24-leg EVA traverse (~120 min) sampling across the provided corridor.
    const TRAVERSE_LEGS: usize = 24;
    const DT_MIN: f64 = 5.0;
    const SOLAR_ACTIVITY_CHAOS: f64 = 2.2;

    // PLSS mission limits at start of critical EVA window (O2 reserve + acute SPE dose cap).
    const INITIAL_O2_LITERS: f64 = 210.0;
    const MISSION_RAD_LIMIT_MSV: f64 = EVA_SPE_DOSE_BUDGET_MSV as f64;

    let mut survived_with_wp3_shelter = 0usize;
    let mut survived_base_only = 0usize;
    let mut multi_hazard_events_triggered = 0usize;

    for _trial in 0..trials {
        let mut model = MarkovHazardModel::new();

        // Paired comparison on the exact same stochastic hazard timeline:
        let mut o2_base = INITIAL_O2_LITERS;
        let mut rad_base = 0.0_f64;
        let mut base_progress = 0.0_f64;
        let mut base_alive = true;

        let mut o2_shelter = INITIAL_O2_LITERS;
        let mut rad_shelter = 0.0_f64;
        let mut switched_to_shelter = false;
        let mut shelter_arrived = false;
        let mut shelter_alive = true;

        let mut prev_multi = false;

        for leg in 0..TRAVERSE_LEGS {
            let idx = (leg * corridor_cells.len()) / TRAVERSE_LEGS;
            let cell = &corridor_cells[idx];
            let local_hour = (mars_solar_hour + (leg as f64) * DT_MIN / 60.0) % MARS_SOL_HOURS;

            let hazards = model.step_ctmc(cell, local_hour, SOLAR_ACTIVITY_CHAOS, DT_MIN, &mut rng);

            let active_count = (hazards.h1_dust_storm as u8)
                + (hazards.h2_spe_radiation as u8)
                + (hazards.h3_regolith_slope as u8)
                + (hazards.h4_nlos_offline as u8);
            let is_multi = active_count >= 2;
            if is_multi && !prev_multi {
                multi_hazard_events_triggered += 1;
            }
            prev_multi = is_multi;

            // Instantaneous metabolic O2 demand (L/min) from slope, regolith TIU, and H1/H3 stress.
            let base_o2_l_min = 0.80
                + 0.045 * (cell.slope_deg as f64).max(0.0)
                + if cell.thermal_inertia_tiu < LOW_TIU_TRAP_THRESHOLD {
                    0.65
                } else {
                    0.0
                };
            let hazard_o2_mult = (if hazards.h1_dust_storm { 1.30 } else { 1.0 })
                * (if hazards.h3_regolith_slope { 1.35 } else { 1.0 });
            let step_o2_rate = base_o2_l_min * hazard_o2_mult;

            let open_svf = (cell.sky_view_factor as f64).clamp(0.15, 1.0);
            let step_rad_open = (hazards.spe_dose_rate_msv_h as f64) * open_svf * (DT_MIN / 60.0);

            // Travel speed degradation under dust storm & regolith trap.
            let speed_factor = (if hazards.h1_dust_storm { 0.65 } else { 1.0 })
                * (if hazards.h3_regolith_slope { 0.45 } else { 1.0 });

            // --- Strategy A: Base-only return (must complete full 1.0 normalized return distance) ---
            if base_alive && base_progress < 1.0 {
                o2_base -= step_o2_rate * DT_MIN;
                rad_base += step_rad_open;
                // Only advance toward Base once past initial outbound legs (leg >= 6).
                if leg >= 6 {
                    base_progress += speed_factor / 14.0;
                }
                if o2_base <= 0.0 || rad_base > MISSION_RAD_LIMIT_MSV {
                    base_alive = false;
                }
            }

            // --- Strategy B: Dynamic Goal Switching to WP3 Cliff Shelter ---
            if shelter_alive {
                if !switched_to_shelter && (is_multi || hazards.h2_spe_radiation || o2_shelter < 95.0)
                {
                    switched_to_shelter = true;
                }

                if switched_to_shelter {
                    if !shelter_arrived {
                        // ~8-10 min (2 legs) lateral escape to WP3 cliff alcove.
                        o2_shelter -= step_o2_rate * DT_MIN;
                        rad_shelter += step_rad_open * 0.55;
                        shelter_arrived = true;
                    } else {
                        // Sheltered inside WP3 alcove: low resting O2 rate & SVF=0.15 shielding.
                        o2_shelter -= 0.42 * DT_MIN;
                        rad_shelter += (hazards.spe_dose_rate_msv_h as f64)
                            * effective_shelter_svf
                            * (DT_MIN / 60.0);
                    }
                } else {
                    o2_shelter -= step_o2_rate * DT_MIN;
                    rad_shelter += step_rad_open;
                }

                if o2_shelter <= 0.0 || rad_shelter > MISSION_RAD_LIMIT_MSV {
                    shelter_alive = false;
                }
            }
        }

        if base_alive && base_progress >= 1.0 {
            survived_base_only += 1;
        }
        if shelter_alive {
            survived_with_wp3_shelter += 1;
        }
    }

    let denom = trials as f64;
    ChaosModeReport {
        trials,
        survived_with_wp3_shelter,
        survived_base_only,
        survival_rate_with_shelter_pct: (survived_with_wp3_shelter as f64) * 100.0 / denom,
        survival_rate_base_only_pct: (survived_base_only as f64) * 100.0 / denom,
        multi_hazard_events_triggered,
    }
}

#[inline]
fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cell(
        slope_deg: f32,
        tiu: f32,
        svf: f32,
        rssi_dbm: f32,
    ) -> HexCellState64B {
        let mut cell = HexCellState64B {
            h3_index: 0x8d28_3082_8000_0000,
            elev_m: red_atlas_shared::SITE_BASE_ELEV_M,
            slope_deg,
            aspect_deg: 90.0,
            thermal_inertia_tiu: tiu,
            roughness_hi: 0.15,
            isru_h2o_pct: 2.0,
            sky_view_factor: svf,
            los_base_rssi_dbm: rssi_dbm,
            base_metabolic_cost: 280.0,
            horizon_hash_id: 1,
            hazard_bitmask: 0,
            padding_crc: [0; 14],
        };
        cell.seal_crc();
        cell
    }

    #[test]
    fn xorshift64_is_deterministic_and_bounded() {
        let mut rng_a = XorShift64::new(42);
        let mut rng_b = XorShift64::new(42);
        let mut rng_zero = XorShift64::new(0);

        for _ in 0..1000 {
            let a = rng_a.next_f64();
            let b = rng_b.next_f64();
            assert_eq!(a, b);
            assert!((0.0..1.0).contains(&a));

            let z = rng_zero.next_f64();
            assert!((0.0..1.0).contains(&z));
        }
    }

    #[test]
    fn afternoon_solar_hour_increases_lambda1_dust_over_morning() {
        let canyon_slope = make_cell(15.0, 350.0, 0.75, -90.0);
        let morning = MarkovHazardModel::compute_poisson_rates(&canyon_slope, 8.0, 1.0, 0.7);
        let afternoon = MarkovHazardModel::compute_poisson_rates(&canyon_slope, 15.5, 1.0, 0.7);

        assert!(
            afternoon.lambda1_dust > morning.lambda1_dust * 3.0,
            "Expected 15.5h dust rate ({}) >> 8.0h dust rate ({})",
            afternoon.lambda1_dust,
            morning.lambda1_dust
        );

        let flat = make_cell(0.0, 350.0, 0.75, -90.0);
        let flat_afternoon = MarkovHazardModel::compute_poisson_rates(&flat, 15.5, 1.0, 0.7);
        assert!(afternoon.lambda1_dust > flat_afternoon.lambda1_dust);
    }

    #[test]
    fn low_tiu_and_steep_slope_trigger_lambda3_regolith() {
        let firm_basalt = make_cell(4.0, 420.0, 0.75, -85.0);
        let wp2_trap = make_cell(22.0, 110.0, 0.70, -120.0);

        let r_firm = MarkovHazardModel::compute_poisson_rates(&firm_basalt, 15.5, 1.0, 0.7);
        let r_trap = MarkovHazardModel::compute_poisson_rates(&wp2_trap, 15.5, 1.0, 0.7);

        assert!(r_firm.lambda3_regolith < 1e-4);
        assert!(
            r_trap.lambda3_regolith > 0.04,
            "Expected high regolith rate on WP2 trap, got {}",
            r_trap.lambda3_regolith
        );
        assert!(r_trap.lambda4_nlos > r_firm.lambda4_nlos);
    }

    #[test]
    fn cross_hazard_coupling_amplifies_h3_and_h4_under_h1() {
        let wp2_trap = make_cell(22.0, 110.0, 0.70, -120.0);
        let clear_model = MarkovHazardModel::with_mask(0);
        let dust_model = MarkovHazardModel::with_mask(MASK_H1_DUST);

        let clear_rates = clear_model.coupled_poisson_rates(&wp2_trap, 15.5, 1.0);
        let base_at_dust_tau =
            MarkovHazardModel::compute_poisson_rates(&wp2_trap, 15.5, 1.0, dust_model.current_tau);
        let dust_rates = dust_model.coupled_poisson_rates(&wp2_trap, 15.5, 1.0);

        assert!(
            (dust_rates.lambda3_regolith / clear_rates.lambda3_regolith - MU_3_GIVEN_1).abs()
                < 1e-6
        );
        assert!(
            (dust_rates.lambda4_nlos / base_at_dust_tau.lambda4_nlos - MU_4_GIVEN_1).abs() < 1e-6
        );
        assert!(dust_rates.lambda4_nlos > clear_rates.lambda4_nlos * MU_4_GIVEN_1);

        // Stochastic verification: starting with H1 active produces higher H3 onset frequency.
        let mut h3_hits_clear = 0usize;
        let mut h3_hits_dust = 0usize;
        let mut rng1 = XorShift64::new(101);
        let mut rng2 = XorShift64::new(101);

        for _ in 0..400 {
            let mut m0 = MarkovHazardModel::with_mask(0);
            let hz0 = m0.step_ctmc(&wp2_trap, 15.5, 1.0, 5.0, &mut rng1);
            if hz0.h3_regolith_slope {
                h3_hits_clear += 1;
            }

            let mut m1 = MarkovHazardModel::with_mask(MASK_H1_DUST);
            let hz1 = m1.step_ctmc(&wp2_trap, 15.5, 1.0, 5.0, &mut rng2);
            if hz1.h3_regolith_slope {
                h3_hits_dust += 1;
            }
        }

        assert!(
            h3_hits_dust > h3_hits_clear,
            "Expected H1 coupling to increase H3 triggers ({} > {})",
            h3_hits_dust,
            h3_hits_clear
        );
    }

    #[test]
    fn chaos_mode_100_runs_proves_wp3_shelter_advantage() {
        let corridor = vec![
            make_cell(2.0, 440.0, 0.85, -75.0),   // Base habitat
            make_cell(6.0, 380.0, 0.80, -88.0),   // Outbound firm basalt
            make_cell(12.0, 240.0, 0.75, -102.0), // WP1 approach
            make_cell(22.0, 110.0, 0.72, -122.0), // WP2 fault regolith trap + NLOS
            make_cell(20.0, 130.0, 0.70, -118.0), // WP2 exit slope
            make_cell(8.0, 410.0, 0.15, -116.0),  // WP3 Cliff Shelter (SVF = 0.15)
        ];

        let report = run_chaos_mode_monte_carlo(&corridor, 100, 2026, 15.5);

        assert_eq!(report.trials, 100);
        assert!(report.multi_hazard_events_triggered > 0);
        assert!(
            report.survived_with_wp3_shelter > report.survived_base_only,
            "WP3 shelter survival ({}) must exceed Base-only ({})",
            report.survived_with_wp3_shelter,
            report.survived_base_only
        );
        assert!(
            report.survival_rate_with_shelter_pct - report.survival_rate_base_only_pct >= 15.0,
            "Expected significant survival gap: shelter {:.1}% vs base-only {:.1}%",
            report.survival_rate_with_shelter_pct,
            report.survival_rate_base_only_pct
        );
    }
}
