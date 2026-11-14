# Datos canónicos P1 — fuente única de cifras del escenario EVA-07

Fuente única de cifras para `ENTREGABLE_1_CIENCIA_Y_MISION.md`, el validador `red_atlas_p1.scenario` y el núcleo Rust. Un cambio de cifra se hace aquí y en los JSON de `data/mission-scenarios/`, y después se regeneran las salidas.

> **Actualizado tras la reubicación del sitio (2026-11-14).** El triángulo se trasladó 13,6 km (rumbo 245°) al pie de la pared suroeste de la cuenca, como figura rígida (detalle en `data/nasa-layers/SITE_REALITY_CHECK.md`). Nodos, tramos, presión, columna, potencias por fase, O₂ por hito y dosis acumulada salen del validador `data/pipeline/src/red_atlas_p1/scenario/` (`uv run python -m red_atlas_p1.scenario`), que regenera `data/mission-scenarios/eva07_timeline.parquet`, `eva07_events.json` y `SCHEMA_EVA07.md`. Las cifras compartidas de §2 no cambian.

Etiquetas de procedencia obligatorias en tablas: **[M]** medido/publicado · **[D]** derivado por cálculo · **[E]** supuesto del escenario de diseño.

## 1. Sitio y geometría

- Cuenca suroeste de Melas Chasma, pie de la pared suroeste (Base en 9,89646°S, 283,38920°E = 76,61080°W; el sitio original de 9,8°S, 283,6°E no tenía ni la rampa del WP2 ni el escarpe del WP3). Paleolago con abanicos (Quantin et al. 2005; Metz et al. 2009; Williams & Weitz 2014). Fue uno de los 8 candidatos de aterrizaje de Mars 2020 (taller 2015). CRISM: sulfatos hidratados interestratificados con esmectitas Fe/Mg, bajo una unidad gruesa de sulfato monohidratado; jarosita y ópalo en exposiciones menores (Weitz et al. 2015; Liu et al. 2018 — verificar año/DOI).
- La cuenca está **colgada ~1 km sobre el piso principal** del cañón; su depresión cerrada sigue la curva **−1.800 m** MOLA [M]. Por tanto: "7–9 km" = relieve total del sistema (meseta ≈ +4 km a piso más profundo ≈ −5 km); relieve local de pared en nuestro sitio ≈ 5–6 km [D]; "pared de 4 km" = tramo de escarpe local visible sobre WP3 [E].
- CRS: IAU 2015:49900 (Marte esférico, ocentrico, Este positivo 0–360), R = 3.396.190 m. 1° lat = 59.274,7 m; 1° lon = 58.392,7 m a 9,9°S. GeoJSON en orden `[lon, lat, elev]`.
- Las posiciones salen de una búsqueda rígida sobre el DTM CTX de 20 m `P18_007878_1703_XN_09S076W__P20_008735_1702_XI_09S076W` [D]; cotas medidas [M]; pendientes, SVF y línea de vista derivadas [D]. Siguen siendo **escenario de diseño [E]** la alcoba con cornisa del WP3 y las TIU (hay que fijarlas sobre THEMIS real). Ningún DTM HiRISE cubre la ruta. No inventar IDs de escena (HiRISE/CTX/CRISM): citar solo tipo de producto PDS y marcar "ID de escena por confirmar en PDS ODE".

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
| WP2→Base (R1, retorno) | 2.150 m en línea recta; **2.500 m por ruta segura D\* Lite** (rodeo 1,16 evitando bancos <150 TIU) | −196 m | 5° | −5,20° | 21,4° |

Pendiente media del GeoJSON = perfil del DTM; difiere de atan(Δz/d) hasta 0,07° (L3: −5,26° frente a −5,33°). En L4 se recupera la línea de vista a ~634 m del WP3.

Ficheros de datos asociados: `data/mission-scenarios/triangulo_supervivencia.geojson`, `data/mission-scenarios/eva_thresholds.json`, `data/nasa-layers/layers_catalog.json` (léelos y sé coherente con ellos).

## 2. Cifras compartidas con P2/P3/Fase 4 (verbatim)

110 TIU · 22° · O₂ 3,2 L/min · τ 0,7→2,4 · Base 48 min · límite radiación 15 min · WP3 8 min / 600 m · SVF 0,15 · 85 % · >12 % H₂O · 99,4 % Chaos Mode · Dynamic Goal Switching <10 ms · voz <8 s.

## 3. Física verificada y correcciones que hay que reflejar

- **Agua en sulfatos [D]:** kieserita MgSO₄·H₂O = 13,0 % peso y es **mono**hidratada (no polihidratada); yeso 20,9 %; starkeyita 37,4 %; hexahidrita 47,3 %; epsomita 51,2 %. Mezcla del WP1: ≥12 % en roca total. Liberación: polihidratados <150–200 °C, yeso 100–150 °C, kieserita >300–350 °C. Energía ideal ≈ 153 kWh/t de regolito → ≈1,3 kWh por kg de agua, 120 kg agua/t.
- **Instrumentos:** OMEGA va en **Mars Express** (no en TGO); NOMAD sí en TGO. MEDA está en Perseverance (Jezero) y RAD en Curiosity (Gale): son **análogos extrapolados**, no medidas en Melas. SHARAD sufre *clutter* de paredes en Valles Marineris: solo contexto regional.
- **Presión:** P = 610 Pa · exp(−z / 11,1 km); columna = P / g. Base a −1.660 m → **708 Pa**, columna CO₂ **19,0 g/cm²** [D] (antes 724 Pa y 19,5 g/cm² a −1.905 m; misma fórmula). Gale (−4,4 km): ~23 g/cm² [M]. Es decir, nuestro sitio tiene **menos** blindaje atmosférico que Gale; la frase "mayor presión del fondo de Melas" solo vale para el piso más profundo (−5 km).
- **Sublimador:** 708 Pa está por encima del punto triple del agua (611 Pa) → un sublimador no funciona bien; el traje usa evaporador de membrana (SWME). Mantén el campo "agua de refrigeración LCVG".
- **Radiación [M]:** GCR en superficie (RAD, Gale) ≈ 0,21 mGy/día, ≈ 0,64 mSv/día ≈ 0,027 mSv/h. SPE de sept. 2017: 2–3× el fondo GCR, dosis integrada apenas superior. Blindaje topográfico medido por RAD: −5 ± 1 % con 19 % de cielo obstruido junto a un butte (Guo et al. 2021); ~19 % de la dosis es albedo del suelo.
- **SPE del escenario [E]:** envolvente de diseño de evento extremo de espectro duro: pico **8 mSv/h** a cielo abierto (≈2 órdenes de magnitud sobre lo medido en 2017). Regla de vuelo: **máx. 2 mSv de dosis SPE por EVA** → 15 min a cielo abierto. En WP3 (SVF 0,15 de la alcoba [E]; el SVF real del DTM es 0,76 [D]): 1,2 mSv/h. Volver a Base (48 min) ≈ 6,4 mSv = 3,2× la regla. **No es letal de forma aguda** por sí sola: la letalidad viene de la combinación (sin radio, visibilidad, consumibles, terreno). El 85 % exige techo de roca (alcoba con cornisa), no solo pared (una pared sola da SVF ≈ 0,5); con albedo/neutrones secundarios la reducción real sería 70–85 %. Límites NASA: carrera 600 mSv; 30 días BFO 250 mGy-Eq.
- **Viento y polvo:** densidad del aire ~0,018 kg/m³ → 30 m/s dan solo ~8 Pa de presión dinámica: el peligro es la **visibilidad y el polvo**, no el empuje. Vientos de ladera modelados 10–30 m/s (Spiga & Forget 2009; Rafkin & Michaels 2003). Catabático = descendente, al caer la tarde cuando la pared entra en sombra. τ=2,4 concentrado en capa límite de 1–2 km → visibilidad ~1,6–3 km [D]: se pierden los muros lejanos (el *Skyline Matching* de Canyon-TRN se degrada a VIO+LiDAR) pero el escarpe cercano a 600 m sigue visible.
- **Metabolismo [D]:** masa con traje 170 kg, peso 632,5 N. Modelo: `M = 120 + η·0,285·W·v + W·v·sinθ / (0,25·(1−s))` W; 1 L O₂/min = 335 W; O₂ 1,429 g/L. η: 1,0 (>400 TIU), 1,3 (250–400), 1,6 (150–250), 2,1 (<150). Valores: llano firme 1,0 m/s = 300 W (0,90 L/min); 10° = 592 W (1,77); 20° = 839 W (2,50); **WP2 22°, 0,55 m/s, η 2,1, deslizamiento 30 % = 1.073 W = 3,2 L/min**, pico transitorio cercano al VO₂máx, insostenible más de 2–3 min. Escape a WP3 (1,25 m/s, **cuesta abajo**, −56 m): 593 W el primer minuto (banco de 110 TIU) y 413 W el resto; el modelo no acredita trabajo en bajada ni cuenta su coste excéntrico.
- **Traje [E]:** O₂ primario 800 g útiles; agua 4,5 kg; batería 1.000 Wh (~140 W); presión 29,6 kPa. O₂ restante: T+28 93,3 % · T+75 87,1 % · T+98 80,5 % · T+105 77,5 % · T+114 75,3 % · T+165 71,8 % [D]. El O₂ **no** es el limitante: lo es la radiación.
- **Potencias por fase [D]** (modelo metabólico con la pendiente media real de cada tramo, la velocidad media que imponen los hitos y η de la TIU media de los dos nodos del tramo; ninguna potencia ajustada al O₂):

  | Fase | T | Potencia | Parámetros |
  |---|---|---|---|
  | Marcha L1 | 0–28 | 447 W | 0,893 m/s, +2,98°, η 1,3 |
  | ISRU en WP1 | 28–75 | 250 W [E] | trabajo ligero de muestreo |
  | Marcha L2 | 75–98 | 539 W | 0,870 m/s, +5,62°, η 1,3 (ámbar 23 min, bajo el rojo de 585 W) |
  | Pico en la rampa del WP2 | 98–101 | **1.073 W** | 22° [E], 0,55 m/s, η 2,1, s 0,30 |
  | Rampa lenta | 101–105 | 585 W | ritmo regulado al rojo sostenido: 0,268 m/s |
  | Salida del banco blando | 105–106 | 593 W | 1,25 m/s, bajada, η 2,1 |
  | Escape L3 | 106–113 | 413 W | 1,25 m/s, bajada, η 1,3 |
  | Entrada bajo la cornisa | 113–114 | 645 W | 0,5 m/s [E] por el talud real de 20,1°, η 1,0 |
  | Refugio | 114–165 | 130 W [E] | reposo presurizado |

  Media de la rampa del WP2 (T+98–105): 794 W (antes «800»). Media del escape (T+105–113): 435 W (antes «650»). Ninguna fase pasa más de 5 min seguidos por encima de 585 W.
- **Dosis SPE acumulada [D]** (perfil nominal «rampa calibrada»; entre paréntesis, envolvente de 8 mSv/h constantes): T+113 0,58 (1,07) · T+114 0,59 (1,09) · T+125 0,79 (1,31) · T+140 1,09 (1,61) · T+158 1,35 (1,97) · T+165 **1,40** (2,11) mSv. GCR aparte: 0,074 mSv en T+0–165. La reubicación no cambia la dosis: depende de la cronología y del SVF 0,15, no de la geometría.
- **Radio [D]:** UHF 435 MHz, 1 W: pérdida en espacio libre 93,2 dB a 2,5 km → ≈ −63 dBm con LOS; difracción en el espolón añade 20–30+ dB → −95…−110 dBm. Umbrales: verde > −85, ámbar −85…−100, rojo < −100 dBm o NLOS >60 s.
- **H3 en Marte [D]:** arista res 9 ≈ 93 m (≈ THEMIS), res 12 ≈ 5 m (navegación).

## 4. Cronología fija de EVA-07 (minutos terrestres; salida 14:45 LMST)

T−45 inspección Spyglass · T−30 Chaos Mode (10.000 simulaciones Monte Carlo, 100 visibles en pantalla, 99,4 % = 9.940 supervivencias) · T−10 sincronización Zenoh · T+0 salida · T+28 llegada WP1 · T+28–75 ISRU · T+75 salida hacia WP2 · **T+92 NLOS** · **T+98 suelo 110 TIU / 22°** (pico 3,2 L/min) · **T+105 alerta SPE + frente de polvo (τ 0,7→2,4): las 4 amenazas activas a la vez** · T+105 Dynamic Goal Switching · **T+113–114 llegada a WP3** (dosis acumulada ≈ 0,6 mSv) · T+125 pico SPE · T+114–140 refugio activo · T+140–165 remite el pico, telemetría final · **T+158 se restablece Zenoh** (repetidor desplegado por rover desde la Base).

Nota: el plan original pone la "llegada" en el Acto 5 (T+140); con 8 min de marcha y 15 min de ventana, la llegada tiene que ser en T+113–114. Los actos conservan sus rangos, pero el Acto 4 incluye la llegada y el Acto 5 es la permanencia y recuperación. Decirlo explícitamente.

## 5. Formato

- Español con ortografía completa. Markdown para GitHub. Sin código fuente (sí esquemas de datos).
- Mermaid que renderice en GitHub: etiquetas con paréntesis o símbolos entre comillas dobles, saltos con `<br/>`, nunca `\n`.
- Stack a mencionar donde toque: Python (GDAL, Rasterio, PDS4-tools) → COG / GeoJSON / Parquet; Rust `h3o` + DuckDB Spatial; ROS 2 `rclrs` + Eclipse Zenoh; `nalgebra` EKF; Candle / `ort` + `whisper-rs`; React + CesiumJS + Three.js (shader WebGPU Spyglass: sector norte CRISM azul eléctrico, derecha THEMIS magenta/naranja, izquierda MOLA/HiRISE + SVF).
- Solo se toca el carril P1. No hacer commit ni push, no cambiar de rama.
