# 🛰️ `data/pipeline/` — Pipeline científico de datos NASA (Persona 1)

Convierte productos reales de la NASA (PDS / catálogo STAC de USGS Astrogeology) en las capas
que consume el motor en Rust: **Cloud-Optimized GeoTIFF (COG)**, **GeoJSON** y **Apache Parquet**.

```bash
cd data/pipeline
uv sync
uv run pytest
```

| Módulo | Qué hace |
| :--- | :--- |
| `red_atlas_p1.config` | Rutas, CRS de Marte, AOIs, convenciones de longitud y constantes compartidas |
| `red_atlas_p1.terrain` | Descubrimiento STAC, recorte por ventana, COG, pendiente, *Sky View Factor* y línea de visión |
| `red_atlas_p1.scenario` | Validador del escenario EVA-07: geometría, metabolismo, dosis, enlace de radio |
| `red_atlas_p1.hexgrid` | Agregación a malla H3, tabla Parquet por celda y consultas DuckDB |

## Terreno real (`red_atlas_p1.terrain`)

```bash
uv run python -m red_atlas_p1.terrain            # regenera todo desde cero (~3 min, necesita red)
uv run python -m red_atlas_p1.terrain --reuse    # reutiliza el manifiesto y los recortes de build/cog
uv run rio cogeo validate build/cog/dem_ctx_20m_route.tif
uv run pytest -m "not network"                   # solo los tests sintéticos
uv run python -m red_atlas_p1.terrain.site_search   # búsqueda rígida del emplazamiento (~35 min)
uv run python -m red_atlas_p1.terrain.relocate      # aplica la colocación elegida al GeoJSON y regenera
uv run python -m red_atlas_p1.terrain.ortho_texture # textura CTX 6 m co-registrada para el gemelo 3D (necesita red la 1.ª vez)
```

Lee por ventana (rangos HTTP, nunca el fichero entero) los productos reales que cubren el sitio y escribe:

| Salida | Contenido |
| :--- | :--- |
| `build/cog/*.tif` | 13 COG: DEM (CTX 20 m, HRSC+MOLA 200 m, MOLA 463 m; HiRISE 1 m solo si cubre la ruta), ortoimágenes (CTX 6 m, HiRISE 1 m), THEMIS IR día/noche, pendiente y orientación, horizonte por acimut, SVF, línea de vista de radio y capa de escenario |
| `../nasa-layers/sources_manifest.json` | Productos reales, URL, licencia y cobertura **medida** de cada AOI; también lo que no existe o no se puede leer por ventana |
| `../nasa-layers/site_reality_check.json` y `SITE_REALITY_CHECK.md` | El escenario frente al terreno real, con las correcciones propuestas al entregable |
| `../nasa-layers/terrain_outputs.json` | Contrato para la malla H3: ficheros, bandas, unidades, nodata, CRS, resolución, AOI y procedencia |
| `../nasa-layers/site_search.json` | Embudo de la búsqueda del emplazamiento y evaluación de la colocación elegida en cada par CTX |
| `../nasa-layers/site_reality_check_original_site.json` | Comprobación del sitio original (9,8°S, 283,6°E), que justifica el traslado |
| `../nasa-layers/scenario_overlay.geojson` | Valores de diseño junto a los medidos, con procedencia por entidad |
| `../nasa-layers/ortho_ctx_6m_route.png` y `.json` (`terrain.ortho_texture`) | Textura del gemelo 3D: mosaico CTX de 6 m (Robbins et al., USGS) estirado a 8 bits y co-registrado con el DTM de trabajo. El desfase se mide por correlación de fase contra la ortoimagen del propio par estéreo (≈ +68 m E, +55 m N, igual en los cuatro cuadrantes) y se corrige moviendo los límites, sin remuestrear. HiRISE se descarta por deformado (sin control) y Mars Trek solo ofrece aquí el CTX global sin control. |

Convenciones: todas las mallas son geográficas `IAU_2015:49900` con longitud Este 0–360 (usar
`config.lon180` antes de H3 o CesiumJS); las distancias y pendientes se calculan en metros reales
(paso E–O = R·Δλ·cos φ). Los rásteres medidos nunca llevan valores de escenario: estos viven solo en
`scenario_overlay_route.tif`, con una banda de procedencia por variable (1 medido, 2 derivado, 3 escenario).

Los rásteres generados van a `data/pipeline/build/` (ignorado por git). Solo se versionan el código,
los manifiestos y las tablas pequeñas.
