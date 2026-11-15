# Esquema de la malla H3 de la ruta EVA-07 (`hexgrid`)

> Fichero generado por `cd data/pipeline && uv run python -m red_atlas_p1.hexgrid`. No editar a mano: los recuentos, tamaños y tiempos salen de la ejecución.

Agrega los COG de terreno descritos en `terrain_outputs.json` (DTM CTX de 20 m y sus derivados, THEMIS IR y la capa de escenario) a celdas H3 sobre `AOI_ROUTE` (-9,95..-9,88° N, 283,36..283,42° E) y produce dos vistas por resolución: una tabla completa y documentada y otra con exactamente los campos de `HexCellState64B` (`src/shared/src/lib.rs`).

## 1. Ficheros

| Fichero | Vista | Res. | Filas | Tamaño (zstd) |
|---|---|---|---|---|
| `data/nasa-layers/hexgrid_route_res12.parquet` | completa | 12 | 141.313 | 15,56 MB |
| `data/nasa-layers/hexgrid_route_res12_hexcell64b.parquet` | `HexCellState64B` | 12 | 141.313 | 2,58 MB |
| `data/nasa-layers/hexgrid_route_res9.parquet` | completa | 9 | 462 | 0,14 MB |
| `data/nasa-layers/hexgrid_route_res9_hexcell64b.parquet` | `HexCellState64B` | 9 | 462 | 0,02 MB |

Límite para versionar la tabla completa: 20,00 MB. Si la de resolución 12 lo supera, en el repositorio queda un corredor de 150 m alrededor de los tramos y la completa va a `build/hexgrid/`. Filas ordenadas por `h3_index`; grupos de 65.536 filas con estadísticas mín./máx. para que DuckDB pode por índice. Cada Parquet lleva en sus metadatos (`red_atlas`) la procedencia, las entradas y las constantes de escala.

## 2. Convenciones

- **Índice:** H3 real (librería `h3` 4.x) como `uint64`. H3 trabaja con longitud −180..180: se aplica `config.lon180` al indexar; las tablas guardan ambas longitudes.
- **Métrica:** las funciones métricas de H3 asumen la Tierra. Toda longitud se multiplica por `H3_LENGTH_SCALE` = 0,53307 y toda área por `H3_AREA_SCALE` = 0,28416 (R = 3.396.190 m). Las distancias de esta capa se calculan sobre la esfera de Marte, nunca con las de la librería sin escalar.

| Res. | Arista media global en Marte | Área media global en Marte | Área media en la AOI (`cell_area_m2`) | Píxeles CTX de 20 m por celda en la AOI |
|---|---|---|---|---|
| 12 | 5,77 m | 87,3 m² | 102,9 m² | 0,26 |
| 9 | 107,03 m | 29.932 m² | 35.283 m² | 89,18 |

La arista media que da la librería (`average_hexagon_edge_length`) escalada a Marte es 5,77 m en la resolución 12 y 107,0 m en la 9, no los 5,01 m y 92,86 m de la tabla fija de `h3_mars_grid.rs::resolution_metrics`. Las áreas medias globales sí cuadran (86,87 m² en Rust frente a 87,26 m²), pero en esta latitud las celdas H3 son mayores que la media global: la columna «Área media en la AOI» es la que vale aquí.

- **Coordenadas locales:** `east_m`/`north_m` en metros respecto a la Base, plano tangente sobre la esfera de Marte; las usa DuckDB para radios y rumbos.
- **Procedencia:** `0` sin dato, `1` medido, `2` derivado, `3` escenario (mismos códigos que `terrain_outputs.json`). Cada atributo lleva `<var>_prov` y `<var>_src_res_m`.
- **Nulos:** `NULL` de Parquet. Ningún valor sin dato se rellena con 0.

## 3. Honestidad de resolución y estadísticas de agregación

**Resolución 12 (más fina que el DTM).** Cada celda toma, sin interpolar, el valor del píxel de 20 m que contiene su centro (`ref_pixel_id`). Cada píxel alimenta de media 3,81 celdas (141.313 celdas sobre 37.079 píxeles), que llevan el mismo valor: la resolución real de la información es la de `*_src_res_m`, no la de la celda. THEMIS se muestrea igual en su píxel de 100 m.

**Resolución 9 (más gruesa que el DTM).** Cada celda agrupa los píxeles de la malla de referencia (`dem_ctx_20m_route.tif`) cuyo centro cae dentro (`n_pixels`). Estadística por variable:

| Variable | Estadística a res. 9 | Motivo |
|---|---|---|
| Cota | media (+ mín. y máx.) | variable continua |
| Pendiente | **percentil 90** (+ media y máx.) | conservadora sin depender de un píxel ruidoso del DTM |
| Orientación | media circular + longitud del resultante | ángulo: la media aritmética no vale |
| SVF | media (+ mín. y máx.) | la media es la que representa la dosis en la celda; el mínimo indica si hay un rincón más protegido |
| Horizonte | máximo | el más alto bloquea |
| Línea de vista | 1 solo si todos los píxeles tienen LOS; fracción con LOS; margen mínimo | conservadora para la radio |
| THEMIS DN | media de los valores THEMIS en cada píxel CTX (ponderada por solape) | DN cualitativo |
| Escenario | TIU mínima, SVF mínimo, pendiente máxima, LOS mínima, H₂O máxima + `*_scenario_cover_frac` | si la zona toca la celda, manda el caso peor (o el refugio/recurso presente) |

**Semántica del escenario a resolución 9: «la celda contiene».** Basta que la zona toque un píxel de la celda para que el valor efectivo sea el de escenario. Así, la celda del WP3 sale con SVF 0,15 y bandera `SHELTER` aunque la alcoba de 40 m cubra solo el 13 % de sus píxeles. La tabla de contrato no lleva esa cobertura: el SVF efectivo de resolución 9 sirve para saber dónde hay refugio, **no para calcular dosis**. Para la dosis, usar `svf_mean` o la resolución 12.

A resolución 9 hay 462 celdas; mediana de 89 píxeles por celda (máx. 92); 77 celdas de borde con cobertura < 0,9, de ellas 1 sin ningún centro de píxel: son padres de celdas de resolución 12 que solo rozan la malla, y se incluyen sin dato para que todo `h3_parent_res9` exista en la tabla de resolución 9.

### Resolución de fuente por atributo

| Atributo | Resolución de la fuente (m) |
|---|---|
| `elev` | 20,041 |
| `slope` | 20,041 |
| `aspect` | 20,041 |
| `svf` | 20,041 |
| `horizon` | 20,041 |
| `los` | 20,041 |
| `tiu` | 20,041 |
| `h2o` | 20,041 |
| `themis_day` | 100,000 |
| `themis_night` | 100,000 |
| `roughness` | 20,041 |
| `rssi` | 20,041 |

El SVF y el horizonte combinan un campo cercano de 20 m (CTX) con uno lejano de 200 m (HRSC+MOLA). Las zonas de escenario son vectoriales, rasterizadas a 20 m por `terrain`.

## 4. Valores de escenario: columnas separadas y columna efectiva

Los valores de escenario nunca sobrescriben los medidos o derivados. Para cada variable con escenario hay: valor medido/derivado, valor de escenario (`*_scenario`), cobertura de la zona, valor **efectivo** (el que usa el motor: escenario si la celda tiene escenario; si no, el medido o derivado) y su procedencia (`*_effective_prov`).

| Variable | Escenario | Fuente del escenario |
|---|---|---|
| Inercia térmica | 110 TIU en WP2 (r = 150 m), 320 Base (100 m), 410 WP1 (100 m), 620 WP3 (40 m) | `scenario_overlay_route.tif` banda 7 donde la banda 8 = 3 |
| SVF | 0,15 en la alcoba del WP3 (r = 40 m) | banda 3 donde la banda 4 = 3 |
| Pendiente | sin zonas en la versión actual | banda 1 donde la banda 2 = 3 |
| LOS de radio | sin zonas en la versión actual | banda 5 donde la banda 6 = 3 |
| H₂O | 12 % en WP1 | `triangulo_supervivencia.geojson`; **extensión supuesta por esta capa (E):** la zona de inercia térmica del WP1 (disco de 100 m) |

No hay inercia térmica medida (el producto THEMIS cuantitativo no está disponible) ni hidratación medida (no hay CRISM en el pipeline): `tiu_measured` y `h2o_measured` son siempre nulas y, fuera de las zonas, también lo son las efectivas.

## 5. Tabla completa: columnas

Mismas columnas y tipos en las dos resoluciones; cambia la estadística.

| Columna | Tipo Arrow | Nulos | Unidad | Res. 12 | Res. 9 | Procedencia | Descripción |
|---|---|---|---|---|---|---|---|
| `h3_index` | `uint64` | no | índice H3 | geometría H3 | geometría H3 | metadato | Celda H3 real (librería h3 4.x) como entero sin signo de 64 bits. |
| `h3_res` | `uint8` | no | — | geometría H3 | geometría H3 | metadato | Resolución H3. |
| `h3_parent_res9` | `uint64` | no | índice H3 | geometría H3 | la propia celda | metadato | Celda padre de resolución 9 (para pasar de la vista fina a la gruesa). |
| `lat_deg` | `double` | no | grados | geometría H3 | geometría H3 | metadato | Latitud planetocéntrica del centro. |
| `lon_e_deg` | `double` | no | grados E 0-360 | geometría H3 | geometría H3 | metadato | Longitud Este 0-360 del centro (convención IAU/PDS). |
| `lon180_deg` | `double` | no | grados −180..180 | geometría H3 | geometría H3 | metadato | Longitud del centro en la convención de H3, CesiumJS y DuckDB Spatial. |
| `east_m` | `float` | no | m | geometría H3 | geometría H3 | metadato | Coordenada local este respecto a la Base (plano tangente sobre la esfera de Marte, R = 3.396.190 m). |
| `north_m` | `float` | no | m | geometría H3 | geometría H3 | metadato | Coordenada local norte respecto a la Base. |
| `cell_area_m2` | `float` | no | m² | h3.cell_area × H3_AREA_SCALE | ídem | metadato | Área de la celda en Marte. |
| `ref_pixel_id` | `int32` | no | fila·179 + columna | píxel CTX que da el valor | −1 (no aplica) | metadato | Píxel de dem_ctx_20m_route.tif del que salen los valores; las celdas que lo comparten tienen los mismos valores. |
| `n_pixels` | `uint16` | no | píxeles | 1 | número de centros de píxel CTX dentro | metadato | Píxeles de la malla de referencia que alimentan la celda. |
| `valid_fraction` | `float` | no | 0-1 | 1 o 0 | fracción de píxeles con cota | metadato | Fracción de píxeles con dato. |
| `coverage_fraction` | `float` | sí | 0-1 | nulo (no aplica) | área de píxeles válidos / área de celda | metadato | Cobertura de la celda por el DTM; < 1 en los bordes de la AOI. |
| `elev_m` | `double` | sí | m sobre el areoide MOLA | píxel del centro | media | medido | Cota del DTM CTX de 20 m. |
| `elev_min_m` | `double` | sí | m | píxel del centro | mínimo | medido | Cota mínima. |
| `elev_max_m` | `double` | sí | m | píxel del centro | máximo | medido | Cota máxima. |
| `elev_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia de la cota (1 = medido; 0 = sin dato). |
| `elev_src_res_m` | `float` | no | m | — | — | metadato | Resolución de la fuente de la cota. |
| `slope_deg_mean` | `double` | sí | grados | píxel del centro | media | derivado | Pendiente Horn 3×3 sobre el DTM CTX. |
| `slope_deg_p90` | `double` | sí | grados | píxel del centro | percentil 90 | derivado | Pendiente de navegación (robusta al ruido del DTM). |
| `slope_deg_max` | `double` | sí | grados | píxel del centro | máximo | derivado | Pendiente máxima. |
| `slope_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia de la pendiente derivada. |
| `slope_src_res_m` | `float` | no | m | — | — | metadato | Resolución del DTM fuente (la pendiente usa una base de 40 m). |
| `slope_deg_scenario` | `double` | sí | grados | píxel del centro | máximo de los píxeles en zona | escenario | Pendiente de escenario (no hay zonas de pendiente en la versión actual). |
| `slope_scenario_cover_frac` | `float` | no | 0-1 | 0 o 1 | fracción de píxeles en zona | metadato | Cobertura de la zona de escenario. |
| `slope_deg_effective` | `double` | sí | grados | escenario si hay; si no, derivada | escenario si hay; si no, p90 | efectivo | Pendiente que usa el motor (slope_deg de P3). |
| `slope_effective_prov` | `uint8` | no | código 0-3 | — | — | metadato | De dónde sale la pendiente efectiva. |
| `aspect_deg` | `double` | sí | grados desde el norte, horario | píxel del centro | media circular | derivado | Acimut hacia el que baja la ladera. |
| `aspect_resultant` | `double` | sí | 0-1 | 1 | longitud del vector resultante | derivado | Concentración de la orientación (1 = todas iguales). |
| `aspect_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia de la orientación. |
| `aspect_src_res_m` | `float` | no | m | — | — | metadato | Resolución de la fuente. |
| `svf_mean` | `double` | sí | 0-1 | píxel del centro | media | derivado | Sky View Factor del DEM (CTX 20 m + HRSC/MOLA 200 m). |
| `svf_min` | `double` | sí | 0-1 | píxel del centro | mínimo | derivado | SVF mínimo. |
| `svf_max` | `double` | sí | 0-1 | píxel del centro | máximo | derivado | SVF máximo. |
| `svf_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia del SVF derivado. |
| `svf_src_res_m` | `float` | no | m | — | — | metadato | Resolución del campo cercano (el lejano es de 200 m). |
| `svf_scenario` | `double` | sí | 0-1 | píxel del centro | mínimo de los píxeles en zona | escenario | SVF de diseño: 0,15 en la alcoba del WP3 (un DEM 2,5D no la representa). |
| `svf_scenario_cover_frac` | `float` | no | 0-1 | 0 o 1 | fracción de píxeles en zona | metadato | Cobertura de la zona de escenario. |
| `svf_effective` | `double` | sí | 0-1 | escenario si hay; si no, derivado | escenario si hay; si no, media | efectivo | SVF que usa el motor (sky_view_factor de P3). |
| `svf_effective_prov` | `uint8` | no | código 0-3 | — | — | metadato | De dónde sale el SVF efectivo. |
| `horizon_max_deg` | `double` | sí | grados | máximo de 36 acimuts del píxel | máximo | derivado | Elevación máxima del horizonte. |
| `horizon_max_az_deg` | `double` | sí | grados | acimut del máximo | acimut del máximo | derivado | Acimut (paso de 10°) del horizonte más alto. |
| `horizon_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia del horizonte. |
| `horizon_src_res_m` | `float` | no | m | — | — | metadato | Resolución del campo cercano. |
| `los_fraction` | `double` | sí | 0-1 | 0 o 1 del píxel | fracción de píxeles con LOS | derivado | Línea de vista geométrica con la antena de la Base. |
| `los_margin_min_m` | `double` | sí | m | píxel del centro | mínimo | derivado | Separación mínima rayo-terreno (negativa = obstruido; nulo a < 40 m de la Base). |
| `los_base` | `double` | sí | 0/1 | LOS del píxel | 1 solo si todos los píxeles tienen LOS | derivado | LOS geométrica de la celda. |
| `los_indeterminate` | `bool` | no | booleano | |margen| < 5 m | |margen mínimo| < 5 m | derivado | Margen dentro del ruido vertical del DTM: LOS indeterminada. |
| `los_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia de la LOS. |
| `los_src_res_m` | `float` | no | m | — | — | metadato | Resolución del DTM usado en el perfil. |
| `los_base_scenario` | `double` | sí | 0/1 | píxel del centro | mínimo de los píxeles en zona | escenario | LOS de escenario (no hay zonas de sombra de radio en la versión actual). |
| `los_scenario_cover_frac` | `float` | no | 0-1 | 0 o 1 | fracción de píxeles en zona | metadato | Cobertura de la zona de escenario. |
| `los_base_effective` | `double` | sí | 0/1 | escenario si hay; si no, derivada | ídem | efectivo | LOS que usa la bandera NLOS. |
| `los_effective_prov` | `uint8` | no | código 0-3 | — | — | metadato | De dónde sale la LOS efectiva. |
| `tiu_measured` | `double` | sí | J m⁻² K⁻¹ s⁻½ | — | — | medido | Siempre nulo: no hay producto THEMIS de inercia térmica cuantitativa (terrain_outputs.json, not_available). |
| `tiu_scenario` | `double` | sí | J m⁻² K⁻¹ s⁻½ | píxel del centro | mínimo de los píxeles en zona | escenario | Inercia térmica de diseño en discos alrededor de los nodos (110 en WP2, 320 Base, 410 WP1, 620 WP3). |
| `tiu_scenario_cover_frac` | `float` | no | 0-1 | 0 o 1 | fracción de píxeles en zona | metadato | Cobertura de la zona de escenario. |
| `tiu_effective` | `double` | sí | J m⁻² K⁻¹ s⁻½ | escenario si hay; si no, nulo | ídem | efectivo | TIU que usa el motor (thermal_inertia_tiu de P3); nula fuera de las zonas. |
| `tiu_effective_prov` | `uint8` | no | código 0-3 | — | — | metadato | De dónde sale la TIU efectiva. |
| `tiu_src_res_m` | `float` | no | m | — | — | metadato | Resolución de la rasterización de las zonas. |
| `h2o_measured` | `double` | sí | % en peso | — | — | medido | Siempre nulo: no hay producto CRISM cuantitativo de H₂O en el pipeline. |
| `h2o_scenario` | `double` | sí | % en peso | píxel del centro | máximo de los píxeles en zona | escenario | 12 % de H₂O del WP1, extendido a la zona de 100 m del WP1 (supuesto de esta capa). |
| `h2o_scenario_cover_frac` | `float` | no | 0-1 | 0 o 1 | fracción de píxeles en zona | metadato | Cobertura de la zona de escenario. |
| `h2o_effective` | `double` | sí | % en peso | escenario si hay; si no, nulo | ídem | efectivo | H₂O que usa el motor (isru_h2o_pct de P3). |
| `h2o_effective_prov` | `uint8` | no | código 0-3 | — | — | metadato | De dónde sale la H₂O efectiva. |
| `h2o_src_res_m` | `float` | no | m | — | — | metadato | Resolución de la rasterización de la zona. |
| `themis_day_dn` | `double` | sí | DN uint8 | píxel del centro | media de los valores en cada píxel CTX | medido | THEMIS IR diurno: DN cualitativo, NO es temperatura ni inercia térmica. |
| `themis_day_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia. |
| `themis_day_src_res_m` | `float` | no | m | — | — | metadato | Resolución de la fuente (100 m). |
| `themis_night_dn` | `double` | sí | DN uint8 | píxel del centro | ídem | medido | THEMIS IR nocturno: DN cualitativo (más claro = más inercia), no calibrado. |
| `themis_night_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia. |
| `themis_night_src_res_m` | `float` | no | m | — | — | metadato | Resolución de la fuente (100 m). |
| `roughness_m` | `double` | sí | m | píxel del centro | media | derivado | Rugosidad: desviación típica de los residuos de la cota respecto al plano ajustado en la ventana 3×3 (60 m) del DTM CTX, a su resolución nativa. Sin la pendiente: un plano inclinado liso da 0. |
| `roughness_m_max` | `double` | sí | m | píxel del centro | máximo | derivado | Rugosidad máxima. |
| `roughness_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia de la rugosidad. |
| `roughness_src_res_m` | `float` | no | m | — | — | metadato | Resolución del DTM fuente (ventana de 3 píxeles). |
| `rssi_dbm` | `double` | sí | dBm | píxel del centro | mínimo (peor caso) | derivado | Nivel recibido del enlace primario de datos (banda S, 2,4 GHz, 1 W, antenas isótropas): espacio libre con la distancia real a la Base y difracción en filo de cuchillo (ITU-R P.526, arista dominante del perfil). |
| `rssi_dbm_mean` | `double` | sí | dBm | píxel del centro | media | derivado | Nivel recibido medio. |
| `rssi_dbm_low` | `double` | sí | dBm | arista dominante 5 m más alta | mínimo | derivado | Extremo bajo con el ruido vertical del DTM (±5 m) en la arista dominante. |
| `rssi_dbm_high` | `double` | sí | dBm | arista dominante 5 m más baja | mínimo | derivado | Extremo alto con el ruido vertical del DTM. |
| `diffraction_db` | `double` | sí | dB | píxel del centro | máximo | derivado | Pérdida por difracción J(ν) restada al espacio libre. |
| `rssi_uhf_dbm` | `double` | sí | dBm | píxel del centro | mínimo (peor caso) | derivado | Nivel recibido de la baliza UHF (435 MHz, 1 W) con el mismo perfil y modelo. |
| `diffraction_uhf_db` | `double` | sí | dB | píxel del centro | máximo | derivado | Pérdida por difracción de la baliza UHF. |
| `rssi_prov` | `uint8` | no | código 0-3 | — | — | metadato | Procedencia del nivel recibido. |
| `rssi_src_res_m` | `float` | no | m | — | — | metadato | Resolución del DTM del perfil. |
| `hazard_bitmask` | `uint16` | no | bits | desde las efectivas | desde las efectivas | efectivo | Banderas HAZARD_FLAG_* de P3. |

## 6. Tabla de contrato `HexCellState64B`

Campos, tipos y orden idénticos a `src/shared/src/lib.rs` (64 bytes, `repr(C, align(64))`). Los flotantes sin dato son `NULL` de Parquet; el cargador del motor (`H3MarsGrid::load_p1_parquet`) los convierte en `CELL_NO_DATA` (NaN), no en 0.

| Offset | Campo | Rust | Arrow | Nulos | Origen en la tabla completa | Nota |
|---|---|---|---|---|---|---|
| 0 | `h3_index` | `u64` | `uint64` | no | `h3_index` | H3 real. INCOMPATIBLE con el empaquetado axial de h3_mars_grid.rs. |
| 8 | `elev_m` | `f32` | `float` | sí | `elev_m` | Medido. |
| 12 | `slope_deg` | `f32` | `float` | sí | `slope_deg_effective` | Derivado (p90 a res 9) o escenario. |
| 16 | `aspect_deg` | `f32` | `float` | sí | `aspect_deg` | Derivado (media circular a res 9). |
| 20 | `thermal_inertia_tiu` | `f32` | `float` | sí | `tiu_effective` | Solo escenario; nulo fuera de las zonas. |
| 24 | `roughness_hi` | `f32` | `float` | sí | `roughness_m` | Rugosidad en m (σ de residuos al plano 3×3 del DTM de 20 m); derivado. |
| 28 | `isru_h2o_pct` | `f32` | `float` | sí | `h2o_effective` | Solo escenario; nulo fuera de la zona del WP1. |
| 32 | `sky_view_factor` | `f32` | `float` | sí | `svf_effective` | Derivado (media a res 9) o escenario. |
| 36 | `los_base_rssi_dbm` | `f32` | `float` | sí | `rssi_dbm` | Enlace primario en banda S (2,4 GHz, 1 W): espacio libre + difracción en filo de cuchillo; derivado. Incertidumbre en rssi_dbm_low/high y baliza UHF en rssi_uhf_dbm de la tabla completa. |
| 40 | `base_metabolic_cost` | `f32` | `float` | sí | `nulo` | Lo calcula el motor por arista: depende de velocidad, sentido de la marcha y deslizamiento, no solo de la celda. |
| 44 | `horizon_hash_id` | `u32` | `uint32` | no | `0` | Lo calcula el motor: hash FNV de Canyon-TRN sobre su base de horizontes; valor de Default (0). |
| 48 | `hazard_bitmask` | `u16` | `uint16` | no | `hazard_bitmask` | Calculado con los umbrales de P1. |
| 50 | `padding_crc` | `[u8; 14]` | `fixed_size_binary[14]` | no | `14 bytes a cero` | H3MarsGrid::insert vuelve a sellar el CRC al cargar. |

Campos que calcula el motor: `base_metabolic_cost` (siempre nulo), `horizon_hash_id` (siempre 0) y `padding_crc` (14 bytes a cero); ver §9. Parcialmente nulos: `thermal_inertia_tiu` (139.978 de 141.313 celdas a res. 12) e `isru_h2o_pct` (141.020).

## 7. Banderas de peligro

Comparación en `float32` por los dos lados, como en Rust. Un nulo nunca activa una bandera.

| Bit | Bandera | Condición | Umbral | Celdas res. 12 | Celdas res. 9 |
|---|---|---|---|---|---|
| `0x01` | `SLOPE_CRITICAL` | slope_deg_effective > 20° | eva_thresholds.json → slope_deg.red | 20.196 | 96 |
| `0x02` | `REGOLITH_TRAP` | tiu_effective < 150 TIU | eva_thresholds.json → thermal_inertia_tiu.red | 696 | 5 |
| `0x04` | `SHELTER` | svf_effective ≤ 0,2 | eva_thresholds.json → shelter_sky_view_factor.green (= lib.rs SHELTER_SVF_MAX) | 47 | 1 |
| `0x08` | `NLOS` | los_base_effective = 0 (o RSSI < -100 dBm) | eva_thresholds.json → radio_rssi_dbm.red; además, sin LOS geométrica | 92.489 | 362 |
| `0x10` | `ISRU_WATER` | h2o_effective ≥ 12 % | eva_thresholds.json → isru_h2o_wt_pct.green (= lib.rs ISRU_WATER_MIN_PCT) | 293 | 4 |

### Nodos a resolución 12

| Nodo | Celda | Cota (m) | Pendiente efectiva (°) | SVF efectivo | TIU | H₂O % | LOS (margen mín.) | Banderas |
|---|---|---|---|---|---|---|---|---|
| BASE | `8c8f591152cb1ff` | -1659,6 | 2,8 (derivado) | 0,85 (derivado) | 320 | nulo | 1 (nulo) | `0x00` |
| WP1 | `8c8f5911c103dff` | -1582,4 | 6,7 (derivado) | 0,85 (derivado) | 410 | 12 | 1 (0,6 m) | `0x10` |
| WP2 | `8c8f5911eaabdff` | -1463,3 | 19,4 (derivado) | 0,84 (derivado) | 110 | nulo | 0 (-24,7 m) | `0x0a` |
| WP3 | `8c8f5911e823bff` | -1518,5 | 20,1 (derivado) | 0,15 (escenario) | 620 | nulo | 0 (-28,2 m) | `0x0d` |

### Nodos a resolución 9

| Nodo | Celda | Cota (m) | Pendiente efectiva (°) | SVF efectivo | TIU | H₂O % | LOS (margen mín.) | Banderas |
|---|---|---|---|---|---|---|---|---|
| BASE | `898f591152fffff` | -1661,7 | 2,8 (derivado) | 0,86 (derivado) | 320 | nulo | 1 (0,9 m) | `0x00` |
| WP1 | `898f5911c13ffff` | -1586,3 | 9,2 (derivado) | 0,85 (derivado) | 410 | 12 | 0 (-3,5 m) | `0x18` |
| WP2 | `898f5911eabffff` | -1471,8 | 19,8 (derivado) | 0,84 (derivado) | 110 | nulo | 0 (-51,4 m) | `0x0a` |
| WP3 | `898f5911e83ffff` | -1540,8 | 23,0 (derivado) | 0,15 (escenario) | 620 | nulo | 0 (-76,6 m) | `0x0d` |

## 8. Demostración con DuckDB

Módulo `red_atlas_p1.hexgrid.duckdb_demo`, sin extensiones (la extensión H3 de DuckDB necesitaría red): el radio y el rumbo se calculan en SQL con `east_m`/`north_m`, y el anillo `grid_disk` y el camino `grid_path_cells` se calculan con `h3` en Python y se pasan a SQL. Los tres sectores de 120° siguen `SpyglassTriSectorSlice` de P3: norte (300°–60°) hidratación, derecha (60°–180°) inercia térmica e izquierda (180°–300°) pendiente, SVF y LOS.

Tiempos medidos sobre `data/nasa-layers/hexgrid_route_res12.parquet` (141.313 filas), DuckDB 2.0.0, Darwin arm64, Python 3.12.13. Son de esta máquina y esta ejecución; no son una garantía para el traje ni para el navegador.

| Consulta | Repeticiones | Mediana | p95 |
|---|---|---|---|
| En frío: conexión nueva + vista + primera celda (Parquet ya en la caché del sistema) | 1 | 89,7 ms | — |
| Celda por `h3_index` | 200 | 2,68 ms | 2,80 ms |
| Spyglass, 3 sectores, radio 100 m | 50 | 6,58 ms | 6,74 ms |
| Spyglass por celda (listas como `SpyglassTriSectorSlice`), radio 100 m | 50 | 6,02 ms | 6,32 ms |
| Spyglass, anillo k = 10 | 50 | 2,48 ms | 2,64 ms |
| Perfil del tramo L1 | 10 | 5,39 ms | 6,60 ms |
| Perfil del tramo L2 | 10 | 4,68 ms | 5,09 ms |
| Perfil del tramo L3 | 10 | 4,01 ms | 4,20 ms |
| Perfil del tramo L4 | 10 | 5,18 ms | 5,25 ms |
| Perfil del tramo R1 | 10 | 5,27 ms | 5,35 ms |

Los tiempos en caliente incluyen el paso de Python a DuckDB y la conversión del resultado; los perfiles incluyen el cálculo del camino con `h3`.

### Spyglass alrededor del WP1 y del WP3 (radio 100 m, resolución 12)

| Centro | Sector | Celdas | H₂O máx. % | TIU mín. | Pendiente máx. (°) | SVF mín. | Fracción con LOS | Banderas |
|---|---|---|---|---|---|---|---|---|
| WP1 | derecha_inercia_termica | 103 | 12 | 410 | 10,3 | 0,85 | 0,94 | `0x18` |
| WP1 | izquierda_pendiente_svf | 102 | 12 | 410 | 7,3 | 0,85 | 0,35 | `0x18` |
| WP1 | norte_hidratacion | 102 | 12 | 410 | 9,8 | 0,85 | 0,10 | `0x18` |
| WP3 | derecha_inercia_termica | 103 | nulo | 620 | 22,5 | 0,15 | 0,00 | `0x0d` |
| WP3 | izquierda_pendiente_svf | 102 | nulo | 620 | 24,1 | 0,15 | 0,00 | `0x0d` |
| WP3 | norte_hidratacion | 102 | nulo | 620 | 22,2 | 0,15 | 0,00 | `0x0d` |

### Perfiles de los tramos (resolución 12)

| Tramo | Celdas | Recta entre centros (m) | GeoJSON (m) | Desnivel (m) | GeoJSON (m) | Pendiente máx. (°) | GeoJSON (°) | Fracción sin LOS |
|---|---|---|---|---|---|---|---|---|
| L1 | 147 | 1493,4 | 1.500 | 77,2 | 78 | 8,0 | 8,0 | 0,51 |
| L2 | 127 | 1198,6 | 1.200 | 119,1 | 118 | 19,9 | 19,9 | 0,57 |
| L3 | 63 | 595,4 | 600 | -55,2 | -56 | 22,5 | 22,5 | 1,00 |
| L4 | 162 | 1600,7 | 1.600 | -141,1 | -140 | 20,1 | 20,1 | 0,28 |
| R1 | 224 | 2148,2 | 2.150 | -196,3 | -196 | 21,4 | 21,4 | 0,51 |

La suma de pasos entre centros de celda sigue el zigzag de la malla y sale entre un 6,7 % y un 14,6 % más larga que la recta; por eso la tabla da la recta entre los centros de las celdas de los nodos.

## 9. Señal de radio, rugosidad y campos que calcula el motor

**`los_base_rssi_dbm` (derivado): enlace primario en banda S.** Enlace del validador (`scenario/radio.py`: antenas isótropas, pérdida en espacio libre con la distancia real a la Base, mínimo de 10 m) menos la pérdida por difracción de la arista dominante del perfil Base→celda, J(ν) de ITU-R P.526 con ν = h·√(2d/(λ·d1·d2)). El perfil es el mismo que el de la LOS de `terrain` (DTM CTX de 20 m, antenas a 3 y 2 m, curvatura; un test comprueba que el margen coincide con la banda `los_margin_m`); con ν ≤ −0,78 no hay pérdida adicional. Con antenas tan bajas, el propio suelo invade el primer elipsoide de Fresnel y resta unos pocos dB aunque haya LOS. Incertidumbre: `rssi_dbm_low`/`rssi_dbm_high` con la arista ±5 m (ruido del DTM). Modelo de arista única: varias aristas, reflexiones o la rugosidad no resuelta por el DTM darían más pérdida.

### Elección del enlace primario

Mismo modelo y misma malla para tres configuraciones del enlace Base–traje. Clase con `eva_thresholds.json` (`radio_rssi_dbm`: verde > −85, rojo < −100 dBm).

| Configuración | Base | WP1 | WP2 | WP3 | LOS a la distancia del WP1 | L2: mín. / mediana / % < −100 | L3: mín. / mediana / % < −100 |
|---|---|---|---|---|---|---|---|
| (a) UHF 435 MHz, 1 W | -15,2 (verde) | -64,2 (verde) | -81,0 (verde) | -85,7 (ámbar) | -58,7 | -89,0 / -65,3 / 0 % | -91,3 / -89,4 / 0 % |
| (b) Banda S 2,4 GHz, 1 W | -30,0 (verde) | -78,2 (verde) | -103,1 (rojo) | -107,9 (rojo) | -73,6 | -111,3 / -80,7 / 45 % | -113,6 / -111,7 / 100 % |
| (c) UHF 435 MHz, 100 mW, −5 dB por antena y cuerpo | -35,2 (verde) | -84,2 (verde) | -101,0 (rojo) | -105,7 (rojo) | -78,7 | -109,0 / -85,3 / 43 % | -111,3 / -109,4 / 100 % |

Niveles en dBm, en las coordenadas exactas de los nodos (la tabla siguiente usa el píxel de la celda de resolución 12 y puede diferir en unas décimas). Distancia Base–WP1: 1500 m. En (c), 5 dB de pérdidas por antena y cuerpo en cada extremo (10 dB en total). L2 y L3 se muestrean en las celdas de resolución 12 de `grid_path_cells` entre los nodos.

**Regla de decisión:** si en banda S el WP2 y el WP3 quedan por debajo de −100 dBm con al menos 2 dB de margen, el enlace primario de datos pasa a banda S. Resultado: WP2 -103,1 dBm y WP3 -107,9 dBm (márgenes de 3,1 y 7,9 dB). **Decisión aplicada:** el enlace primario de R.E.D. ATLAS, el que transporta la sesión Zenoh y se pierde tras el relieve, es banda S a 2,4 GHz y 1 W; UHF a 435 MHz queda como baliza de baja tasa que sobrevive degradada (verde en el WP2 y ámbar en el WP3, sin bajar nunca de −100 dBm en la ruta) y de la que el sistema no depende. `los_base_rssi_dbm` lleva el enlace primario; `rssi_uhf_dbm` (tabla completa) lleva la baliza.

| Nodo | Banda S (dBm) | Intervalo ±5 m (dBm) | Difracción (dB) | Clase | Baliza UHF (dBm) | Clase UHF |
|---|---|---|---|---|---|---|
| BASE | -30,0 | -30,0 a -30,0 | 0,0 | verde | -15,2 | verde |
| WP1 | -78,5 | -86,9 a -73,5 | 4,9 | verde | -64,3 | verde |
| WP2 | -103,0 | -104,6 a -101,0 | 26,3 | rojo | -80,9 | verde |
| WP3 | -107,7 | -109,2 a -105,9 | 33,6 | rojo | -85,4 | ámbar |

En la ruta (res. 12), el enlace primario va de -114,0 a -30,0 dBm, con 17.870 celdas bajo -100 dBm; la baliza UHF, de -91,7 a -15,2 dBm, con 0.

**`roughness_hi` (derivado, metros).** Desviación típica de los residuos de la cota respecto al plano de mínimos cuadrados ajustado en la ventana 3×3 (60 m) del DTM CTX de 20 m, calculada a su resolución nativa sobre el DTM del entorno cercano y asignada después a las celdas (píxel del centro a res. 12, media a res. 9). Se quita la pendiente: un plano inclinado liso da 0. Escala de 20-60 m: no ve bloques métricos.

En la ruta (res. 12): de 0,00 a 2,11 m; mediana 0,16 m; percentil 95 0,47 m.

**Campos que calcula el motor y van sin dato o a cero:**

- `base_metabolic_cost`: depende de la velocidad, del sentido de la marcha (subir o bajar la misma celda cuesta distinto) y del deslizamiento; es una propiedad de la arista, no de la celda. Lo calcula `metabolic_dstar.rs` con el modelo de P1.
- `horizon_hash_id`: identificador de Canyon-TRN (hash FNV sobre la base de horizontes del motor); P1 no tiene esa base. Los ángulos de horizonte de P1 están en `horizon_max_deg` y en el COG de 36 acimuts.
- `padding_crc`: a cero; `H3MarsGrid::insert` lo sella al cargar.

## 10. Contrato con P3

**Resuelto en el motor:**

- Índices H3 reales: el motor usa `h3o` y carga directamente `hexgrid_route_res12_hexcell64b.parquet` (`src/core-engine/tests/p1_hexgrid.rs`).
- «Sin dato» explícito: `CELL_NO_DATA` (NaN) en los `f32`; los NULL de Parquet se cargan así, no como 0.
- Métrica: `resolution_metrics` ya calcula arista y área con `h3o` escalado (5,77 m de arista media en res. 12).
- Umbrales de refugio e ISRU: ahora están también en `eva_thresholds.json` (`shelter_sky_view_factor`, `isru_h2o_wt_pct`) y las banderas se calculan desde ahí.

**Pendiente o a revisar por P3:**

- La bandera NLOS de P1 se activa por LOS geométrica o por RSSI < −100 dBm del enlace primario; en Rust, `HAZARD_FLAG_NLOS` está documentada solo como RSSI < −100 dBm. Con banda S, el WP2 y el WP3 cumplen las dos condiciones.

## 11. Observaciones sobre los datos

- La pendiente real del WP2 (19,4° a res. 12) no supera los 20°: no lleva `SLOPE_CRITICAL`. No se ha forzado.
- El tramo L1 no tiene LOS geométrica en el 51 % de sus celdas (margen mínimo -7,4 m; ruido del DTM ±5 m), aunque el GeoJSON lo describe «con línea de vista a la Base». La columna `los_indeterminate` marca los márgenes dentro del ruido.
- A menos de 40 m de la Base la LOS es 1 y el margen es nulo (así lo define `terrain`).
