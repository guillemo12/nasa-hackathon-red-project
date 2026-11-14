# Esquema de la malla H3 de la ruta EVA-07 (`hexgrid`)

> Fichero generado por `cd data/pipeline && uv run python -m red_atlas_p1.hexgrid`. No editar a mano: los recuentos, tamaños y tiempos salen de la ejecución.

Agrega los COG de terreno descritos en `terrain_outputs.json` (DTM CTX de 20 m y sus derivados, THEMIS IR y la capa de escenario) a celdas H3 sobre `AOI_ROUTE` (-9,95..-9,88° N, 283,36..283,42° E) y produce dos vistas por resolución: una tabla completa y documentada y otra con exactamente los campos de `HexCellState64B` (`src/shared/src/lib.rs`).

## 1. Ficheros

| Fichero | Vista | Res. | Filas | Tamaño (zstd) |
|---|---|---|---|---|
| `data/nasa-layers/hexgrid_route_res12.parquet` | completa | 12 | 141.313 | 11,15 MB |
| `data/nasa-layers/hexgrid_route_res12_hexcell64b.parquet` | `HexCellState64B` | 12 | 141.313 | 1,86 MB |
| `data/nasa-layers/hexgrid_route_res9.parquet` | completa | 9 | 462 | 0,10 MB |
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
| `hazard_bitmask` | `uint16` | no | bits | desde las efectivas | desde las efectivas | efectivo | Banderas HAZARD_FLAG_* de P3. |

## 6. Tabla de contrato `HexCellState64B`

Campos, tipos y orden idénticos a `src/shared/src/lib.rs` (64 bytes, `repr(C, align(64))`). Los flotantes sin dato son `NULL` de Parquet: P3 no tiene campos opcionales ni lector de Parquet, y el 0,0 de `Default` mentiría (0 TIU activaría la trampa de regolito).

| Offset | Campo | Rust | Arrow | Nulos | Origen en la tabla completa | Nota |
|---|---|---|---|---|---|---|
| 0 | `h3_index` | `u64` | `uint64` | no | `h3_index` | H3 real. INCOMPATIBLE con el empaquetado axial de h3_mars_grid.rs. |
| 8 | `elev_m` | `f32` | `float` | sí | `elev_m` | Medido. |
| 12 | `slope_deg` | `f32` | `float` | sí | `slope_deg_effective` | Derivado (p90 a res 9) o escenario. |
| 16 | `aspect_deg` | `f32` | `float` | sí | `aspect_deg` | Derivado (media circular a res 9). |
| 20 | `thermal_inertia_tiu` | `f32` | `float` | sí | `tiu_effective` | Solo escenario; nulo fuera de las zonas. |
| 24 | `roughness_hi` | `f32` | `float` | sí | `nulo` | Sin fuente ni definición: siempre nulo. |
| 28 | `isru_h2o_pct` | `f32` | `float` | sí | `h2o_effective` | Solo escenario; nulo fuera de la zona del WP1. |
| 32 | `sky_view_factor` | `f32` | `float` | sí | `svf_effective` | Derivado (media a res 9) o escenario. |
| 36 | `los_base_rssi_dbm` | `f32` | `float` | sí | `nulo` | P1 solo tiene LOS geométrica (booleano y margen en m), no dBm: siempre nulo. |
| 40 | `base_metabolic_cost` | `f32` | `float` | sí | `nulo` | Depende de velocidad, sentido y deslizamiento: lo calcula el motor; siempre nulo. |
| 44 | `horizon_hash_id` | `u32` | `uint32` | no | `0` | Hash FNV de Canyon-TRN (P3); sin equivalente en P1: valor de Default (0). |
| 48 | `hazard_bitmask` | `u16` | `uint16` | no | `hazard_bitmask` | Calculado con los umbrales de P1. |
| 50 | `padding_crc` | `[u8; 14]` | `fixed_size_binary[14]` | no | `14 bytes a cero` | H3MarsGrid::insert vuelve a sellar el CRC al cargar. |

Campos que no se pueden rellenar con datos reales ni de escenario: `roughness_hi`, `los_base_rssi_dbm`, `base_metabolic_cost` (siempre nulos), `horizon_hash_id` (siempre 0) y `padding_crc` (14 bytes a cero). Parcialmente nulos: `thermal_inertia_tiu` (139.978 de 141.313 celdas a res. 12) e `isru_h2o_pct` (141.020).

## 7. Banderas de peligro

Comparación en `float32` por los dos lados, como en Rust. Un nulo nunca activa una bandera.

| Bit | Bandera | Condición | Umbral | Celdas res. 12 | Celdas res. 9 |
|---|---|---|---|---|---|
| `0x01` | `SLOPE_CRITICAL` | slope_deg_effective > 20° | eva_thresholds.json → slope_deg.red | 20.196 | 96 |
| `0x02` | `REGOLITH_TRAP` | tiu_effective < 150 TIU | eva_thresholds.json → thermal_inertia_tiu.red | 696 | 5 |
| `0x04` | `SHELTER` | svf_effective ≤ 0,2 | lib.rs → SHELTER_SVF_MAX (no está en eva_thresholds.json) | 47 | 1 |
| `0x08` | `NLOS` | los_base_effective = 0 (o RSSI < -100 dBm) | eva_thresholds.json → radio_rssi_dbm.red; P1 no tiene RSSI: se usa la LOS geométrica | 92.489 | 362 |
| `0x10` | `ISRU_WATER` | h2o_effective ≥ 12 % | lib.rs → ISRU_WATER_MIN_PCT (no está en eva_thresholds.json) | 293 | 4 |

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
| En frío: conexión nueva + vista + primera celda (Parquet ya en la caché del sistema) | 1 | 13,4 ms | — |
| Celda por `h3_index` | 200 | 2,32 ms | 2,52 ms |
| Spyglass, 3 sectores, radio 100 m | 50 | 6,31 ms | 6,64 ms |
| Spyglass por celda (listas como `SpyglassTriSectorSlice`), radio 100 m | 50 | 5,75 ms | 6,10 ms |
| Spyglass, anillo k = 10 | 50 | 2,35 ms | 2,49 ms |
| Perfil del tramo L1 | 10 | 5,13 ms | 5,54 ms |
| Perfil del tramo L2 | 10 | 4,70 ms | 4,92 ms |
| Perfil del tramo L3 | 10 | 4,05 ms | 4,28 ms |
| Perfil del tramo L4 | 10 | 5,26 ms | 5,57 ms |
| Perfil del tramo R1 | 10 | 5,25 ms | 5,58 ms |

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

## 9. Incompatibilidades con el contrato de P3 (no se ha editado `src/`)

1. **`h3_index` no es H3 en el motor.** `h3_mars_grid.rs` empaqueta coordenadas axiales propias (`res << 56 | q << 28 | r`) sobre una proyección local centrada en `SITE_REFERENCE_LAT/LON_DEG`. `nearest_cell`, `neighbors`, `k_ring` y `geodesic_distance_m` no entienden los índices H3 reales de estas tablas. El README de `shared` habla de `h3o`: o el motor adopta `h3o`, o hace falta una tabla de correspondencia que P3 genere con su propio origen.
2. **`los_base_rssi_dbm` está en dBm**, y P1 solo tiene LOS geométrica (booleano y margen en metros). El campo va nulo y la bandera NLOS se calcula con la geometría. Pasar a dBm exige un modelo de enlace (potencia, ganancias, difracción) que no existe.
3. **Sin campos opcionales.** Los `f32` de P3 no tienen representación de «sin dato». `Default` pone 0,0 y SVF 1,0. Con NaN, `soil_sinkage_eta` cae en la rama de η = 2,1, y `serde_json` escribe NaN como `null` y, según su comportamiento documentado, no lo vuelve a leer como `f32` (no comprobado aquí: no se ha ejecutado Rust). Aquí se usan nulos de Parquet; el cargador de P3 debe decidir su centinela.
4. **Umbrales solo en Rust.** `SHELTER_SVF_MAX` (0,20) e `ISRU_WATER_MIN_PCT` (12 %) no están en `eva_thresholds.json`.
5. **Métrica fija.** `resolution_metrics` da 5,01 m y 92,86 m de arista (res. 12 y 9); la media de la librería H3 escalada da 5,77 m y 107,0 m.
6. **`roughness_hi`, `horizon_hash_id`, `base_metabolic_cost`:** sin definición de unidad (`roughness_hi`), específico de Canyon-TRN (`horizon_hash_id`, hash FNV) o dependiente de velocidad, sentido y deslizamiento (`base_metabolic_cost`).
7. **`padding_crc`** va a cero: `H3MarsGrid::insert` vuelve a sellar el CRC al cargar.

## 10. Observaciones sobre los datos

- La pendiente real del WP2 (19,4° a res. 12) no supera los 20°: no lleva `SLOPE_CRITICAL`. No se ha forzado.
- El tramo L1 no tiene LOS geométrica en el 51 % de sus celdas (margen mínimo -7,4 m; ruido del DTM ±5 m), aunque el GeoJSON lo describe «con línea de vista a la Base». La columna `los_indeterminate` marca los márgenes dentro del ruido.
- A menos de 40 m de la Base la LOS es 1 y el margen es nulo (así lo define `terrain`).
