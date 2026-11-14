"""Terreno real del sitio: descubrimiento de fuentes, recortes COG y derivados topográficos.

    uv run python -m red_atlas_p1.terrain

- `settings`: AOIs auxiliares, fuentes reales y parámetros.
- `sources`: catálogo STAC de USGS, cobertura medida y manifiesto.
- `rasters`: lectura por ventana (rangos HTTP) y escritura de COG con procedencia.
- `derive`: pendiente, horizonte, Sky View Factor y línea de vista en metros reales.
- `reality`, `report`: comprobación de realidad del sitio frente al escenario.
- `overlay`: capa de escenario con procedencia por píxel, separada de lo medido.
- `build`: orquestación y contrato de salida para la malla H3.
"""
