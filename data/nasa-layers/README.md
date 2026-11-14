# 🗺️ `data/nasa-layers/` — Capas NASA del sitio de Melas Chasma

Salidas versionadas del pipeline de la **Persona 1** ([`data/pipeline/`](../pipeline/README.md)) para la ruta EVA-07 (huella 9,88–9,95°S, 283,36–283,42°E). Explicación en la sección 2 de [`ENTREGABLE_1_CIENCIA_Y_MISION.md`](../../docs/01-planetary-science-mission/ENTREGABLE_1_CIENCIA_Y_MISION.md). Los ficheros generados no se editan a mano.

| Fichero | Contenido | Lo genera |
| :--- | :--- | :--- |
| `layers_catalog.json` | Descripción genérica de las 6 capas de R.E.D. ATLAS (instrumentos, tipos de producto PDS, resolución, formato, sector de la lupa Spyglass) | a mano |
| `sources_manifest.json` | Productos reales localizados en el catálogo STAC de USGS (DTM CTX de 20 m, mezcla HRSC+MOLA de 200 m, MOLA de 463 m, mosaico CTX de 6 m, HiRISE RDR, THEMIS IR día/noche), con URL, licencia y cobertura **medida** en cada zona; también lo que no existe o no se puede leer por ventana (inercia térmica cuantitativa, CRISM, SHARAD) | `terrain` |
| `terrain_outputs.json` | Contrato de los 13 COG de `data/pipeline/build/cog/`: bandas, unidades, nodata, CRS, resolución, zona y procedencia | `terrain` |
| `SITE_REALITY_CHECK.md` y `site_reality_check.json` | El escenario frente al DTM CTX real en el sitio reubicado: condiciones de la colocación, nodos, tramos, presión, entorno y límites de la comprobación | `terrain` |
| `site_reality_check_original_site.json` | La misma comprobación en el sitio original (9,8°S, 283,6°E), que justifica el traslado | `terrain` |
| `site_search.json` | Embudo de la búsqueda rígida del emplazamiento y evaluación de la colocación elegida en cada par CTX | `terrain.site_search` |
| `scenario_overlay.geojson` | Valores de diseño junto a los medidos, con procedencia por entidad | `terrain` |
| `hexgrid_route_res12.parquet` y `hexgrid_route_res9.parquet` | Malla H3 de la ruta (141.313 y 462 celdas): cota, pendiente, orientación, SVF, horizonte, línea de vista, THEMIS DN y valores de escenario, con procedencia y resolución de la fuente por atributo | `hexgrid` |
| `hexgrid_route_res12_hexcell64b.parquet` y `hexgrid_route_res9_hexcell64b.parquet` | Las mismas celdas con exactamente los campos de `HexCellState64B` del núcleo Rust (nulos de Parquet donde no hay dato) | `hexgrid` |
| `SCHEMA_HEXGRID.md` | Esquema de las tablas H3, banderas de peligro, incompatibilidades con el contrato de P3 y tiempos de DuckDB | `hexgrid` |
| `hexgrid_duckdb_benchmark.json` | Tiempos medidos de las consultas DuckDB de demostración | `hexgrid` |

Límites que hay que tener presentes: ningún DTM HiRISE cubre la ruta (la topografía es CTX de 20 m), la inercia térmica y la hidratación son valores de escenario, y la alcoba del WP3 (SVF 0,15) no la puede representar ningún DEM (SVF real 0,76).
