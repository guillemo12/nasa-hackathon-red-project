"""Esquemas Arrow de las dos vistas y construcción de las tablas.

* Tabla completa (``hexgrid_route_res{N}.parquet``): todas las columnas documentadas, con
  procedencia y resolución de fuente por atributo, y valores de escenario separados.
* Tabla de contrato (``hexgrid_route_res{N}_hexcell64b.parquet``): exactamente los campos,
  tipos y orden de ``HexCellState64B`` (``src/shared/src/lib.rs``).

La documentación de cada columna vive aquí (``FULL_COLUMNS`` y ``CONTRACT_FIELDS``) y de aquí
la toma ``schema_doc`` para escribir ``SCHEMA_HEXGRID.md``.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pyarrow as pa

from .constants import HORIZON_HASH_ID_UNSET, PADDING_CRC_ZEROS

U8, U16, U64, I32 = pa.uint8(), pa.uint16(), pa.uint64(), pa.int32()
F32, F64, BOOL = pa.float32(), pa.float64(), pa.bool_()


@dataclass(frozen=True)
class Col:
    name: str
    type: pa.DataType
    unit: str
    stat12: str          # estadística a resolución 12
    stat9: str           # estadística a resolución 9
    prov: str            # medido / derivado / escenario / efectivo / metadato
    desc: str
    nullable: bool = True


S12 = "píxel del centro"
GEOM = "geometría H3"
_ = "—"

FULL_COLUMNS: list[Col] = [
    # identidad y geometría
    Col("h3_index", U64, "índice H3", GEOM, GEOM, "metadato", "Celda H3 real (librería h3 4.x) como entero sin signo de 64 bits.", False),
    Col("h3_res", U8, "—", GEOM, GEOM, "metadato", "Resolución H3.", False),
    Col("h3_parent_res9", U64, "índice H3", GEOM, "la propia celda", "metadato", "Celda padre de resolución 9 (para pasar de la vista fina a la gruesa).", False),
    Col("lat_deg", F64, "grados", GEOM, GEOM, "metadato", "Latitud planetocéntrica del centro.", False),
    Col("lon_e_deg", F64, "grados E 0-360", GEOM, GEOM, "metadato", "Longitud Este 0-360 del centro (convención IAU/PDS).", False),
    Col("lon180_deg", F64, "grados −180..180", GEOM, GEOM, "metadato", "Longitud del centro en la convención de H3, CesiumJS y DuckDB Spatial.", False),
    Col("east_m", F32, "m", GEOM, GEOM, "metadato", "Coordenada local este respecto a la Base (plano tangente sobre la esfera de Marte, R = 3.396.190 m).", False),
    Col("north_m", F32, "m", GEOM, GEOM, "metadato", "Coordenada local norte respecto a la Base.", False),
    Col("cell_area_m2", F32, "m²", "h3.cell_area × H3_AREA_SCALE", "ídem", "metadato", "Área de la celda en Marte.", False),
    Col("ref_pixel_id", I32, "fila·179 + columna", "píxel CTX que da el valor", "−1 (no aplica)", "metadato", "Píxel de dem_ctx_20m_route.tif del que salen los valores; las celdas que lo comparten tienen los mismos valores.", False),
    Col("n_pixels", U16, "píxeles", "1", "número de centros de píxel CTX dentro", "metadato", "Píxeles de la malla de referencia que alimentan la celda.", False),
    Col("valid_fraction", F32, "0-1", "1 o 0", "fracción de píxeles con cota", "metadato", "Fracción de píxeles con dato.", False),
    Col("coverage_fraction", F32, "0-1", "nulo (no aplica)", "área de píxeles válidos / área de celda", "metadato", "Cobertura de la celda por el DTM; < 1 en los bordes de la AOI."),
    # cota
    Col("elev_m", F64, "m sobre el areoide MOLA", S12, "media", "medido", "Cota del DTM CTX de 20 m."),
    Col("elev_min_m", F64, "m", S12, "mínimo", "medido", "Cota mínima."),
    Col("elev_max_m", F64, "m", S12, "máximo", "medido", "Cota máxima."),
    Col("elev_prov", U8, "código 0-3", _, _, "metadato", "Procedencia de la cota (1 = medido; 0 = sin dato).", False),
    Col("elev_src_res_m", F32, "m", _, _, "metadato", "Resolución de la fuente de la cota.", False),
    # pendiente
    Col("slope_deg_mean", F64, "grados", S12, "media", "derivado", "Pendiente Horn 3×3 sobre el DTM CTX."),
    Col("slope_deg_p90", F64, "grados", S12, "percentil 90", "derivado", "Pendiente de navegación (robusta al ruido del DTM)."),
    Col("slope_deg_max", F64, "grados", S12, "máximo", "derivado", "Pendiente máxima."),
    Col("slope_prov", U8, "código 0-3", _, _, "metadato", "Procedencia de la pendiente derivada.", False),
    Col("slope_src_res_m", F32, "m", _, _, "metadato", "Resolución del DTM fuente (la pendiente usa una base de 40 m).", False),
    Col("slope_deg_scenario", F64, "grados", S12, "máximo de los píxeles en zona", "escenario", "Pendiente de escenario (no hay zonas de pendiente en la versión actual)."),
    Col("slope_scenario_cover_frac", F32, "0-1", "0 o 1", "fracción de píxeles en zona", "metadato", "Cobertura de la zona de escenario.", False),
    Col("slope_deg_effective", F64, "grados", "escenario si hay; si no, derivada", "escenario si hay; si no, p90", "efectivo", "Pendiente que usa el motor (slope_deg del motor)."),
    Col("slope_effective_prov", U8, "código 0-3", _, _, "metadato", "De dónde sale la pendiente efectiva.", False),
    # orientación
    Col("aspect_deg", F64, "grados desde el norte, horario", S12, "media circular", "derivado", "Acimut hacia el que baja la ladera."),
    Col("aspect_resultant", F64, "0-1", "1", "longitud del vector resultante", "derivado", "Concentración de la orientación (1 = todas iguales)."),
    Col("aspect_prov", U8, "código 0-3", _, _, "metadato", "Procedencia de la orientación.", False),
    Col("aspect_src_res_m", F32, "m", _, _, "metadato", "Resolución de la fuente.", False),
    # SVF
    Col("svf_mean", F64, "0-1", S12, "media", "derivado", "Sky View Factor del DEM (CTX 20 m + HRSC/MOLA 200 m)."),
    Col("svf_min", F64, "0-1", S12, "mínimo", "derivado", "SVF mínimo."),
    Col("svf_max", F64, "0-1", S12, "máximo", "derivado", "SVF máximo."),
    Col("svf_prov", U8, "código 0-3", _, _, "metadato", "Procedencia del SVF derivado.", False),
    Col("svf_src_res_m", F32, "m", _, _, "metadato", "Resolución del campo cercano (el lejano es de 200 m).", False),
    Col("svf_scenario", F64, "0-1", S12, "mínimo de los píxeles en zona", "escenario", "SVF de diseño: 0,15 en la alcoba del WP3 (un DEM 2,5D no la representa)."),
    Col("svf_scenario_cover_frac", F32, "0-1", "0 o 1", "fracción de píxeles en zona", "metadato", "Cobertura de la zona de escenario.", False),
    Col("svf_effective", F64, "0-1", "escenario si hay; si no, derivado", "escenario si hay; si no, media", "efectivo", "SVF que usa el motor (sky_view_factor del motor)."),
    Col("svf_effective_prov", U8, "código 0-3", _, _, "metadato", "De dónde sale el SVF efectivo.", False),
    # horizonte
    Col("horizon_max_deg", F64, "grados", "máximo de 36 acimuts del píxel", "máximo", "derivado", "Elevación máxima del horizonte."),
    Col("horizon_max_az_deg", F64, "grados", "acimut del máximo", "acimut del máximo", "derivado", "Acimut (paso de 10°) del horizonte más alto."),
    Col("horizon_prov", U8, "código 0-3", _, _, "metadato", "Procedencia del horizonte.", False),
    Col("horizon_src_res_m", F32, "m", _, _, "metadato", "Resolución del campo cercano.", False),
    # línea de vista
    Col("los_fraction", F64, "0-1", "0 o 1 del píxel", "fracción de píxeles con LOS", "derivado", "Línea de vista geométrica con la antena de la Base."),
    Col("los_margin_min_m", F64, "m", S12, "mínimo", "derivado", "Separación mínima rayo-terreno (negativa = obstruido; nulo a < 40 m de la Base)."),
    Col("los_base", F64, "0/1", "LOS del píxel", "1 solo si todos los píxeles tienen LOS", "derivado", "LOS geométrica de la celda."),
    Col("los_indeterminate", BOOL, "booleano", "|margen| < 5 m", "|margen mínimo| < 5 m", "derivado", "Margen dentro del ruido vertical del DTM: LOS indeterminada.", False),
    Col("los_prov", U8, "código 0-3", _, _, "metadato", "Procedencia de la LOS.", False),
    Col("los_src_res_m", F32, "m", _, _, "metadato", "Resolución del DTM usado en el perfil.", False),
    Col("los_base_scenario", F64, "0/1", S12, "mínimo de los píxeles en zona", "escenario", "LOS de escenario (no hay zonas de sombra de radio en la versión actual)."),
    Col("los_scenario_cover_frac", F32, "0-1", "0 o 1", "fracción de píxeles en zona", "metadato", "Cobertura de la zona de escenario.", False),
    Col("los_base_effective", F64, "0/1", "escenario si hay; si no, derivada", "ídem", "efectivo", "LOS que usa la bandera NLOS."),
    Col("los_effective_prov", U8, "código 0-3", _, _, "metadato", "De dónde sale la LOS efectiva.", False),
    # inercia térmica
    Col("tiu_measured", F64, "J m⁻² K⁻¹ s⁻½", _, _, "medido", "Siempre nulo: no hay producto THEMIS de inercia térmica cuantitativa (terrain_outputs.json, not_available)."),
    Col("tiu_scenario", F64, "J m⁻² K⁻¹ s⁻½", S12, "mínimo de los píxeles en zona", "escenario", "Inercia térmica de diseño en discos alrededor de los nodos (110 en WP2, 320 Base, 410 WP1, 620 WP3)."),
    Col("tiu_scenario_cover_frac", F32, "0-1", "0 o 1", "fracción de píxeles en zona", "metadato", "Cobertura de la zona de escenario.", False),
    Col("tiu_effective", F64, "J m⁻² K⁻¹ s⁻½", "escenario si hay; si no, nulo", "ídem", "efectivo", "TIU que usa el motor (thermal_inertia_tiu del motor); nula fuera de las zonas."),
    Col("tiu_effective_prov", U8, "código 0-3", _, _, "metadato", "De dónde sale la TIU efectiva.", False),
    Col("tiu_src_res_m", F32, "m", _, _, "metadato", "Resolución de la rasterización de las zonas.", False),
    # hidratación
    Col("h2o_measured", F64, "% en peso", _, _, "medido", "Siempre nulo: no hay producto CRISM cuantitativo de H₂O en el pipeline."),
    Col("h2o_scenario", F64, "% en peso", S12, "máximo de los píxeles en zona", "escenario", "12 % de H₂O del WP1, extendido a la zona de 100 m del WP1 (supuesto de esta capa)."),
    Col("h2o_scenario_cover_frac", F32, "0-1", "0 o 1", "fracción de píxeles en zona", "metadato", "Cobertura de la zona de escenario.", False),
    Col("h2o_effective", F64, "% en peso", "escenario si hay; si no, nulo", "ídem", "efectivo", "H₂O que usa el motor (isru_h2o_pct del motor)."),
    Col("h2o_effective_prov", U8, "código 0-3", _, _, "metadato", "De dónde sale la H₂O efectiva.", False),
    Col("h2o_src_res_m", F32, "m", _, _, "metadato", "Resolución de la rasterización de la zona.", False),
    # THEMIS
    Col("themis_day_dn", F64, "DN uint8", S12, "media de los valores en cada píxel CTX", "medido", "THEMIS IR diurno: DN cualitativo, NO es temperatura ni inercia térmica."),
    Col("themis_day_prov", U8, "código 0-3", _, _, "metadato", "Procedencia.", False),
    Col("themis_day_src_res_m", F32, "m", _, _, "metadato", "Resolución de la fuente (100 m).", False),
    Col("themis_night_dn", F64, "DN uint8", S12, "ídem", "medido", "THEMIS IR nocturno: DN cualitativo (más claro = más inercia), no calibrado."),
    Col("themis_night_prov", U8, "código 0-3", _, _, "metadato", "Procedencia.", False),
    Col("themis_night_src_res_m", F32, "m", _, _, "metadato", "Resolución de la fuente (100 m).", False),
    # rugosidad
    Col("roughness_m", F64, "m", S12, "media", "derivado", "Rugosidad: desviación típica de los residuos de la cota respecto al plano ajustado en la ventana 3×3 (60 m) del DTM CTX, a su resolución nativa. Sin la pendiente: un plano inclinado liso da 0."),
    Col("roughness_m_max", F64, "m", S12, "máximo", "derivado", "Rugosidad máxima."),
    Col("roughness_prov", U8, "código 0-3", _, _, "metadato", "Procedencia de la rugosidad.", False),
    Col("roughness_src_res_m", F32, "m", _, _, "metadato", "Resolución del DTM fuente (ventana de 3 píxeles).", False),
    # radio
    Col("rssi_dbm", F64, "dBm", S12, "mínimo (peor caso)", "derivado", "Nivel recibido del enlace primario de datos (banda S, 2,4 GHz, 1 W, antenas isótropas): espacio libre con la distancia real a la Base y difracción en filo de cuchillo (ITU-R P.526, arista dominante del perfil)."),
    Col("rssi_dbm_mean", F64, "dBm", S12, "media", "derivado", "Nivel recibido medio."),
    Col("rssi_dbm_low", F64, "dBm", "arista dominante 5 m más alta", "mínimo", "derivado", "Extremo bajo con el ruido vertical del DTM (±5 m) en la arista dominante."),
    Col("rssi_dbm_high", F64, "dBm", "arista dominante 5 m más baja", "mínimo", "derivado", "Extremo alto con el ruido vertical del DTM."),
    Col("diffraction_db", F64, "dB", S12, "máximo", "derivado", "Pérdida por difracción J(ν) restada al espacio libre."),
    Col("rssi_uhf_dbm", F64, "dBm", S12, "mínimo (peor caso)", "derivado", "Nivel recibido de la baliza UHF (435 MHz, 1 W) con el mismo perfil y modelo."),
    Col("diffraction_uhf_db", F64, "dB", S12, "máximo", "derivado", "Pérdida por difracción de la baliza UHF."),
    Col("rssi_prov", U8, "código 0-3", _, _, "metadato", "Procedencia del nivel recibido.", False),
    Col("rssi_src_res_m", F32, "m", _, _, "metadato", "Resolución del DTM del perfil.", False),
    # banderas
    Col("hazard_bitmask", U16, "bits", "desde las efectivas", "desde las efectivas", "efectivo", "Banderas HAZARD_FLAG_* del motor.", False),
]

FULL_SCHEMA = pa.schema([pa.field(c.name, c.type, nullable=c.nullable) for c in FULL_COLUMNS])

# --- contrato del motor ---------------------------------------------------------------------
# (campo, tipo Rust, tipo Arrow, anulable, columna o regla de origen, nota)
CONTRACT_FIELDS: list[tuple[str, str, pa.DataType, bool, str, str]] = [
    ("h3_index", "u64", U64, False, "h3_index", "H3 real. INCOMPATIBLE con el empaquetado axial de h3_mars_grid.rs."),
    ("elev_m", "f32", F32, True, "elev_m", "Medido."),
    ("slope_deg", "f32", F32, True, "slope_deg_effective", "Derivado (p90 a res 9) o escenario."),
    ("aspect_deg", "f32", F32, True, "aspect_deg", "Derivado (media circular a res 9)."),
    ("thermal_inertia_tiu", "f32", F32, True, "tiu_effective", "Solo escenario; nulo fuera de las zonas."),
    ("roughness_hi", "f32", F32, True, "roughness_m", "Rugosidad en m (σ de residuos al plano 3×3 del DTM de 20 m); derivado."),
    ("isru_h2o_pct", "f32", F32, True, "h2o_effective", "Solo escenario; nulo fuera de la zona del WP1."),
    ("sky_view_factor", "f32", F32, True, "svf_effective", "Derivado (media a res 9) o escenario."),
    ("los_base_rssi_dbm", "f32", F32, True, "rssi_dbm", "Enlace primario en banda S (2,4 GHz, 1 W): espacio libre + difracción en filo de cuchillo; derivado. Incertidumbre en rssi_dbm_low/high y baliza UHF en rssi_uhf_dbm de la tabla completa."),
    ("base_metabolic_cost", "f32", F32, True, "nulo", "Lo calcula el motor por arista: depende de velocidad, sentido de la marcha y deslizamiento, no solo de la celda."),
    ("horizon_hash_id", "u32", pa.uint32(), False, "0", "Lo calcula el motor: hash FNV de Canyon-TRN sobre su base de horizontes; valor de Default (0)."),
    ("hazard_bitmask", "u16", U16, False, "hazard_bitmask", "Calculado con los umbrales canónicos."),
    ("padding_crc", "[u8; 14]", pa.binary(14), False, "14 bytes a cero", "H3MarsGrid::insert vuelve a sellar el CRC al cargar."),
]

RUST_TO_ARROW = {"u64": U64, "u32": pa.uint32(), "u16": U16, "f32": F32, "[u8; 14]": pa.binary(14)}

CONTRACT_SCHEMA = pa.schema([pa.field(n, t, nullable=nl) for n, _, t, nl, _, _ in CONTRACT_FIELDS])


def _arr(values: np.ndarray, col: Col) -> pa.Array:
    v = np.asarray(values)
    if pa.types.is_floating(col.type):
        f = v.astype(np.float64)
        mask = ~np.isfinite(f)
        return pa.array(f.astype(col.type.to_pandas_dtype()), type=col.type,
                        mask=mask if mask.any() else None)
    if pa.types.is_boolean(col.type):
        return pa.array(v.astype(bool), type=col.type)
    return pa.array(v.astype(col.type.to_pandas_dtype()), type=col.type)


def full_table(cols: dict, metadata: dict | None = None) -> pa.Table:
    arrays = [_arr(cols[c.name], c) for c in FULL_COLUMNS]
    order = np.argsort(np.asarray(cols["h3_index"], dtype=np.uint64), kind="stable")
    t = pa.Table.from_arrays(arrays, schema=FULL_SCHEMA).take(pa.array(order))
    return t.replace_schema_metadata(metadata) if metadata else t


def contract_table(full: pa.Table, metadata: dict | None = None) -> pa.Table:
    """Vista HexCellState64B a partir de la tabla completa (mismo orden de filas)."""
    n = full.num_rows
    null_f32 = pa.nulls(n, F32)
    src = {
        "h3_index": full["h3_index"],
        "elev_m": full["elev_m"].cast(F32),
        "slope_deg": full["slope_deg_effective"].cast(F32),
        "aspect_deg": full["aspect_deg"].cast(F32),
        "thermal_inertia_tiu": full["tiu_effective"].cast(F32),
        "roughness_hi": full["roughness_m"].cast(F32),
        "isru_h2o_pct": full["h2o_effective"].cast(F32),
        "sky_view_factor": full["svf_effective"].cast(F32),
        "los_base_rssi_dbm": full["rssi_dbm"].cast(F32),
        "base_metabolic_cost": null_f32,
        "horizon_hash_id": pa.array(np.full(n, HORIZON_HASH_ID_UNSET, dtype=np.uint32)),
        "hazard_bitmask": full["hazard_bitmask"],
        "padding_crc": pa.array([PADDING_CRC_ZEROS] * n, type=pa.binary(14)),
    }
    t = pa.Table.from_arrays([src[f.name] for f in CONTRACT_SCHEMA], schema=CONTRACT_SCHEMA)
    return t.replace_schema_metadata(metadata) if metadata else t
