"""Enlace de radio UHF Base–traje: pérdida en espacio libre, nivel recibido y clase.

FSPL(dB) = 20·log10(d_km) + 20·log10(f_MHz) + 32,44. Nivel recibido (dBm) =
potencia transmitida (dBm) + ganancias (dBi) − FSPL − pérdida adicional por difracción.
"""
from __future__ import annotations

import math

from red_atlas_p1.scenario import constants as K


def fspl_db(distance_m: float, freq_mhz: float = K.RADIO_FREQ_MHZ) -> float:
    """Pérdida en espacio libre en dB. La distancia se limita a ``RADIO_MIN_DISTANCE_M``."""
    d_km = max(distance_m, K.RADIO_MIN_DISTANCE_M) / 1000.0
    return 20.0 * math.log10(d_km) + 20.0 * math.log10(freq_mhz) + 32.44


def received_dbm(
    distance_m: float,
    los: bool = True,
    diffraction_db: float = K.RADIO_DIFFRACTION_DB,
    tx_dbm: float = K.RADIO_TX_DBM,
    gains_dbi: float = 2 * K.RADIO_ANTENNA_GAIN_DBI,
    freq_mhz: float = K.RADIO_FREQ_MHZ,
) -> float:
    """Nivel recibido en dBm; sin línea de vista se resta ``diffraction_db``."""
    level = tx_dbm + gains_dbi - fspl_db(distance_m, freq_mhz)
    return level if los else level - diffraction_db


def classify_link(rssi_dbm: float, nlos_s: float = 0.0) -> str:
    """Clase del enlace con los umbrales de ``eva_thresholds.json`` (radio_rssi_dbm)."""
    from red_atlas_p1.scenario.thresholds import classify

    return classify("radio_rssi_dbm", rssi_dbm, nlos_s=nlos_s)
