# Comprobación de realidad del sitio — Melas Chasma, EVA-07 (emplazamiento reubicado)

> Generado por `uv run python -m red_atlas_p1.terrain` el 2026-11-14T21:25:22Z. Las cifras salen de
> `site_reality_check.json`; no editar a mano. Convención: coma decimal; cotas en metros sobre el
> areoide MOLA; longitudes Este 0–360.

## Veredicto

El triángulo se ha reubicado 13,6 km al suroeste (rumbo 245°), al pie de la pared suroeste de la misma cuenca cerrada, manteniendo rígida la figura. En el DTM CTX de 20 m la Base queda a −1.660 m con 2,8° de pendiente; el WP2 está sobre una ladera real de 19,4°; el WP3 ve un horizonte de hasta 20,7° y tiene un SVF real de 0,76; y no hay línea de vista de radio desde la Base al WP2 ni al WP3 (márgenes de −24,7 y −28,2 m, fuera del ruido), pero sí al WP1 (+0,6 m). En el par CTX de trabajo se cumplen las condiciones con umbral (a, b, c, e, f, g). Matices: solo se cumplen todas en 2 de los 4 pares CTX que cubren la colocación; la (c) está en el límite inferior y no es robusta (WP2 entre 14,0° y 19,4° según el par, y el par de trabajo da el valor más alto); la línea de vista al WP1 (entre +0,8 y +3,5 m) está dentro del ruido de ±5 m del DTM, es decir, es indeterminada; y la (d) es la condición débil: el WP3 está en un talud, no al pie de un escarpe. Presión en la Base: 708 Pa; columna de CO₂: 19,0 g/cm². Siguen siendo escenario la inercia térmica y la alcoba con cornisa del WP3 (SVF 0,15), y el WP3 sigue quedando por debajo del WP2.

## 1. Condiciones de la colocación

| Condición | ¿Se cumple? | Cifra real |
|---|---|---|
| (a) Cobertura completa del DTM CTX en nodos y ruta | **Sí** | Los cuatro nodos y los cinco tramos, sin huecos; 99,9 % de la caja de la AOI de ruta y 95,9 % del entorno cercano |
| (b) Base en terreno llano y seguro (< 3°) | **Sí** | 2,8° en el nodo; máximo 3,8° a 60 m |
| (c) WP2 sobre pendiente real de 18–26° | **Sí** | 19,4° en el nodo; hasta 20,0° a 100 m |
| (d) WP3 con máximo horizonte y mínimo SVF | Optimizada | SVF 0,76; horizonte hasta 20,7° (media 13,7°); mínimo fiable de la AOI de ruta 0,72 |
| (e) WP1 con pendiente < 8° | **Sí** | 6,7° |
| (f) Sin LOS a WP2 y WP3, con LOS a WP1 | **Sí** | WP1 +0,6 m; WP2 −24,7 m; WP3 −28,2 m |
| (g) L1 y L4 sin celdas por encima de 25° | **Sí** | L1 8,0°; L4 20,1° (L2 19,9°; L3 22,5°) |

**Orden aplicado.** Primero los umbrales (a), (b), (c), (e), (f) y (g) como filtros; después (d) como criterio de
desempate. Si se quiere (d) por delante de (e)–(g), hay que repetir la selección con ese orden.

**La condición débil es la (d).** El WP3 tiene un SVF real de 0,76 frente a 0,85 en la Base, y un
horizonte máximo de 20,7° frente a 19,0°: la mejora es pequeña. Está sobre un talud de
20,1°, no al pie de un escarpe. En toda la AOI de ruta el cielo más cerrado fuera de artefactos de borde del DTM es
SVF 0,72, a 140 m del WP3 con rumbo 287°
(−9,92217°, 283,38120°E, cota −1.536 m, pendiente 24,8°); el percentil 1 es
0,77 y el 0,0 % de la AOI baja de 0,70. Es decir, a 20 m este tramo de pared
no ofrece un abrigo topográfico mucho mejor que el del WP3: el refugio del escenario depende de la alcoba con cornisa,
que sigue siendo **[E]**.

## 2. Nodos

| Nodo | Latitud (°) | Longitud E (°) | Cota CTX 20 m (m) | Rango entre pares CTX (m) | Pendiente 20 m | Máx. a 100 m | SVF derivado | Horizonte máx. | LOS con la Base (margen) | Presión (Pa) | CO₂ (g/cm²) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Base | −9,89646 | 283,38920 | **−1.660** | −1.660 a −1.633 (5) | **2,8°** | 4,6° | **0,85** | 19,0° hacia 190° | — | 708 | 19,0 |
| WP1 ISRU | −9,91880 | 283,40126 | **−1.582** | −1.583 a −1.572 (5) | **6,7°** | 10,0° | **0,85** | 20,1° hacia 200° | sí (+0,6 m) | 703 | 18,9 |
| WP2 riesgo | −9,93261 | 283,38623 | **−1.464** | −1.468 a −1.456 (5) | **19,4°** | 20,0° | **0,84** | 22,3° hacia 170° | no (−24,7 m) | 696 | 18,7 |
| WP3 refugio | −9,92286 | 283,38349 | **−1.520** | −1.524 a −1.513 (5) | **20,1°** | 24,1° | **0,76** | 20,7° hacia 220° | no (−28,2 m) | 699 | 18,8 |

- Cota **medida** en el DTM CTX `P18_007878_1703_XN_09S076W__P20_008735_1702_XI_09S076W`; pendiente, SVF, horizonte y línea de vista **derivados** de él.
  El rango entre pares es la dispersión de los pares CTX con cobertura (número entre paréntesis).
- El WP3 queda 55 m **por debajo** del WP2: el refugio se
  alcanza bajando, no subiendo como en el escenario original.
- SVF con la definición de ángulo sólido, 1 − media(sen θ). El 0,15 del WP3 que figura en el GeoJSON es la alcoba con
  cornisa de diseño; un DEM 2,5D no puede representarla. El valor real está en `sky_view_factor_dem`.
- La pendiente a 20 m se mide sobre una base de 40 m: no ve rampas, bloques ni escalones más cortos.

## 3. Tramos

| Tramo | Distancia (m) | Rumbo | Desnivel real (m) | Pendiente media | Pendiente mediana / máx. en el tramo |
|---|---|---|---|---|---|
| L1 BASE→WP1 | 1.500 | 152° | **+78** | +3,0° | 4,4° / **8,0°** |
| L2 WP1→WP2 | 1.200 | 227° | **+118** | +5,6° | 10,1° / **19,9°** |
| L3 WP2→WP3 | 600 | 344° | **−56** | −5,3° | 14,7° / **22,5°** |
| L4 WP3→BASE | 1.600 | 12° | **−140** | −5,0° | 5,5° / **20,1°** |
| R1 WP2→BASE | 2.150 | 5° | **−196** | −5,2° | 7,4° / **21,4°** |

Las distancias y los ángulos entre tramos son los del escenario original (figura rígida, perímetro 4.900 m); los rumbos
han girado 37°. Los desniveles son ahora mucho mayores: el recorrido sube 196 m
de la Base al WP2, frente a 85 m en el escenario original. Esto afecta al modelo metabólico y al consumo de O₂.

## 4. Presión y columna de CO₂ en la nueva cota

P = 610 Pa · exp(−z / 11,1 km); columna de CO₂ = P / g. Es la fórmula que reproduce los valores canónicos del proyecto (724 Pa y 19,5 g/cm² a −1.905 m).

| | Cota (m) | Presión (Pa) | Columna de CO₂ (g/cm²) |
|---|---|---|---|
| **Base reubicada** | −1.660 | **708** | **19,0** |
| Base original | −1.905 | 724 | 19,5 |
| Gale (referencia RAD) | −4.400 | — | 23 |

La Base sube 245 m, así que pierde 16 Pa y
0,4 g/cm² de blindaje atmosférico: todavía menos que en Gale. La presión
sigue por encima del punto triple del agua (611,7 Pa), de modo que el argumento del evaporador de membrana frente al sublimador se mantiene.
En el WP2 (−1.464 m) la presión baja a 696 Pa.

## 5. Entorno: cuenca, pared y horizonte

- **Misma cuenca cerrada.** La nueva Base (−1.677 m en MOLA) sigue dentro de la depresión que
  desborda a −1.168 m (690 km²), 509 m por debajo del collado.
  Está 13,6 km al suroeste de la Base original.
- **Pared.** Subida de +1 km más cercana a la Base: 4,6 km con rumbo 171°
  (rampa de 3,2 km a 15,6° de media). Borde de meseta (≥ +3.000 m) a
  14,2 km con rumbo 194°.
- **Relieve.** 3.071 m sobre la Base en 10 km, 5.471 m en 25 km y
  8.241 m de relieve total en 100 km.
- **Ruta.** Desnivel total de la AOI 715 m; pendiente mediana 7,2°, percentil 95
  23,9°, máxima 36,4°; el 14,3 % de las celdas
  supera 20°. SVF entre 0,54 y 0,86. El 66 % de la AOI no tiene
  línea de vista geométrica con la Base.

## 6. Cómo se eligió: búsqueda con la figura rígida

Grados de libertad: traslación (paso 40 m), rotación (paso 3°) y simetría especular. Se recorrió el borde sur y este de la cuenca
(lat −10,06° a −9,74°, lon 283,30° a 283,92°E)
en cada par CTX de 20 m por separado, sin mosaico. Reproducible con `uv run python -m red_atlas_p1.terrain.site_search`.

| Filtro acumulado | Colocaciones |
|---|---|
| Evaluadas | 805.488.960 |
| (a) cobertura en los cuatro nodos | 404.563.031 |
| + (b) Base llana y segura | 116.801.316 |
| + (e) WP1 < 8° | 113.200.397 |
| + (c) WP2 en 18–26° | 416.743 |
| + (g) L1 y L4 ≤ 25° y cobertura de toda la ruta | 361.631 |
| + (f) sombra de radio clara en WP2 y WP3 | **1.022** |

Sí existen colocaciones que cumplen (c) y (d) a la vez con la figura rígida: no ha hecho falta relajar ninguna distancia.
Entre las 1.022 que cumplen todo se ordenó por SVF real mínimo en el WP3 (el mejor valor alcanzable con todas las demás condiciones es ~0,72) y se afinó a 20 m y 1°, exigiendo que la colocación cumpliera todas las condiciones en al menos dos pares CTX
independientes. Solo tres colocaciones lo consiguen; se eligió la de mayor margen de sombra de radio.

La misma colocación medida en cada par CTX independiente que la cubre (pendiente a 20 m):

| Par CTX | Base | WP1 | WP2 | WP3 | Margen LOS WP1 / WP2 / WP3 (m) | L1 / L4 máx. | Cumple todo |
|---|---|---|---|---|---|---|---|
| `D02_027855_1710_XN_09S077W_` | 0,9° | 7,4° | 18,1° | 21,9° | +1,7 / −23,7 / −29,3 | 7,4° / 21,9° | sí |
| `F22_044325_1692_XN_10S076W_` | 1,2° | 6,1° | 14,0° | 22,2° | +3,5 / −22,5 / −33,5 | 7,5° / 22,2° | no: c |
| `P18_007878_1703_XN_09S076W_` | 2,8° | 6,7° | 19,4° | 20,1° | +0,8 / −25,0 / −29,1 | 8,0° / 20,1° | sí |
| `P20_008669_1703_XI_09S076W_` | 4,2° | 5,6° | 15,9° | 25,3° | +2,7 / −23,6 / −30,0 | 7,2° / 25,3° | no: b, c, g |

La sombra de radio y la Base llana se sostienen en todos los pares. La pendiente del WP2 no: va de 14,0° a
19,4° según el par, de modo que la condición (c) se cumple **en el límite inferior** y solo en
2 de 4 pares. Es una ladera de talud de ~15–20°, no una rampa de 22°.

## 7. Por qué se trasladó: resultado del sitio original (9,8°S, 283,6°E)

Resumen de `site_reality_check_original_site.json` (DTM CTX `P04_002551_1712_XI_08S076W_`):

| Afirmación del escenario original | Realidad medida |
|---|---|
| Base a −1.905 m dentro de la cuenca | **Confirmado**: −1.906 m, en una depresión cerrada de 690 km² |
| WP1, WP2 y WP3 a −1.878, −1.820 y −1.790 m | −1.894, −1.872 y −1.885 m (−16, −52 y −95 m) |
| Rampa de 22° (18–26°) en el WP2 | 2,6° en el nodo; máximo de toda la AOI 7,2° |
| Escarpe con alcoba en el WP3, a 600 m del WP2 | Relieve de +1 km más cercano a 8,5 km; desnivel total de la AOI 68 m |
| SVF 0,92 / 0,90 / 0,78 / 0,15 | 0,85–0,86 en toda la ruta |
| Sin LOS de radio en WP2 y WP3 | LOS geométrica en ambos (márgenes de +2,4 y +1,3 m, dentro del ruido) |
| Depresión cerrada que sigue la curva de −1.800 m | Cerrada hasta −1.168 m |

El sitio original era real y estaba dentro de la cuenca, pero era un piso casi llano: ni el talud del WP2 ni el escarpe
del WP3 existían. El GeoJSON original se conserva en `data/mission-scenarios/triangulo_supervivencia_original_9.8S_283.6E.geojson`.

## 8. Qué hay que cambiar en el entregable y en los datos compartidos (sin editarlos aquí)

1. **Coordenadas y tabla 1.2.** Sustituir nodos, cotas, pendientes, SVF y LOS por los de la sección 2, con etiqueta
   **[M]** para la cota y **[D]** para lo demás. TIU, geología y alcoba siguen **[E]**.
2. **Tabla de tramos.** Distancias y perímetro no cambian. Rumbos: L1 152°, L2 227°, L3 344°, L4 12°, R1 5°.
   Desniveles: L1 +78 m, L2 +118 m, L3 −56 m, L4 −140 m, R1 −196 m. Pendientes medias:
   L1 +3,0°, L2 +5,6°, L3 −5,3°, L4 −5,0°, R1 −5,2°.
3. **WP2.** «22° (rampas de 18–26°)» → pendiente real de 19,4° a 20 m (14–19° según el par CTX).
   El lóbulo de deslizamiento y la traza de falla siguen sin estar identificados: **[E]**.
4. **WP3.** «+30 m sobre el WP2» → el WP3 está 55 m por debajo. Está
   en una ladera de 20,1°, no al pie de una pared vertical; la alcoba con cornisa sigue **[E]**.
5. **Sombra de radio.** Ahora es real y está **[D]**: márgenes de −24,7 y −28,2 m.
6. **Sección 1.1 y 2.3.** «~9,8°S, 283,6°E = 76,4°W» → 9,90°S, 283,39°E = 76,61°W.
   «~724 Pa y ~19,5 g/cm² a −1,9 km» → 708 Pa y 19,0 g/cm² a −1,66 km.
   «su depresión cerrada sigue la curva de −1.800 m [M]» → cerrada hasta −1.168 m **[D]**.
7. **Sección 2.1 y catálogo.** Huella nueva: 9,88–9,95°S,
   283,36–283,42°E. Productos resueltos en `sources_manifest.json`.
8. **Capa 3 (2.1 y 2.2).** Solo hay mosaicos THEMIS IR día/noche **cualitativos** (DN de 8 bits); no existe un mapa
   cuantitativo de inercia térmica accesible por ventana. Los 320 / 410 / 110 / 620 TIU siguen **[E]**.
9. **Capa 2 (2.1).** El mosaico CTX usado es el controlado de 6 m de USGS (Robbins et al. 2023), no el de Murray Lab,
   que solo se distribuye en teselas ZIP completas.
10. **Capas 1 y 6, y 2.5.** Ningún DTM HiRISE cubre la nueva ruta: la topografía es CTX de 20 m, el SVF sale a 20 m en
    campo cercano y 200 m en campo lejano (no «1–20 m»), y la resolución 12 de H3 (~5 m) es más fina que el dato.
11. **Tabla de relieve de 1.1.** «7–9 km [M]»: 8,2–8,7 km en 100–150 km, correcto;
    pero el piso más profundo en 150 km está a −4.200 m, no a «≈ −5 km». «5–6 km [D]»:
    5,5–5,7 km sobre la nueva Base en 25–50 km. «4 km: escarpe local visible sobre el WP3 [E]»
    → la pared sube 15,6° de media y gana +1 km a 4,6 km de la Base; no hay un escarpe de 4 km sobre el WP3.
12. **Sección 5.2.** La cuenca cerrada mide 46 × 24 km, no «30 × 120 km»; la coordenada alternativa
    12,2°S, 290,0°E está a unos 400 km y no es este sitio. Los supuestos «identidad del sitio» y «alcoba del WP3» pueden
    cerrarse con estas cifras.
13. **`eva_thresholds.json`.** `surface_pressure_pa_site` y `co2_column_g_cm2_site` siguen con los valores del sitio
   original (724 y 19,5); no se han tocado aquí.
14. **Validador (`scenario/`).** Sus tests de geometría y los perfiles de O₂ y potencia de escape dependen de rumbos y
    desniveles: hay que actualizarlos con la tabla de tramos.
15. **Otros consumidores con cifras del sitio original** (no tocados aquí): `docs/.../DATOS_CANONICOS_P1.md`,
    `data/mission-scenarios/eva07_events.json`, `eva07_timeline.parquet`, `SCHEMA_EVA07.md` y lo que el motor en Rust
    tenga escrito a mano.

## 9. Qué no puede decir esta comprobación

- Un DTM de 20 m no ve bloques, rampas cortas, cornisas ni alcobas.
- La inercia térmica no se ha podido contrastar: no hay producto cuantitativo accesible por ventana.
- La línea de vista es geométrica, sin zona de Fresnel ni difracción.
- La pendiente del WP2 depende del par CTX (14–19°): la cifra tiene una incertidumbre de varios grados.
