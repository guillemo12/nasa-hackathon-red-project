# 🛰️ `data/` — Catálogo de Datasets NASA y Escenarios de Misión

Datos, esquemas y código del pipeline científico, consumidos por el motor en Rust y por la consola de Base. La explicación científica está en [`docs/01-planetary-science-mission/CIENCIA_Y_MISION.md`](../docs/01-planetary-science-mission/CIENCIA_Y_MISION.md).

| Carpeta | Contenido |
| :--- | :--- |
| [`pipeline/`](pipeline/README.md) | Paquete Python `red_atlas_pipeline` (gestionado con `uv`) que lee los productos reales de la NASA y genera todo lo demás: módulos `terrain`, `scenario` y `hexgrid` |
| [`nasa-layers/`](nasa-layers/README.md) | Productos NASA resueltos y su cobertura medida, comprobación de realidad del sitio, contrato de los COG y malla H3 de la ruta en Parquet |
| [`mission-scenarios/`](mission-scenarios/README.md) | Escenario «Triángulo de Supervivencia» de la EVA-07: nodos y tramos en GeoJSON, umbrales Verde/Ámbar/Rojo y cronología minuto a minuto |

**Emplazamiento:** cuenca suroeste de Melas Chasma (Valles Marineris), al pie de su pared suroeste. Base en 9,89646°S, 283,38920°E (76,61080°W), a −1.660 m sobre el areoide MOLA. El triángulo se trasladó 13,6 km desde el diseño original en 9,8°S, 283,6°E, donde el DTM CTX no muestra ni el talud del WP2 ni el escarpe del WP3 (véase [`nasa-layers/SITE_REALITY_CHECK.md`](nasa-layers/SITE_REALITY_CHECK.md)).

**Convenciones comunes:** CRS `IAU_2015:49900` (Marte esférico, R = 3.396.190 m, planetocéntrico, longitud Este 0–360); GeoJSON en orden `[lon, lat, elev]`; procedencia de cada valor como medido, derivado o escenario. Los COG generados viven en `pipeline/build/` y no se versionan.

Regenerar todo, desde `data/pipeline/`:

```bash
uv sync
uv run python -m red_atlas_pipeline.terrain
uv run python -m red_atlas_pipeline.scenario
uv run python -m red_atlas_pipeline.hexgrid
```
