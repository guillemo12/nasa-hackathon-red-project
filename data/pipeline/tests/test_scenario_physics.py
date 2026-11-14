"""Física del escenario EVA-07: geometría, metabolismo, radiación y radio.

Cada test reproduce una cifra del entregable 1 (secciones 1.2, 3 y 4) con una tolerancia
explícita. Las cifras «[R]» usan velocidades reconstruidas porque el canónico no las da.
"""
import math

import pytest

from red_atlas_p1 import config
from red_atlas_p1.scenario import atmosphere as atm
from red_atlas_p1.scenario import constants as K
from red_atlas_p1.scenario import geometry as geo
from red_atlas_p1.scenario import metabolic as met
from red_atlas_p1.scenario import radiation as rad
from red_atlas_p1.scenario import radio

# --- Geometría -----------------------------------------------------------------

DIST_TOL_M = 2.0       # haversine frente a los metros redondeados del GeoJSON
BEARING_TOL_DEG = 1.0  # el GeoJSON da rumbos enteros
# El GeoJSON da la pendiente media del perfil del DTM, no atan(Δz/d): difieren hasta 0,07°
# (L3: −5,26° frente a −5,33°).
SLOPE_TOL_DEG = 0.1

# Invariantes de la figura rígida (cifras compartidas): no se leen del GeoJSON a propósito.
RIGID_DISTANCES_M = {"L1": 1500, "L2": 1200, "L3": 600, "L4": 1600, "R1": 2150}


def test_perimeter_4900():
    assert geo.perimeter_m() == pytest.approx(4900.0, abs=4 * DIST_TOL_M)


@pytest.mark.parametrize("leg", ["L1", "L2", "L3", "L4", "R1"])
def test_legs_match_geojson(leg):
    """Distancia rígida; Δz, rumbo y pendiente media coherentes con las cotas del DTM CTX."""
    g = geo.leg_geometry(leg)
    props = config.scenario_legs()[leg]
    assert g.distance_m == pytest.approx(RIGID_DISTANCES_M[leg], abs=DIST_TOL_M)
    assert g.distance_m == pytest.approx(g.declared_distance_m, abs=DIST_TOL_M)
    assert g.delta_elev_m == g.declared_delta_elev_m
    assert geo.bearing_error_deg(g.bearing_deg, g.declared_bearing_deg) <= BEARING_TOL_DEG
    assert g.slope_deg == pytest.approx(props["mean_slope_deg"], abs=SLOPE_TOL_DEG)


def test_relocated_elevation_profile():
    """Desniveles del sitio reubicado: el refugio queda cuesta abajo desde WP2."""
    dz = {leg: geo.leg_geometry(leg).delta_elev_m for leg in RIGID_DISTANCES_M}
    assert dz == {"L1": 78, "L2": 118, "L3": -56, "L4": -140, "R1": -196}
    assert sum(dz[leg] for leg in ("L1", "L2", "L3", "L4")) == 0


def test_return_leg_and_detour():
    g = geo.leg_geometry("R1")
    assert g.distance_m == pytest.approx(2150, abs=DIST_TOL_M)
    assert K.SAFE_RETURN_WP2_BASE_M / g.declared_distance_m == pytest.approx(
        K.SAFE_RETURN_DETOUR, abs=0.005)


# --- Atmósfera ----------------------------------------------------------------

def test_base_pressure_and_column():
    """P = 610 Pa · exp(−z/11,1 km) y columna = P/g con la cota de la Base del GeoJSON."""
    p, col = atm.node_atmosphere("BASE")
    assert p == pytest.approx(708.4, abs=0.1)
    assert col == pytest.approx(19.04, abs=0.01)
    consts = config.load_thresholds()["constants"]
    assert consts["surface_pressure_pa_site"] == round(p)
    assert consts["co2_column_g_cm2_site"] == round(col, 1)


def test_formula_reproduces_original_site():
    p = atm.surface_pressure_pa(-1905.0)
    assert p == pytest.approx(724.0, abs=0.5)
    assert atm.column_g_cm2(p) == pytest.approx(19.5, abs=0.05)


# --- Metabolismo --------------------------------------------------------------

def test_suited_weight():
    assert met.suited_weight_n() == pytest.approx(632.5, abs=0.1)


def test_flat_300w():
    p = met.metabolic_power_w(1.0, 0.0, 1.0, 0.0)
    assert p == pytest.approx(300.0, abs=1.0)
    assert met.o2_l_min(p) == pytest.approx(0.90, abs=0.005)


def test_ramp_10deg_592w():                 # [R] v = 0,76 m/s
    p = met.metabolic_power_w(K.RAMP10_SPEED_M_S, 10.0)
    assert p == pytest.approx(592.0, abs=3.0)
    assert met.o2_l_min(592.0) == pytest.approx(1.77, abs=0.005)


def test_ramp_20deg_839w():                 # [R] v = 0,69 m/s
    p = met.metabolic_power_w(K.RAMP20_SPEED_M_S, 20.0)
    assert p == pytest.approx(839.0, abs=3.0)
    assert met.o2_l_min(839.0) == pytest.approx(2.50, abs=0.005)


def test_reconstructed_speeds():
    assert met.speed_for_power_m_s(592.0, 10.0) == pytest.approx(0.762, abs=0.001)
    assert met.speed_for_power_m_s(839.0, 20.0) == pytest.approx(0.688, abs=0.001)


def test_wp2_peak_1073w_3_2_l_min():
    eta = met.eta_from_tiu(110)
    assert eta == 2.1
    p = met.metabolic_power_w(0.55, 22.0, eta, 0.30)
    assert p == pytest.approx(1073.0, abs=0.5)
    assert met.o2_l_min(p) == pytest.approx(3.2, abs=0.01)
    assert met.o2_g_min(p) == pytest.approx(3.2 * 1.429, abs=0.02)


def test_escape_power_downhill_below_canon_range():
    """L3 baja 56 m: sin término de pendiente, 1,25 m/s con η 1,3 da 412,9 W, por debajo de los
    580–650 W del canónico (que suponía subida). Con η 2,1 (banco suelto) 593,2 W."""
    slope = geo.leg_geometry("L3").slope_deg
    assert slope < 0
    assert met.metabolic_power_w(K.ESCAPE_SPEED_M_S, slope, 1.3) == pytest.approx(412.9, abs=0.1)
    assert met.metabolic_power_w(K.ESCAPE_SPEED_M_S, slope, 2.1) == pytest.approx(593.2, abs=0.1)


@pytest.mark.parametrize("tiu,eta", [(620, 1.0), (410, 1.0), (400, 1.3), (320, 1.3),
                                     (250, 1.6), (200, 1.6), (150, 1.6), (149, 2.1), (110, 2.1)])
def test_eta_from_tiu(tiu, eta):
    assert met.eta_from_tiu(tiu) == eta


def test_descent_not_credited():
    assert met.metabolic_power_w(1.0, -5.0) == met.metabolic_power_w(1.0, 0.0)


def test_slip_validation():
    with pytest.raises(ValueError):
        met.metabolic_power_w(1.0, 5.0, 1.0, 1.0)


# --- Radiación ----------------------------------------------------------------

def test_open_sky_window_15min():
    assert rad.time_to_budget_min(8.0, 2.0) == pytest.approx(15.0, abs=1e-9)


def test_wp3_rate_1_2():
    assert rad.local_dose_rate_msv_h(8.0, 0.15) == pytest.approx(1.2, abs=1e-9)
    assert rad.shielding_reduction(0.15) == pytest.approx(0.85)


def test_return_base_6_4_msv_envelope():
    assert rad.dose_msv(8.0, 48.0) == pytest.approx(6.4, abs=1e-9)
    fn = rad.profile("envolvente")
    assert rad.integrate_dose_msv(fn, 105, 153) == pytest.approx(6.4, abs=1e-3)
    assert 6.4 / K.SPE_BUDGET_MSV == pytest.approx(3.2)


def test_profile_rate_shape():
    for name, knots in K.SPE_PROFILES.items():
        assert rad.profile_rate(knots, 104.9) == 0.0
        assert rad.profile_rate(knots, 125) == pytest.approx(8.0), name


def test_integrator_exact_on_linear_ramp():
    fn = rad.profile("rampa_lineal")       # 0 → 8 mSv/h en 20 min
    assert rad.integrate_dose_msv(fn, 105, 125) == pytest.approx(4.0 * 20 / 60, abs=1e-4)


def test_svf_validation():
    with pytest.raises(ValueError):
        rad.local_dose_rate_msv_h(8.0, 1.5)


# --- Radio --------------------------------------------------------------------

def test_fspl_93_2db():
    assert radio.fspl_db(2500.0, 435.0) == pytest.approx(93.2, abs=0.05)


def test_rssi_los_minus_63():
    assert radio.received_dbm(2500.0) == pytest.approx(-63.2, abs=0.1)
    assert radio.classify_link(radio.received_dbm(2500.0)) == "VERDE"


def test_rssi_nlos_red_with_documented_diffraction():
    level = radio.received_dbm(2500.0, los=False)
    assert level == pytest.approx(-103.2, abs=0.1)
    assert radio.classify_link(level) == "ROJO"


def test_canon_diffraction_range_is_inconsistent():
    """−63 dBm − (20…30 dB) da −83…−93 dBm, no los −95…−110 dBm del canónico: hace falta
    32–47 dB para llegar a ese rango. Este test fija el desfase para que no se olvide."""
    los = radio.received_dbm(2500.0)
    assert los - 20 == pytest.approx(-83.2, abs=0.1)
    assert los - 30 == pytest.approx(-93.2, abs=0.1)
    assert los - (-95) == pytest.approx(31.8, abs=0.1)
    assert los - (-110) == pytest.approx(46.8, abs=0.1)
    assert radio.classify_link(los - 30) == "AMBAR"   # con 30 dB el NLOS no llega a rojo por nivel


def test_distance_zero_is_finite():
    assert math.isfinite(radio.received_dbm(0.0))
