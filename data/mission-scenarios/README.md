# 📍 `data/mission-scenarios/` — Escenario "Triángulo de Supervivencia" (Melas Chasma)

Definición de la misión **EVA-07** en la cuenca suroeste de Melas Chasma (Valles Marineris), al pie de su pared suroeste. Explicación en las secciones 1, 3 y 4 de [`CIENCIA_Y_MISION.md`](../../docs/01-planetary-science-mission/CIENCIA_Y_MISION.md).

| Nodo | Lat / Lon E | Cota (DTM CTX 20 m) | Papel |
| :--- | :--- | :--- | :--- |
| Base | −9,89646 / 283,38920 | −1.660 m | Hábitat en terraza aluvial (2,8°) |
| WP1 | −9,91880 / 283,40126 | −1.582 m | ISRU de agua en sulfatos hidratados (6,7°; ≥12 % de agua, escenario) |
| WP2 | −9,93261 / 283,38623 | −1.464 m | Geología y alto riesgo: talud real de 19,4° (rampa local de 22°, escenario), 110 TIU (escenario), sin radio |
| WP3 | −9,92286 / 283,38349 | −1.520 m | Refugio: alcoba con cornisa (SVF 0,15, escenario; 0,76 en el DEM) en un talud de 20,1°, sin radio |

Tramos: 1.500 / 1.200 / 600 / 1.600 m (perímetro 4.900 m); retorno WP2→Base 2.150 m en línea recta y 2.500 m por la ruta segura.

| Fichero | Contenido |
| :--- | :--- |
| `triangulo_supervivencia.geojson` | Nodos y tramos en `IAU_2015:49900`, orden `[lon, lat, elev]`, con procedencia por campo (`property_provenance`), SVF del DEM, margen de línea de vista y horizonte |
| `triangulo_supervivencia_original_9.8S_283.6E.geojson` | Versión original del escenario en 9,8°S, 283,6°E, conservada como referencia (sustituida por la reubicación) |
| `eva_thresholds.json` | Umbrales Verde/Ámbar/Rojo de la máquina de estados del traje y constantes físicas (gravedad, 170 kg, 335 W por L/min, 708 Pa, 19,0 g/cm²) |
| `eva07_timeline.parquet` | Cronología de la EVA-07 minuto a minuto (T−45 a T+165, 211 filas): posición, potencia, O₂, tasas y dosis SPE (tres perfiles), radio, amenazas y Walkback Limit |
| `eva07_events.json` | Hitos de la cronología, fases, ventanas de amenaza, comparación de perfiles SPE y valores finales |
| `SCHEMA_EVA07.md` | Esquema de los dos ficheros anteriores y discrepancias detectadas |

`eva07_timeline.parquet`, `eva07_events.json` y `SCHEMA_EVA07.md` se regeneran con `cd data/pipeline && uv run python -m red_atlas_pipeline.scenario`; el GeoJSON, con `uv run python -m red_atlas_pipeline.terrain.relocate`.
