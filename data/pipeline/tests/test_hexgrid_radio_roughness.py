"""Nivel recibido con difracción en filo de cuchillo y rugosidad del DTM (sin red)."""
from __future__ import annotations

import math

import numpy as np
import pytest
from affine import Affine

from red_atlas_p1 import config
from red_atlas_p1.hexgrid import layers as hl
from red_atlas_p1.hexgrid import radio
from red_atlas_p1.hexgrid.layers import planar_residual_std
from red_atlas_p1.scenario import constants as K
from red_atlas_p1.scenario.radio import fspl_db, received_dbm
from red_atlas_p1.scenario.thresholds import load_specs
from red_atlas_p1.terrain import derive
from red_atlas_p1.terrain.rasters import Raster

needs_cogs = pytest.mark.skipif(bool(hl.missing_inputs()), reason="faltan los COG de build/cog")


# --- difracción ------------------------------------------------------------------------
def test_longitud_de_onda_del_enlace_del_validador():
    assert radio.WAVELENGTH_M == pytest.approx(299_792_458 / (K.RADIO_FREQ_MHZ * 1e6))
    assert radio.WAVELENGTH_M == pytest.approx(0.1249, abs=1e-4)      # banda S, 2,4 GHz


@pytest.mark.parametrize("nu,j", [(-1.0, 0.0), (-0.78, 0.0), (0.0, 6.03), (1.0, 13.96),
                                  (2.4, 20.54)])
def test_perdida_de_arista_itu_p526(nu, j):
    assert float(radio.knife_edge_loss_db(nu)) == pytest.approx(j, abs=0.05)


def test_perdida_crece_con_la_obstruccion_y_es_continua():
    nu = np.linspace(-0.78, 5, 200)
    j = radio.knife_edge_loss_db(nu)
    assert np.all(np.diff(j) > 0)
    assert float(radio.knife_edge_loss_db(-0.7799)) == pytest.approx(0.0, abs=0.01)
    assert float(radio.knife_edge_loss_db(np.nan)) == 0.0


def test_parametro_de_fresnel():
    # Arista de 10 m a mitad de 2 km: ν = 10·√(2·2000/(λ·1000·1000)).
    nu = float(radio.fresnel_nu(10.0, 1000.0, 1000.0))
    assert nu == pytest.approx(10 * math.sqrt(4000 / (radio.WAVELENGTH_M * 1e6)))
    # La misma arista cerca de un extremo obstruye más (ν mayor).
    assert float(radio.fresnel_nu(10.0, 100.0, 1900.0)) > nu


def _dem_with_ridge(height: float) -> Raster:
    """DTM plano de 0 m con una cresta norte-sur en la columna central."""
    n, px = 120, 0.0003381091347308497
    z = np.zeros((n, n), dtype="float32")
    z[:, n // 2] = height
    return Raster(z, Affine(px, 0, 283.0, 0, -px, -9.0), -9999.0)


@pytest.mark.parametrize("ridge", [0.0, 15.0, 40.0])
def test_perfil_reproduce_el_margen_de_terrain(ridge):
    dem = _dem_with_ridge(ridge)
    lat0 = -9.0 - 60.5 * 0.0003381091347308497
    tx = (283.0 + 10.5 * 0.0003381091347308497, lat0)
    rx_lon = 283.0 + np.array([30.5, 80.5, 110.5]) * 0.0003381091347308497
    rx_lat = np.full(3, lat0)
    _, m_ref = derive.line_of_sight(dem, *tx, 3.0, rx_lon, rx_lat, 2.0)
    prof = radio.diffraction_profile(dem, *tx, 3.0, rx_lon, rx_lat, 2.0)
    assert np.allclose(prof["margin_m"], m_ref, equal_nan=True)
    out = radio.rssi_from_profile(prof)
    free = np.array([received_dbm(d) for d in prof["distance_m"]])
    assert np.allclose(out["rssi_dbm"], free - out["diffraction_db"])
    # Delante de la cresta hay LOS (margen > 0). En UHF el suelo llano, con antenas a 2-3 m,
    # invade el primer elipsoide de Fresnel (~8 m de radio a 200 m) y resta unos pocos dB;
    # en banda S el elipsoide es más estrecho (~3,5 m) y la pérdida es menor o nula.
    assert prof["margin_m"][0] > 0
    uhf = radio.rssi_from_profile(prof, freq_mhz=435.0)
    assert 0.0 < uhf["diffraction_db"][0] < 6.0
    assert 0.0 <= out["diffraction_db"][0] < uhf["diffraction_db"][0]
    if ridge >= 15.0:
        assert np.all(out["diffraction_db"][1:] > 6.0)
        assert np.all(out["rssi_dbm_low"] <= out["rssi_dbm"])
        assert np.all(out["rssi_dbm"] <= out["rssi_dbm_high"])


def test_espacio_libre_del_validador():
    # 2 km: FSPL = 20·log10(2) + 20·log10(f) + 32,44 -> 91,2 dB a 435 MHz y 106,07 dB a 2,4 GHz.
    assert fspl_db(2000.0, 435.0) == pytest.approx(91.23, abs=0.02)
    assert fspl_db(2000.0, 2400.0) == pytest.approx(106.07, abs=0.02)
    assert received_dbm(2000.0) == pytest.approx(K.RADIO_TX_DBM - 106.07, abs=0.02)


def test_configuraciones_de_enlace():
    assert radio.link_kwargs("b") == {"freq_mhz": 2400.0, "tx_dbm": 30.0, "gains_dbi": 0.0}
    # (c) = (a) − 10 dB de potencia − 10 dB de pérdidas: 20 dB menos a cualquier distancia.
    a = received_dbm(1500.0, **radio.link_kwargs("a"))
    c = received_dbm(1500.0, **radio.link_kwargs("c"))
    assert a - c == pytest.approx(20.0)


def test_nu_escala_con_la_frecuencia():
    prof = {"distance_m": np.array([2000.0]), "nu": np.array([2.0]), "d1_m": np.array([1000.0]),
            "margin_m": np.array([-20.0])}
    u = radio.rssi_from_profile(prof, freq_mhz=435.0)
    s = radio.rssi_from_profile(prof, freq_mhz=2400.0)
    # El perfil guarda ν a la longitud de onda de referencia (banda S); ν ∝ 1/√λ.
    lam0 = radio.WAVELENGTH_M
    assert s["fresnel_nu"][0] == pytest.approx(2.0 * math.sqrt(lam0 / (299_792_458 / 2.4e9)))
    assert u["fresnel_nu"][0] == pytest.approx(2.0 * math.sqrt(lam0 / (299_792_458 / 4.35e8)))
    assert s["diffraction_db"][0] > u["diffraction_db"][0]


@needs_cogs
def test_nodos_reales_margen_y_clase():
    # Sobre toda la malla de referencia (el número de pasos del perfil depende de la distancia
    # máxima del lote, como en terrain), el margen es la banda los_margin_m del COG.
    margin_cog = hl.load_layer("m", hl.F_LOS, "los_margin_m")
    plat, plon = margin_cog.pixel_centers()
    gp = radio.rssi_grid(plat, plon)
    both = np.isfinite(margin_cog.values)
    assert np.allclose(gp["margin_m"][both], margin_cog.values[both], atol=1e-3)

    nodes = config.scenario_nodes()
    lat = np.array([[p["lat_pc_deg"] for p in nodes.values()]])
    lon = np.array([[p["lon_e_deg"] for p in nodes.values()]])
    g = radio.rssi_grid(lat, lon)
    names = list(nodes)
    rssi = dict(zip(names, g["rssi_dbm"][0]))
    # Base y WP1 en verde o ámbar (> −100 dBm); WP2 y WP3 por debajo de la Base y del WP1.
    assert rssi["BASE"] > -85 and rssi["WP1"] > -100
    assert max(rssi["WP2"], rssi["WP3"]) < rssi["WP1"]
    assert np.all(g["diffraction_db"][0, [names.index("WP2"), names.index("WP3")]] > 10)
    # Regla de decisión: en banda S (enlace primario) WP2 y WP3 en rojo con ≥ 2 dB de margen;
    # la baliza UHF queda por encima de −100 dBm.
    assert K.RADIO_FREQ_MHZ == 2400.0
    assert rssi["WP2"] < -102.0 and rssi["WP3"] < -102.0
    uhf = dict(zip(names, g["rssi_uhf_dbm"][0]))
    assert min(uhf["WP2"], uhf["WP3"]) > -100.0


# --- rugosidad -------------------------------------------------------------------------
def test_rugosidad_de_un_plano_inclinado_es_cero():
    y, x = np.mgrid[0:20, 0:20].astype(float)
    z = -1500.0 + 7.3 * x - 4.1 * y              # 20° y pico de pendiente, sin rugosidad
    r = planar_residual_std(z)
    assert np.nanmax(np.abs(r)) < 1e-5            # redondeo de float64 con cotas de −1.500 m
    assert np.isnan(r[0]).all() and np.isnan(r[:, -1]).all()     # bordes sin ventana completa


def test_rugosidad_con_resultado_conocido():
    z = np.zeros((9, 9))
    z[4, 4] = 9.0                                 # un pico aislado de 9 m
    r = planar_residual_std(z)
    # Ventana centrada en el pico: el plano ajustado es z = 1 (media), residuos 8 y −1 (×8):
    # SSR = 64 + 8 = 72; σ = √(72/6) = √12.
    assert r[4, 4] == pytest.approx(math.sqrt(12.0))
    z2 = z.copy()
    z2[4, 4] = np.nan
    assert np.isnan(planar_residual_std(z2)[3:6, 3:6]).all()


@needs_cogs
def test_rugosidad_real_en_la_ruta():
    L = hl.load_all()
    r = L["roughness_m"].values
    assert np.isfinite(r).mean() > 0.99
    assert 0.0 <= np.nanmin(r) and np.nanmax(r) < 20.0
    assert L["roughness_m"].src_res_m == pytest.approx(20.041, abs=0.01)


# --- umbrales en el JSON ---------------------------------------------------------------
def test_umbrales_nuevos_legibles_por_el_validador():
    specs = load_specs()
    from red_atlas_p1.scenario.thresholds import classify
    assert {"shelter_sky_view_factor", "isru_h2o_wt_pct"} <= set(specs)
    assert classify("shelter_sky_view_factor", 0.20) == "VERDE"
    assert classify("shelter_sky_view_factor", 0.21) == "ROJO"
    assert classify("isru_h2o_wt_pct", 12.0) == "VERDE"
    assert classify("isru_h2o_wt_pct", 11.9) == "ROJO"
