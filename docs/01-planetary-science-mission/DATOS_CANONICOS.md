# Datos canónicos — fuente única de cifras del escenario EVA-07

Fuente única de cifras para `CIENCIA_Y_MISION.md`, el validador `red_atlas_pipeline.scenario` y el núcleo Rust. Un cambio de cifra se hace aquí y en los JSON de `data/mission-scenarios/`, y después se regeneran las salidas.

> **Actualizado tras la reubicación del sitio (2026-11-14).** El triángulo se trasladó 13,6 km (rumbo 245°) al pie de la pared suroeste de la cuenca, como figura rígida (detalle en `data/nasa-layers/SITE_REALITY_CHECK.md`). Nodos, tramos, presión, columna, potencias por fase, O₂ por hito y dosis acumulada salen del validador `data/pipeline/src/red_atlas_pipeline/scenario/` (`uv run python -m red_atlas_pipeline.scenario`), que regenera `data/mission-scenarios/eva07_timeline.parquet`, `eva07_events.json` y `SCHEMA_EVA07.md`. Las cifras compartidas de §2 no cambiaron con la reubicación. **Después (2026-11-14),** el tiempo al refugio WP3 pasó de 8 min a 9,4 min, que es lo que da el planificador D\* Lite del motor Rust sobre el terreno real.

> **Procedencia de las cifras del motor (2026-11-15).** El Walkback Limit Dual en T+105 (caminos, tiempos, velocidades, potencias, O₂ y dosis de decisión), T_vital y el Chaos Mode salen del motor Rust y se regeneran con `cargo run --release --bin export_mission_results` en `src/core-engine`, que escribe `data/mission-scenarios/planner_walkback.json` y `data/mission-scenarios/chaos_mode_results.json`. El validador los lee (no los copia) y falla si faltan o no cuadran. La replanificación del cambio de destino (17,3 ms) es una medida del motor en modo optimizado sobre un corredor de la malla real; no está en esos JSON.

Etiquetas de procedencia obligatorias en tablas: **[M]** medido/publicado · **[D]** derivado por cálculo · **[E]** supuesto del escenario de diseño.

## 1. Sitio y geometría

- Cuenca suroeste de Melas Chasma, pie de la pared suroeste (Base en 9,89646°S, 283,38920°E = 76,61080°W; el sitio original de 9,8°S, 283,6°E no tenía ni la rampa del WP2 ni el escarpe del WP3). Paleolago con abanicos (Quantin et al. 2005; Metz et al. 2009; Williams & Weitz 2014). Fue uno de los 8 candidatos de aterrizaje de Mars 2020 (taller 2015). CRISM: sulfatos hidratados interestratificados con esmectitas Fe/Mg, bajo una unidad gruesa de sulfato monohidratado; jarosita y ópalo en exposiciones menores (Weitz et al. 2015; Liu et al. 2018 — verificar año/DOI).
- La cuenca está **colgada ~1 km sobre el piso principal** del cañón; su depresión cerrada sigue la curva **−1.800 m** MOLA [M]. Por tanto: "7–9 km" = relieve total del sistema (meseta ≈ +4 km a piso más profundo ≈ −5 km); relieve local de pared en nuestro sitio ≈ 5–6 km [D]; "pared de 4 km" = tramo de escarpe local visible sobre WP3 [E].
- CRS: IAU 2015:49900 (Marte esférico, ocentrico, Este positivo 0–360), R = 3.396.190 m. 1° lat = 59.274,7 m; 1° lon = 58.392,7 m a 9,9°S. GeoJSON en orden `[lon, lat, elev]`.
- Las posiciones salen de una búsqueda rígida sobre el DTM CTX de 20 m `P18_007878_1703_XN_09S076W__P20_008735_1702_XI_09S076W` [D]; cotas medidas [M]; pendientes, SVF y línea de vista derivadas [D]. Siguen siendo **escenario de diseño [E]** la alcoba con cornisa del WP3 y las TIU (hay que fijarlas sobre THEMIS real). Ningún DTM HiRISE cubre la ruta. Para HiRISE y CRISM se cita solo el tipo de producto PDS: el ID de escena queda por confirmar en PDS ODE.

| Nodo | Lat (°) | Lon E (°) | Cota CTX 20 m (m) [M] | Pendiente local 20 m [D] | TIU [E] | SVF | LOS radio Base [D] | Presión (Pa) [D] | Columna CO₂ (g/cm²) [D] |
|---|---|---|---|---|---|---|---|---|---|
| Base | −9,89646 | 283,38920 | −1.660 | 2,8° | 320 | 0,85 [D] | — | **708** | **19,0** |
| WP1 ISRU | −9,91880 | 283,40126 | −1.582 | 6,7° | 410 | 0,85 [D] | sí (+0,6 m, dentro del ruido de ±5 m) | 703 | 18,9 |
| WP2 riesgo | −9,93261 | 283,38623 | −1.464 | **19,4° real [D]**; rampa local **22° [E]** (cifra compartida) | 110 | 0,84 [D] | no (−24,7 m) | 696 | 18,7 |
| WP3 refugio | −9,92286 | 283,38349 | −1.520 | 20,1° (talud) | 620 | **0,15 [E]** alcoba; **0,76 [D]** real | no (−28,2 m) | 699 | 18,8 |

- **SVF del WP3:** el 0,15 es el supuesto de escenario de la alcoba con cornisa [E], que un DEM no puede representar; el SVF real derivado del DTM CTX de 20 m es **0,76** [D]. Toda la radiación del refugio (1,2 mSv/h, 85 %) usa el 0,15.
- **WP2:** se conservan los dos valores, etiquetados: 22° [E] es la rampa local con la que salen 1.073 W y 3,2 L/min; 19,4° [D] es la pendiente real del nodo a 20 m (entre 14,0° y 19,4° según el par CTX).
- El WP3 sigue quedando **por debajo** del WP2: el escape es cuesta abajo.

| Tramo | Distancia | Δz [M/D] | Rumbo [D] | Pend. media [D] | Pend. máx. [D] |
|---|---|---|---|---|---|
| Base→WP1 (L1) | 1.500 m | +78 m | 152° | 2,96° | 8,0° |
| WP1→WP2 (L2) | 1.200 m | +118 m | 227° | 5,62° | 19,9° |
| WP2→WP3 (L3) | 600 m | −56 m | 344° | −5,26° | 22,5° |
| WP3→Base (L4) | 1.600 m | −140 m | 12° | −5,02° | 20,1° |
| **Perímetro** | **4.900 m** | 0 | | | |
| WP2→Base (R1, retorno) | 2.150 m en línea recta; **2.148 m de camino del planificador D\* Lite** («unos 2,15 km»; se elimina la antigua «ruta segura de 2.500 m») | −196 m | 5° | −5,20° | 21,4° |

Pendiente media del GeoJSON = perfil del DTM; difiere de atan(Δz/d) hasta 0,07° (L3: −5,26° frente a −5,33°). En L4 se recupera la línea de vista a ~634 m del WP3.

Ficheros de datos asociados: `data/mission-scenarios/triangulo_supervivencia.geojson`, `data/mission-scenarios/eva_thresholds.json`, `data/nasa-layers/layers_catalog.json`. Este documento y esos ficheros deben coincidir.

## 2. Cifras compartidas por toda la documentación y la interfaz

110 TIU · 22° · O₂ 3,2 L/min · τ 0,7→2,4 · Base **48 min y 2,15 km** (47,6 min y 2.148 m de camino del planificador) · límite radiación 15 min · WP3 **9,4 min («unos 9 min»)** / 600 m en línea recta (595 m de camino) · SVF 0,15 · 85 % · >12 % H₂O · **Chaos Mode 96,0 % de misión segura con cambio al refugio frente a 23,8 % solo con la Base** (10.000 simulaciones, semilla 42) · **replanificación del cambio de destino 17 ms medidos** · **enlace primario en banda S** (2,4 GHz; baliza UHF) · dosis de decisión en T+105: refugio **0,89 mSv**, Base **5,30 mSv** · voz <8 s.

Ya no son cifras del proyecto: 99,4 % de Chaos Mode, Dynamic Goal Switching <10 ms, ruta segura de 2.500 m y 6,4 mSv como dosis del retorno.

## 3. Física verificada

- **Agua en sulfatos [D]:** kieserita MgSO₄·H₂O = 13,0 % peso y es **mono**hidratada (no polihidratada); yeso 20,9 %; starkeyita 37,4 %; hexahidrita 47,3 %; epsomita 51,2 %. Mezcla del WP1: ≥12 % en roca total. Liberación: polihidratados <150–200 °C, yeso 100–150 °C, kieserita >300–350 °C. Energía ideal ≈ 153 kWh/t de regolito → ≈1,3 kWh por kg de agua, 120 kg agua/t.
- **Instrumentos:** OMEGA va en **Mars Express** (no en TGO); NOMAD sí en TGO. MEDA está en Perseverance (Jezero) y RAD en Curiosity (Gale): son **análogos extrapolados**, no medidas en Melas. SHARAD sufre *clutter* de paredes en Valles Marineris: solo contexto regional.
- **Presión:** P = 610 Pa · exp(−z / 11,1 km); columna = P / g. Base a −1.660 m → **708 Pa**, columna CO₂ **19,0 g/cm²** [D] (antes 724 Pa y 19,5 g/cm² a −1.905 m; misma fórmula). Gale (−4,4 km): ~23 g/cm² [M]. Es decir, nuestro sitio tiene **menos** blindaje atmosférico que Gale; la frase "mayor presión del fondo de Melas" solo vale para el piso más profundo (−5 km).
- **Sublimador:** 708 Pa está por encima del punto triple del agua (611 Pa) → un sublimador no funciona bien; el traje usa evaporador de membrana (SWME). El traje conserva el campo «agua de refrigeración LCVG».
- **Radiación [M]:** GCR en superficie (RAD, Gale) ≈ 0,21 mGy/día, ≈ 0,64 mSv/día ≈ 0,027 mSv/h. SPE de sept. 2017: 2–3× el fondo GCR, dosis integrada apenas superior. Blindaje topográfico medido por RAD: −5 ± 1 % con 19 % de cielo obstruido junto a un butte (Guo et al. 2021); ~19 % de la dosis es albedo del suelo.
- **SPE del escenario [E]:** envolvente de diseño de evento extremo de espectro duro: pico **8 mSv/h** a cielo abierto (≈2 órdenes de magnitud sobre lo medido en 2017). Regla de vuelo: **máx. 2 mSv de dosis SPE por EVA** → 15 min a cielo abierto. En WP3 (SVF 0,15 de la alcoba [E]; el SVF real del DTM es 0,76 [D]): 1,2 mSv/h. **Dosis de decisión** (la que usa el Walkback, modelo del motor: envolvente de 8 mSv/h constante × SVF de cada celda del camino): Base **5,30 mSv** = 2,65× la regla; refugio **0,89 mSv**. La antigua referencia de 6,4 mSv (8 mSv/h durante 48 min a cielo abierto, sin SVF) ya no es la cifra del sistema. **Dosis acumulada** (cronología, perfil temporal de la tormenta): 0,72 mSv al llegar al refugio y 1,52 mSv en T+165. Difieren porque la decisión supone la tasa máxima desde el primer minuto y el SVF de las celdas, mientras que la acumulada sigue la rampa de la tormenta y toma cielo abierto en marcha. **No es letal de forma aguda** por sí sola: la letalidad viene de la combinación (sin radio, visibilidad, consumibles, terreno). El 85 % exige techo de roca (alcoba con cornisa), no solo pared (una pared sola da SVF ≈ 0,5); con albedo/neutrones secundarios la reducción real sería 70–85 %. Límites NASA: carrera 600 mSv; 30 días BFO 250 mGy-Eq.
- **Viento y polvo:** densidad del aire ~0,018 kg/m³ → 30 m/s dan solo ~8 Pa de presión dinámica: el peligro es la **visibilidad y el polvo**, no el empuje. Vientos de ladera modelados 10–30 m/s (Spiga & Forget 2009; Rafkin & Michaels 2003). Catabático = descendente, al caer la tarde cuando la pared entra en sombra. τ=2,4 concentrado en capa límite de 1–2 km → visibilidad ~1,6–3 km [D]: se pierden los muros lejanos (el *Skyline Matching* de Canyon-TRN se degrada a VIO+LiDAR) pero el escarpe cercano a 600 m sigue visible.
- **Metabolismo [D]:** masa con traje 170 kg, peso 632,5 N. Modelo: `M = 120 + η·0,285·W·v + W·v·sinθ / (0,25·(1−s))` W; 1 L O₂/min = 335 W; O₂ 1,429 g/L. η: 1,0 (>400 TIU), 1,3 (250–400), 1,6 (150–250), 2,1 (<150). Valores: llano firme 1,0 m/s = 300 W (0,90 L/min); 10° = 592 W (1,77); 20° = 839 W (2,50); **WP2 22°, 0,55 m/s, η 2,1, deslizamiento 30 % = 1.073 W = 3,2 L/min**, pico transitorio cercano al VO₂máx, insostenible más de 2–3 min. Huida a WP3 (planificador D\* Lite sobre terreno real, topes de huida 1,25 m/s y 650 W): **9,45 min por 595 m de camino, 1,05 m/s y 548 W de media**, 15,4 L de O₂. Retorno a la Base (topes de retorno sostenido 1,0 m/s y 585 W): 47,6 min por 2.148 m, 0,75 m/s, 354 W, 50,3 L de O₂. Los topes viven en `eva_thresholds.json` (`constants`).
- **Traje [E]:** O₂ primario 800 g útiles; agua 4,5 kg; batería 1.000 Wh (~140 W); presión 29,6 kPa. O₂ restante: T+28 93,3 % · T+75 87,1 % · T+98 80,5 % · T+105 77,5 % · T+114 74,9 % · T+115 74,7 % · T+165 71,2 % [D]. El O₂ **no** es el limitante: lo es la radiación.
- **Potencias por fase [D]** (modelo metabólico con la pendiente media real de cada tramo, la velocidad media que imponen los hitos y η de la TIU media de los dos nodos del tramo; ninguna potencia ajustada al O₂):

  | Fase | T | Potencia | Parámetros |
  |---|---|---|---|
  | Marcha L1 | 0–28 | 447 W | 0,893 m/s, +2,98°, η 1,3 |
  | ISRU en WP1 | 28–75 | 250 W [E] | trabajo ligero de muestreo |
  | Marcha L2 | 75–98 | 539 W | 0,870 m/s, +5,62°, η 1,3 (ámbar 23 min, bajo el rojo de 585 W) |
  | Pico en la rampa del WP2 | 98–101 | **1.073 W** | 22° [E], 0,55 m/s, η 2,1, s 0,30 |
  | Rampa lenta | 101–105 | 585 W | ritmo regulado al rojo sostenido: 0,268 m/s |
  | Huida a WP3 (incluye la entrada bajo la cornisa) | 105–114,45 | **548 W** | planificador D\* Lite: 9,45 min, 595 m, 1,05 m/s de media |
  | Refugio | 114,45–165 | 130 W [E] | reposo presurizado |

  Media de la rampa del WP2 (T+98–105): 794 W (antes «800»). Huida (T+105–114,45): 548 W del planificador (antes «650»). Solo el pico del WP2 (3 min) pasa de 585 W.
- **Dosis SPE acumulada [D]** (cronología minuto a minuto; perfil nominal «rampa calibrada»; entre paréntesis, envolvente de 8 mSv/h constantes): llegada a WP3 en T+114,45 **0,72** (1,26) · T+115 0,73 (1,27) · T+125 0,91 (1,47) · T+140 1,21 (1,77) · T+158 1,47 (2,13) · T+165 **1,52** (2,27) mSv. GCR aparte: 0,074 mSv en T+0–165. El nudo (108, 5) de la rampa se calibró para el escape de 8 min (0,58 mSv) y no se recalibra.
- **Walkback Limit Dual en T+105 [D, motor]:** Base: 2.148 m, 47,6 min, O₂ necesario 50,3 L (71,9 g), **dosis de decisión 5,30 mSv**, margen −32,6 min → **no viable**. WP3: 595 m, 9,45 min, 15,4 L (22,1 g), **0,89 mSv**, margen 5,55 min (rojo según umbral; la regla de 10 min solo se aplica a la Base) → **viable**. T_vital 17,9 min; ventana a cielo abierto 15,0 min. SVF medio efectivo de los caminos: 0,70 (refugio) y 0,84 (Base).
- **Dos modelos de dosis:** la **dosis de decisión** (proyección del Walkback) es la del motor: envolvente constante × SVF por celda; responde a «¿cabe la ruta en 2 mSv?». La **dosis acumulada** de la cronología usa el perfil temporal de la tormenta, cielo abierto en marcha y SVF 0,15 bajo la cornisa; responde a «¿cuánto ha recibido?». Ver `SCHEMA_EVA07.md` §5 y §9.
- **Chaos Mode [D, motor]:** 10.000 simulaciones (semilla 42): **96,02 %** de misión segura con cambio automático al refugio frente a **23,84 %** si solo se permite volver a la Base. Corre sobre un corredor sintético de Melas (H3 res. 11); el propio JSON lista sus limitaciones (celdas muestreadas por posición, solo O₂ primario como consumible, huida al refugio modelada como un tramo al 55 % de la dosis a cielo abierto).
- **Radio [D]:** enlace primario de datos (sesión Zenoh) en **banda S, 2,4 GHz, 1 W**: pérdida en espacio libre 108,0 dB a 2,5 km → ≈ −78 dBm con LOS; la difracción de arista única sobre el DTM CTX real añade 26,4 dB en WP2 y 33,8 dB en WP3 → −103,1 dBm en WP2 y −107,9 dBm en WP3 (en la ruta, hasta −114 dBm). Baliza **UHF 435 MHz, 1 W** de baja tasa (93,2 dB a 2,5 km → ≈ −63 dBm con LOS): tras el relieve solo pierde 19–26 dB (−81,0 dBm en WP2, −85,7 dBm en WP3), así que sobrevive degradada y el sistema no depende de ella. Por eso la sombra de radio es la del enlace en banda S: con UHF no llegaría a rojo por nivel. Umbrales: verde > −85, ámbar −85…−100, rojo < −100 dBm o NLOS >60 s. Detalle en `data/nasa-layers/SCHEMA_HEXGRID.md`.
- **H3 en Marte [D]:** arista res 9 ≈ 93 m (≈ THEMIS), res 12 ≈ 5 m (navegación).

## 4. Cronología fija de EVA-07 (minutos terrestres; salida 14:45 LMST)

T−45 inspección Spyglass · T−30 Chaos Mode (10.000 simulaciones Monte Carlo, semilla 42, 100 visibles en pantalla: 96,0 % de misión segura con cambio al refugio frente a 23,8 % solo con la Base) · T−10 sincronización Zenoh · T+0 salida · T+28 llegada WP1 · T+28–75 ISRU · T+75 salida hacia WP2 · **T+92 NLOS** · **T+98 suelo 110 TIU / 22°** (pico 3,2 L/min) · **T+105 alerta SPE + frente de polvo (τ 0,7→2,4): las 4 amenazas activas a la vez** · T+105 Dynamic Goal Switching · **T+114 llegada a WP3** (T+114,45 exacto; dosis acumulada ≈ 0,7 mSv; dosis de decisión de la ruta 0,89 mSv) · T+115 refugio activo · T+125 pico SPE · T+115–140 refugio activo · T+140–165 remite el pico, telemetría final · **T+158 se restablece Zenoh** (repetidor desplegado por rover desde la Base).

Nota: una versión anterior del escenario ponía la «llegada» en el Acto 5 (T+140); con 9,4 min de huida (planificador) y 15 min de ventana, la llegada tiene que ser en T+114 (T+114,45). Los actos conservan sus rangos, pero el Acto 4 incluye la llegada y el Acto 5 es la permanencia y recuperación.

