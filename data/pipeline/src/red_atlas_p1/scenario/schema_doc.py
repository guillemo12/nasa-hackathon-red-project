"""Plantilla y diccionario de columnas de ``SCHEMA_EVA07.md``.

El documento lo escribe ``export.export_all``: los tipos salen del esquema Arrow del Parquet y
las tablas de fases y de perfiles SPE se generan con los mismos datos que la serie.
"""
from __future__ import annotations

# columna -> (unidad, descripción)
COLUMN_DOCS: dict[str, tuple[str, str]] = {
    't_min': ('min', 'Minuto T (−45…165)'),
    'lmst': ('HH:MM', 'Hora solar local; 1 min marciano = 1,0275 min terrestres'),
    'act': ('—', 'Acto del entregable (1–5)'),
    'phase_id': ('—', 'Fase de la cronología (ver §4)'),
    'location': ('—', 'Nodo, o `A→B` si la fase es de marcha'),
    'goal': ('—', 'Destino activo del planificador (WP1, WP2, WP3)'),
    'from_node': ('—', 'Nodos entre los que está el astronauta (iguales si está quieto)'),
    'to_node': ('—', 'Nodos entre los que está el astronauta (iguales si está quieto)'),
    'track_fraction': ('0–1', 'Fracción recorrida del tramo actual'),
    'lat_pc_deg': ('°', 'Posición (planetocéntrica; Este 0–360; IAU_2015:49900)'),
    'lon_e_deg': ('°', 'Posición (planetocéntrica; Este 0–360; IAU_2015:49900)'),
    'metabolic_power_w': ('W', 'Potencia metabólica de la fase'),
    'power_source': ('—', 'Origen de la potencia: `modelo`, `modelo_tramo_real`, `modelo_ritmo_regulado`, `modelo_parametro_escenario`, `escenario` o `sin_consumo` (ver §4)'),
    'o2_l_min': ('L/min STPD', 'Consumo de O₂ (potencia / 335)'),
    'o2_g_min': ('g/min', 'Consumo de O₂ (× 1,429 g/L)'),
    'o2_used_g': ('g', 'O₂ primario consumido desde T+0'),
    'o2_remaining_g': ('g', 'O₂ primario restante (800 g útiles al salir)'),
    'o2_remaining_pct': ('%', 'O₂ primario restante'),
    'svf_geo': ('0–1', 'SVF del nodo de referencia de la fase (GeoJSON)'),
    'dose_factor': ('0–1', 'Factor de exposición aplicado a la tasa externa: 1,0 en marcha (convenio «cielo abierto» del canónico) y 0,15 bajo la cornisa'),
    'spe_ext_rate_env_msv_h': ('mSv/h', 'Tasa SPE externa, perfil `envolvente`'),
    'spe_ext_rate_linear_msv_h': ('mSv/h', 'Tasa SPE externa, perfil `rampa_lineal`'),
    'spe_ext_rate_cal_msv_h': ('mSv/h', 'Tasa SPE externa, perfil `rampa_calibrada` (nominal)'),
    'spe_local_rate_msv_h': ('mSv/h', 'Tasa SPE local nominal = externa calibrada × `dose_factor`'),
    'dose_spe_msv': ('mSv', '**Dosis SPE acumulada nominal** (`rampa_calibrada`)'),
    'dose_spe_env_msv': ('mSv', 'Dosis SPE acumulada con la `envolvente`'),
    'dose_spe_linear_msv': ('mSv', 'Dosis SPE acumulada con la `rampa_lineal`'),
    'dose_gcr_msv': ('mSv', 'Fondo GCR desde T+0 a 0,027 mSv/h; aparte de la regla SPE'),
    'dust_tau': ('—', 'Opacidad τ (880 nm): 0,7 antes del frente y 2,4 después'),
    'radio_distance_m': ('m', 'Distancia en línea recta a la Base (trayecto radioeléctrico)'),
    'radio_los': ('—', 'Línea de vista. Falsa en T+92–157; desde T+158 vuelve por el repetidor'),
    'radio_nlos_s': ('s', 'Segundos acumulados sin línea de vista'),
    'radio_rssi_dbm': ('dBm', 'Nivel recibido (1 W, 435 MHz, 0 dBi; 40 dB de difracción en NLOS)'),
    'radio_class': ('—', 'VERDE, AMBAR o ROJO con `radio_rssi_dbm` (incluye «NLOS >60 s»)'),
    'threat_polvo': ('—', 'Frente de polvo catabático activo'),
    'threat_spe': ('—', 'Evento SPE activo'),
    'threat_trampa_regolito': ('—', 'Trampa de regolito (110 TIU, 22°) activa'),
    'threat_sombra_radio': ('—', 'Sombra de radio (NLOS) activa'),
    'n_threats': ('—', 'Número de amenazas activas (4 en T+105)'),
    'base_route_m': ('m', 'Distancia de ruta al destino'),
    'wp3_route_m': ('m', 'Distancia de ruta al destino'),
    'base_time_min': ('min', 'Tiempo de marcha al destino'),
    'wp3_time_min': ('min', 'Tiempo de marcha al destino'),
    'base_dose_proj_env_msv': ('mSv', 'Dosis SPE proyectada por el traje. Con la alerta activa, 8 mSv/h constantes todo el trayecto; sin alerta, 0'),
    'wp3_dose_proj_env_msv': ('mSv', 'Dosis SPE proyectada por el traje. Con la alerta activa, 8 mSv/h constantes todo el trayecto; sin alerta, 0'),
    'base_dose_proj_ramp_msv': ('mSv', 'Dosis proyectada integrando la `rampa_calibrada` hacia delante (proyección «oráculo», solo para comparar)'),
    'wp3_dose_proj_ramp_msv': ('mSv', 'Dosis proyectada integrando la `rampa_calibrada` hacia delante (proyección «oráculo», solo para comparar)'),
    'base_o2_need_g': ('g', 'O₂ necesario para llegar'),
    'wp3_o2_need_g': ('g', 'O₂ necesario para llegar'),
    'base_margin_min': ('min', 'Margen = mín(margen de O₂, margen de radiación). O₂: (restante − necesario) / consumo de marcha. Radiación (con SPE activa): minutos a cielo abierto que deja el presupuesto de 2 mSv a 8 mSv/h, menos el tiempo de marcha'),
    'wp3_margin_min': ('min', 'Margen = mín(margen de O₂, margen de radiación). O₂: (restante − necesario) / consumo de marcha. Radiación (con SPE activa): minutos a cielo abierto que deja el presupuesto de 2 mSv a 8 mSv/h, menos el tiempo de marcha'),
    'base_viable': ('—', 'Viable si dosis acumulada + proyectada (envolvente) ≤ 2 mSv y el O₂ basta. La Base exige además margen ≥ 10 min (diagrama 3.6)'),
    'wp3_viable': ('—', 'Viable si dosis acumulada + proyectada (envolvente) ≤ 2 mSv y el O₂ basta. La Base exige además margen ≥ 10 min (diagrama 3.6)'),
    'viable_destination': ('—', '`BASE` si es viable; si no, `WP3` si es viable; si no, `NINGUNO`'),
    'class_metabolic': ('—', 'Clase de `metabolic_power_w` (umbral `metabolic_rate_w`, sostenido)'),
    'class_dose_rate': ('—', 'Clase de `spe_local_rate_msv_h`'),
    'class_dose_budget': ('—', 'Clase de `dose_spe_msv` (presupuesto por EVA)'),
    'class_o2': ('—', 'Clase de `o2_remaining_pct`'),
    'class_walkback': ('—', 'Clase del margen del destino viable'),
}

TEMPLATE = r'''# Esquema de la simulación EVA-07 (`eva07_timeline.parquet` y `eva07_events.json`)

Ficheros de escenario de la Persona 1 para el motor de la Persona 3 (estocástico Markov/Poisson, D\* Lite y máquina de estados del traje, en Rust) y para la consola (Fase 4). Son la **implementación de referencia** de la física del canónico (`docs/01-planetary-science-mission/DATOS_CANONICOS_P1.md`, secciones 3 y 4 del entregable 1). No son un motor competidor.

- **Generación reproducible:** `cd data/pipeline && uv run python -m red_atlas_p1.scenario` (salida determinista; sin marcas de tiempo).
- **Código:** `data/pipeline/src/red_atlas_p1/scenario/`. **Tests:** `data/pipeline/tests/test_scenario_*.py`.
- **Entradas:** `triangulo_supervivencia.geojson` y `eva_thresholds.json` (no se modifican).
- **Versión de esquema:** 1.0.

## 1. Convenios

- **Tiempo:** minutos terrestres desde la salida. T+0 = 14:45 LMST. La serie va de T−45 a T+165: 211 filas, una por minuto entero, con ambos extremos incluidos.
- **Instante frente a intervalo:**
  - La fila `t` describe el instante `t`.
  - Los acumulados (O₂ y dosis) integran `[t−1, t]` con la fase que contiene `t−1`.
  - Las variables instantáneas (potencia, SVF, amenazas) son las de la fase que contiene `t`.
  - Las fases son intervalos `[t0, t1)`; la fila T+165 toma la última fase.
- **Posición:** interpolación lineal en lat/lon a lo largo de los tramos L1 (T+0–28), L2 (T+75–98) y L3 (T+105–113). Fuera de esos intervalos el astronauta está quieto en un nodo.
- **Distancias de ruta del Walkback:**
  - Desde los nodos:

    | Nodo | A la Base | A WP3 |
    |---|---|---|
    | Base | 0 | 1.600 m (L4 al revés) |
    | WP1 | 1.500 m | 1.065 m en recta (no hay tramo planificado) |
    | WP2 | **2.500 m** (ruta segura D\* Lite) | 600 m |
    | WP3 | 1.600 m | 0 |

  - Entre nodos se interpolan con la fracción recorrida. Es una aproximación de validación: la distancia real la calcula el D\* Lite de la Persona 3.
- **Velocidades del Walkback:**
  - Base: 2.500 m / 48 min = 52,1 m/min (0,868 m/s), a 323 W (η 1,3; en bajada no se acredita la pendiente).
  - WP3: 1,25 m/s, a 412,9 W (η 1,3 de la TIU media de L3; L3 baja 56 m, así que no se acredita pendiente).
- **Etiquetas de procedencia:**
  - **[M]** medido.
  - **[D]** derivado.
  - **[E]** escenario.
  - **[R]** reconstruido por el validador: el canónico no da el dato y se despeja de sus cifras.
  - **[C]** calibrado contra un punto de control del canónico (parámetro libre). Tras la reubicación solo queda el nudo (108, 5) de la rampa calibrada de dosis; ninguna potencia está calibrada.

## 2. Columnas de `eva07_timeline.parquet`

Compresión zstd. Los metadatos clave-valor del esquema Parquet incluyen:

- `schema_version`, `mission`, `time_unit`.
- `nominal_dose_profile` (`rampa_calibrada`) y `projection_dose_profile` (`envolvente`).
- `spe_profiles_knots` (JSON).
- `constants` (las constantes de `eva_thresholds.json`, en JSON).
- `doc`.

<<COLUMNS>>

## 3. Estructura de `eva07_events.json`

| Clave | Contenido |
|---|---|
| `events[]` | Hitos con `t_min`, `lmst`, `id`, `title`, `threat` (amenaza principal o `null`), `active_threats[]`, `phase_id` y `values{}`. `values` lleva O₂, potencia, tasas y dosis (los 3 perfiles y GCR), radio, τ, los dos lados del Walkback y el destino viable, con 4 decimales |
| `threat_windows_t_min` | Intervalo `[inicio, fin)` de cada amenaza. Fin 166 = activa hasta el final |
| `phases[]` | La cronología como datos (ver §4): intervalo, acto, descripción, lugar, destino, potencia y su origen, SVF, factor de dosis, tasa SPE externa (perfil nominal y envolvente) en `t0` y en `t1 − 1`, amenazas activas y estado de cada amenaza (`activa`, `inactiva`, `se_activa`, `se_desactiva`) |
| `reference_figures` | Cifras de referencia del modelo: 300 / 591 / 841 / 1.073 W, 93,17 dB, −63,2 y −103,2 dBm, 15 min, 1,2 mSv/h |
| `spe_profile_comparison` | Para cada perfil: nudos, dosis del escape, tasa media, dosis al llegar, dosis en el refugio, total, retorno de 48 min a la Base y viabilidad en T+105 |
| `final` | O₂ restante y dosis SPE (nominal y envolvente) y GCR en T+165 |

Identificadores de hitos: `spyglass` (T−45), `chaos_mode` (T−30), `zenoh_sync` (T−10), `salida` (T+0), `llegada_wp1` (T+28), `salida_wp1` (T+75), `nlos` (T+92), `regolito` (T+98), `spe_polvo` y `dynamic_goal_switching` (T+105), `llegada_wp3` (T+113), `refugio_activo` (T+114), `pico_spe` (T+125), `remite_spe` (T+140), `zenoh_restablecido` (T+158) y `telemetria_final` (T+165).

## 4. Cronología como datos

<<PHASES>>

Orígenes de potencia (`power_source`):

<<POWER_SOURCES>>

**Ventanas de amenaza** `[inicio, fin)`:

- Sombra de radio: 92–158.
- Trampa de regolito: 98–106 (se sale del banco blando en el primer minuto de escape).
- SPE: 105–fin.
- Polvo: 105–fin (el canónico no da fin).

## 5. Perfiles de tasa SPE y la incoherencia del canónico

El canónico calcula dos cifras con supuestos distintos sobre la misma tasa de dosis:

- **≈0,6 mSv en los 8–9 min de escape.** Implica una tasa media de unos 4–4,5 mSv/h.
- **6,4 mSv volviendo a la Base en 48 min.** Implica 8 mSv/h constantes desde el primer minuto.

El validador modela la tasa externa a cielo abierto como un **perfil temporal explícito**: lineal a trozos, con nudos `(T, mSv/h)` y tasa 0 antes de T+105. Calcula tres perfiles:

<<PROFILES>>

**Qué reproduce cada perfil:**

- **15 min de ventana, 6,4 mSv = 3,2× la regla y 1,2 mSv/h en WP3:** la **envolvente**.
- **≈0,6 mSv a la llegada a WP3:** la **rampa calibrada**. Su nudo (108, 5) es un **parámetro libre ajustado** para dar esa cifra, no una predicción. La rampa lineal literal (0 → 8 en 20 min) da solo 0,21 mSv, un 64 % menos.
- **«≤ 1,6 mSv en total»:** ningún perfil por sí solo. El entregable suma 0,6 (rampa) y 1,0 (envolvente en el refugio). Con la envolvente completa el total es **2,11 mSv**, por encima de la regla de 2 mSv. Con la rampa calibrada es 1,40 mSv.
- **Diferencia entre casos:**
  - En el escape, 1,07 frente a 0,58 mSv: la envolvente da +0,49 mSv (×1,84).
  - En el retorno a la Base, 6,40 frente a 5,36 mSv: −1,04 mSv (−16 %) con la rampa calibrada.

**La decisión no depende del perfil.** Con los tres perfiles, en T+105 la Base no es viable (4,7–6,4 mSv > 2) y WP3 sí (0,21–1,07 mSv ≤ 2).

**Qué usa la serie:**

- La **viabilidad** usa la proyección del traje: envolvente de 8 mSv/h al detectar la SPE, como manda la regla del canónico.
- La **dosis acumulada nominal** usa la rampa calibrada.
- Las demás dosis van en columnas aparte.

**Factor de exposición:** en marcha es 1,0 (convenio «cielo abierto»), no el SVF real de la ruta (0,84–0,85 en los nodos del DTM CTX). Solo así salen los 15 min y los 6,4 mSv. El SVF 0,15 se aplica desde la entrada bajo la cornisa (T+113). Es el supuesto de escenario de la alcoba con cornisa [E]; el SVF real del WP3 derivado del DTM CTX de 20 m es 0,76 [D], porque un DEM no representa la cornisa (`sky_view_factor_dem` en el GeoJSON).

## 6. Interpretación de los rangos de `eva_thresholds.json`

El intérprete (`scenario/thresholds.py`) no modifica el JSON. Reglas:

1. **Separador de rango:** «a» o guion entre dos números, que pueden ser negativos. «-85 a -100» se lee como [−100, −85].
2. **Fronteras:** «<x» y «>x» son abiertos y «a-b» es cerrado. Un valor que cae en dos clases toma la peor. Ejemplo: 28,0 kPa está en verde «28.0-30.5» y en ámbar «24.0-28.0», y se clasifica **ámbar**.
3. **Huecos:** un valor sin clase toma la peor de sus vecinas:
   - η entre 1,0 y 1,3 → ámbar.
   - η entre 1,6 y 2,1 → rojo.
   - η < 1,0 → verde.
   - Presión del traje > 30,5 kPa (sin clase en el JSON) → ámbar.
4. **«>585 sostenido; pico 1072»** (y «>1.75 sostenido; pico 3.2»):
   - Por defecto (`sustained=True`) todo valor por encima del límite es rojo.
   - Con `sustained=False`, un transitorio hasta el pico es ámbar y por encima del pico es rojo.
   - El pico se compara con una tolerancia del 0,5 %, porque el JSON lo guarda truncado (1.072 frente a 1.072,9 W de la fórmula).
5. **«<-100 o NLOS >60 s»:** segunda variable, que se pasa como `nlos_s`. Más de 60 s sin línea de vista es rojo, aunque el nivel sea ámbar.
6. **Sentido:** `creciente` / `decreciente` / `banda`, con los límites numéricos del esquema 3.3 del entregable (`numeric_table()`).

## 7. Otras discrepancias detectadas (el canónico no se cambia)

- **Radio:**
  - −63,2 dBm − (20…30 dB) = −83…−93 dBm, no los −95…−110 dBm del canónico. Para ese rango hacen falta 32–47 dB.
  - Con 20–30 dB el NLOS no llegaría a rojo por nivel. La serie usa **40 dB** (dentro de «30+»).
  - Con 40 dB, en WP3 (1,6 km en recta) el nivel es −99,3 dBm: ámbar por nivel y rojo por persistencia NLOS.
- **Velocidades de 592 W y 839 W:** el canónico solo dice «velocidad reducida». Despejadas, son 0,762 y 0,688 m/s. El validador usa 0,76 y 0,69 m/s [R], que dan 590,9 y 841,5 W.
- **Margen de WP3 en T+105:** 15 − 8 = **7 min**, rojo según `walkback_margin_min`. WP3 solo resulta viable porque la regla del margen de 10 min se aplica a la Base, como en el diagrama 3.6, y no al destino de refugio.
- **Dosis en el refugio:** 51 min a 1,2 mSv/h son 1,02 mSv, no «≤ 1,0». Por tanto, el «≤ 1,6 mSv» del entregable es en rigor 1,62 mSv con sus propios supuestos.

## 8. Sitio reubicado y potencias de marcha

El triángulo se trasladó 13,6 km (rumbo 245°) al pie de la pared suroeste de la cuenca, como figura rígida (1.500 / 1.200 / 600 / 1.600 m; WP2→Base 2.150 m en recta y 2.500 m por la ruta segura). Las cotas son del DTM CTX de 20 m [M]: Base −1.660 m, WP1 −1.582 m, WP2 −1.464 m y WP3 −1.520 m. Desniveles: L1 +78 m, L2 +118 m, L3 −56 m (el refugio queda **cuesta abajo** desde WP2), L4 −140 m y R1 −196 m. La geometría se lee del GeoJSON; las pendientes medias del GeoJSON salen del perfil del DTM y difieren de atan(Δz/d) hasta 0,07° (L3: −5,26° frente a −5,33°).

- **Atmósfera en la Base:** P = 610 Pa · exp(−z / 11,1 km) = **708 Pa** y columna = P / g = **19,0 g/cm²** (antes 724 Pa y 19,5 g/cm² a −1.905 m). Sigue por encima del punto triple del agua (611 Pa).
- **WP2:** se conservan los dos valores. 22° es la rampa local de escenario [E], con la que sale la cifra compartida de 1.072,9 W y 3,20 L/min; 19,4° es la pendiente real del nodo a 20 m [D].
- **Regla de η por tramo [D]:** η de la TIU media de sus dos nodos: L1 (320/410) 1,3; L2 (410/110) 1,3; L3 (110/620) 1,3. El banco de 110 TIU (η 2,1) solo se aplica donde la cronología activa la trampa de regolito (T+98–106). Se descarta la regla del peor nodo porque la cronología sitúa el banco al final del tramo (la trampa empieza en T+98), no por sus vatios. Sensibilidad: la TIU media de L2 (260) está a 10 TIU del corte de 250. Con η 1,6, L2 daría 586,1 W (bastaría salir de WP1 0,1 min antes); con η 2,1, 664,5 W durante 23 min (habría que adelantar la salida de WP1 3,9 min, a 0,743 m/s).
- **Velocidades [D]:** las medias que imponen los hitos fijos: L1 1.500 m en 28 min (0,893 m/s), L2 1.200 m en 23 min (0,870 m/s) y L3 600 m en 8 min (1,25 m/s).
- **Tras el pico del WP2 [D]:** el traje regula el ritmo para no pasar del rojo sostenido: 0,268 m/s en la rampa de 22° (585,0 W).
- **Entrada bajo la cornisa:** 0,5 m/s [E] por el talud real de 20,1° del WP3 (η 1,0): 644,9 W durante 1 min.
- **Sostenibilidad:** «insostenible» = más de 5 min seguidos por encima de 585 W. Antes, la rampa lenta a 0,28 m/s daba 605 W y T+98–106 eran 8 min seguidos por encima del rojo. **Cambio aplicado:** la velocidad tras el pico baja a 0,268 m/s (585,0 W, en el límite ámbar). Así T+98–106 son 8 min a ≥585 W, pero solo 3 + 1 por encima: el pico canónico y la salida del banco (593,2 W). La entrada bajo la cornisa (644,9 W) dura 1 min. No cambia ningún hito.
- **Escape:** baja 56 m, así que el modelo no acredita pendiente: 593,2 W en el primer minuto (banco, η 2,1) y 412,9 W el resto (η 1,3). Los 580–650 W del canónico suponían subida. El modelo no cuenta el coste excéntrico de bajar laderas de hasta 22°: es optimista en bajada.
- **Calibración:** ninguna potencia está ajustada al O₂. ISRU (250 W) y reposo (130 W) son las cifras de escenario del canónico. Los porcentajes de O₂ son una salida y sus tests, de regresión; el de T+28 se comprueba además a mano.
'''
