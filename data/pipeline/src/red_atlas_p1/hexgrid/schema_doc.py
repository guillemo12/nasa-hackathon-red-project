"""Generación de ``data/nasa-layers/SCHEMA_HEXGRID.md`` a partir de las tablas reales."""
from __future__ import annotations

import numpy as np

from .. import config
from . import geo
from .constants import (
    CORRIDOR_HALFWIDTH_M,
    HAZARD_FLAG_ISRU_WATER,
    HAZARD_FLAG_NLOS,
    HAZARD_FLAG_REGOLITH_TRAP,
    HAZARD_FLAG_SHELTER,
    HAZARD_FLAG_SLOPE_CRITICAL,
    MAX_REPO_PARQUET_BYTES,
    PROV_NAMES,
    flag_thresholds,
)
from .export import Output, node_cells
from .tables import CONTRACT_FIELDS, FULL_COLUMNS

FLAGS = [
    ("SLOPE_CRITICAL", HAZARD_FLAG_SLOPE_CRITICAL, "slope_deg_effective > {slope_red_gt_deg}°",
     "eva_thresholds.json → slope_deg.red"),
    ("REGOLITH_TRAP", HAZARD_FLAG_REGOLITH_TRAP, "tiu_effective < {tiu_red_lt} TIU",
     "eva_thresholds.json → thermal_inertia_tiu.red"),
    ("SHELTER", HAZARD_FLAG_SHELTER, "svf_effective ≤ {svf_shelter_le}",
     "lib.rs → SHELTER_SVF_MAX (no está en eva_thresholds.json)"),
    ("NLOS", HAZARD_FLAG_NLOS, "los_base_effective = 0 (o RSSI < {rssi_red_lt_dbm} dBm)",
     "eva_thresholds.json → radio_rssi_dbm.red; P1 no tiene RSSI: se usa la LOS geométrica"),
    ("ISRU_WATER", HAZARD_FLAG_ISRU_WATER, "h2o_effective ≥ {h2o_isru_ge_pct} %",
     "lib.rs → ISRU_WATER_MIN_PCT (no está en eva_thresholds.json)"),
]

RUST_SIZES = {"u64": 8, "f32": 4, "u32": 4, "u16": 2, "[u8; 14]": 14}


def _mb(n: int) -> str:
    return f"{n / 1e6:.2f} MB".replace(".", ",")


def _g(v) -> str:
    return f"{float(v):.6g}".replace(".", ",")


def _n(x: int) -> str:
    return f"{x:,}".replace(",", ".")


def _f(x, nd=1) -> str:
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "nulo"
    return f"{x:.{nd}f}".replace(".", ",")


def _src_res(out: Output) -> dict[str, str]:
    res = {}
    for c in FULL_COLUMNS:
        if c.name.endswith("_src_res_m"):
            v = out.full[c.name].to_numpy()
            res[c.name.removesuffix("_src_res_m")] = _f(float(v[0]), 3) if len(v) else "—"
    return res


def _flag_counts(out: Output) -> dict[str, int]:
    m = out.full["hazard_bitmask"].to_numpy()
    return {name: int(((m & bit) != 0).sum()) for name, bit, _, _ in FLAGS}


def _node_rows(out: Output) -> list[str]:
    cells = node_cells(out.res)
    idx = {int(h): i for i, h in enumerate(out.full["h3_index"].to_numpy())}
    rows = []
    for node, h in cells.items():
        i = idx.get(h)
        if i is None:
            rows.append(f"| {node} | `{h:x}` | fuera de la tabla | | | | | | |")
            continue
        r = {c: out.full[c][i].as_py() for c in (
            "elev_m", "slope_deg_effective", "slope_effective_prov", "svf_effective",
            "svf_effective_prov", "tiu_effective", "h2o_effective", "los_base_effective",
            "los_margin_min_m", "hazard_bitmask")}
        rows.append(
            f"| {node} | `{h:x}` | {_f(r['elev_m'])} | {_f(r['slope_deg_effective'])} "
            f"({PROV_NAMES[r['slope_effective_prov']]}) | {_f(r['svf_effective'], 2)} "
            f"({PROV_NAMES[r['svf_effective_prov']]}) | {_f(r['tiu_effective'], 0)} | "
            f"{_f(r['h2o_effective'], 0)} | {_f(r['los_base_effective'], 0)} "
            f"({_f(r['los_margin_min_m'])}{' m' if r['los_margin_min_m'] is not None else ''}) | `0x{r['hazard_bitmask']:02x}` |")
    return rows


def _area(x: float) -> str:
    return _n(round(x)) if x > 1000 else _f(x, 1)


def pixel_area_m2_ref() -> np.ndarray:
    from .layers import F_DEM, load_layer, pixel_area_m2
    return pixel_area_m2(load_layer("elev_m", F_DEM, "elevation_m"))


def _cells_per_pixel(o: Output | None) -> str:
    if o is None:
        return ""
    ids = o.full["ref_pixel_id"].to_numpy()
    ids = ids[ids >= 0]
    return (f"Cada píxel alimenta de media {_f(ids.size / np.unique(ids).size, 2)} celdas "
            f"({_n(ids.size)} celdas sobre {_n(np.unique(ids).size)} píxeles),")


def _node_value(o: Output, node: str, col: str):
    h = node_cells(o.res)[node]
    i = np.where(o.full["h3_index"].to_numpy() == h)[0]
    return o.full[col][int(i[0])].as_py() if i.size else None


def _wp3_cover(o: Output | None) -> str:
    if o is None:
        return "una parte"
    v = _node_value(o, "WP3", "svf_scenario_cover_frac")
    return f"el {_f(100 * v, 0)} %" if v is not None else "una parte"


def render(outs: list[Output], bench: dict) -> str:
    th = flag_thresholds()
    by_res = {o.res: o for o in outs}
    o12, o9 = by_res.get(12), by_res.get(9)
    L: list[str] = []
    a = L.append
    a("# Esquema de la malla H3 de la ruta EVA-07 (`hexgrid`)\n")
    a("> Fichero generado por `cd data/pipeline && uv run python -m red_atlas_p1.hexgrid`. "
      "No editar a mano: los recuentos, tamaños y tiempos salen de la ejecución.\n")
    a("Agrega los COG de terreno descritos en `terrain_outputs.json` (DTM CTX de 20 m y sus "
      "derivados, THEMIS IR y la capa de escenario) a celdas H3 sobre `AOI_ROUTE` "
      f"({_f(config.AOI_ROUTE['lat_min'], 2)}..{_f(config.AOI_ROUTE['lat_max'], 2)}° N, "
      f"{_f(config.AOI_ROUTE['lon_e_min'], 2)}..{_f(config.AOI_ROUTE['lon_e_max'], 2)}° E) y produce dos "
      "vistas por resolución: una tabla completa y documentada y otra con exactamente los "
      "campos de `HexCellState64B` (`src/shared/src/lib.rs`).\n")

    a("## 1. Ficheros\n")
    a("| Fichero | Vista | Res. | Filas | Tamaño (zstd) |")
    a("|---|---|---|---|---|")
    for o in outs:
        a(f"| `data/nasa-layers/{o.full_path.name}` | completa"
          f"{' (corredor)' if o.corridor_only else ''} | {o.res} | {_n(o.full.num_rows)} | "
          f"{_mb(o.full_bytes)} |")
        a(f"| `data/nasa-layers/{o.contract_path.name}` | `HexCellState64B` | {o.res} | "
          f"{_n(o.contract.num_rows)} | {_mb(o.contract_bytes)} |")
        if o.corridor_only:
            a(f"| `data/pipeline/{o.complete_path.relative_to(config.PIPELINE_DIR)}` | completa "
              f"(sin versionar) | {o.res} | {_n(o.complete_rows)} | — |")
    a("")
    a(f"Límite para versionar la tabla completa: {_mb(MAX_REPO_PARQUET_BYTES)}. Si la de "
      f"resolución 12 lo supera, en el repositorio queda un corredor de "
      f"{CORRIDOR_HALFWIDTH_M:.0f} m alrededor de los tramos y la completa va a `build/hexgrid/`. "
      "Filas ordenadas por `h3_index`; grupos de 65.536 filas con estadísticas mín./máx. para "
      "que DuckDB pode por índice. Cada Parquet lleva en sus metadatos (`red_atlas`) la "
      "procedencia, las entradas y las constantes de escala.\n")

    a("## 2. Convenciones\n")
    a("- **Índice:** H3 real (librería `h3` 4.x) como `uint64`. H3 trabaja con longitud "
      "−180..180: se aplica `config.lon180` al indexar; las tablas guardan ambas longitudes.")
    a("- **Métrica:** las funciones métricas de H3 asumen la Tierra. Toda longitud se "
      f"multiplica por `H3_LENGTH_SCALE` = {_f(config.H3_LENGTH_SCALE, 5)} y toda área por "
      f"`H3_AREA_SCALE` = {_f(config.H3_AREA_SCALE, 5)} (R = 3.396.190 m). Las distancias de "
      "esta capa se calculan sobre la esfera de Marte, nunca con las de la librería sin escalar.")
    a("")
    px_area = float(np.mean(pixel_area_m2_ref())) if o12 else 395.6
    a("| Res. | Arista media global en Marte | Área media global en Marte | Área media en la AOI "
      "(`cell_area_m2`) | Píxeles CTX de 20 m por celda en la AOI |")
    a("|---|---|---|---|---|")
    for r in (12, 9):
        area = geo.mars_area_m2(r)
        o = by_res.get(r)
        local = float(np.mean(o.full["cell_area_m2"].to_numpy())) if o else float("nan")
        a(f"| {r} | {_f(geo.mars_edge_length_m(r), 2)} m | {_area(area)} m² | {_area(local)} m² | "
          f"{_f(local / px_area, 2)} |")
    a("")
    a(f"La arista media que da la librería (`average_hexagon_edge_length`) escalada a Marte es "
      f"{_f(geo.mars_edge_length_m(12), 2)} m en la resolución 12 y "
      f"{_f(geo.mars_edge_length_m(9), 1)} m en la 9, no los 5,01 m y 92,86 m de la tabla fija "
      f"de `h3_mars_grid.rs::resolution_metrics`. Las áreas medias globales sí cuadran (86,87 m² "
      f"en Rust frente a {_f(geo.mars_area_m2(12), 2)} m²), pero en esta latitud las celdas H3 "
      "son mayores que la media global: la columna «Área media en la AOI» es la que vale aquí.\n")
    a("- **Coordenadas locales:** `east_m`/`north_m` en metros respecto a la Base, plano "
      "tangente sobre la esfera de Marte; las usa DuckDB para radios y rumbos.")
    a("- **Procedencia:** `0` sin dato, `1` medido, `2` derivado, `3` escenario (mismos códigos "
      "que `terrain_outputs.json`). Cada atributo lleva `<var>_prov` y `<var>_src_res_m`.")
    a("- **Nulos:** `NULL` de Parquet. Ningún valor sin dato se rellena con 0.\n")

    a("## 3. Honestidad de resolución y estadísticas de agregación\n")
    a("**Resolución 12 (más fina que el DTM).** Cada celda toma, sin interpolar, el valor del "
      "píxel de 20 m que contiene su centro (`ref_pixel_id`). "
      f"{_cells_per_pixel(o12)} "
      "que llevan el mismo valor: la resolución real de la información es la de "
      "`*_src_res_m`, no la de la celda. THEMIS se muestrea igual en su píxel de 100 m.\n")
    a("**Resolución 9 (más gruesa que el DTM).** Cada celda agrupa los píxeles de la malla de "
      "referencia (`dem_ctx_20m_route.tif`) cuyo centro cae dentro (`n_pixels`). Estadística "
      "por variable:\n")
    a("| Variable | Estadística a res. 9 | Motivo |")
    a("|---|---|---|")
    a("| Cota | media (+ mín. y máx.) | variable continua |")
    a("| Pendiente | **percentil 90** (+ media y máx.) | conservadora sin depender de un píxel ruidoso del DTM |")
    a("| Orientación | media circular + longitud del resultante | ángulo: la media aritmética no vale |")
    a("| SVF | media (+ mín. y máx.) | la media es la que representa la dosis en la celda; el mínimo indica si hay un rincón más protegido |")
    a("| Horizonte | máximo | el más alto bloquea |")
    a("| Línea de vista | 1 solo si todos los píxeles tienen LOS; fracción con LOS; margen mínimo | conservadora para la radio |")
    a("| THEMIS DN | media de los valores THEMIS en cada píxel CTX (ponderada por solape) | DN cualitativo |")
    a("| Escenario | TIU mínima, SVF mínimo, pendiente máxima, LOS mínima, H₂O máxima + `*_scenario_cover_frac` | si la zona toca la celda, manda el caso peor (o el refugio/recurso presente) |")
    a("")
    a("**Semántica del escenario a resolución 9: «la celda contiene».** Basta que la zona "
      "toque un píxel de la celda para que el valor efectivo sea el de escenario. Así, la "
      "celda del WP3 sale con SVF 0,15 y bandera `SHELTER` aunque la alcoba de 40 m cubra "
      f"solo {_wp3_cover(o9)} de sus píxeles. La tabla de contrato no lleva esa cobertura: el "
      "SVF efectivo de resolución 9 sirve para saber dónde hay refugio, **no para calcular "
      "dosis**. Para la dosis, usar `svf_mean` o la resolución 12.\n")
    if o9:
        npx = o9.full["n_pixels"].to_numpy()
        cov = o9.full["coverage_fraction"].to_numpy()
        a(f"A resolución 9 hay {_n(o9.full.num_rows)} celdas; mediana de {int(np.median(npx))} "
          f"píxeles por celda (máx. {npx.max()}); "
          f"{int((cov < 0.9).sum())} celdas de borde con cobertura < 0,9, de ellas "
          f"{int((npx == 0).sum())} sin ningún centro de píxel: son padres de celdas de "
          "resolución 12 que solo rozan la malla, y se incluyen sin dato para que todo "
          "`h3_parent_res9` exista en la tabla de resolución 9.\n")

    a("### Resolución de fuente por atributo\n")
    if o12:
        sr = _src_res(o12)
        a("| Atributo | Resolución de la fuente (m) |")
        a("|---|---|")
        for k, v in sr.items():
            a(f"| `{k}` | {v} |")
        a("")
    a("El SVF y el horizonte combinan un campo cercano de 20 m (CTX) con uno lejano de 200 m "
      "(HRSC+MOLA). Las zonas de escenario son vectoriales, rasterizadas a 20 m por `terrain`.\n")

    a("## 4. Valores de escenario: columnas separadas y columna efectiva\n")
    a("Los valores de escenario nunca sobrescriben los medidos o derivados. Para cada variable "
      "con escenario hay: valor medido/derivado, valor de escenario (`*_scenario`), cobertura "
      "de la zona, valor **efectivo** (el que usa el motor: escenario si la celda tiene "
      "escenario; si no, el medido o derivado) y su procedencia (`*_effective_prov`).\n")
    a("| Variable | Escenario | Fuente del escenario |")
    a("|---|---|---|")
    a("| Inercia térmica | 110 TIU en WP2 (r = 150 m), 320 Base (100 m), 410 WP1 (100 m), 620 WP3 (40 m) | `scenario_overlay_route.tif` banda 7 donde la banda 8 = 3 |")
    a("| SVF | 0,15 en la alcoba del WP3 (r = 40 m) | banda 3 donde la banda 4 = 3 |")
    a("| Pendiente | sin zonas en la versión actual | banda 1 donde la banda 2 = 3 |")
    a("| LOS de radio | sin zonas en la versión actual | banda 5 donde la banda 6 = 3 |")
    a("| H₂O | 12 % en WP1 | `triangulo_supervivencia.geojson`; **extensión supuesta por esta capa (E):** la zona de inercia térmica del WP1 (disco de 100 m) |")
    a("")
    a("No hay inercia térmica medida (el producto THEMIS cuantitativo no está disponible) ni "
      "hidratación medida (no hay CRISM en el pipeline): `tiu_measured` y `h2o_measured` son "
      "siempre nulas y, fuera de las zonas, también lo son las efectivas.\n")

    a("## 5. Tabla completa: columnas\n")
    a("Mismas columnas y tipos en las dos resoluciones; cambia la estadística.\n")
    a("| Columna | Tipo Arrow | Nulos | Unidad | Res. 12 | Res. 9 | Procedencia | Descripción |")
    a("|---|---|---|---|---|---|---|---|")
    for c in FULL_COLUMNS:
        a(f"| `{c.name}` | `{c.type}` | {'sí' if c.nullable else 'no'} | {c.unit} | {c.stat12} | "
          f"{c.stat9} | {c.prov} | {c.desc} |")
    a("")

    a("## 6. Tabla de contrato `HexCellState64B`\n")
    a("Campos, tipos y orden idénticos a `src/shared/src/lib.rs` (64 bytes, `repr(C, align(64))`). "
      "Los flotantes sin dato son `NULL` de Parquet: P3 no tiene campos opcionales ni lector "
      "de Parquet, y el 0,0 de `Default` mentiría (0 TIU activaría la trampa de regolito).\n")
    a("| Offset | Campo | Rust | Arrow | Nulos | Origen en la tabla completa | Nota |")
    a("|---|---|---|---|---|---|---|")
    off = 0
    for name, rust, arrow, nullable, src, note in CONTRACT_FIELDS:
        a(f"| {off} | `{name}` | `{rust}` | `{arrow}` | {'sí' if nullable else 'no'} | `{src}` | {note} |")
        off += RUST_SIZES[rust]
    a("")
    if o12:
        a("Campos que no se pueden rellenar con datos reales ni de escenario: `roughness_hi`, "
          "`los_base_rssi_dbm`, `base_metabolic_cost` (siempre nulos), `horizon_hash_id` "
          "(siempre 0) y `padding_crc` (14 bytes a cero). Parcialmente nulos: "
          f"`thermal_inertia_tiu` ({_n(o12.contract['thermal_inertia_tiu'].null_count)} de "
          f"{_n(o12.contract.num_rows)} celdas a res. 12) e `isru_h2o_pct` "
          f"({_n(o12.contract['isru_h2o_pct'].null_count)}).\n")

    a("## 7. Banderas de peligro\n")
    a("Comparación en `float32` por los dos lados, como en Rust. Un nulo nunca activa una "
      "bandera.\n")
    a("| Bit | Bandera | Condición | Umbral | Celdas res. 12 | Celdas res. 9 |")
    a("|---|---|---|---|---|---|")
    c12 = _flag_counts(o12) if o12 else {}
    c9 = _flag_counts(o9) if o9 else {}
    for name, bit, cond, src in FLAGS:
        a(f"| `0x{bit:02x}` | `{name}` | {cond.format(**{k: _g(v) for k, v in th.items()})} | "
          f"{src} | {_n(c12.get(name, 0))} | {_n(c9.get(name, 0))} |")
    a("")
    for o in outs:
        a(f"### Nodos a resolución {o.res}\n")
        a("| Nodo | Celda | Cota (m) | Pendiente efectiva (°) | SVF efectivo | TIU | H₂O % | LOS (margen mín.) | Banderas |")
        a("|---|---|---|---|---|---|---|---|---|")
        L.extend(_node_rows(o))
        a("")

    a("## 8. Demostración con DuckDB\n")
    a("Módulo `red_atlas_p1.hexgrid.duckdb_demo`, sin extensiones (la extensión H3 de DuckDB "
      "necesitaría red): el radio y el rumbo se calculan en SQL con `east_m`/`north_m`, y el "
      "anillo `grid_disk` y el camino `grid_path_cells` se calculan con `h3` en Python y se "
      "pasan a SQL. Los tres sectores de 120° siguen `SpyglassTriSectorSlice` de P3: norte "
      "(300°–60°) hidratación, derecha (60°–180°) inercia térmica e izquierda (180°–300°) "
      "pendiente, SVF y LOS.\n")
    a(f"Tiempos medidos sobre `{bench['parquet']}` ({_n(bench['filas'])} filas), DuckDB "
      f"{bench['duckdb']}, {bench['maquina']}. Son de esta máquina y esta ejecución; no son "
      "una garantía para el traje ni para el navegador.\n")
    a("| Consulta | Repeticiones | Mediana | p95 |")
    a("|---|---|---|---|")
    a(f"| En frío: conexión nueva + vista + primera celda (Parquet ya en la caché del sistema) | 1 | {_f(bench['frio_conexion_y_primera_celda_ms'], 1)} ms | — |")
    q = bench["celda_por_indice"]
    a(f"| Celda por `h3_index` | {q['n']} | {_f(q['mediana_ms'], 2)} ms | {_f(q['p95_ms'], 2)} ms |")
    q = bench["spyglass_radio"]
    a(f"| Spyglass, 3 sectores, radio {q['radio_m']:.0f} m | {q['n']} | {_f(q['mediana_ms'], 2)} ms | {_f(q['p95_ms'], 2)} ms |")
    q = bench["spyglass_celdas"]
    a(f"| Spyglass por celda (listas como `SpyglassTriSectorSlice`), radio {q['radio_m']:.0f} m | {q['n']} | {_f(q['mediana_ms'], 2)} ms | {_f(q['p95_ms'], 2)} ms |")
    q = bench["spyglass_kring"]
    a(f"| Spyglass, anillo k = {q['k']} | {q['n']} | {_f(q['mediana_ms'], 2)} ms | {_f(q['p95_ms'], 2)} ms |")
    for leg, q in bench["perfil_tramo"].items():
        a(f"| Perfil del tramo {leg} | {q['n']} | {_f(q['mediana_ms'], 2)} ms | {_f(q['p95_ms'], 2)} ms |")
    a("")
    a("Los tiempos en caliente incluyen el paso de Python a DuckDB y la conversión del "
      "resultado; los perfiles incluyen el cálculo del camino con `h3`.\n")
    a("### Spyglass alrededor del WP1 y del WP3 (radio 100 m, resolución 12)\n")
    a("| Centro | Sector | Celdas | H₂O máx. % | TIU mín. | Pendiente máx. (°) | SVF mín. | Fracción con LOS | Banderas |")
    a("|---|---|---|---|---|---|---|---|---|")
    for node in ("WP1", "WP3"):
        for s in bench[f"ejemplo_spyglass_{node.lower()}"]:
            a(f"| {node} | {s['sector']} | {s['n_celdas']} | {_f(s['h2o_max_pct'], 0)} | "
              f"{_f(s['tiu_min'], 0)} | {_f(s['pendiente_max_deg'])} | {_f(s['svf_min'], 2)} | "
              f"{_f(s['fraccion_con_los'], 2)} | `0x{s['banderas']:02x}` |")
    a("")
    a("### Perfiles de los tramos (resolución 12)\n")
    a("| Tramo | Celdas | Recta entre centros (m) | GeoJSON (m) | Desnivel (m) | GeoJSON (m) | Pendiente máx. (°) | GeoJSON (°) | Fracción sin LOS |")
    a("|---|---|---|---|---|---|---|---|---|")
    for leg, p in bench["perfiles"].items():
        a(f"| {leg} | {p['n_celdas']} | {_f(p['longitud_recta_m'])} | {_n(p['distancia_geojson_m'])} | "
          f"{_f(p['desnivel_m'])} | {p['desnivel_geojson_m']} | {_f(p['pendiente_max_deg'])} | "
          f"{_f(p['pendiente_max_geojson_deg'])} | {_f(p['fraccion_sin_los'], 2)} |")
    a("")
    zz = [p["longitud_camino_celdas_m"] / p["longitud_recta_m"] - 1 for p in bench["perfiles"].values()]
    a(f"La suma de pasos entre centros de celda sigue el zigzag de la malla y sale entre un "
      f"{_f(100 * min(zz), 1)} % y un {_f(100 * max(zz), 1)} % más larga que la recta; por eso "
      "la tabla da la recta entre los centros de las celdas de los nodos.\n")

    a("## 9. Incompatibilidades con el contrato de P3 (no se ha editado `src/`)\n")
    a("1. **`h3_index` no es H3 en el motor.** `h3_mars_grid.rs` empaqueta coordenadas axiales "
      "propias (`res << 56 | q << 28 | r`) sobre una proyección local centrada en "
      "`SITE_REFERENCE_LAT/LON_DEG`. `nearest_cell`, `neighbors`, `k_ring` y "
      "`geodesic_distance_m` no entienden los índices H3 reales de estas tablas. El README de "
      "`shared` habla de `h3o`: o el motor adopta `h3o`, o hace falta una tabla de "
      "correspondencia que P3 genere con su propio origen.")
    a("2. **`los_base_rssi_dbm` está en dBm**, y P1 solo tiene LOS geométrica (booleano y "
      "margen en metros). El campo va nulo y la bandera NLOS se calcula con la geometría. "
      "Pasar a dBm exige un modelo de enlace (potencia, ganancias, difracción) que no existe.")
    a("3. **Sin campos opcionales.** Los `f32` de P3 no tienen representación de «sin dato». "
      "`Default` pone 0,0 y SVF 1,0. Con NaN, `soil_sinkage_eta` cae en la rama de η = 2,1, y "
      "`serde_json` escribe NaN como `null` y, según su comportamiento documentado, no lo "
      "vuelve a leer como `f32` (no comprobado aquí: no se ha ejecutado Rust). Aquí se usan "
      "nulos de Parquet; el cargador de P3 debe decidir su centinela.")
    a("4. **Umbrales solo en Rust.** `SHELTER_SVF_MAX` (0,20) e `ISRU_WATER_MIN_PCT` (12 %) "
      "no están en `eva_thresholds.json`.")
    a("5. **Métrica fija.** `resolution_metrics` da 5,01 m y 92,86 m de arista (res. 12 y 9); "
      f"la media de la librería H3 escalada da {_f(geo.mars_edge_length_m(12), 2)} m y "
      f"{_f(geo.mars_edge_length_m(9), 1)} m.")
    a("6. **`roughness_hi`, `horizon_hash_id`, `base_metabolic_cost`:** sin definición de "
      "unidad (`roughness_hi`), específico de Canyon-TRN (`horizon_hash_id`, hash FNV) o "
      "dependiente de velocidad, sentido y deslizamiento (`base_metabolic_cost`).")
    a("7. **`padding_crc`** va a cero: `H3MarsGrid::insert` vuelve a sellar el CRC al cargar.\n")

    a("## 10. Observaciones sobre los datos\n")
    if o12:
        wp2 = _node_value(o12, "WP2", "slope_deg_effective")
        a(f"- La pendiente real del WP2 ({_f(wp2)}° a res. 12) "
          f"{'no supera' if wp2 <= float(th['slope_red_gt_deg']) else 'supera'} los "
          f"{_g(th['slope_red_gt_deg'])}°: "
          f"{'no lleva' if wp2 <= float(th['slope_red_gt_deg']) else 'lleva'} `SLOPE_CRITICAL`. "
          "No se ha forzado.")
    l1 = bench["perfiles"].get("L1")
    if l1:
        a(f"- El tramo L1 no tiene LOS geométrica en el {_f(100 * l1['fraccion_sin_los'], 0)} % de "
          f"sus celdas (margen mínimo {_f(l1['margen_los_min_m'])} m; ruido del DTM ±5 m), aunque "
          "el GeoJSON lo describe «con línea de vista a la Base». La columna "
          "`los_indeterminate` marca los márgenes dentro del ruido.")
    a("- A menos de 40 m de la Base la LOS es 1 y el margen es nulo (así lo define `terrain`).")
    return "\n".join(L) + "\n"
