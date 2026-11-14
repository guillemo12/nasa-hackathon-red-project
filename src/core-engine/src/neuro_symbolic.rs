//! # Neuro-Symbolic Offline Copilot (`neuro_symbolic.rs`)
//!
//! Implements Section 4 of `docs/03-system-architecture-ai/ENTREGABLE_3_ARQUITECTURA_E_IA.md`:
//! - **Triple Modular Redundancy (TMR 2-out-of-3)**: mitigates Single Event Upsets
//!   (SEU bit-flips) induced by solar particle events (SPE) and Martian galactic cosmic rays.
//! - **Deterministic Safety Guardrail FSM (100 Hz)**: hard mathematical state machine
//!   governing astronaut life-support constraints, dynamic goal switching, and terrain safety.
//!   Maps exactly to:
//!     - `0x01_NOMINAL` (`#00F0FF`)
//!     - `0x02_CAUTION` (`#FFB000`)
//!     - `0x03_MULTI_HAZARD` (`#FFB000`)
//!     - `0x04_EVAC_SHELTER` (`#FF2A2A`)
//!     - `0x05_SHELTER_HOLD` (`#00E676`)
//! - **Single-Alert Fusion Triage**: cognitive triage priority matrix
//!   (1. Radiation/O2 -> 2. Terrain Trap -> 3. Dust/Wind -> 4. NLOS Radio) suppressing
//!   redundant popups and producing validated `voice_summary_slots`.
//! - **Offline Edge SLM Voice Slot Synthesizer**: deterministic zero-hallucination
//!   tactical voice synthesis (<= 8 seconds spoken length, <= 25 words).
//! - **Eclipse Zenoh CRDT Ring-Buffer**: bounded offline ring-buffer for telemetry and
//!   science samples during `AUTONOMOUS_NLOS` with automatic `drain_replay()` upon link recovery.

use red_atlas_shared::{
    ActiveHazards, PlssTelemetry, SafetyGuardrailState, SingleAlertFrame, TargetGoal,
    WalkbackDualStatus, CRITICAL_SLOPE_DEG, DUST_TAU_AMBER, DUST_TAU_RED, LOW_TIU_TRAP_THRESHOLD,
    NLOS_RSSI_THRESHOLD_DBM, O2_RATE_AMBER_L_MIN, O2_RATE_RED_L_MIN, RSSI_AMBER_THRESHOLD_DBM,
    SLOPE_AMBER_DEG, TIU_AMBER_THRESHOLD, SPE_AMBER_RATE_MSV_H, SPE_CRITICAL_RATE_MSV_H, WALKBACK_SAFETY_FACTOR,
    WIND_AMBER_M_S, WIND_RED_M_S,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

// ============================================================================
// Exact Visual AR Path Colors per Section 4 Specification
// ============================================================================

/// Hex color for 0x01_NOMINAL state AR path (Cyan #00F0FF).
pub const COLOR_NOMINAL_HEX: &str = "#00F0FF";

/// Hex color for 0x02_CAUTION state AR path (Amber #FFB000).
pub const COLOR_CAUTION_HEX: &str = "#FFB000";

/// Hex color for 0x03_MULTI_HAZARD state AR path (Pulsing Amber #FFB000).
pub const COLOR_MULTI_HAZARD_HEX: &str = "#FFB000";

/// Hex color for 0x04_EVAC_SHELTER state AR path (Pulsing Red #FF2A2A).
pub const COLOR_EVAC_SHELTER_HEX: &str = "#FF2A2A";

/// Hex color for 0x05_SHELTER_HOLD state AR path (Emerald Green #00E676).
pub const COLOR_SHELTER_HOLD_HEX: &str = "#00E676";

// ============================================================================
// 1. Triple Modular Redundancy (TMR 2-out-of-3) SEU Protection
// ============================================================================

/// Triple Modular Redundancy container with 2-out-of-3 majority voting.
///
/// Designed to protect mission-critical variables (oxygen thresholds, walkback limits,
/// target goals, FSM state) against radiation-induced Single Event Upsets (SEU bit-flips)
/// without requiring garbage-collected or heavyweight runtimes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TmrVoted<T: Copy + PartialEq> {
    pub copies: [T; 3],
}

impl<T: Copy + PartialEq> TmrVoted<T> {
    /// Creates a new TMR triple with all three redundant copies initialized to `val`.
    pub fn new(val: T) -> Self {
        Self {
            copies: [val, val, val],
        }
    }

    /// Sets all three copies to a newly verified value.
    pub fn set(&mut self, val: T) {
        self.copies = [val, val, val];
    }

    /// Reads the majority-voted value using 2-out-of-3 consensus.
    ///
    /// If cosmic ray radiation corrupts a single copy, the remaining two identical
    /// copies maintain valid consensus. If all three copies diverge, an error is returned.
    pub fn read_voted(&self) -> Result<T, &'static str> {
        if self.copies[0] == self.copies[1] || self.copies[0] == self.copies[2] {
            Ok(self.copies[0])
        } else if self.copies[1] == self.copies[2] {
            Ok(self.copies[1])
        } else {
            Err("TMR failure: no 2-of-3 majority agreement")
        }
    }

    /// Simulates a radiation SEU bit-flip / memory corruption in a single copy.
    pub fn inject_seu_fault_copy(&mut self, idx: usize, corrupted: T) {
        if idx < 3 {
            self.copies[idx] = corrupted;
        }
    }

    /// Returns the raw copies array for diagnostics and telemetry streaming.
    pub fn copies(&self) -> [T; 3] {
        self.copies
    }
}

// ============================================================================
// 2. Deterministic Safety Guardrail FSM (100 Hz) & Single-Alert Fusion Triage
// ============================================================================

/// Deterministic 100 Hz Safety Guardrail Finite State Machine.
///
/// Executes on the spacesuit Wearable Edge Node at 100 Hz (< 5 ms latency)
/// to guarantee zero-hallucination life safety.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardrailFsm {
    /// Internal FSM state protected by TMR 2-of-3 voting.
    pub current_state: TmrVoted<SafetyGuardrailState>,
    /// Dynamic Goal Switching state protected by TMR 2-of-3 voting.
    pub dynamic_goal_switched: TmrVoted<bool>,
    /// 100 Hz evaluation cycle counter.
    pub cycle_count: u64,
}

impl Default for GuardrailFsm {
    fn default() -> Self {
        Self::new()
    }
}

impl GuardrailFsm {
    /// Initializes a new deterministic Guardrail FSM in the Nominal state.
    pub fn new() -> Self {
        Self {
            current_state: TmrVoted::new(SafetyGuardrailState::Nominal),
            dynamic_goal_switched: TmrVoted::new(false),
            cycle_count: 0,
        }
    }

    /// Evaluates current terrain, life support, environmental hazards, and walkback metrics at 100 Hz.
    ///
    /// Implements:
    /// 1. State Mapping:
    ///    - `0x01_NOMINAL` (`#00F0FF`)
    ///    - `0x02_CAUTION` (`#FFB000`)
    ///    - `0x03_MULTI_HAZARD` (`#FFB000`)
    ///    - `0x04_EVAC_SHELTER` (`#FF2A2A`)
    ///    - `0x05_SHELTER_HOLD` (`#00E676`)
    /// 2. Single-Alert Fusion Priority Matrix:
    ///    1. Radiation / O2 Depletion
    ///    2. Terrain Trap (critical slope > 20 deg, TIU < 150)
    ///    3. Dust Storm / Wind (tau > 2.0, wind > 20 m/s)
    ///    4. NLOS Radio Shadow (RSSI <= -100 dBm)
    ///    Red/amber thresholds come from P1's `data/mission-scenarios/eva_thresholds.json`
    ///    via `red_atlas_shared`.
    ///    Suppressing redundant popups into a single tactical directive with validated voice slots.
    pub fn evaluate(
        &mut self,
        cell_slope_deg: f32,
        cell_tiu: f32,
        at_shelter: bool,
        hazards: &ActiveHazards,
        telemetry: &PlssTelemetry,
        walkback: &WalkbackDualStatus,
        target_bearing_deg: f32,
        target_dist_m: f32,
    ) -> SingleAlertFrame {
        self.cycle_count = self.cycle_count.wrapping_add(1);

        // Detect discrete hazard flags
        let h1_dust = hazards.h1_dust_storm
            || hazards.dust_tau > DUST_TAU_RED
            || hazards.wind_speed_ms > WIND_RED_M_S;

        let h2_rad_o2 = hazards.h2_spe_radiation
            || hazards.spe_dose_rate_msv_h >= SPE_CRITICAL_RATE_MSV_H
            || telemetry.o2_remaining_liters < 100.0
            || telemetry.current_o2_rate_l_min > O2_RATE_RED_L_MIN;

        let h3_terrain = hazards.h3_regolith_slope
            || cell_slope_deg >= CRITICAL_SLOPE_DEG
            || cell_tiu <= LOW_TIU_TRAP_THRESHOLD;

        let h4_nlos = hazards.h4_nlos_offline
            || hazards.rssi_dbm <= NLOS_RSSI_THRESHOLD_DBM;

        let active_hazard_count =
            (h1_dust as u8) + (h2_rad_o2 as u8) + (h3_terrain as u8) + (h4_nlos as u8);

        // P1 TIU bands: green > 400, amber 150-400 (`TIU_AMBER_THRESHOLD`), red < 150.
        let caution_present = cell_slope_deg >= SLOPE_AMBER_DEG
            || cell_tiu <= TIU_AMBER_THRESHOLD
            || hazards.dust_tau >= DUST_TAU_AMBER
            || hazards.wind_speed_ms >= WIND_AMBER_M_S
            || hazards.spe_dose_rate_msv_h >= SPE_AMBER_RATE_MSV_H
            || hazards.rssi_dbm <= RSSI_AMBER_THRESHOLD_DBM
            || telemetry.current_o2_rate_l_min >= O2_RATE_AMBER_L_MIN
            || (walkback.t_walkback_base_min > walkback.t_vital_min * 0.70);

        // Dynamic Goal Switching condition:
        // Evacuation to shelter is mandated if:
        // - explicitly requested by walkback planner
        // - base is infeasible
        // - base walkback time exceeds 85% vital endurance
        // - critical SPE radiation makes base return impossible within safe dose limits
        let evac_shelter_condition = walkback.dynamic_goal_switched
            || walkback.active_target == TargetGoal::Wp3Shelter
            || !walkback.base_feasible
            || (walkback.t_walkback_base_min > walkback.t_vital_min * WALKBACK_SAFETY_FACTOR)
            || (hazards.h2_spe_radiation
                && hazards.spe_dose_rate_msv_h >= SPE_CRITICAL_RATE_MSV_H
                && walkback.t_walkback_base_min > walkback.t_walkback_shelter_min);

        // Determine FSM State
        let next_state = if at_shelter {
            SafetyGuardrailState::ShelterHold
        } else if evac_shelter_condition {
            SafetyGuardrailState::EvacShelter
        } else if active_hazard_count >= 2 {
            SafetyGuardrailState::MultiHazard
        } else if active_hazard_count == 1 || caution_present {
            SafetyGuardrailState::Caution
        } else {
            SafetyGuardrailState::Nominal
        };

        // Update TMR protected state
        self.current_state.set(next_state);
        if next_state == SafetyGuardrailState::EvacShelter {
            self.dynamic_goal_switched.set(true);
        } else if next_state == SafetyGuardrailState::Nominal {
            self.dynamic_goal_switched.set(false);
        }

        // Single-Alert Fusion Priority Matrix:
        // 1. Radiation / O2 -> 2. Terrain Trap -> 3. Dust / Wind -> 4. NLOS Radio
        let primary_cause = match next_state {
            SafetyGuardrailState::ShelterHold => "SHELTER_HOLD_REACHED".to_string(),
            SafetyGuardrailState::EvacShelter | SafetyGuardrailState::MultiHazard => {
                if h2_rad_o2 {
                    "SPE_RADIATION_CRITICAL".to_string()
                } else if h3_terrain {
                    "REGOLITH_SLOPE_TERRAIN_TRAP".to_string()
                } else if h1_dust {
                    "DUST_STORM_HIGH_WIND".to_string()
                } else if h4_nlos {
                    "NLOS_RADIO_LOSS".to_string()
                } else {
                    "DYNAMIC_GOAL_SWITCH_EVAC".to_string()
                }
            }
            SafetyGuardrailState::Caution => {
                if h2_rad_o2 {
                    "SPE_RADIATION_ELEVATED".to_string()
                } else if h3_terrain {
                    "REGOLITH_SLOPE_WARNING".to_string()
                } else if h1_dust {
                    "DUST_WIND_ELEVATED".to_string()
                } else if h4_nlos {
                    "NLOS_OFFLINE".to_string()
                } else {
                    "CAUTION_MARGIN_AMBER".to_string()
                }
            }
            SafetyGuardrailState::Nominal => "NOMINAL".to_string(),
        };

        // Determine AR Path Color Hex
        let ar_path_color_hex = match next_state {
            SafetyGuardrailState::Nominal => COLOR_NOMINAL_HEX.to_string(),
            SafetyGuardrailState::Caution => COLOR_CAUTION_HEX.to_string(),
            SafetyGuardrailState::MultiHazard => COLOR_MULTI_HAZARD_HEX.to_string(),
            SafetyGuardrailState::EvacShelter => COLOR_EVAC_SHELTER_HEX.to_string(),
            SafetyGuardrailState::ShelterHold => COLOR_SHELTER_HOLD_HEX.to_string(),
        };

        // Compute Target Distance & ETA
        let (target_eta_min, final_target_distance_m) = match next_state {
            SafetyGuardrailState::ShelterHold => (0.0, 0.0),
            SafetyGuardrailState::EvacShelter => (walkback.t_walkback_shelter_min, target_dist_m),
            _ => (walkback.t_walkback_base_min, target_dist_m),
        };

        // Pack validated voice summary slots
        let mut voice_slots = Vec::with_capacity(7);
        match next_state {
            SafetyGuardrailState::ShelterHold => {
                voice_slots.push("EVENT:SHELTER_HOLD".to_string());
                voice_slots.push("TERRAIN:CLIFF_OVERHANG_SHIELD".to_string());
                voice_slots.push("DEST:WP3_CLIFF_SHELTER".to_string());
                voice_slots.push("BEARING:0_DEG".to_string());
                voice_slots.push("DIST:0_M".to_string());
                voice_slots.push("ETA:0_MIN".to_string());
                voice_slots.push("RADIO:ZENOH_STANDBY".to_string());
            }
            SafetyGuardrailState::EvacShelter => {
                let event_slot = if h2_rad_o2 && h1_dust {
                    "EVENT:SPE_Y_TORMENTA"
                } else if h2_rad_o2 {
                    "EVENT:SPE_SOLAR_ALERT"
                } else {
                    "EVENT:EMERGENCY_EVAC"
                };
                let terrain_slot = if h3_terrain {
                    "TERRAIN:SALIR_ARENA_IZQUIERDA"
                } else {
                    "TERRAIN:FOLLOW_PATH"
                };
                let radio_slot = if h4_nlos {
                    "RADIO:OFFLINE_AUTONOMO"
                } else {
                    "RADIO:ONLINE"
                };

                voice_slots.push(event_slot.to_string());
                voice_slots.push(terrain_slot.to_string());
                voice_slots.push("DEST:REFUGIO_WP3".to_string());
                voice_slots.push(format!("BEARING:{:.0}_GRADOS", target_bearing_deg));
                voice_slots.push(format!("DISTANCIA_M:{:.0}", target_dist_m));
                voice_slots.push(format!("TIEMPO_MIN:{:.0}", walkback.t_walkback_shelter_min));
                voice_slots.push(radio_slot.to_string());
            }
            SafetyGuardrailState::MultiHazard => {
                voice_slots.push("EVENT:MULTI_HAZARD".to_string());
                voice_slots.push(format!("PRIMARY_CAUSE:{}", primary_cause));
                voice_slots.push("DEST:BASE_HABITAT".to_string());
                voice_slots.push(format!("BEARING:{:.0}_DEG", target_bearing_deg));
                voice_slots.push(format!("DISTANCIA_M:{:.0}", target_dist_m));
                voice_slots.push(format!("TIEMPO_MIN:{:.0}", target_eta_min));
                voice_slots.push(if h4_nlos {
                    "RADIO:OFFLINE_AUTONOMO".to_string()
                } else {
                    "RADIO:ONLINE".to_string()
                });
            }
            SafetyGuardrailState::Caution => {
                voice_slots.push("EVENT:CAUTION".to_string());
                voice_slots.push(format!("PRIMARY_CAUSE:{}", primary_cause));
                voice_slots.push("DEST:TARGET_WAYPOINT".to_string());
                voice_slots.push(format!("BEARING:{:.0}_DEG", target_bearing_deg));
                voice_slots.push(format!("DISTANCIA_M:{:.0}", target_dist_m));
                voice_slots.push(format!("TIEMPO_MIN:{:.0}", target_eta_min));
                voice_slots.push(if h4_nlos {
                    "RADIO:OFFLINE_AUTONOMO".to_string()
                } else {
                    "RADIO:ONLINE".to_string()
                });
            }
            SafetyGuardrailState::Nominal => {
                voice_slots.push("EVENT:NOMINAL".to_string());
                voice_slots.push("TERRAIN:STABLE".to_string());
                voice_slots.push("DEST:NOMINAL_TRAVERSE".to_string());
                voice_slots.push(format!("BEARING:{:.0}_DEG", target_bearing_deg));
                voice_slots.push(format!("DISTANCIA_M:{:.0}", target_dist_m));
                voice_slots.push(format!("TIEMPO_MIN:{:.0}", target_eta_min));
                voice_slots.push(if h4_nlos {
                    "RADIO:OFFLINE_AUTONOMO".to_string()
                } else {
                    "RADIO:ONLINE".to_string()
                });
            }
        }

        SingleAlertFrame {
            state: next_state,
            ar_path_color_hex,
            primary_cause,
            target_bearing_deg,
            target_distance_m: final_target_distance_m,
            target_eta_min,
            nlos_autonomous: h4_nlos,
            voice_summary_slots: voice_slots,
        }
    }
}

// ============================================================================
// 3. Offline Edge SLM Voice Slot Synthesizer (Quantized Candle SLM Mock)
// ============================================================================

/// Trait defining the offline edge SLM voice synthesis and geology QA backend.
pub trait EdgeSlmVoiceBackend {
    /// Synthesizes a deterministic slot-based tactical voice alert (duration <= 8 s, <= 25 words).
    fn synthesize_tactical_alert(&self, frame: &SingleAlertFrame) -> String;

    /// Answers scientific geology queries deterministically from preloaded CRISM / THEMIS layers.
    fn answer_geology_query(&self, query: &str, h2o_pct: f32, tiu: f32) -> String;
}

/// Quantized offline Candle SLM mock adhering strictly to the Zero-Hallucination Guarantee.
///
/// Under emergency and caution states, the LLM free-generation loop is bypassed:
/// verbal speech is synthesized deterministically from slot values provided directly
/// by the Rust Safety Guardrail FSM.
#[derive(Debug, Clone, Copy, Default)]
pub struct QuantizedCandleSlmMock;

impl EdgeSlmVoiceBackend for QuantizedCandleSlmMock {
    fn synthesize_tactical_alert(&self, frame: &SingleAlertFrame) -> String {
        let bearing = frame.target_bearing_deg.round() as i32;
        let dist = frame.target_distance_m.round() as i32;
        let eta = frame.target_eta_min.round() as i32;
        let radio_clause = if frame.nlos_autonomous {
            "Autonomous link active."
        } else {
            "Base link active."
        };

        match frame.state {
            SafetyGuardrailState::EvacShelter => {
                // Tactical voice alert for critical evacuation (strictly <= 25 words, duration <= 8 seconds)
                if frame.primary_cause.contains("SPE") || frame.primary_cause.contains("RADIATION")
                {
                    format!(
                        "Solar alert and storm. {} Exit loose slope to firm rock; follow bearing {} to cliff shelter, {} meters, {} minutes.",
                        radio_clause, bearing, dist, eta
                    )
                } else {
                    format!(
                        "Emergency shelter evacuation. {} Exit slope to firm rock; follow bearing {} to cliff shelter, {} meters, {} minutes.",
                        radio_clause, bearing, dist, eta
                    )
                }
            }
            SafetyGuardrailState::ShelterHold => {
                "Shelter hold confirmed. Topographic radiation shielding active. PLSS power reduced to standby."
                    .to_string()
            }
            SafetyGuardrailState::MultiHazard => {
                format!(
                    "Multi-hazard alert. {} Maintain path bearing {} toward Base, {} meters, {} minutes.",
                    radio_clause, bearing, dist, eta
                )
            }
            SafetyGuardrailState::Caution => {
                format!(
                    "Caution advisory: {}. {} Proceed along marked path bearing {}, {} meters.",
                    frame.primary_cause, radio_clause, bearing, dist
                )
            }
            SafetyGuardrailState::Nominal => {
                "All systems nominal. Base telemetry link stable. Oxygen and vital margins green."
                    .to_string()
            }
        }
    }

    fn answer_geology_query(&self, query: &str, h2o_pct: f32, tiu: f32) -> String {
        let q = query.to_lowercase();
        if q.contains("water") || q.contains("h2o") || q.contains("isru") || q.contains("hydrate")
        {
            format!(
                "CRISM spectral analysis confirms {:.1}% H2O hydration in polyhydrated sulfates; thermal inertia is {:.0} TIU.",
                h2o_pct, tiu
            )
        } else if q.contains("tiu")
            || q.contains("thermal")
            || q.contains("regolith")
            || q.contains("soil")
            || q.contains("sand")
        {
            let soil_type = if tiu < 150.0 {
                "fine unconsolidated"
            } else if tiu < 250.0 {
                "moderately cohesive"
            } else {
                "dense basaltic"
            };
            format!(
                "Thermal inertia is {:.0} TIU indicating {} regolith; hydration level is {:.1}% H2O.",
                tiu, soil_type, h2o_pct
            )
        } else {
            format!(
                "Spectrometry reading: {:.1}% H2O hydration, thermal inertia {:.0} TIU. Strata consistent with Melas Chasma canyon formations.",
                h2o_pct, tiu
            )
        }
    }
}

// ============================================================================
// 4. Eclipse Zenoh CRDT Ring-Buffer (Autonomous NLOS Store & Forward)
// ============================================================================

/// Record of a geological field sample or spectrometry observation collected during EVA.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScienceSample {
    pub timestamp_s: f64,
    pub sample_id: String,
    pub h2o_pct: f32,
    pub tiu: f32,
    pub notes: String,
}

/// Bounded offline ring-buffer storing PLSS telemetry and science samples during `AUTONOMOUS_NLOS`.
///
/// When UHF radio contact is lost behind Melas Chasma canyon spurs, telemetry frames
/// and science observations are captured in bounded memory (dropping oldest items if full).
/// Upon radio reconnection, `drain_replay()` flushes the buffered data for transmission to Base.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZenohCrdtRingBuffer {
    capacity: usize,
    telemetry_buffer: VecDeque<PlssTelemetry>,
    science_buffer: VecDeque<ScienceSample>,
    nlos_active: bool,
}

impl Default for ZenohCrdtRingBuffer {
    fn default() -> Self {
        Self::with_default_capacity()
    }
}

impl ZenohCrdtRingBuffer {
    /// Creates a new bounded ring buffer with the specified capacity per stream.
    pub fn new(capacity: usize) -> Self {
        let cap = capacity.max(1);
        Self {
            capacity: cap,
            telemetry_buffer: VecDeque::with_capacity(cap),
            science_buffer: VecDeque::with_capacity(cap),
            nlos_active: false,
        }
    }

    /// Creates a ring buffer with default capacity (1024 frames).
    pub fn with_default_capacity() -> Self {
        Self::new(1024)
    }

    /// Sets whether the suit is currently in NLOS autonomous disconnected mode.
    pub fn set_nlos_mode(&mut self, active: bool) {
        self.nlos_active = active;
    }

    /// Returns whether NLOS autonomous mode is active.
    pub fn is_nlos_active(&self) -> bool {
        self.nlos_active
    }

    /// Records a PLSS telemetry frame into the bounded ring-buffer.
    pub fn push_telemetry(&mut self, telem: PlssTelemetry) {
        if self.telemetry_buffer.len() >= self.capacity {
            self.telemetry_buffer.pop_front();
        }
        self.telemetry_buffer.push_back(telem);
    }

    /// Alias for recording telemetry.
    pub fn record_telemetry(&mut self, telem: PlssTelemetry) {
        self.push_telemetry(telem);
    }

    /// Records a science field observation into the bounded ring-buffer.
    pub fn push_science_sample(&mut self, sample: ScienceSample) {
        if self.science_buffer.len() >= self.capacity {
            self.science_buffer.pop_front();
        }
        self.science_buffer.push_back(sample);
    }

    /// Alias for recording science sample.
    pub fn record_science(&mut self, sample: ScienceSample) {
        self.push_science_sample(sample);
    }

    /// Drains all buffered PLSS telemetry frames in FIFO order for replay upon UHF link recovery.
    pub fn drain_replay(&mut self) -> Vec<PlssTelemetry> {
        self.telemetry_buffer.drain(..).collect()
    }

    /// Drains all buffered science observations in FIFO order for replay upon UHF link recovery.
    pub fn drain_science_replay(&mut self) -> Vec<ScienceSample> {
        self.science_buffer.drain(..).collect()
    }

    /// Returns the number of buffered telemetry frames.
    pub fn len(&self) -> usize {
        self.telemetry_buffer.len()
    }

    /// Returns true if both telemetry and science buffers are empty.
    pub fn is_empty(&self) -> bool {
        self.telemetry_buffer.is_empty() && self.science_buffer.is_empty()
    }

    /// Returns the number of buffered science samples.
    pub fn science_len(&self) -> usize {
        self.science_buffer.len()
    }

    /// Returns maximum capacity per stream.
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

// ============================================================================
// 5. Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tmr_2_of_3_seu_recovery() {
        // Test TMR with TargetGoal enum
        let mut tmr = TmrVoted::new(TargetGoal::BaseHabitat);
        assert_eq!(tmr.read_voted(), Ok(TargetGoal::BaseHabitat));

        // Inject simulated radiation SEU bit-flip on copy 0
        tmr.inject_seu_fault_copy(0, TargetGoal::Wp2Fault);
        assert_eq!(
            tmr.read_voted(),
            Ok(TargetGoal::BaseHabitat),
            "Majority voting must recover correct TargetGoal when copy 0 is corrupted"
        );

        // Reset and inject fault on copy 1
        let mut tmr2 = TmrVoted::new(TargetGoal::Wp3Shelter);
        tmr2.inject_seu_fault_copy(1, TargetGoal::BaseHabitat);
        assert_eq!(
            tmr2.read_voted(),
            Ok(TargetGoal::Wp3Shelter),
            "Majority voting must recover correct TargetGoal when copy 1 is corrupted"
        );

        // Reset and inject fault on copy 2
        let mut tmr3 = TmrVoted::new(SafetyGuardrailState::EvacShelter);
        tmr3.inject_seu_fault_copy(2, SafetyGuardrailState::Nominal);
        assert_eq!(
            tmr3.read_voted(),
            Ok(SafetyGuardrailState::EvacShelter),
            "Majority voting must recover correct state when copy 2 is corrupted"
        );

        // Corrupt two distinct copies: consensus must fail
        tmr.inject_seu_fault_copy(1, TargetGoal::Wp1Isru);
        assert!(
            tmr.read_voted().is_err(),
            "Consensus must fail when no two copies agree"
        );
    }

    #[test]
    fn test_t105_min_4hazard_single_alert_fusion() {
        let mut fsm = GuardrailFsm::new();
        let slm = QuantizedCandleSlmMock;

        // Conditions at T+105 min near WP2:
        // 1. Dust storm tau=2.4, wind=28 m/s
        // 2. SPE radiation flux=8 mSv/h (P1 envelope peak)
        // 3. Regolith slope=22 deg, TIU=110
        // 4. NLOS radio shadow, RSSI = -125 dBm
        let hazards = ActiveHazards {
            h1_dust_storm: true,
            h2_spe_radiation: true,
            h3_regolith_slope: true,
            h4_nlos_offline: true,
            dust_tau: red_atlas_shared::DUST_TAU_STORM,
            wind_speed_ms: 28.0,
            spe_dose_rate_msv_h: red_atlas_shared::SPE_PEAK_ENVELOPE_MSV_H,
            rssi_dbm: -125.0,
        };

        let telemetry = PlssTelemetry {
            timestamp_s: 6300.0, // T+105 min
            o2_remaining_liters: 72.0,
            lcvg_water_remaining_min: 150.0,
            battery_remaining_min: 180.0,
            current_o2_rate_l_min: 3.2,
            cumulative_rad_msv: 0.0,
            mission_rad_limit_msv: red_atlas_shared::EVA_SPE_DOSE_BUDGET_MSV,
            heart_rate_bpm: 135,
        };

        // Base is 48 min away, while WP3 Shelter is 8 min away (leg L3: 600 m, bearing 344)
        let walkback = WalkbackDualStatus {
            t_vital_min: 75.0,
            t_walkback_base_min: 48.0,
            t_walkback_shelter_min: 8.0,
            active_target: TargetGoal::Wp3Shelter,
            dynamic_goal_switched: true,
            base_feasible: false,
        };

        let frame = fsm.evaluate(
            22.0,  // cell_slope_deg
            110.0, // cell_tiu
            false, // at_shelter
            &hazards,
            &telemetry,
            &walkback,
            red_atlas_shared::SURVIVAL_TRIANGLE_LEGS[red_atlas_shared::ESCAPE_LEG_WP2_WP3].bearing_deg,
            red_atlas_shared::SURVIVAL_TRIANGLE_LEGS[red_atlas_shared::ESCAPE_LEG_WP2_WP3].distance_m as f32,
        );

        // Verification 1: State must be EvacShelter
        assert_eq!(
            frame.state,
            SafetyGuardrailState::EvacShelter,
            "Guardrail must switch to EvacShelter"
        );

        // Verification 2: Path color must be pulsing red #FF2A2A
        assert_eq!(
            frame.ar_path_color_hex, COLOR_EVAC_SHELTER_HEX,
            "AR path color must be #FF2A2A"
        );

        // Verification 3: Primary cause selected by Priority Matrix (Radiation/O2 over slope/dust/nlos)
        assert_eq!(
            frame.primary_cause, "SPE_RADIATION_CRITICAL",
            "Single-Alert Fusion must prioritize life-critical SPE radiation"
        );

        // Verification 4: NLOS autonomous mode active
        assert!(
            frame.nlos_autonomous,
            "NLOS autonomous mode must be flagged"
        );

        // Verification 5: Synthesize tactical voice alert
        let voice_alert = slm.synthesize_tactical_alert(&frame);
        let word_count = voice_alert.split_whitespace().count();

        assert!(
            word_count <= 25,
            "Voice alert must be <= 25 words (spoken duration <= 8s), got {} words: '{}'",
            word_count,
            voice_alert
        );

        // Ensure key numerical navigation guidance is present without hallucination
        assert!(voice_alert.contains("344"));
        assert!(voice_alert.contains("600"));
        assert!(voice_alert.contains("8"));
    }

    #[test]
    fn test_shelter_hold_at_wp3() {
        let mut fsm = GuardrailFsm::new();
        let slm = QuantizedCandleSlmMock;

        let hazards = ActiveHazards {
            h1_dust_storm: true,
            h2_spe_radiation: true,
            h3_regolith_slope: false,
            h4_nlos_offline: true,
            dust_tau: 2.1,
            wind_speed_ms: 22.0,
            spe_dose_rate_msv_h: red_atlas_shared::SPE_PEAK_ENVELOPE_MSV_H,
            rssi_dbm: -128.0,
        };

        let telemetry = PlssTelemetry::default();
        let walkback = WalkbackDualStatus {
            t_vital_min: 70.0,
            t_walkback_base_min: 52.0,
            t_walkback_shelter_min: 0.0,
            active_target: TargetGoal::Wp3Shelter,
            dynamic_goal_switched: true,
            base_feasible: false,
        };

        // Astronaut arrives within 15 m radius of WP3 Cliff Shelter (at_shelter = true)
        let frame = fsm.evaluate(
            6.0,   // cell_slope_deg
            320.0, // cell_tiu
            true,  // at_shelter
            &hazards,
            &telemetry,
            &walkback,
            0.0,
            0.0,
        );

        assert_eq!(
            frame.state,
            SafetyGuardrailState::ShelterHold,
            "Guardrail must enter ShelterHold upon reaching WP3 shelter"
        );
        assert_eq!(
            frame.ar_path_color_hex, COLOR_SHELTER_HOLD_HEX,
            "AR path color must be #00E676 (emerald green)"
        );

        let voice = slm.synthesize_tactical_alert(&frame);
        let word_count = voice.split_whitespace().count();
        assert!(word_count <= 25);
        assert!(voice.contains("Shelter hold confirmed"));
    }

    #[test]
    fn test_zenoh_nlos_ring_buffer_capture_and_replay() {
        let mut buffer = ZenohCrdtRingBuffer::new(4);
        assert!(buffer.is_empty());

        buffer.set_nlos_mode(true);
        assert!(buffer.is_nlos_active());

        // Push 4 telemetry frames
        for i in 1..=4 {
            let mut t = PlssTelemetry::default();
            t.timestamp_s = i as f64 * 10.0;
            buffer.push_telemetry(t);
        }
        assert_eq!(buffer.len(), 4);

        // Push 5th telemetry frame: buffer is bounded, must evict oldest (timestamp 10.0)
        let mut t5 = PlssTelemetry::default();
        t5.timestamp_s = 50.0;
        buffer.push_telemetry(t5);
        assert_eq!(buffer.len(), 4);

        // Push science sample
        buffer.push_science_sample(ScienceSample {
            timestamp_s: 35.0,
            sample_id: "WP1-ROCK-01".to_string(),
            h2o_pct: 12.4,
            tiu: 390.0,
            notes: "Polyhydrated smectite clay".to_string(),
        });
        assert_eq!(buffer.science_len(), 1);

        // UHF Radio recovery -> drain replay
        let replayed_telemetry = buffer.drain_replay();
        assert_eq!(replayed_telemetry.len(), 4);
        assert_eq!(replayed_telemetry[0].timestamp_s, 20.0);
        assert_eq!(replayed_telemetry[3].timestamp_s, 50.0);
        assert_eq!(buffer.len(), 0);

        let replayed_science = buffer.drain_science_replay();
        assert_eq!(replayed_science.len(), 1);
        assert_eq!(replayed_science[0].sample_id, "WP1-ROCK-01");
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_geology_qa_zero_hallucination() {
        let slm = QuantizedCandleSlmMock;

        // Query water content
        let ans_water = slm.answer_geology_query("What is the water hydration percentage?", 12.8, 380.0);
        assert!(ans_water.contains("12.8% H2O"));
        assert!(ans_water.contains("380 TIU"));

        // Query thermal inertia
        let ans_tiu = slm.answer_geology_query("What is the soil thermal inertia?", 2.1, 110.0);
        assert!(ans_tiu.contains("110 TIU"));
        assert!(ans_tiu.contains("fine unconsolidated"));
    }

    #[test]
    fn test_nominal_and_caution_fsm_evaluations() {
        let mut fsm = GuardrailFsm::new();

        let hazards_nominal = ActiveHazards::default();
        let telemetry_nominal = PlssTelemetry::default();
        let walkback_nominal = WalkbackDualStatus::default();

        // Nominal evaluation (WP1 ground: 410 TIU is green, P1 amber starts at <= 400 TIU)
        let frame_nominal = fsm.evaluate(
            5.0,
            red_atlas_shared::SURVIVAL_TRIANGLE_SITE[1].thermal_inertia_tiu,
            false,
            &hazards_nominal,
            &telemetry_nominal,
            &walkback_nominal,
            180.0,
            1200.0,
        );
        assert_eq!(frame_nominal.state, SafetyGuardrailState::Nominal);
        assert_eq!(frame_nominal.ar_path_color_hex, COLOR_NOMINAL_HEX);

        // Caution evaluation (1 hazard: steep slope 17 deg in amber range)
        let frame_caution = fsm.evaluate(
            17.0,
            250.0,
            false,
            &hazards_nominal,
            &telemetry_nominal,
            &walkback_nominal,
            180.0,
            1200.0,
        );
        assert_eq!(frame_caution.state, SafetyGuardrailState::Caution);
        assert_eq!(frame_caution.ar_path_color_hex, COLOR_CAUTION_HEX);
    }
}
