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
     "eva_thresholds.json → shelter_sky_view_factor.green (= lib.rs SHELTER_SVF_MAX)"),
    ("NLOS", HAZARD_FLAG_NLOS, "los_base_effective = 0 (o RSSI < {rssi_red_lt_dbm} dBm)",
     "eva_thresholds.json → radio_rssi_dbm.red; además, sin LOS geométrica"),
    ("ISRU_WATER", HAZARD_FLAG_ISRU_WATER, "h2o_effective ≥ {h2o_isru_ge_pct} %",
     "eva_thresholds.json → isru_h2o_wt_pct.green (= lib.rs ISRU_WATER_MIN_PCT)"),
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


def _link_comparison() -> dict:
    """Las tres configuraciones de radio.LINK_CONFIGS en los nodos y en los tramos L2 y L3."""
    from ..scenario.radio import received_dbm
    from . import radio

    nodes = config.scenario_nodes()
    names = list(nodes)
    lat = np.array([nodes[k]["lat_pc_deg"] for k in names])
    lon = np.array([nodes[k]["lon_e_deg"] for k in names])
    prof = radio.base_profile(lat, lon)
    legs = {}
    for leg in ("L2", "L3"):
        lg = config.scenario_legs()[leg]
        a, b = (geo.cell_of(nodes[k]["lat_pc_deg"], nodes[k]["lon_e_deg"], 12)
                for k in (lg["from"], lg["to"]))
        la, lo = geo.centers(geo.grid_path(a, b))
        legs[leg] = radio.base_profile(la, lo)
    d_wp1 = float(prof["distance_m"][names.index("WP1")])
    out = {"d_wp1": d_wp1, "configs": {}}
    for key, cfg in radio.LINK_CONFIGS.items():
        kw = radio.link_kwargs(key)
        r = radio.rssi_from_profile(prof, **kw)["rssi_dbm"]
        leg_stats = {}
        for leg, p in legs.items():
            x = radio.rssi_from_profile(p, **kw)["rssi_dbm"]
            leg_stats[leg] = {"min": float(np.nanmin(x)), "median": float(np.nanmedian(x)),
                              "pct_red": float(100 * np.nanmean(x < -100.0))}
        out["configs"][key] = {
            "label": cfg["label"],
            "nodes": {k: float(r[i]) for i, k in enumerate(names)},
            "los_wp1": received_dbm(d_wp1, los=True, **kw),
            "legs": leg_stats,
        }
    return out


def _rssi_class(v) -> str:
    """Clase con el clasificador del validador (eva_thresholds.json → radio_rssi_dbm)."""
    if v is None:
        return "sin dato"
    from ..scenario.radio import classify_link
    return {"VERDE": "verde", "AMBAR": "ámbar", "ROJO": "rojo"}[classify_link(v)]


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
    a("> Fichero generado por `cd data/pipeline && uv run python -m red_atlas_pipeline.hexgrid`. "
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
      "Los flotantes sin dato son `NULL` de Parquet; el cargador del motor "
      "(`H3MarsGrid::load_grid_parquet`) los convierte en `CELL_NO_DATA` (NaN), no en 0.\n")
    a("| Offset | Campo | Rust | Arrow | Nulos | Origen en la tabla completa | Nota |")
    a("|---|---|---|---|---|---|---|")
    off = 0
    for name, rust, arrow, nullable, src, note in CONTRACT_FIELDS:
        a(f"| {off} | `{name}` | `{rust}` | `{arrow}` | {'sí' if nullable else 'no'} | `{src}` | {note} |")
        off += RUST_SIZES[rust]
    a("")
    if o12:
        a("Campos que calcula el motor: `base_metabolic_cost` (siempre nulo), `horizon_hash_id` "
          "(siempre 0) y `padding_crc` (14 bytes a cero); ver §9. Parcialmente nulos: "
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
    a("Módulo `red_atlas_pipeline.hexgrid.duckdb_demo`, sin extensiones (la extensión H3 de DuckDB "
      "necesitaría red): el radio y el rumbo se calculan en SQL con `east_m`/`north_m`, y el "
      "anillo `grid_disk` y el camino `grid_path_cells` se calculan con `h3` en Python y se "
      "pasan a SQL. Los tres sectores de 120° siguen `SpyglassTriSectorSlice` del motor Rust: norte "
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

    a("## 9. Señal de radio, rugosidad y campos que calcula el motor\n")
    a("**`los_base_rssi_dbm` (derivado): enlace primario en banda S.** Enlace del validador "
      "(`scenario/radio.py`: antenas isótropas, pérdida en espacio libre con la distancia real a "
      "la Base, mínimo de 10 m) menos la pérdida por difracción de la arista dominante del "
      "perfil Base→celda, J(ν) de ITU-R P.526 con ν = h·√(2d/(λ·d1·d2)). El perfil es el mismo "
      "que el de la LOS de `terrain` (DTM CTX de 20 m, antenas a 3 y 2 m, curvatura; un test "
      "comprueba que el margen coincide con la banda `los_margin_m`); con ν ≤ −0,78 no hay "
      "pérdida adicional. Con antenas tan bajas, el propio suelo invade el primer elipsoide de "
      "Fresnel y resta unos pocos dB aunque haya LOS. Incertidumbre: `rssi_dbm_low`/"
      "`rssi_dbm_high` con la arista ±5 m (ruido del DTM). Modelo de arista única: varias "
      "aristas, reflexiones o la rugosidad no resuelta por el DTM darían más pérdida.\n")
    a("### Elección del enlace primario\n")
    a("Mismo modelo y misma malla para tres configuraciones del enlace Base–traje. Clase con "
      "`eva_thresholds.json` (`radio_rssi_dbm`: verde > −85, rojo < −100 dBm).\n")
    cmp = _link_comparison()
    a("| Configuración | Base | WP1 | WP2 | WP3 | LOS a la distancia del WP1 | L2: mín. / mediana / % < −100 | L3: mín. / mediana / % < −100 |")
    a("|---|---|---|---|---|---|---|---|")
    for key, c in cmp["configs"].items():
        cells = " | ".join(f"{_f(c['nodes'][n])} ({_rssi_class(c['nodes'][n])})"
                           for n in ("BASE", "WP1", "WP2", "WP3"))
        legs = " | ".join(f"{_f(c['legs'][lg]['min'])} / {_f(c['legs'][lg]['median'])} / "
                          f"{_f(c['legs'][lg]['pct_red'], 0)} %" for lg in ("L2", "L3"))
        a(f"| ({key}) {c['label']} | {cells} | {_f(c['los_wp1'])} | {legs} |")
    a("")
    a(f"Niveles en dBm, en las coordenadas exactas de los nodos (la tabla siguiente usa el "
      f"píxel de la celda de resolución 12 y puede diferir en unas décimas). Distancia "
      f"Base–WP1: {_f(cmp['d_wp1'], 0)} m. En (c), 5 dB de pérdidas "
      "por antena y cuerpo en cada extremo (10 dB en total). L2 y L3 se muestrean en las celdas "
      "de resolución 12 de `grid_path_cells` entre los nodos.\n")
    b = cmp["configs"]["b"]["nodes"]
    a("**Regla de decisión:** si en banda S el WP2 y el WP3 quedan por debajo de −100 dBm con al "
      f"menos 2 dB de margen, el enlace primario de datos pasa a banda S. Resultado: WP2 "
      f"{_f(b['WP2'])} dBm y WP3 {_f(b['WP3'])} dBm (márgenes de {_f(-100 - b['WP2'])} y "
      f"{_f(-100 - b['WP3'])} dB). **Decisión aplicada:** el enlace primario de R.E.D. ATLAS, el "
      "que transporta la sesión Zenoh y se pierde tras el relieve, es banda S a 2,4 GHz y 1 W; "
      "UHF a 435 MHz queda como baliza de baja tasa que sobrevive degradada (verde en el WP2 y "
      "ámbar en el WP3, sin bajar nunca de −100 dBm en la ruta) y de la que el sistema no "
      "depende. `los_base_rssi_dbm` lleva el enlace primario; "
      "`rssi_uhf_dbm` (tabla completa) lleva la baliza.\n")
    if o12:
        a("| Nodo | Banda S (dBm) | Intervalo ±5 m (dBm) | Difracción (dB) | Clase | Baliza UHF (dBm) | Clase UHF |")
        a("|---|---|---|---|---|---|---|")
        for node in ("BASE", "WP1", "WP2", "WP3"):
            v = {c: _node_value(o12, node, c) for c in
                 ("rssi_dbm", "rssi_dbm_low", "rssi_dbm_high", "diffraction_db", "rssi_uhf_dbm")}
            a(f"| {node} | {_f(v['rssi_dbm'])} | {_f(v['rssi_dbm_low'])} a "
              f"{_f(v['rssi_dbm_high'])} | {_f(v['diffraction_db'])} | {_rssi_class(v['rssi_dbm'])} | "
              f"{_f(v['rssi_uhf_dbm'])} | {_rssi_class(v['rssi_uhf_dbm'])} |")
        a("")
        r = o12.full["rssi_dbm"].to_numpy()
        u = o12.full["rssi_uhf_dbm"].to_numpy()
        a(f"En la ruta (res. 12), el enlace primario va de {_f(np.nanmin(r))} a "
          f"{_f(np.nanmax(r))} dBm, con {_n(int((r < float(th['rssi_red_lt_dbm'])).sum()))} "
          f"celdas bajo {_g(th['rssi_red_lt_dbm'])} dBm; la baliza UHF, de {_f(np.nanmin(u))} a "
          f"{_f(np.nanmax(u))} dBm, con {_n(int((u < float(th['rssi_red_lt_dbm'])).sum()))}.\n")
    a("**`roughness_hi` (derivado, metros).** Desviación típica de los residuos de la cota "
      "respecto al plano de mínimos cuadrados ajustado en la ventana 3×3 (60 m) del DTM CTX "
      "de 20 m, calculada a su resolución nativa sobre el DTM del entorno cercano y asignada "
      "después a las celdas (píxel del centro a res. 12, media a res. 9). Se quita la "
      "pendiente: un plano inclinado liso da 0. Escala de 20-60 m: no ve bloques métricos.\n")
    if o12:
        rr = o12.full["roughness_m"].to_numpy()
        a(f"En la ruta (res. 12): de {_f(np.nanmin(rr), 2)} a {_f(np.nanmax(rr), 2)} m; mediana "
          f"{_f(np.nanmedian(rr), 2)} m; percentil 95 {_f(np.nanpercentile(rr, 95), 2)} m.\n")
    a("**Campos que calcula el motor y van sin dato o a cero:**\n")
    a("- `base_metabolic_cost`: depende de la velocidad, del sentido de la marcha (subir o "
      "bajar la misma celda cuesta distinto) y del deslizamiento; es una propiedad de la "
      "arista, no de la celda. Lo calcula `metabolic_dstar.rs` con el modelo metabólico de referencia.")
    a("- `horizon_hash_id`: identificador de Canyon-TRN (hash FNV sobre la base de horizontes "
      "del motor); el pipeline no tiene esa base. Los ángulos de horizonte del pipeline están en "
      "`horizon_max_deg` y en el COG de 36 acimuts.")
    a("- `padding_crc`: a cero; `H3MarsGrid::insert` lo sella al cargar.\n")

    a("## 10. Contrato con el motor Rust\n")
    a("**Resuelto en el motor:**\n")
    a("- Índices H3 reales: el motor usa `h3o` y carga directamente "
      "`hexgrid_route_res12_hexcell64b.parquet` (`src/core-engine/tests/terrain_grid.rs`).")
    a("- «Sin dato» explícito: `CELL_NO_DATA` (NaN) en los `f32`; los NULL de Parquet se "
      "cargan así, no como 0.")
    a("- Métrica: `resolution_metrics` ya calcula arista y área con `h3o` escalado "
      f"({_f(geo.mars_edge_length_m(12), 2)} m de arista media en res. 12).")
    a("- Umbrales de refugio e ISRU: ahora están también en `eva_thresholds.json` "
      "(`shelter_sky_view_factor`, `isru_h2o_wt_pct`) y las banderas se calculan desde ahí.\n")
    a("**Pendiente o a revisar en el motor:**\n")
    a("- La bandera NLOS del pipeline se activa por LOS geométrica o por RSSI < −100 dBm del enlace "
      "primario; en Rust, `HAZARD_FLAG_NLOS` está documentada solo como RSSI < −100 dBm. Con "
      "banda S, el WP2 y el WP3 cumplen las dos condiciones.\n")


    a("## 11. Observaciones sobre los datos\n")
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
