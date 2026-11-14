//! Canyon-TRN: GPS-Denied & Radio-Denied Autonomous Positioning Engine for Melas Chasma.
//!
//! Implements a 15-DOF Error-State Extended Kalman Filter (ESKF) in pure Rust
//! (zero external linear algebra crates, zero-allocation hot loop, zero-panic flight path)
//! fusing:
//! - 400 Hz Tactical IMU (`ImuSample`) with Mars gravity compensation (`MARS_GRAVITY`)
//! - 60 Hz Stereo Visual-Inertial Odometry (`VioDelta`)
//! - 20 Hz Short-Range LiDAR ICP Scan Matching (`LidarScanMatch`)
//! - 2 Hz Wide-Angle Skyline Matching (`SkylineObservation`) against 7 km Melas Chasma canyon rims

use std::f64::consts::PI;

use red_atlas_shared::MARS_GRAVITY;

/// Number of 5-degree azimuth bins covering the full 360-degree horizon.
pub const HORIZON_BINS: usize = 72;

/// Precomputed synthetic horizon signature for a Melas Chasma coordinate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SyntheticHorizon {
    pub horizon_hash_id: u32,
    pub pos_x_m: f64,
    pub pos_y_m: f64,
    pub pos_z_m: f64,
    pub elevations_rad: [f32; HORIZON_BINS],
}

/// 400 Hz IMU measurement sample in body frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImuSample {
    pub dt_s: f64,
    pub accel_mps2: [f64; 3],
    pub gyro_rads: [f64; 3],
}

/// 60 Hz stereo VIO incremental displacement and velocity observation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VioDelta {
    pub delta_pos_m: [f64; 3],
    pub vel_mps: [f64; 3],
    pub sigma_pos_m: f64,
}

/// 20 Hz LiDAR ICP scan-match incremental displacement and local terrain slope.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LidarScanMatch {
    pub delta_pos_m: [f64; 3],
    pub local_slope_deg: f32,
    pub sigma_m: f64,
}

/// 2 Hz skyline contour observation extracted from the upward wide-angle helmet camera.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SkylineObservation {
    pub observed_elevations_rad: [f32; HORIZON_BINS],
    pub dust_tau: f32,
}

/// Current navigation pose and uncertainty output by Canyon-TRN.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrnPoseEstimate {
    pub pos_m: [f64; 3],
    pub vel_mps: [f64; 3],
    pub quat_wxyz: [f64; 4],
    pub horizontal_uncertainty_1sigma_m: f64,
    pub skyline_matched_id: Option<u32>,
    pub ncc_score: f64,
}

type Mat3 = [[f64; 3]; 3];
type Mat15 = [[f64; 15]; 15];

/// 15-DOF Error-State Extended Kalman Filter for Canyon-TRN.
///
/// Error-state vector ordering (15 elements):
/// - `0..3`: position error `dp` (m)
/// - `3..6`: velocity error `dv` (m/s)
/// - `6..9`: attitude error `dtheta` (rad, body-frame small-angle rotation)
/// - `9..12`: accelerometer bias error `dba` (m/s^2)
/// - `12..15`: gyroscope bias error `dbg` (rad/s)
#[derive(Debug, Clone)]
pub struct CanyonTrnEkf {
    pos: [f64; 3],
    vel: [f64; 3],
    quat: [f64; 4],
    ba: [f64; 3],
    bg: [f64; 3],
    cov: Mat15,
    horizon_db: Vec<SyntheticHorizon>,
    vio_anchor_pos: [f64; 3],
    lidar_anchor_pos: [f64; 3],
    imu_steps_since_vio: u32,
    steps_since_lidar: u32,
    has_vio_vel_init: bool,
    imu_step_var_vio: f64,
    pred_step_var_lidar: f64,
    last_skyline_id: Option<u32>,
    last_ncc_score: f64,
}

impl CanyonTrnEkf {
    /// Creates a new 15-DOF Canyon-TRN ESKF initialized at `initial_pos_m` with a preloaded
    /// Melas Chasma synthetic horizon database.
    pub fn new(initial_pos_m: [f64; 3], horizon_db: Vec<SyntheticHorizon>) -> Self {
        let mut cov = [[0.0_f64; 15]; 15];
        for i in 0..3 {
            cov[i][i] = 0.25; // 0.5 m initial 1-sigma per axis
            cov[3 + i][3 + i] = 0.04; // 0.2 m/s velocity 1-sigma
            cov[6 + i][6 + i] = 0.0025; // ~2.9 deg attitude 1-sigma
            cov[9 + i][9 + i] = 0.01; // 0.1 m/s^2 accel bias 1-sigma
            cov[12 + i][12 + i] = 1.0e-4; // 0.01 rad/s gyro bias 1-sigma
        }

        Self {
            pos: initial_pos_m,
            vel: [0.0; 3],
            quat: [1.0, 0.0, 0.0, 0.0],
            ba: [0.0; 3],
            bg: [0.0; 3],
            cov,
            horizon_db,
            vio_anchor_pos: initial_pos_m,
            lidar_anchor_pos: initial_pos_m,
            imu_steps_since_vio: 0,
            steps_since_lidar: 0,
            has_vio_vel_init: false,
            imu_step_var_vio: 0.0,
            pred_step_var_lidar: 0.0,
            last_skyline_id: None,
            last_ncc_score: 0.0,
        }
    }

    /// Propagates nominal kinematics and 15x15 error-state covariance using a 400 Hz IMU sample,
    /// compensating for Mars gravity (`red_atlas_shared::MARS_GRAVITY`) along local `-Z`.
    pub fn predict_imu(&mut self, imu: &ImuSample) {
        let dt = imu.dt_s;
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }
        if !vec3_is_finite(imu.accel_mps2) || !vec3_is_finite(imu.gyro_rads) {
            return;
        }

        let g_mars = MARS_GRAVITY as f64;
        let g_world = [0.0, 0.0, -g_mars];

        let accel = vec3_sub(imu.accel_mps2, self.ba);
        let omega = vec3_sub(imu.gyro_rads, self.bg);

        let r_old = quat_to_mat3(self.quat);
        let dq = quat_from_rotvec(vec3_scale(omega, dt));
        let q_new = quat_normalize(quat_mul(self.quat, dq));
        let r_new = quat_to_mat3(q_new);

        let a_world_old = vec3_add(mat3_mul_vec3(r_old, accel), g_world);
        let a_world_new = vec3_add(mat3_mul_vec3(r_new, accel), g_world);
        let a_world_mid = vec3_scale(vec3_add(a_world_old, a_world_new), 0.5);

        let vel_old = self.vel;
        self.pos = vec3_add(
            self.pos,
            vec3_add(
                vec3_scale(vel_old, dt),
                vec3_scale(a_world_mid, 0.5 * dt * dt),
            ),
        );
        self.vel = vec3_add(vel_old, vec3_scale(a_world_mid, dt));
        self.quat = q_new;

        // Error-state transition matrix F (15x15).
        let mut f = mat15_identity();
        let neg_r_skew_a = mat3_scale(mat3_mul(r_old, skew_symmetric(accel)), -dt);
        let neg_r_dt = mat3_scale(r_old, -dt);
        let att_block = mat3_sub(mat3_identity(), mat3_scale(skew_symmetric(omega), dt));

        for r in 0..3 {
            f[r][3 + r] = dt;
            for c in 0..3 {
                f[3 + r][6 + c] = neg_r_skew_a[r][c];
                f[3 + r][9 + c] = neg_r_dt[r][c];
                f[6 + r][6 + c] = att_block[r][c];
            }
            f[6 + r][12 + r] = -dt;
        }

        // Propagate P = F * P * F^T + Q.
        let fp = mat15_mul(&f, &self.cov);
        let mut p_next = mat15_mul_trans_b(&fp, &f);

        // Tactical IMU process noise densities scaled by dt.
        let q_pos = (1.0e-3_f64).powi(2) * dt;
        let q_vel = (0.08_f64).powi(2) * dt;
        let q_att = (0.005_f64).powi(2) * dt;
        let q_ba = (0.002_f64).powi(2) * dt;
        let q_bg = (2.0e-4_f64).powi(2) * dt;

        for i in 0..3 {
            p_next[i][i] += q_pos;
            p_next[3 + i][3 + i] += q_vel;
            p_next[6 + i][6 + i] += q_att;
            p_next[9 + i][9 + i] += q_ba;
            p_next[12 + i][12 + i] += q_bg;
        }

        mat15_symmetrize_and_floor(&mut p_next);
        self.cov = p_next;

        self.imu_steps_since_vio = self.imu_steps_since_vio.saturating_add(1);
        self.steps_since_lidar = self.steps_since_lidar.saturating_add(1);
        let step_v_var = (self.cov[3][3] + self.cov[4][4]) * 0.5 * dt * dt + q_pos;
        self.imu_step_var_vio += step_v_var;
        self.pred_step_var_lidar += step_v_var;
    }

    /// Applies a 60 Hz stereo VIO incremental displacement and velocity measurement.
    ///
    /// Velocity is fused directly via the 15x15 ESKF update; incremental displacement is fused
    /// against IMU propagation since the last VIO step while accumulating realistic dead-reckoning
    /// position drift variance (since relative odometry cannot observe global position).
    pub fn update_vio(&mut self, vio: &VioDelta) {
        if !vec3_is_finite(vio.delta_pos_m)
            || !vec3_is_finite(vio.vel_mps)
            || !vio.sigma_pos_m.is_finite()
        {
            return;
        }

        let sigma_pos = vio.sigma_pos_m.max(1.0e-4);
        let var_vio = sigma_pos * sigma_pos;

        // 1. Fuse relative position delta with IMU step prediction.
        if self.imu_steps_since_vio == 0 || !self.has_vio_vel_init {
            self.pos = vec3_add(self.vio_anchor_pos, vio.delta_pos_m);
        } else {
            let dp_imu = vec3_sub(self.pos, self.vio_anchor_pos);
            let var_imu = self.imu_step_var_vio.max(var_vio);
            let w_vio = var_imu / (var_imu + var_vio);
            let corr = vec3_scale(vec3_sub(vio.delta_pos_m, dp_imu), w_vio);
            self.pos = vec3_add(self.pos, corr);
        }
        self.vio_anchor_pos = self.pos;
        self.imu_steps_since_vio = 0;
        self.imu_step_var_vio = 0.0;
        self.steps_since_lidar = self.steps_since_lidar.saturating_add(1);
        self.pred_step_var_lidar += var_vio;

        // Relative odometry contributes random-walk position variance to global uncertainty.
        for i in 0..3 {
            self.cov[i][i] += var_vio;
        }

        // 2. Absolute velocity measurement update in ESKF (state indices 3..6).
        let sigma_vel = (sigma_pos * 4.0).clamp(0.03, 0.75);
        let r_vel = [
            [sigma_vel * sigma_vel, 0.0, 0.0],
            [0.0, sigma_vel * sigma_vel, 0.0],
            [0.0, 0.0, sigma_vel * sigma_vel],
        ];
        let vel_innov = vec3_sub(vio.vel_mps, self.vel);
        self.apply_block3_update(3, vel_innov, r_vel);
        self.has_vio_vel_init = true;
    }

    /// Applies a 20 Hz LiDAR ICP scan-match incremental displacement and local slope reading.
    pub fn update_lidar(&mut self, lidar: &LidarScanMatch) {
        if !vec3_is_finite(lidar.delta_pos_m)
            || !lidar.sigma_m.is_finite()
            || !lidar.local_slope_deg.is_finite()
        {
            return;
        }

        let slope_factor = if lidar.local_slope_deg > 20.0 {
            1.5
        } else {
            1.0
        };
        let sigma_lidar = lidar.sigma_m.max(1.0e-4) * slope_factor;
        let var_lidar = sigma_lidar * sigma_lidar;

        let corr = if self.steps_since_lidar == 0 {
            let target_pos = vec3_add(self.lidar_anchor_pos, lidar.delta_pos_m);
            let c = vec3_sub(target_pos, self.pos);
            self.pos = target_pos;
            c
        } else {
            let dp_pred = vec3_sub(self.pos, self.lidar_anchor_pos);
            let var_pred = self.pred_step_var_lidar.max(var_lidar);
            let w_lidar = var_pred / (var_pred + var_lidar);
            let c = vec3_scale(vec3_sub(lidar.delta_pos_m, dp_pred), w_lidar);
            self.pos = vec3_add(self.pos, c);
            c
        };

        self.lidar_anchor_pos = self.pos;
        self.vio_anchor_pos = vec3_add(self.vio_anchor_pos, corr);
        self.steps_since_lidar = 0;
        self.pred_step_var_lidar = 0.0;

        // Add bounded scan-match step drift variance.
        for i in 0..3 {
            self.cov[i][i] += 0.25 * var_lidar;
        }
    }

    /// Matches an observed 72-bin skyline profile against synthetic horizons within
    /// `search_radius_m` (2D horizontal radius around current EKF estimate).
    ///
    /// Uses Normalized Cross-Correlation (NCC) combined with z-normalized 1D angular Chamfer
    /// similarity, making the match invariant to contrast reduction and offset shifts caused
    /// by Martian dust opacity (`dust_tau`).
    pub fn match_skyline(
        &self,
        obs: &SkylineObservation,
        search_radius_m: f64,
    ) -> Option<(u32, [f64; 3], f64)> {
        if self.horizon_db.is_empty() || !search_radius_m.is_finite() || search_radius_m <= 0.0 {
            return None;
        }

        let obs_norm = z_normalize_horizon(&obs.observed_elevations_rad)?;
        let radius_sq = search_radius_m * search_radius_m;

        let mut best_match: Option<(u32, [f64; 3], f64)> = None;

        for cand in &self.horizon_db {
            let dx = cand.pos_x_m - self.pos[0];
            let dy = cand.pos_y_m - self.pos[1];
            if dx * dx + dy * dy > radius_sq {
                continue;
            }

            let Some(cand_norm) = z_normalize_horizon(&cand.elevations_rad) else {
                continue;
            };

            let score = horizon_similarity(&obs_norm, &cand_norm);
            let replace = match best_match {
                None => true,
                Some((_, _, best_score)) => score > best_score,
            };
            if replace {
                best_match = Some((
                    cand.horizon_hash_id,
                    [cand.pos_x_m, cand.pos_y_m, cand.pos_z_m],
                    score,
                ));
            }
        }

        best_match
    }

    /// Performs an absolute EKF position measurement update using 2 Hz Skyline Matching,
    /// eliminating accumulated NLOS dead-reckoning drift (< 0.5 m RMS).
    pub fn update_skyline(&mut self, obs: &SkylineObservation) -> Option<(u32, f64)> {
        let sigma_horiz = (self.cov[0][0] + self.cov[1][1]).max(0.0).sqrt();
        let search_radius_m = (3.5 * sigma_horiz).clamp(50.0, 250.0);

        let (matched_id, matched_pos, score) = self.match_skyline(obs, search_radius_m)?;
        if !score.is_finite() || score < 0.35 {
            return None;
        }

        let tau = obs.dust_tau.max(0.0) as f64;
        let tau_factor = 1.0 + 0.15 * tau;
        let score_factor = 1.0 + 2.0 * (1.0 - score).max(0.0);
        let sigma_xy = (0.12 * tau_factor * score_factor).clamp(0.08, 0.80);
        let sigma_z = (0.25 * tau_factor * score_factor).clamp(0.15, 1.50);

        let z_meas = if (matched_pos[2] - self.pos[2]).abs() < 100.0 {
            matched_pos[2]
        } else {
            self.pos[2]
        };

        let innov = [
            matched_pos[0] - self.pos[0],
            matched_pos[1] - self.pos[1],
            z_meas - self.pos[2],
        ];

        // Innovation-adaptive covariance scaling: when an absolute high-confidence terrain match
        // detects unmodeled NLOS slip/drift exceeding 2-sigma, inflate P_pos so the EKF locks
        // onto the skyline fix cleanly instead of under-correcting.
        let innov_xy_sq = innov[0] * innov[0] + innov[1] * innov[1];
        let current_xy_var = self.cov[0][0] + self.cov[1][1];
        if score > 0.65 && innov_xy_sq > 2.0 * current_xy_var {
            let floor_var = (innov_xy_sq * 4.0).max(1.0);
            self.cov[0][0] = self.cov[0][0].max(floor_var);
            self.cov[1][1] = self.cov[1][1].max(floor_var);
            self.cov[2][2] = self.cov[2][2].max(innov[2] * innov[2] * 4.0 + 0.25);
        }

        let r_sky = [
            [sigma_xy * sigma_xy, 0.0, 0.0],
            [0.0, sigma_xy * sigma_xy, 0.0],
            [0.0, 0.0, sigma_z * sigma_z],
        ];

        self.apply_block3_update(0, innov, r_sky);

        // Re-anchor incremental odometry trackers to the corrected absolute position.
        self.vio_anchor_pos = self.pos;
        self.lidar_anchor_pos = self.pos;
        self.imu_steps_since_vio = 0;
        self.steps_since_lidar = 0;
        self.imu_step_var_vio = 0.0;
        self.pred_step_var_lidar = 0.0;
        self.last_skyline_id = Some(matched_id);
        self.last_ncc_score = score;

        Some((matched_id, score))
    }

    /// Returns the current EKF pose estimate and 1-sigma horizontal position uncertainty.
    pub fn pose(&self) -> TrnPoseEstimate {
        let horiz_var = (self.cov[0][0] + self.cov[1][1]).max(0.0);
        TrnPoseEstimate {
            pos_m: self.pos,
            vel_mps: self.vel,
            quat_wxyz: self.quat,
            horizontal_uncertainty_1sigma_m: horiz_var.sqrt(),
            skyline_matched_id: self.last_skyline_id,
            ncc_score: self.last_ncc_score,
        }
    }

    /// Generic Joseph-form 3-DOF block measurement update for `H = [0.. | I_3 at col_offset | ..0]`.
    fn apply_block3_update(&mut self, col_offset: usize, innov: [f64; 3], r_meas: Mat3) {
        if col_offset + 3 > 15 || !vec3_is_finite(innov) {
            return;
        }

        // Innovation covariance S = P[block, block] + R
        let mut s = [[0.0_f64; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                s[i][j] = self.cov[col_offset + i][col_offset + j] + r_meas[i][j];
            }
        }

        let Some(s_inv) = mat3_inv(s) else {
            return;
        };

        // Kalman gain K (15x3) = P[:, block] * S^-1
        let mut k = [[0.0_f64; 3]; 15];
        for r in 0..15 {
            for c in 0..3 {
                let mut sum = 0.0;
                for m in 0..3 {
                    sum += self.cov[r][col_offset + m] * s_inv[m][c];
                }
                k[r][c] = sum;
            }
        }

        // State error dx = K * innov
        let mut dx = [0.0_f64; 15];
        for r in 0..15 {
            dx[r] = k[r][0] * innov[0] + k[r][1] * innov[1] + k[r][2] * innov[2];
        }

        // Inject error state into nominal state.
        self.pos[0] += dx[0];
        self.pos[1] += dx[1];
        self.pos[2] += dx[2];
        self.vel[0] += dx[3];
        self.vel[1] += dx[4];
        self.vel[2] += dx[5];

        let dtheta = [dx[6], dx[7], dx[8]];
        self.quat = quat_normalize(quat_mul(self.quat, quat_from_rotvec(dtheta)));

        self.ba[0] += dx[9];
        self.ba[1] += dx[10];
        self.ba[2] += dx[11];
        self.bg[0] += dx[12];
        self.bg[1] += dx[13];
        self.bg[2] += dx[14];

        // Joseph-form covariance update: P_new = (I - K H) P (I - K H)^T + K R K^T
        let mut i_kh = mat15_identity();
        for r in 0..15 {
            for c in 0..3 {
                i_kh[r][col_offset + c] -= k[r][c];
            }
        }

        let temp = mat15_mul(&i_kh, &self.cov);
        let mut p_new = mat15_mul_trans_b(&temp, &i_kh);

        // Add K * R * K^T
        let mut kr = [[0.0_f64; 3]; 15];
        for r in 0..15 {
            for c in 0..3 {
                kr[r][c] =
                    k[r][0] * r_meas[0][c] + k[r][1] * r_meas[1][c] + k[r][2] * r_meas[2][c];
            }
        }
        for r in 0..15 {
            for c in 0..15 {
                p_new[r][c] += kr[r][0] * k[c][0] + kr[r][1] * k[c][1] + kr[r][2] * k[c][2];
            }
        }

        mat15_symmetrize_and_floor(&mut p_new);
        self.cov = p_new;
    }
}

/// Generates a synthetic 360-degree Melas Chasma horizon bank centered at `(center_x, center_y)`.
///
/// Models 7 km North and South canyon escarpments with asymmetric serrated ridges plus local
/// canyon-floor basaltic spurs and terrace buttresses so that every coordinate has a distinct
/// 72-bin skyline signature.
pub fn generate_melas_horizon_bank(
    center_x: f64,
    center_y: f64,
    grid_step_m: f64,
    half_extent_steps: i32,
) -> Vec<SyntheticHorizon> {
    let step = if grid_step_m.is_finite() && grid_step_m > 0.0 {
        grid_step_m
    } else {
        1.0
    };
    let extent = half_extent_steps.max(0);
    let side = (2 * extent + 1) as usize;
    let mut bank = Vec::with_capacity(side * side);

    let y_north_wall = center_y + 7000.0;
    let y_south_wall = center_y - 7200.0;

    for iy in -extent..=extent {
        let y = center_y + (iy as f64) * step;
        for ix in -extent..=extent {
            let x = center_x + (ix as f64) * step;
            let mut elevations_rad = [0.0_f32; HORIZON_BINS];

            for (bin, elev_slot) in elevations_rad.iter_mut().enumerate() {
                let az = (bin as f64) * (2.0 * PI / (HORIZON_BINS as f64));
                let ux = az.sin();
                let uy = az.cos();

                let mut max_elev = 0.05_f64;

                // 1. North 7 km Melas Chasma canyon cliff with asymmetric serrated buttresses.
                if uy > 0.04 {
                    let dist = ((y_north_wall - y) / uy).max(250.0);
                    let x_hit = x + dist * ux;
                    let h_north = 7000.0
                        + 950.0 * (x_hit / 420.0).sin()
                        + 580.0 * (x_hit / 185.0 + 0.7).cos()
                        + 340.0 * (x_hit / 78.0 - 0.4).sin();
                    let elev = h_north.atan2(dist);
                    if elev > max_elev {
                        max_elev = elev;
                    }
                }

                // 2. South ~6.85 km Melas Chasma canyon cliff with distinct ridge asymmetry.
                if uy < -0.04 {
                    let dist = ((y - y_south_wall) / (-uy)).max(250.0);
                    let x_hit = x + dist * ux;
                    let h_south = 6850.0
                        + 880.0 * (x_hit / 510.0 + 1.15).cos()
                        + 520.0 * (x_hit / 160.0 - 0.55).sin()
                        + 310.0 * (x_hit / 67.0 + 0.9).cos();
                    let elev = h_south.atan2(dist);
                    if elev > max_elev {
                        max_elev = elev;
                    }
                }

                // 3. Asymmetric interior basaltic spurs and canyon-floor ridges
                //    (realistic 3-20 deg floor relief that uniquely fingerprints every meter).
                let r_spur = 60.0_f64;
                let dx = (x + r_spur * ux) - center_x;
                let dy = (y + r_spur * uy) - center_y;
                let ridge_slope = (0.18
                    + 0.070 * (dx / 10.0 + 0.5 * (dy / 13.0).sin()).sin()
                    + 0.060 * ((dx * 0.73 + dy * 0.68) / 8.0).cos()
                    + 0.050 * ((dx * 0.61 - dy * 0.79) / 6.5 + 0.4).sin())
                .clamp(0.05, 0.36);
                let spur_elev = ridge_slope.atan();
                if spur_elev > max_elev {
                    max_elev = spur_elev;
                }

                // 4. Outer canyon bench terraces at 1.2 km range.
                let dy_bench = (y + 1200.0 * uy) - center_y;
                let terrace = 1400.0 * ((dy_bench.abs() - 1600.0).max(0.0) / 3500.0).powi(2);
                let bench_elev = terrace.atan2(1200.0);
                if bench_elev > max_elev {
                    max_elev = bench_elev;
                }

                *elev_slot = max_elev as f32;
            }

            bank.push(SyntheticHorizon {
                horizon_hash_id: hash_coord_id(x, y),
                pos_x_m: x,
                pos_y_m: y,
                pos_z_m: 0.0,
                elevations_rad,
            });
        }
    }

    bank
}

/// Deterministic FNV-1a 32-bit coordinate hash (millimeter-quantized) for `horizon_hash_id`.
fn hash_coord_id(x_m: f64, y_m: f64) -> u32 {
    let qx = (x_m * 1000.0).round() as i64;
    let qy = (y_m * 1000.0).round() as i64;
    let mut hash: u32 = 0x811c_9dc5;
    for byte in qx.to_le_bytes().into_iter().chain(qy.to_le_bytes()) {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    if hash == 0 {
        1
    } else {
        hash
    }
}

/// Zero-mean unit-variance normalization across the 72 horizon bins.
fn z_normalize_horizon(elev: &[f32; HORIZON_BINS]) -> Option<[f64; HORIZON_BINS]> {
    let n = HORIZON_BINS as f64;
    let mut sum = 0.0_f64;
    for &v in elev {
        if !v.is_finite() {
            return None;
        }
        sum += v as f64;
    }
    let mean = sum / n;

    let mut var_sum = 0.0_f64;
    for &v in elev {
        let d = (v as f64) - mean;
        var_sum += d * d;
    }
    let std = (var_sum / n).sqrt();
    if std < 1.0e-6 {
        return None;
    }

    let inv_std = 1.0 / std;
    let mut out = [0.0_f64; HORIZON_BINS];
    for i in 0..HORIZON_BINS {
        out[i] = ((elev[i] as f64) - mean) * inv_std;
    }
    Some(out)
}

/// Computes blended Normalized Cross-Correlation (NCC) and 1D angular Chamfer similarity.
fn horizon_similarity(obs: &[f64; HORIZON_BINS], cand: &[f64; HORIZON_BINS]) -> f64 {
    let n = HORIZON_BINS as f64;

    let mut dot0 = 0.0_f64;
    let mut l1_0 = 0.0_f64;
    for i in 0..HORIZON_BINS {
        dot0 += obs[i] * cand[i];
        l1_0 += (obs[i] - cand[i]).abs();
    }
    let ncc0 = dot0 / n;

    // Symmetric 1D angular Chamfer distance over +/-1 bin neighborhood for dust/jitter resilience.
    let mut chamfer_sum = 0.0_f64;
    for i in 0..HORIZON_BINS {
        let mut min_d = (obs[i] - cand[i]).abs();
        for shift in [-1_isize, 1] {
            let j = ((i as isize + shift).rem_euclid(HORIZON_BINS as isize)) as usize;
            let d = (obs[i] - cand[j]).abs();
            if d < min_d {
                min_d = d;
            }
        }
        chamfer_sum += min_d;
    }
    let mean_chamfer = (0.5 * (l1_0 / n) + 0.5 * (chamfer_sum / n)).max(0.0);
    let chamfer_sim = (-0.5 * mean_chamfer).exp();

    (0.80 * ncc0 + 0.20 * chamfer_sim).clamp(-1.0, 1.0)
}

// --- Pure Rust 3D Vector, Quaternion, and 3x3 / 15x15 Matrix Primitives ---

#[inline]
fn vec3_is_finite(v: [f64; 3]) -> bool {
    v[0].is_finite() && v[1].is_finite() && v[2].is_finite()
}

#[inline]
fn vec3_add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

#[inline]
fn vec3_sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn vec3_scale(a: [f64; 3], s: f64) -> [f64; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

#[inline]
fn skew_symmetric(v: [f64; 3]) -> Mat3 {
    [
        [0.0, -v[2], v[1]],
        [v[2], 0.0, -v[0]],
        [-v[1], v[0], 0.0],
    ]
}

fn quat_from_rotvec(v: [f64; 3]) -> [f64; 4] {
    let theta_sq = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    let theta = theta_sq.sqrt();
    if theta < 1.0e-8 {
        let w = 1.0 - theta_sq * 0.125;
        let s = 0.5 - theta_sq / 48.0;
        quat_normalize([w, v[0] * s, v[1] * s, v[2] * s])
    } else {
        let half = 0.5 * theta;
        let s = half.sin() / theta;
        quat_normalize([half.cos(), v[0] * s, v[1] * s, v[2] * s])
    }
}

#[inline]
fn quat_mul(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ]
}

fn quat_normalize(q: [f64; 4]) -> [f64; 4] {
    let norm = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if !norm.is_finite() || norm < 1.0e-12 {
        return [1.0, 0.0, 0.0, 0.0];
    }
    let inv = if q[0] < 0.0 { -1.0 / norm } else { 1.0 / norm };
    [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]
}

fn quat_to_mat3(q: [f64; 4]) -> Mat3 {
    let [w, x, y, z] = quat_normalize(q);
    [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - w * z),
            2.0 * (x * z + w * y),
        ],
        [
            2.0 * (x * y + w * z),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - w * x),
        ],
        [
            2.0 * (x * z - w * y),
            2.0 * (y * z + w * x),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ]
}

#[inline]
fn mat3_identity() -> Mat3 {
    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
}

#[inline]
fn mat3_scale(m: Mat3, s: f64) -> Mat3 {
    [
        [m[0][0] * s, m[0][1] * s, m[0][2] * s],
        [m[1][0] * s, m[1][1] * s, m[1][2] * s],
        [m[2][0] * s, m[2][1] * s, m[2][2] * s],
    ]
}

#[inline]
fn mat3_sub(a: Mat3, b: Mat3) -> Mat3 {
    [
        [a[0][0] - b[0][0], a[0][1] - b[0][1], a[0][2] - b[0][2]],
        [a[1][0] - b[1][0], a[1][1] - b[1][1], a[1][2] - b[1][2]],
        [a[2][0] - b[2][0], a[2][1] - b[2][1], a[2][2] - b[2][2]],
    ]
}

fn mat3_mul(a: Mat3, b: Mat3) -> Mat3 {
    let mut out = [[0.0_f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
    }
    out
}

#[inline]
fn mat3_mul_vec3(m: Mat3, v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

fn mat3_inv(m: Mat3) -> Option<Mat3> {
    let c00 = m[1][1] * m[2][2] - m[1][2] * m[2][1];
    let c01 = m[1][2] * m[2][0] - m[1][0] * m[2][2];
    let c02 = m[1][0] * m[2][1] - m[1][1] * m[2][0];
    let det = m[0][0] * c00 + m[0][1] * c01 + m[0][2] * c02;
    if !det.is_finite() || det.abs() < 1.0e-15 {
        return None;
    }
    let inv_det = 1.0 / det;
    Some([
        [
            c00 * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det,
        ],
        [
            c01 * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det,
        ],
        [
            c02 * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det,
        ],
    ])
}

fn mat15_identity() -> Mat15 {
    let mut m = [[0.0_f64; 15]; 15];
    for (i, row) in m.iter_mut().enumerate() {
        row[i] = 1.0;
    }
    m
}

fn mat15_mul(a: &Mat15, b: &Mat15) -> Mat15 {
    let mut out = [[0.0_f64; 15]; 15];
    for i in 0..15 {
        for k in 0..15 {
            let aik = a[i][k];
            if aik == 0.0 {
                continue;
            }
            for j in 0..15 {
                out[i][j] += aik * b[k][j];
            }
        }
    }
    out
}

fn mat15_mul_trans_b(a: &Mat15, b: &Mat15) -> Mat15 {
    let mut out = [[0.0_f64; 15]; 15];
    for i in 0..15 {
        for j in 0..15 {
            let mut sum = 0.0;
            for k in 0..15 {
                sum += a[i][k] * b[j][k];
            }
            out[i][j] = sum;
        }
    }
    out
}

fn mat15_symmetrize_and_floor(p: &mut Mat15) {
    for i in 0..15 {
        for j in (i + 1)..15 {
            let avg = 0.5 * (p[i][j] + p[j][i]);
            p[i][j] = avg;
            p[j][i] = avg;
        }
        if !p[i][i].is_finite() || p[i][i] < 1.0e-12 {
            p[i][i] = 1.0e-12;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn melas_horizon_bank_has_7km_asymmetric_canyon_walls_and_unique_signatures() {
        let bank = generate_melas_horizon_bank(0.0, 0.0, 1.0, 15);
        assert_eq!(bank.len(), 31 * 31);

        let origin = bank
            .iter()
            .find(|h| (h.pos_x_m - 0.0).abs() < 1e-9 && (h.pos_y_m - 0.0).abs() < 1e-9)
            .expect("origin cell present");
        let shifted = bank
            .iter()
            .find(|h| (h.pos_x_m - 12.0).abs() < 1e-9 && (h.pos_y_m - 5.0).abs() < 1e-9)
            .expect("shifted cell present");

        assert_ne!(origin.horizon_hash_id, shifted.horizon_hash_id);

        // North (bin 0) & South (bin 36) face 7 km walls (~43-45 deg -> ~0.75-0.80 rad);
        // East (bin 18) & West (bin 54) look down the canyon axis (much lower elevation).
        assert!(origin.elevations_rad[0] > 0.65);
        assert!(origin.elevations_rad[36] > 0.65);
        assert!(origin.elevations_rad[0] > origin.elevations_rad[18] + 0.30);
        assert!(origin.elevations_rad[36] > origin.elevations_rad[54] + 0.30);
        assert!((origin.elevations_rad[0] - origin.elevations_rad[36]).abs() > 0.005);

        for &e in &origin.elevations_rad {
            assert!(e.is_finite() && e > 0.0 && e < (PI as f32) * 0.5);
        }

        let obs_o = z_normalize_horizon(&origin.elevations_rad).unwrap();
        let obs_s = z_normalize_horizon(&shifted.elevations_rad).unwrap();
        let self_sim = horizon_similarity(&obs_o, &obs_o);
        let cross_sim = horizon_similarity(&obs_o, &obs_s);
        assert!((self_sim - 1.0).abs() < 1e-6);
        assert!(cross_sim < self_sim - 1e-4);
    }

    #[test]
    fn imu_stationary_mars_gravity_equilibrium_holds() {
        let mut ekf = CanyonTrnEkf::new([10.0, -5.0, 0.0], Vec::new());
        let imu = ImuSample {
            dt_s: 1.0 / 400.0,
            accel_mps2: [0.0, 0.0, MARS_GRAVITY as f64],
            gyro_rads: [0.0, 0.0, 0.0],
        };

        for _ in 0..800 {
            ekf.predict_imu(&imu);
        }

        let pose = ekf.pose();
        assert!((pose.pos_m[0] - 10.0).abs() < 1e-9);
        assert!((pose.pos_m[1] + 5.0).abs() < 1e-9);
        assert!(pose.pos_m[2].abs() < 1e-9);
        assert!(pose.vel_mps[0].abs() < 1e-9);
        assert!(pose.vel_mps[1].abs() < 1e-9);
        assert!(pose.vel_mps[2].abs() < 1e-9);
    }

    #[test]
    fn nlos_walk_drifts_12m_and_skyline_update_crushes_error_under_dust_tau_2() {
        let bank = generate_melas_horizon_bank(0.0, 0.0, 1.0, 35);
        let true_end = [24.0_f64, 10.0_f64, 0.0_f64];

        let target_horizon = bank
            .iter()
            .find(|h| {
                (h.pos_x_m - true_end[0]).abs() < 1e-9 && (h.pos_y_m - true_end[1]).abs() < 1e-9
            })
            .copied()
            .expect("target horizon in bank");

        let mut ekf = CanyonTrnEkf::new([0.0, 0.0, 0.0], bank);

        // Simulate 100 s NLOS walk in Melas Chasma where IMU+VIO drift ~12 m from ground truth.
        // True step at 20 Hz (2000 steps): dx=0.012 m, dy=0.005 m -> true_end = (24.0, 10.0).
        // Drifted VIO/IMU step adds (+0.0048, +0.0036) m/step -> drifted_end ≈ (33.6, 17.2) (~12.0 m error!).
        let total_steps = 2000;
        let dt_step = 0.05_f64;
        let imu_substeps = 20; // 400 Hz IMU inside 20 Hz step
        let dt_imu = dt_step / (imu_substeps as f64);

        for step in 0..total_steps {
            let phase = (step as f64) * 0.02;
            for _ in 0..imu_substeps {
                let imu = ImuSample {
                    dt_s: dt_imu,
                    accel_mps2: [0.004 * phase.sin(), 0.003 * phase.cos(), MARS_GRAVITY as f64],
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
                    local_slope_deg: 18.5,
                    sigma_m: 0.12,
                };
                ekf.update_lidar(&lidar);
            }
        }

        let drifted_pose = ekf.pose();
        let pre_err = ((drifted_pose.pos_m[0] - true_end[0]).powi(2)
            + (drifted_pose.pos_m[1] - true_end[1]).powi(2))
        .sqrt();
        assert!(
            pre_err > 8.0 && pre_err < 16.0,
            "expected ~12 m NLOS drift before skyline fix, got {pre_err:.3} m"
        );

        // Simulate 2 Hz skyline extraction under heavy dust storm (tau = 2.0):
        // 55% contrast attenuation + atmospheric scattering offset + deterministic bin noise.
        let mut observed_elevations_rad = [0.0_f32; HORIZON_BINS];
        for (i, slot) in observed_elevations_rad.iter_mut().enumerate() {
            let noise = 0.004_f32 * (((i * 17 + 3) % 11) as f32 - 5.0) / 5.0;
            *slot = (0.45 * target_horizon.elevations_rad[i] + 0.07 + noise).max(0.01);
        }
        let obs = SkylineObservation {
            observed_elevations_rad,
            dust_tau: 2.0,
        };

        let update_res = ekf.update_skyline(&obs);
        assert!(update_res.is_some(), "skyline update should lock onto canyon rim");
        let (matched_id, ncc_score) = update_res.unwrap();
        assert_eq!(matched_id, target_horizon.horizon_hash_id);
        assert!(ncc_score > 0.90, "expected high NCC under tau=2.0, got {ncc_score:.4}");

        let corrected = ekf.pose();
        let post_err = ((corrected.pos_m[0] - true_end[0]).powi(2)
            + (corrected.pos_m[1] - true_end[1]).powi(2))
        .sqrt();
        assert!(
            post_err < 0.5,
            "expected corrected horizontal error < 0.5 m, got {post_err:.4} m"
        );
        assert!(corrected.horizontal_uncertainty_1sigma_m < 0.5);
        assert_eq!(corrected.skyline_matched_id, Some(matched_id));
        assert!((corrected.ncc_score - ncc_score).abs() < 1e-9);
    }

    #[test]
    fn invalid_inputs_and_empty_horizon_db_do_not_panic() {
        let mut ekf = CanyonTrnEkf::new([0.0, 0.0, 0.0], Vec::new());
        ekf.predict_imu(&ImuSample {
            dt_s: 0.0,
            accel_mps2: [f64::NAN, 0.0, 0.0],
            gyro_rads: [0.0, 0.0, 0.0],
        });
        ekf.update_vio(&VioDelta {
            delta_pos_m: [f64::INFINITY, 0.0, 0.0],
            vel_mps: [0.0, 0.0, 0.0],
            sigma_pos_m: 0.05,
        });
        ekf.update_lidar(&LidarScanMatch {
            delta_pos_m: [0.0, 0.0, 0.0],
            local_slope_deg: f32::NAN,
            sigma_m: 0.1,
        });
        let obs = SkylineObservation {
            observed_elevations_rad: [0.3_f32; HORIZON_BINS],
            dust_tau: 2.0,
        };
        assert!(ekf.match_skyline(&obs, 50.0).is_none());
        assert!(ekf.update_skyline(&obs).is_none());
    }
}
