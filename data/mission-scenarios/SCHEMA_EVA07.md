# Esquema de la simulación EVA-07 (`eva07_timeline.parquet` y `eva07_events.json`)

Ficheros de escenario del pipeline de ciencia para el motor Rust (estocástico Markov/Poisson, D\* Lite y máquina de estados del traje, en Rust) y para la consola. Son la **implementación de referencia** de la física del canónico (`docs/01-planetary-science-mission/DATOS_CANONICOS.md`, secciones 3 y 4 de `CIENCIA_Y_MISION.md`). No son un motor competidor.

- **Generación reproducible:** `cd data/pipeline && uv run python -m red_atlas_pipeline.scenario` (salida determinista; sin marcas de tiempo).
- **Código:** `data/pipeline/src/red_atlas_pipeline/scenario/`. **Tests:** `data/pipeline/tests/test_scenario_*.py`.
- **Entradas:** `triangulo_supervivencia.geojson` y `eva_thresholds.json` (no se modifican).
- **Versión de esquema:** 1.0.

## 1. Convenios

- **Tiempo:** minutos terrestres desde la salida. T+0 = 14:45 LMST. La serie va de T−45 a T+165: 211 filas, una por minuto entero, con ambos extremos incluidos.
- **Instante frente a intervalo:**
  - La fila `t` describe el instante `t`.
  - Los acumulados (O₂ y dosis) integran `[t−1, t]` con la fase que contiene `t−1`.
  - Las variables instantáneas (potencia, SVF, amenazas) son las de la fase que contiene `t`.
  - Las fases son intervalos `[t0, t1)`; la fila T+165 toma la última fase.
- **Posición:** interpolación lineal en lat/lon a lo largo de los tramos L1 (T+0–28), L2 (T+75–98) y L3 (T+105–114,45). Las fronteras de fase pueden ser fraccionarias: los acumulados reparten cada minuto entre las fases que lo cubren. Fuera de esos intervalos el astronauta está quieto en un nodo.
- **Distancias de ruta del Walkback:**
  - Desde los nodos:

    | Nodo | A la Base | A WP3 |
    |---|---|---|
    | Base | 0 | 1.600 m (L4 al revés) |
    | WP1 | 1.500 m | 1.065 m en recta (no hay tramo planificado) |
    | WP2 | **2.148 m** (camino del planificador D\* Lite) | 595 m (camino del planificador) |
    | WP3 | 1.600 m | 0 |

  - Entre nodos se interpolan con la fracción recorrida. Es una aproximación de validación: el planificador solo exporta las rutas desde WP2 en T+105.
- **Velocidades del Walkback:** se leen de `data/mission-scenarios/planner_walkback.json`, que exporta el motor Rust (`cargo run --release --bin export_mission_results` en `src/core-engine`): planificador D\* Lite sobre la malla H3 res. 12 real, con los topes de ritmo de `eva_thresholds.json` (huida 1,25 m/s y 650 W; retorno sostenido 1,0 m/s y 585 W). El validador no copia ninguna cifra a mano; si el JSON falta o sus campos no cuadran (llegada = T+105 + tiempo, velocidad = camino / tiempo, decisión «WP3, Base no viable»), la cronología no se genera. Cifras en §9.
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

| Columna | Tipo | Unidad | Descripción |
|---|---|---|---|
| `t_min` | int64 | min | Minuto T (−45…165) |
| `lmst` | string | HH:MM | Hora solar local; 1 min marciano = 1,0275 min terrestres |
| `act` | int64 | — | Acto del escenario (1–5) |
| `phase_id` | string | — | Fase de la cronología (ver §4) |
| `location` | string | — | Nodo, o `A→B` si la fase es de marcha |
| `goal` | string | — | Destino activo del planificador (WP1, WP2, WP3) |
| `from_node` | string | — | Nodos entre los que está el astronauta (iguales si está quieto) |
| `to_node` | string | — | Nodos entre los que está el astronauta (iguales si está quieto) |
| `track_fraction` | double | 0–1 | Fracción recorrida del tramo actual |
| `lat_pc_deg` | double | ° | Posición (planetocéntrica; Este 0–360; IAU_2015:49900) |
| `lon_e_deg` | double | ° | Posición (planetocéntrica; Este 0–360; IAU_2015:49900) |
| `metabolic_power_w` | double | W | Potencia metabólica de la fase |
| `power_source` | string | — | Origen de la potencia: `modelo`, `modelo_tramo_real`, `modelo_ritmo_regulado`, `planificador_dstar`, `escenario` o `sin_consumo` (ver §4) |
| `o2_l_min` | double | L/min STPD | Consumo de O₂ (potencia / 335) |
| `o2_g_min` | double | g/min | Consumo de O₂ (× 1,429 g/L) |
| `o2_used_g` | double | g | O₂ primario consumido desde T+0 |
| `o2_remaining_g` | double | g | O₂ primario restante (800 g útiles al salir) |
| `o2_remaining_pct` | double | % | O₂ primario restante |
| `svf_geo` | double | 0–1 | SVF del nodo de referencia de la fase (GeoJSON) |
| `dose_factor` | double | 0–1 | Factor de exposición aplicado a la tasa externa: 1,0 en marcha (convenio «cielo abierto» del canónico) y 0,15 bajo la cornisa |
| `spe_ext_rate_env_msv_h` | double | mSv/h | Tasa SPE externa, perfil `envolvente` |
| `spe_ext_rate_linear_msv_h` | double | mSv/h | Tasa SPE externa, perfil `rampa_lineal` |
| `spe_ext_rate_cal_msv_h` | double | mSv/h | Tasa SPE externa, perfil `rampa_calibrada` (nominal) |
| `spe_local_rate_msv_h` | double | mSv/h | Tasa SPE local nominal = externa calibrada × `dose_factor` |
| `dose_spe_msv` | double | mSv | **Dosis SPE acumulada nominal** (`rampa_calibrada`) |
| `dose_spe_env_msv` | double | mSv | Dosis SPE acumulada con la `envolvente` |
| `dose_spe_linear_msv` | double | mSv | Dosis SPE acumulada con la `rampa_lineal` |
| `dose_gcr_msv` | double | mSv | Fondo GCR desde T+0 a 0,027 mSv/h; aparte de la regla SPE |
| `dust_tau` | double | — | Opacidad τ (880 nm): 0,7 antes del frente y 2,4 después |
| `radio_distance_m` | double | m | Distancia en línea recta a la Base (trayecto radioeléctrico) |
| `radio_los` | bool | — | Línea de vista. Falsa en T+92–157; desde T+158 vuelve por el repetidor |
| `radio_nlos_s` | double | s | Segundos acumulados sin línea de vista |
| `radio_rssi_dbm` | double | dBm | Nivel recibido del enlace primario de datos (banda S, 2,4 GHz, 1 W, 0 dBi; 30 dB de difracción en NLOS, derivados de la malla real) |
| `radio_class` | string | — | VERDE, AMBAR o ROJO con `radio_rssi_dbm` (incluye «NLOS >60 s») |
| `threat_polvo` | bool | — | Frente de polvo catabático activo |
| `threat_spe` | bool | — | Evento SPE activo |
| `threat_trampa_regolito` | bool | — | Trampa de regolito (110 TIU, 22°) activa |
| `threat_sombra_radio` | bool | — | Sombra de radio (NLOS) activa |
| `n_threats` | int64 | — | Número de amenazas activas (4 en T+105) |
| `base_route_m` | double | m | Distancia de camino al destino (desde WP2, la del planificador: 2.148 m) |
| `base_time_min` | double | min | Tiempo de marcha al destino |
| `base_dose_proj_msv` | double | mSv | **Dosis de decisión** proyectada (modelo del motor): envolvente constante × SVF medio efectivo de la ruta del planificador × tiempo; con la alerta inactiva, 0. En T+105 = 5,30 mSv |
| `base_o2_need_g` | double | g | O₂ necesario para llegar |
| `base_margin_min` | double | min | Margen = mín(margen de O₂, margen de radiación). O₂: (restante − necesario) / consumo de marcha. Radiación (con SPE activa): minutos a cielo abierto que deja el presupuesto de 2 mSv a 8 mSv/h, menos el tiempo de marcha |
| `base_viable` | bool | — | Viable si dosis acumulada + proyectada (envolvente) ≤ 2 mSv y el O₂ basta. La Base exige además margen ≥ 10 min (diagrama 3.6) |
| `wp3_route_m` | double | m | Distancia de camino al destino (desde WP2, la del planificador: 595 m) |
| `wp3_time_min` | double | min | Tiempo de marcha al destino |
| `wp3_dose_proj_msv` | double | mSv | **Dosis de decisión** proyectada (modelo del motor): envolvente constante × SVF medio efectivo de la ruta del planificador × tiempo; con la alerta inactiva, 0. En T+105 = 0,89 mSv |
| `wp3_o2_need_g` | double | g | O₂ necesario para llegar |
| `wp3_margin_min` | double | min | Margen = mín(margen de O₂, margen de radiación). O₂: (restante − necesario) / consumo de marcha. Radiación (con SPE activa): minutos a cielo abierto que deja el presupuesto de 2 mSv a 8 mSv/h, menos el tiempo de marcha |
| `wp3_viable` | bool | — | Viable si dosis acumulada + proyectada (envolvente) ≤ 2 mSv y el O₂ basta. La Base exige además margen ≥ 10 min (diagrama 3.6) |
| `viable_destination` | string | — | `BASE` si es viable; si no, `WP3` si es viable; si no, `NINGUNO` |
| `class_metabolic` | string | — | Clase de `metabolic_power_w` (umbral `metabolic_rate_w`, sostenido) |
| `class_dose_rate` | string | — | Clase de `spe_local_rate_msv_h` |
| `class_dose_budget` | string | — | Clase de `dose_spe_msv` (presupuesto por EVA) |
| `class_o2` | string | — | Clase de `o2_remaining_pct` |
| `class_walkback` | string | — | Clase del margen del destino viable |

## 3. Estructura de `eva07_events.json`

| Clave | Contenido |
|---|---|
| `events[]` | Hitos con `t_min`, `lmst`, `id`, `title`, `threat` (amenaza principal o `null`), `active_threats[]`, `phase_id` y `values{}`. `values` lleva O₂, potencia, tasas y dosis (los 3 perfiles y GCR), radio, τ, los dos lados del Walkback y el destino viable, con 4 decimales |
| `threat_windows_t_min` | Intervalo `[inicio, fin)` de cada amenaza. Fin 166 = activa hasta el final |
| `phases[]` | La cronología como datos (ver §4): intervalo, acto, descripción, lugar, destino, potencia y su origen, SVF, factor de dosis, tasa SPE externa (perfil nominal y envolvente) en `t0` y en `t1 − 1`, amenazas activas y estado de cada amenaza (`activa`, `inactiva`, `se_activa`, `se_desactiva`) |
| `reference_figures` | Cifras de referencia del modelo: 300 / 591 / 841 / 1.073 W; enlace primario en banda S: 108,0 dB, −78,0 y −108,0 dBm a 2,5 km; baliza UHF: 93,17 dB y −63,2 dBm; 15 min, 1,2 mSv/h |
| `decision_dose_T105` | Walkback en T+105 según el motor: modelo de dosis, camino, tiempo, llegada, velocidad y potencia medias, O₂, SVF medio efectivo y dosis de decisión de cada destino; T_vital; ventana a cielo abierto; y la referencia antigua de 6,4 mSv marcada como tal |
| `chaos_mode` | Resultados del Chaos Mode leídos de `chaos_mode_results.json`: simulaciones, semilla, % de misión segura con refugio y solo con la Base, corredor, criterio y limitaciones |
| `spe_profile_comparison` | Dosis **acumulada** con cada perfil temporal: nudos, huida, tasa media, refugio, total y vuelta a la Base a cielo abierto en el tiempo del planificador |
| `final` | O₂ restante y dosis SPE (nominal y envolvente) y GCR en T+165 |

Identificadores de hitos: `spyglass` (T−45), `chaos_mode` (T−30), `zenoh_sync` (T−10), `salida` (T+0), `llegada_wp1` (T+28), `salida_wp1` (T+75), `nlos` (T+92), `regolito` (T+98), `spe_polvo` y `dynamic_goal_switching` (T+105), `llegada_wp3` (T+114, redondeo de T+114,45), `refugio_activo` (T+115, primer minuto completo bajo la cornisa), `pico_spe` (T+125), `remite_spe` (T+140), `zenoh_restablecido` (T+158) y `telemetria_final` (T+165).

## 4. Cronología como datos

| Fase | T | Potencia (W) | Origen | Factor de dosis | Tasa SPE nominal (mSv/h) | Amenazas activas |
|---|---|---|---|---|---|---|
| `A1_consola` | -45 → 0 | 0,0 | `sin_consumo` | 1,00 | 0,00 → 0,00 | — |
| `A2_marcha_L1` | 0 → 28 | 446,6 | `modelo_tramo_real` | 1,00 | 0,00 → 0,00 | — |
| `A2_isru_wp1` | 28 → 75 | 250,0 | `escenario` | 1,00 | 0,00 → 0,00 | — |
| `A3_marcha_L2` | 75 → 92 | 539,1 | `modelo_tramo_real` | 1,00 | 0,00 → 0,00 | — |
| `A3_marcha_L2_nlos` | 92 → 98 | 539,1 | `modelo_tramo_real` | 1,00 | 0,00 → 0,00 | sombra_radio |
| `A3_rampa_pico` | 98 → 101 | 1.072,9 | `modelo` | 1,00 | 0,00 → 0,00 | trampa_regolito, sombra_radio |
| `A3_rampa_lenta` | 101 → 105 | 585,0 | `modelo_ritmo_regulado` | 1,00 | 0,00 → 0,00 | trampa_regolito, sombra_radio |
| `A4_huida_L3` | 105 → 114,448 | 547,6 | `planificador_dstar` | 1,00 | 0,00 → 5,96 | polvo, spe, trampa_regolito, sombra_radio |
| `A4_refugio` | 114,448 → 125 | 130,0 | `escenario` | 0,15 | 6,14 → 7,82 | polvo, spe, sombra_radio |
| `A4_refugio_pico` | 125 → 140 | 130,0 | `escenario` | 0,15 | 8,00 → 8,00 | polvo, spe, sombra_radio |
| `A5_permanencia` | 140 → 158 | 130,0 | `escenario` | 0,15 | 8,00 → 3,92 | polvo, spe, sombra_radio |
| `A5_zenoh` | 158 → 165 | 130,0 | `escenario` | 0,15 | 3,68 → 2,24 | polvo, spe |

Orígenes de potencia (`power_source`):

- `modelo`: modelo del canónico con los parámetros que publica el propio canónico.
- `modelo_tramo_real`: modelo con la pendiente media real del tramo (GeoJSON, DTM CTX 20 m), la velocidad media de la cronología y el η del tramo.
- `modelo_ritmo_regulado`: modelo con la velocidad que lleva la potencia al rojo sostenido (585 W).
- `planificador_dstar`: potencia media de la ruta del planificador D* Lite del motor Rust sobre el terreno real (malla H3 res. 12), con los topes de ritmo de eva_thresholds.json.
- `escenario`: potencia de escenario del canónico (sin modelo de marcha).
- `sin_consumo`: sin consumo de O₂ primario (astronauta en la Base).

**Ventanas de amenaza** `[inicio, fin)`:

- Sombra de radio: 92–158.
- Trampa de regolito: 98–106 (se sale del banco blando en el primer minuto de escape).
- SPE: 105–fin.
- Polvo: 105–fin (el canónico no da fin).

## 5. Perfiles de tasa SPE y la incoherencia del canónico

El canónico calcula dos cifras con supuestos distintos sobre la misma tasa de dosis:

- **≈0,6 mSv en los 8–9 min de escape.** Implica una tasa media de unos 4–4,5 mSv/h.
- **6,4 mSv volviendo a la Base en 48 min.** Implica 8 mSv/h constantes desde el primer minuto, a cielo abierto y sin SVF. **Esta referencia ya no es la cifra del sistema:** la dosis de decisión es la del motor (§9).

**Dos modelos, dos preguntas.** La serie lleva dos dosis distintas que no deben mezclarse:

1. **Dosis de decisión (proyección, Walkback Limit Dual):** la del motor. Al detectar la alerta, el traje supone lo peor que ha medido —la envolvente de 8 mSv/h constante— y la multiplica por el SVF de cada celda del camino que propone el planificador. Responde a «¿me cabe esta ruta en el presupuesto de 2 mSv?». En T+105: **0,89 mSv** al refugio y **5,30 mSv** a la Base.
2. **Dosis acumulada (cronología minuto a minuto):** la que de verdad recibe el astronauta con el perfil temporal de la tormenta (rampa calibrada, nominal), a cielo abierto en marcha (factor 1,0) y con el SVF 0,15 bajo la cornisa. Responde a «¿cuánto se ha llevado?». Al llegar al refugio: 0,72 mSv.

Difieren porque la proyección usa la tasa máxima constante desde el primer minuto (la tormenta todavía está subiendo) y el SVF de las celdas (0,70 de media en el camino al refugio, 0,84 en el de la Base), mientras que la acumulada sigue la rampa y toma cielo abierto en marcha. La proyección es conservadora a propósito: es la que decide.

El validador modela la tasa externa a cielo abierto como un **perfil temporal explícito**: lineal a trozos, con nudos `(T, mSv/h)` y tasa 0 antes de T+105. Calcula tres perfiles:

| Perfil | Nudos (T, mSv/h) | Huida a WP3 (mSv) | Tasa media de la huida (mSv/h) | Refugio hasta T+165 (mSv) | Total SPE acumulado (mSv) | Base a cielo abierto, tiempo del planificador (mSv) |
|---|---|---|---|---|---|---|
| `envolvente` | (105, 8) (165, 8) | 1,26 | 8,00 | 1,01 | **2,27** | 6,35 |
| `rampa_lineal` | (105, 0) (125, 8) (140, 8) (165, 2) | 0,30 | 1,89 | 0,77 | **1,07** | 4,70 |
| `rampa_calibrada` (nominal) | (105, 0) (108, 5) (125, 8) (140, 8) (165, 2) | 0,72 | 4,59 | 0,80 | **1,52** | 5,33 |

**Qué reproduce cada perfil (dosis acumulada):**

- **15 min de ventana y 1,2 mSv/h en WP3:** la **envolvente**.
- **≈0,6 mSv a la llegada a WP3:** la **rampa calibrada**, con el escape antiguo de 8 min (0,58 mSv en T+113). Su nudo (108, 5) es un **parámetro libre ajustado** para dar esa cifra y no se recalibra: con la huida de 9,45 min la dosis acumulada al llegar es **0,72 mSv**. La rampa lineal literal da 0,29 mSv.
- **«≤ 1,6 mSv en total»:** ningún perfil por sí solo. Con la envolvente completa el total acumulado es **2,27 mSv**, por encima de la regla de 2 mSv; con la rampa calibrada es **1,52 mSv**.

**La decisión no depende del perfil.** La toma la dosis de decisión del motor (5,30 mSv a la Base > 2; 0,89 mSv al refugio ≤ 2). Con cualquiera de los tres perfiles acumulados a cielo abierto el resultado sería el mismo.

**Qué usa la serie:**

- La **viabilidad** usa la dosis de decisión del motor (`*_dose_proj_msv`).
- La **dosis acumulada nominal** usa la rampa calibrada (`dose_spe_msv`); la envolvente y la rampa lineal van en columnas aparte.

**Factor de exposición:** en marcha es 1,0 (convenio «cielo abierto»), no el SVF real de la ruta (0,84–0,85 en los nodos del DTM CTX). Solo así sale la ventana de 15 min. El SVF 0,15 se aplica desde la llegada bajo la cornisa (T+114,45). Es el supuesto de escenario de la alcoba con cornisa [E]; el SVF real del WP3 derivado del DTM CTX de 20 m es 0,76 [D], porque un DEM no representa la cornisa (`sky_view_factor_dem` en el GeoJSON).

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
6. **Sentido:** `creciente` / `decreciente` / `banda`, con los límites numéricos del esquema 3.3 del documento científico (`numeric_table()`).

## 7. Otras discrepancias detectadas (el canónico no se cambia)

- **Radio (enlace primario en banda S):**
  - Con el UHF de 435 MHz del canónico, la difracción de arista única sobre el DTM real solo resta 19–26 dB en WP2 y WP3 (−81,0 y −85,7 dBm): la sombra de radio no llegaba a rojo por nivel. Ver `data/nasa-layers/SCHEMA_HEXGRID.md`.
  - El enlace primario de datos (sesión Zenoh) pasa a banda S, 2,4 GHz, 1 W: 108,0 dB de pérdida en espacio libre a 2,5 km, −78,0 dBm con línea de vista y 30 dB de difracción en NLOS (media de 26,4 dB en WP2 y 33,8 dB en WP3 sobre el DTM real). UHF 435 MHz queda como baliza de baja tasa.
  - En la serie, el NLOS da −106,7 dBm en WP2 (2,15 km) y −104,1 dBm en WP3 (1,6 km): rojo por nivel, además de por persistencia.
- **Velocidades de 592 W y 839 W:** el canónico solo dice «velocidad reducida». Despejadas, son 0,762 y 0,688 m/s. El validador usa 0,76 y 0,69 m/s [R], que dan 590,9 y 841,5 W.
- **Margen de WP3 en T+105:** 15 − 9,45 = **5,55 min**, rojo según `walkback_margin_min`. WP3 solo resulta viable porque la regla del margen de 10 min se aplica a la Base, como en el diagrama 3.6, y no al destino de refugio.
- **Dosis en el refugio:** 51 min a 1,2 mSv/h son 1,02 mSv, no «≤ 1,0». Por tanto, el «≤ 1,6 mSv» de la versión anterior del documento científico es en rigor 1,62 mSv con sus propios supuestos.

## 8. Sitio reubicado y potencias de marcha

El triángulo se trasladó 13,6 km (rumbo 245°) al pie de la pared suroeste de la cuenca, como figura rígida (1.500 / 1.200 / 600 / 1.600 m; WP2→Base 2.150 m en recta). Las cotas son del DTM CTX de 20 m [M]: Base −1.660 m, WP1 −1.582 m, WP2 −1.464 m y WP3 −1.520 m. Desniveles: L1 +78 m, L2 +118 m, L3 −56 m (el refugio queda **cuesta abajo** desde WP2), L4 −140 m y R1 −196 m. La geometría se lee del GeoJSON; las pendientes medias del GeoJSON salen del perfil del DTM y difieren de atan(Δz/d) hasta 0,07° (L3: −5,26° frente a −5,33°).

- **Atmósfera en la Base:** P = 610 Pa · exp(−z / 11,1 km) = **708 Pa** y columna = P / g = **19,0 g/cm²** (antes 724 Pa y 19,5 g/cm² a −1.905 m). Sigue por encima del punto triple del agua (611 Pa).
- **WP2:** se conservan los dos valores. 22° es la rampa local de escenario [E], con la que sale la cifra compartida de 1.072,9 W y 3,20 L/min; 19,4° es la pendiente real del nodo a 20 m [D].
- **Regla de η por tramo [D]:** η de la TIU media de sus dos nodos: L1 (320/410) 1,3; L2 (410/110) 1,3; L3 (110/620) 1,3. El banco de 110 TIU (η 2,1) solo se aplica donde la cronología activa la trampa de regolito (T+98–106). Se descarta la regla del peor nodo porque la cronología sitúa el banco al final del tramo (la trampa empieza en T+98), no por sus vatios. Sensibilidad: la TIU media de L2 (260) está a 10 TIU del corte de 250. Con η 1,6, L2 daría 586,1 W (bastaría salir de WP1 0,1 min antes); con η 2,1, 664,5 W durante 23 min (habría que adelantar la salida de WP1 3,9 min, a 0,743 m/s).
- **Velocidades [D]:** las medias que imponen los hitos fijos: L1 1.500 m en 28 min (0,893 m/s), L2 1.200 m en 23 min (0,870 m/s). La huida L3 ya no sale del modelo (ver más abajo).
- **Tras el pico del WP2 [D]:** el traje regula el ritmo para no pasar del rojo sostenido: 0,268 m/s en la rampa de 22° (585,0 W).
- **Sostenibilidad:** «insostenible» = más de 5 min seguidos por encima de 585 W. Antes, la rampa lenta a 0,28 m/s daba 605 W y T+98–106 eran 8 min seguidos por encima del rojo. **Cambio aplicado:** la velocidad tras el pico baja a 0,268 m/s (585,0 W, en el límite ámbar). Con la huida del planificador (548 W), solo el pico canónico (T+98–101) queda por encima de 585 W.
- **Huida a WP3 (decisión del equipo, 2026-11-14):** la fuente de verdad es el planificador D\* Lite del motor Rust sobre el terreno real, con el mismo modelo de velocidad y los topes de huida (1,25 m/s, 650 W): **9,45 min** por 595 m de camino (T+105–114,45), 1,05 m/s y **548 W** de media, 15,4 L de O₂. Sustituye a la fase de 8 min (antes 593,2 W el primer minuto, 412,9 W el resto y 644,9 W en la entrada a la cornisa). El modelo por tramos daba menos porque L3 baja 56 m y no acredita pendiente; el planificador recorre el terreno real celda a celda.
- **Retorno a la Base:** se elimina la «ruta segura de 2.500 m» (rodeo de 1,16). La distancia es la del camino del planificador: **2.148 m** («unos 2,15 km»), casi la línea recta de 2.150 m, en 47,6 min («48 min»).
- **Calibración:** ninguna potencia está ajustada al O₂. ISRU (250 W) y reposo (130 W) son las cifras de escenario del canónico. Los porcentajes de O₂ son una salida y sus tests, de regresión; el de T+28 se comprueba además a mano.

## 9. Resultados del motor (Walkback en T+105 y Chaos Mode)

Se leen de `data/mission-scenarios/planner_walkback.json` y `chaos_mode_results.json`, que se regeneran con `cargo run --release --bin export_mission_results` en `src/core-engine`. El validador falla si faltan o si sus campos no cuadran.

**Walkback Limit Dual en T+105** (dosis de decisión = envolvente constante × SVF de cada celda):

| Destino | Camino (m) | Tiempo (min) | Llegada | Velocidad media (m/s) | Potencia media (W) | O₂ (L) | SVF medio efectivo | **Dosis de decisión (mSv)** |
|---|---|---|---|---|---|---|---|---|
| Refugio WP3 | 595 | 9,45 | T+114,45 | 1,05 | 548 | 15,4 | 0,71 | **0,89** |
| Base | 2.148 | 47,60 | T+152,60 | 0,75 | 354 | 50,3 | 0,84 | **5,30** |

T_vital 17,9 min (término de radiación con el SVF de la celda actual); ventana a cielo abierto 15,0 min. Referencia antigua, que **ya no es la cifra del sistema**: 8 mSv/h durante 48 min a cielo abierto, sin SVF = 6,4 mSv.

**Chaos Mode** (sustituye al 99,4 % anterior, que deja de ser cifra del proyecto):

| Simulaciones | Semilla | Misión segura con cambio al refugio | Solo volver a la Base |
|---|---|---|---|
| 10.000 | 42 | **96,02 %** (9.602) | **23,84 %** (2.384) |

- Corredor: synthetic Melas Chasma corridor, H3 res 11, cells sorted by index.
- Criterio: mision segura = reaches a destination (Base, or WP3 shelter when switching is allowed) with SPE dose <= 2 mSv and primary O2 left; otherwise the most severe of: consumables lost > destination not reached > flight-rule breach (dose > 2 mSv).
- Limitaciones (del propio JSON): cells sampled by position in the sorted corridor, not along a planned route; only primary O2 modelled as consumable; escape to the shelter = 1 leg at 0.55 of the open-sky dose; Base return = 14 nominal legs from leg 6.
