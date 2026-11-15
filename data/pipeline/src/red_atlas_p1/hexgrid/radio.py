"""Nivel recibido desde la Base por celda: espacio libre + difracción en filo de cuchillo.

Enlace (reutilizado del validador, ``scenario/radio.py`` y ``scenario/constants.py``): enlace
primario de datos en banda S (2,4 GHz, 1 W) y baliza UHF (435 MHz, 1 W), antenas isótropas,
pérdida en espacio libre con la distancia real a la Base. A ese nivel se resta la pérdida por difracción de una arista en filo de cuchillo
(ITU-R P.526, ecuación de J(ν) para una arista única):

    J(ν) = 6,9 + 20·log10( √((ν − 0,1)² + 1) + ν − 0,1 )   si ν > −0,78;   0 en otro caso
    ν    = h · √( 2·d / (λ·d1·d2) )

``h`` es la altura del terreno sobre el rayo recto Base–receptor (h = −margen), ``d1`` y
``d2`` las distancias de la arista a cada extremo y ``d = d1 + d2``. Con ν ≤ −0,78 (despeje
de más de ~0,55 del primer elipsoide de Fresnel) no hay pérdida adicional; entre −0,78 y 0
hay pérdida aunque el rayo pase por encima del terreno.

Geometría: la misma que ``terrain.derive.line_of_sight`` (DTM CTX de 20 m del entorno
cercano, muestreo bilineal, paso de un píxel, curvatura como flecha t·(1−t)·D²/(2R), antenas
a 3 m en la Base y 2 m en el traje). En cada punto del perfil se calcula ν y se toma la
arista dominante (ν máximo). El margen mínimo que sale del mismo bucle coincide con la
banda ``los_margin_m`` del COG de terreno; un test lo comprueba.

Incertidumbre: el DTM tiene un ruido vertical de ±5 m. Se recalcula J con h ± 5 m en la
arista dominante y se dan los dos extremos del nivel recibido.

Limitaciones: arista única (sin Deygout ni varias aristas, que darían más pérdida), sin
reflexiones ni dispersión por el suelo, sin ganancias de antena y sin atmósfera (en Marte,
despreciable a 435 MHz y a 2,4 GHz).
"""
from __future__ import annotations

import math

import numpy as np

from .. import config
from ..scenario import constants as K
from ..scenario.radio import received_dbm
from ..terrain import derive
from ..terrain import settings as TS
from ..terrain.rasters import Raster, read_cog, sample

C_LIGHT_M_S = 299_792_458.0
WAVELENGTH_M = C_LIGHT_M_S / (K.RADIO_FREQ_MHZ * 1e6)
DTM_NOISE_M = 5.0
F_DEM_NEAR = "build/cog/dem_ctx_20m_near.tif"


def knife_edge_loss_db(nu) -> np.ndarray:
    """J(ν) de ITU-R P.526 en dB (0 para ν ≤ −0,78 y para ν = NaN o −∞)."""
    nu = np.asarray(nu, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        x = np.where(np.isfinite(nu) & (nu > -0.78), nu, -0.78)
        j = 6.9 + 20.0 * np.log10(np.sqrt((x - 0.1) ** 2 + 1.0) + x - 0.1)
    return np.where(np.isfinite(nu) & (nu > -0.78), j, 0.0)


def fresnel_nu(h_m, d1_m, d2_m, wavelength_m: float = WAVELENGTH_M) -> np.ndarray:
    d1, d2 = np.asarray(d1_m, dtype=np.float64), np.asarray(d2_m, dtype=np.float64)
    return np.asarray(h_m) * np.sqrt(2.0 * (d1 + d2) / (wavelength_m * d1 * d2))


def diffraction_profile(dem: Raster, tx_lon: float, tx_lat: float, tx_agl_m: float,
                        rx_lon, rx_lat, rx_agl_m: float, step_m: float | None = None,
                        radius: float = config.MARS_RADIUS_M) -> dict:
    """Perfil Base→receptores: margen mínimo, ν dominante y su geometría.

    Mismo bucle que ``terrain.derive.line_of_sight`` (no se evalúa a menos de un paso de los
    extremos), añadiendo ν en cada punto.
    """
    z = dem.band(0)
    rx_lon = np.asarray(rx_lon, dtype=np.float64)
    rx_lat = np.asarray(rx_lat, dtype=np.float64)
    step = step_m or dem.pixel_m
    h_tx = float(sample(z, *dem.index(tx_lon, tx_lat))) + tx_agl_m
    h_rx = sample(z, *dem.index(rx_lon, rx_lat)) + rx_agl_m
    dist = derive.distance_m(tx_lon, tx_lat, rx_lon, rx_lat, radius)
    n = max(2, math.ceil(float(np.nanmax(dist)) / step))
    margin = np.full(rx_lon.shape, np.inf)
    nu_max = np.full(rx_lon.shape, -np.inf)
    d1_dom = np.full(rx_lon.shape, np.nan)
    for k in range(1, n):
        t = k / n
        use = (t * dist >= step) & ((1 - t) * dist >= step)
        if not use.any():
            continue
        lon = tx_lon + t * (rx_lon - tx_lon)
        lat = tx_lat + t * (rx_lat - tx_lat)
        terrain = sample(z, *dem.index(lon, lat))
        ray = h_tx + t * (h_rx - h_tx) - t * (1 - t) * dist**2 / (2 * radius)
        m = np.where(use, ray - terrain, np.inf)
        margin = np.fmin(margin, m)
        with np.errstate(invalid="ignore", divide="ignore"):
            nu = np.where(use, fresnel_nu(terrain - ray, t * dist, (1 - t) * dist), -np.inf)
        better = nu > nu_max
        nu_max = np.where(better, nu, nu_max)
        d1_dom = np.where(better, t * dist, d1_dom)
    valid = np.isfinite(h_rx) & np.isfinite(h_tx)
    margin = np.where(valid, margin, np.nan)
    margin = np.where(np.isinf(margin), np.nan, margin)
    nu_max = np.where(valid, nu_max, np.nan)
    return {"distance_m": dist, "margin_m": margin, "nu": nu_max, "d1_m": d1_dom}


def rssi_from_profile(prof: dict, noise_m: float = DTM_NOISE_M,
                      freq_mhz: float = K.RADIO_FREQ_MHZ, tx_dbm: float = K.RADIO_TX_DBM,
                      gains_dbi: float = 2 * K.RADIO_ANTENNA_GAIN_DBI) -> dict:
    """Nivel recibido (dBm) y sus extremos con ±``noise_m`` en la arista dominante.

    ``prof`` se calcula una vez con ``WAVELENGTH_M``; para otra frecuencia, ν escala con
    √(λ0/λ) y la arista dominante es la misma (el factor es común a todo el perfil).
    ``gains_dbi`` es la suma de ganancias menos pérdidas de antena y cuerpo de los dos extremos.
    """
    wl = C_LIGHT_M_S / (freq_mhz * 1e6)
    dist = prof["distance_m"]
    nu, d1 = prof["nu"] * math.sqrt(WAVELENGTH_M / wl), prof["d1_m"]
    loss = knife_edge_loss_db(nu)
    with np.errstate(invalid="ignore", divide="ignore"):
        dnu = noise_m * np.sqrt(2.0 * dist / (wl * d1 * (dist - d1)))
    dnu = np.where(np.isfinite(dnu), dnu, 0.0)
    loss_hi = knife_edge_loss_db(nu + dnu)       # arista 5 m más alta: más pérdida
    loss_lo = knife_edge_loss_db(nu - dnu)
    free = np.array([received_dbm(float(d), los=True, tx_dbm=tx_dbm, gains_dbi=gains_dbi,
                                  freq_mhz=freq_mhz) for d in np.ravel(dist)]).reshape(
        np.shape(dist))
    # ν = −∞: receptor a menos de dos pasos de la Base (sin perfil intermedio, sin pérdida);
    # ν = NaN: sin cota en algún extremo.
    ok = ~np.isnan(nu)
    rssi = np.where(ok, free - loss, np.nan)
    return {"rssi_dbm": rssi, "rssi_dbm_low": np.where(ok, free - loss_hi, np.nan),
            "rssi_dbm_high": np.where(ok, free - loss_lo, np.nan),
            "diffraction_db": np.where(ok, loss, np.nan), "fresnel_nu": nu}


# Configuraciones comparadas para decidir el enlace primario (ver SCHEMA_HEXGRID.md, §9).
# «gains_dbi» es la suma de los dos extremos: en (c), 5 dB de pérdidas por antena y cuerpo en
# cada extremo.
LINK_CONFIGS = {
    "a": {"label": "UHF 435 MHz, 1 W", "freq_mhz": 435.0, "tx_dbm": 30.0, "gains_dbi": 0.0},
    "b": {"label": "Banda S 2,4 GHz, 1 W", "freq_mhz": 2400.0, "tx_dbm": 30.0, "gains_dbi": 0.0},
    "c": {"label": "UHF 435 MHz, 100 mW, −5 dB por antena y cuerpo", "freq_mhz": 435.0,
          "tx_dbm": 20.0, "gains_dbi": -10.0},
}


def link_kwargs(key: str) -> dict:
    return {k: v for k, v in LINK_CONFIGS[key].items() if k != "label"}


def base_profile(ref_lat: np.ndarray, ref_lon: np.ndarray) -> dict:
    """Perfil Base→puntos (independiente de la frecuencia salvo por ν, que se reescala)."""
    dem = read_cog(config.PIPELINE_DIR / F_DEM_NEAR)
    base = config.scenario_nodes()["BASE"]
    return diffraction_profile(dem, base["lon_e_deg"], base["lat_pc_deg"],
                               TS.ANTENNA_BASE_AGL_M, np.ravel(ref_lon), np.ravel(ref_lat),
                               TS.ANTENNA_SUIT_AGL_M)


def rssi_grid(ref_lat: np.ndarray, ref_lon: np.ndarray) -> dict:
    """Nivel recibido en los centros de píxel de la malla de referencia (2D)."""
    dem = read_cog(config.PIPELINE_DIR / F_DEM_NEAR)
    base = config.scenario_nodes()["BASE"]
    prof = diffraction_profile(dem, base["lon_e_deg"], base["lat_pc_deg"],
                               TS.ANTENNA_BASE_AGL_M, ref_lon.ravel(), ref_lat.ravel(),
                               TS.ANTENNA_SUIT_AGL_M)
    out = rssi_from_profile(prof)                               # enlace primario (banda S)
    uhf = rssi_from_profile(prof, freq_mhz=K.RADIO_BEACON_FREQ_MHZ, tx_dbm=K.RADIO_BEACON_TX_DBM)
    out["rssi_uhf_dbm"] = uhf["rssi_dbm"]
    out["diffraction_uhf_db"] = uhf["diffraction_db"]
    out["margin_m"] = prof["margin_m"]
    return {k: np.asarray(v).reshape(ref_lat.shape) for k, v in out.items()}
