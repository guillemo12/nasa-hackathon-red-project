"""Constantes del escenario EVA-07 que no viven en los JSON de ``data/mission-scenarios``.

Todas proceden de ``docs/01-planetary-science-mission/DATOS_CANONICOS_P1.md``
(el «canónico») o del entregable 1, secciones 3 y 4. Las constantes físicas que sí están
en ``eva_thresholds.json`` (gravedad, masa con traje, 335 W por L/min, 1,429 g/L) se leen
de allí en ``metabolic.py`` y no se duplican aquí.

Etiquetas de procedencia: [M] medido/publicado · [D] derivado · [E] supuesto de escenario ·
[R] reconstruido por este validador (el canónico no da el dato y se despeja de sus cifras) ·
[C] calibrado contra un punto de control del canónico (parámetro libre ajustado).
"""
from __future__ import annotations

# --- Metabolismo ------------------------------------------------------------
BASAL_POWER_W = 120.0            # [D] gasto basal con traje presurizado
HORIZONTAL_COEF = 0.285          # [D] coste de marcha horizontal (adimensional, ×W·v)
MUSCLE_EFFICIENCY = 0.25         # [D] eficiencia muscular en trabajo positivo

# Tramos de inercia térmica (TIU = J m-2 K-1 s-1/2) → factor de terreno η  [D]
#   >400 → 1,0 · 250–400 → 1,3 · 150–250 → 1,6 · <150 → 2,1
ETA_TIU_BREAKS = ((400.0, 1.0), (250.0, 1.3), (150.0, 1.6))
ETA_LOOSE = 2.1

# Casos de la tabla 3.1 del entregable
FLAT_SPEED_M_S = 1.0             # [D] llano firme
RAMP10_SPEED_M_S = 0.76          # [R] «velocidad reducida»: despejada de 592 W a 10°
RAMP20_SPEED_M_S = 0.69          # [R] «velocidad reducida»: despejada de 839 W a 20°
WP2_SLOPE_DEG = 22.0             # [E] rampa local de escenario (cifra compartida); la pendiente
                                 #     real del nodo a 20 m (19,4°, [D]) se lee del GeoJSON
WP2_SPEED_M_S = 0.55             # [D]
WP2_TIU = 110.0                  # [E] → η 2,1
WP2_SLIP = 0.30                  # [E]
# Los topes de ritmo (huida 1,25 m/s y 650 W; retorno sostenido 1,0 m/s y 585 W) viven en
# ``eva_thresholds.json`` (bloque ``constants``) y se leen con ``metabolic.pace_caps()``.
CORNICE_ENTRY_SPEED_M_S = 0.5    # [E] trepada corta a la alcoba por el talud real del WP3
ISRU_POWER_W = 250.0             # [E] trabajo ligero de muestreo en WP1 (cifra del canónico)
REST_POWER_W = 130.0             # [E] reposo presurizado en el refugio (cifra del canónico)
SUSTAINED_RED_MAX_MIN = 5.0      # [D] «muchos minutos»: más de 5 min seguidos por encima del rojo
                                 #     sostenido (el canónico solo tolera el pico 2–3 min)

# Regla de η por tramo [D]: η de la inercia térmica media de sus dos nodos (el tramo es una
# transición entre ambos terrenos). El banco suelto de 110 TIU (η 2,1) se aplica solo donde la
# cronología activa la trampa de regolito (T+98–106), no a todo L2.

# --- Atmósfera -------------------------------------------------------------
SCALE_PRESSURE_PA = 610.0        # [D] presión de referencia en el areoide (fórmula del proyecto)
SCALE_HEIGHT_M = 11100.0         # [D] altura de escala: P = 610 Pa · exp(−z / 11,1 km)

# --- Traje -------------------------------------------------------------------
O2_USABLE_G = 800.0              # [E] O₂ primario útil
SUIT_PRESSURE_KPA = 29.6         # [E]

# --- Rutas ------------------------------------------------------------------
SAFE_RETURN_TIME_MIN = 48.0      # [D] cifra compartida: redondeo de los 47,6 min del planificador

# Walkback Limit Dual en T+105: se lee del planificador D* Lite del motor Rust
# (``engine_results.planner()``, ``data/mission-scenarios/planner_walkback.json``).
ESCAPE_T0 = 105.0
RETURN_ETA = 1.3                 # [E] terraza de la ruta segura (Base 320 TIU, evita <150 TIU)

# --- Radiación --------------------------------------------------------------
GCR_DOSE_RATE_MSV_H = 0.027      # [M] fondo GCR (RAD, Gale), contabilizado aparte de la regla SPE
SPE_PEAK_MSV_H = 8.0             # [E] envolvente de diseño a cielo abierto
SPE_BUDGET_MSV = 2.0             # [E] regla de vuelo: máx. dosis SPE por EVA
OPEN_SKY_DOSE_FACTOR = 1.0       # convenio del canónico: en marcha se toma «cielo abierto»
                                 # (no el SVF del nodo); solo la alcoba de WP3 aplica su SVF
WALKBACK_MARGIN_MIN_REQUIRED = 10.0   # [E] regla de 3.6, aplicada solo a la Base

# Perfiles temporales de la tasa SPE externa (cielo abierto), nudos (minuto T, mSv/h).
# Fuera de los nudos la tasa es 0 antes del primero y se mantiene el último valor después.
SPE_ONSET_T = 105
SPE_PEAK_T = 125
SPE_PROFILES: dict[str, tuple[tuple[float, float], ...]] = {
    # Envolvente constante: 8 mSv/h desde la alerta. Reproduce 15 min y 6,4 mSv.
    "envolvente": ((105.0, 8.0), (165.0, 8.0)),
    # Rampa literal: 0 en la alerta → 8 en el pico de T+125; meseta hasta T+140; remite.
    "rampa_lineal": ((105.0, 0.0), (125.0, 8.0), (140.0, 8.0), (165.0, 2.0)),
    # Rampa calibrada: subida rápida hasta 5 mSv/h en T+108 [C] (nudo ajustado para que el
    # escape acumule ≈0,6 mSv), pico 8 en T+125 [E], meseta hasta T+140 [E] y descenso
    # lineal hasta 2 mSv/h en T+165 [C, supuesto: «remite el pico»].
    "rampa_calibrada": ((105.0, 0.0), (108.0, 5.0), (125.0, 8.0), (140.0, 8.0), (165.0, 2.0)),
}
NOMINAL_PROFILE = "rampa_calibrada"   # perfil de la serie nominal (dosis acumulada)
PROJECTION_PROFILE = "envolvente"     # lo que el traje proyecta al detectar la SPE (regla)

# --- Radio ------------------------------------------------------------------
# Enlace primario de datos Base–traje (sesión Zenoh): banda S, 2,4 GHz, 1 W. Es el que se
# pierde tras el relieve. Decisión tomada con la malla real (data/nasa-layers/SCHEMA_HEXGRID.md):
# con difracción de arista única sobre el DTM CTX, a 2,4 GHz el WP2 y el WP3 quedan en rojo
# (−103,1 y −107,9 dBm), mientras que en UHF 435 MHz solo bajan a −81,0 y −85,7 dBm.
RADIO_FREQ_MHZ = 2400.0          # [D] banda S, enlace primario de datos
RADIO_TX_DBM = 30.0              # [D] 1 W
RADIO_ANTENNA_GAIN_DBI = 0.0     # supuesto: antenas isótropas (el canónico no da ganancias)
# [D] Difracción de arista única (ITU-R P.526) a 2,4 GHz sobre el DTM CTX de 20 m: 26,4 dB en
# el WP2 y 33,8 dB en el WP3; se toma la media, 30 dB (antes 40 dB de escenario en UHF).
RADIO_DIFFRACTION_DB = 30.0
RADIO_MIN_DISTANCE_M = 10.0      # evita log(0) con el astronauta en la Base
# Baliza UHF de baja tasa: sobrevive degradada tras el relieve; el sistema no depende de ella.
RADIO_BEACON_FREQ_MHZ = 435.0    # [D] UHF
RADIO_BEACON_TX_DBM = 30.0       # [D] 1 W
NLOS_RED_PERSISTENCE_S = 60.0    # [D/E] NLOS > 60 s → rojo

# --- Cronología -------------------------------------------------------------
T_START = -45
T_END = 165
