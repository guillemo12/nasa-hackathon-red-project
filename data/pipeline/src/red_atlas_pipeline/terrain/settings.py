"""Constantes propias del módulo de terreno: AOIs auxiliares, fuentes reales y ficheros de salida.

Todo lo que aquí figura como URL se ha comprobado con lectura por ventana (rangos HTTP).
Las AOIs compartidas (`AOI_ROUTE`, `AOI_HORIZON`) viven en `red_atlas_pipeline.config` y no se tocan.
"""
from __future__ import annotations

from .. import config

# --- AOIs auxiliares (lat planetocéntrica, lon Este 0-360) --------------------
# Entorno cercano de la ruta: margen de 0,10° (~6 km) para que la pendiente no tenga
# efecto de borde y para el campo cercano del horizonte a 20 m.
def _pad(aoi: dict, pad: float) -> dict:
    return {"lat_min": round(aoi["lat_min"] - pad, 4), "lat_max": round(aoi["lat_max"] + pad, 4),
            "lon_e_min": round(aoi["lon_e_min"] - pad, 4), "lon_e_max": round(aoi["lon_e_max"] + pad, 4)}


AOI_NEAR = _pad(config.AOI_ROUTE, 0.10)
# Ventana regional (ruta ±3°, ~178 km) solo para la comprobación de realidad: la cuenca
# cerrada mide decenas de kilómetros y no cabe con holgura en AOI_HORIZON.
AOI_REGIONAL = _pad(config.AOI_ROUTE, 2.97)

AOIS = {
    "route": config.AOI_ROUTE,
    "near": AOI_NEAR,
    "horizon": config.AOI_HORIZON,
    "regional": AOI_REGIONAL,
}

# --- Parámetros de los derivados ----------------------------------------------
HORIZON_AZIMUTH_STEP_DEG = 10.0          # 36 acimuts
HORIZON_NEAR_STEP_M = 20.0               # paso del rayo sobre el DTM CTX
HORIZON_NEAR_MAX_M = 6_000.0
HORIZON_FAR_STEP_M = 200.0               # paso del rayo sobre la mezcla HRSC+MOLA
HORIZON_FAR_MAX_M = 60_000.0             # los rayos se cortan al salir de AOI_HORIZON
ANTENNA_BASE_AGL_M = 3.0                 # antena de la Base sobre el suelo
ANTENNA_SUIT_AGL_M = 2.0                 # antena del astronauta sobre el suelo
SCARP_RELIEF_M = 1_000.0                 # desnivel que define «escarpe» en la comprobación
NODATA_F32 = -9999.0

# --- Zonas de diseño de la capa de escenario (E) -------------------------------
# Tras la reubicación, pendiente y sombra de radio son reales y ya no necesitan zona de
# escenario. Quedan como diseño la inercia térmica (sin producto medido) y la alcoba con
# cornisa del WP3 (un DEM 2,5D no puede representarla). Los radios son un supuesto de
# esta capa (E): el escenario solo fija el valor en el nodo.
SCENARIO_ZONES = {
    "ti_radius_m": {"BASE": 100.0, "WP1": 100.0, "WP2": 150.0, "WP3": 40.0},
    "slope_radius_m": {},
    "svf_radius_m": {"WP3": 40.0},
    "nlos_radius_m": {},
    "nlos_corridor_leg": None,
    "nlos_corridor_halfwidth_m": 50.0,
}
SCENARIO_VALUES = {"WP3_sky_view_factor": 0.15}      # alcoba con cornisa (E)

# --- Emplazamiento ---------------------------------------------------------------
ORIGINAL_SITE = {"lat_pc_deg": -9.8, "lon_e_deg": 283.6}
# Par CTX de trabajo, fijado. La colocación cumple todas las condiciones en dos pares
# independientes (D02_027855 y P18_007878); se usa P18 porque cubre el 96 % del entorno
# cercano (D02 solo el 64 %), de modo que el campo cercano del horizonte sale a 20 m.
# El criterio automático (cobertura del 100 % de la caja de la AOI) elegiría P20_008669,
# que es el par que peor concuerda con los demás en este sitio. None = criterio automático.
WORKING_DEM_PIN = "P18_007878_1703_XN_09S076W__P20_008735_1702_XI_09S076W"
WORKING_DEM_PIN_MIN_ROUTE_COVERAGE = 0.995
# Atmósfera: misma fórmula que los datos canónicos del proyecto (724 Pa a −1.905 m).
PRESSURE_DATUM_PA = 610.0
SCALE_HEIGHT_M = 11_100.0

PROV_CODES = {0: "sin_dato", 1: "medido", 2: "derivado", 3: "escenario"}

# --- Fuentes reales -------------------------------------------------------------
STAC_API = "https://stac.astrogeology.usgs.gov/api"
STAC_COLLECTIONS = {
    "mro_ctx_controlled_usgs_dtms": "DTM y ortoimagen CTX (20 m), USGS/ASP",
    "mro_hirise_socet_dtms": "DTM HiRISE (1 m) y ortoimágenes asociadas",
    "mro_hirise_uncontrolled_observations": "HiRISE RDR sin control (0,25-0,5 m)",
    "mo_themis_controlled_mosaics": "Mosaicos THEMIS IR controlados por cuadrángulo (100 m)",
}
_ARD = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars"
_PM = "https://planetarymaps.usgs.gov/mosaic"

# Fuentes que no están en STAC (mosaicos globales de USGS) o que se fijan por URL.
STATIC_SOURCES = {
    "mola_megdr_463m": {
        "url": f"{_PM}/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif",
        "id": "Mars_MGS_MOLA_DEM_mosaic_global_463m",
        "mission": "Mars Global Surveyor",
        "instrument": "MOLA",
        "product_type": "MGS-M-MOLA-5-MEGDR-L3-V1.0 (mosaico global USGS)",
        "kind": "dem",
        "unit": "m sobre el areoide MOLA",
        "native_resolution_m": 463.09,
        "catalog_layer_id": "MOLA_HRSC_DEM",
        "access": "GeoTIFF sin teselar ni comprimir (tiras de una fila); lectura por ventana "
                  "con GTIFF_DIRECT_IO sobre /vsicurl",
        "license": "Dominio público (NASA/USGS)",
        "citation": "Smith, D. E. et al. (2001), JGR 106(E10), 23689-23722; "
                    "MOLA MEGDR 128 px/grado, mosaico USGS Astrogeology.",
    },
    "hrsc_mola_blend_200m": {
        "url": f"{_PM}/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif",
        "id": "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2",
        "mission": "Mars Express + Mars Global Surveyor",
        "instrument": "HRSC + MOLA",
        "product_type": "Mezcla HRSC+MOLA 200 m v2 (USGS Astrogeology)",
        "kind": "dem",
        "unit": "m sobre el areoide MOLA",
        "native_resolution_m": 200.0,
        "catalog_layer_id": "MOLA_HRSC_DEM",
        "access": "GeoTIFF sin teselar ni comprimir (tiras de una fila); lectura por ventana "
                  "con GTIFF_DIRECT_IO sobre /vsicurl",
        "license": "Dominio público (USGS); datos HRSC de ESA/DLR/FU Berlin",
        "citation": "Fergason, R. L., Hare, T. M., Laura, J. (2018), HRSC and MOLA Blended "
                    "Digital Elevation Model at 200m v2, USGS Astrogeology Science Center.",
    },
    "ctx_mosaic_6m_mc18": {
        "url": "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/"
               "Mars_MRO_CTX_Equi_Mosaics_Robbins/6mpp/MC18_6mpp.16bit.tif",
        "id": "MC18_6mpp.16bit",
        "mission": "Mars Reconnaissance Orbiter",
        "instrument": "CTX",
        "product_type": "Mosaico ecuatorial controlado CTX 6 m, cuadrángulo MC-18 Coprates (USGS)",
        "kind": "ortho",
        "unit": "I/F (entero de 16 bits con escala y desplazamiento del fichero)",
        "native_resolution_m": 6.0,
        "catalog_layer_id": "HiRISE_CTX_ORTHO",
        "access": "GeoTIFF teselado con vistas reducidas; lectura por ventana /vsicurl",
        "license": "Dominio público (USGS)",
        "citation": "Robbins, S. J. et al. (2023), Fully controlled 6 meters per pixel "
                    "equatorial mosaic of Mars from MRO CTX data, Earth and Space Science; "
                    "distribución USGS Astrogeology.",
    },
    "themis_day_ir_100m_mc18": {
        "url": "https://astrogeo-ard.s3.us-west-2.amazonaws.com/mars/mo/themis/"
               "controlled_mosaics/mc18_coprates_dir/mc18_coprates_dir.tif",
        "id": "mc18_coprates_dir",
        "stac_collection": "mo_themis_controlled_mosaics",
        "mission": "2001 Mars Odyssey",
        "instrument": "THEMIS IR (diurno)",
        "product_type": "Mosaico THEMIS IR diurno controlado 100 m, MC-18 Coprates (USGS)",
        "kind": "thermal_qualitative",
        "unit": "DN de 8 bits, cualitativo (no es temperatura ni inercia térmica)",
        "native_resolution_m": 100.0,
        "catalog_layer_id": "THEMIS_THERMAL_INERTIA",
        "access": "COG; lectura por ventana /vsicurl",
        "license": "CC0-1.0",
        "citation": "Fergason, R. L. et al., THEMIS IR controlled mosaics, USGS Astrogeology; "
                    "datos THEMIS: Christensen, P. R. et al. (2004), Space Sci. Rev. 110, 85-130.",
    },
    "themis_night_ir_100m_mc18": {
        "url": "https://astrogeo-ard.s3.us-west-2.amazonaws.com/mars/mo/themis/"
               "controlled_mosaics/mc18_coprates_nir/mc18_coprates_nir.tif",
        "id": "mc18_coprates_nir",
        "stac_collection": "mo_themis_controlled_mosaics",
        "mission": "2001 Mars Odyssey",
        "instrument": "THEMIS IR (nocturno)",
        "product_type": "Mosaico THEMIS IR nocturno controlado 100 m, MC-18 Coprates (USGS)",
        "kind": "thermal_qualitative",
        "unit": "DN de 8 bits, cualitativo (no es temperatura ni inercia térmica)",
        "native_resolution_m": 100.0,
        "catalog_layer_id": "THEMIS_THERMAL_INERTIA",
        "access": "COG; lectura por ventana /vsicurl",
        "license": "CC0-1.0",
        "citation": "Fergason, R. L. et al., THEMIS IR controlled mosaics, USGS Astrogeology; "
                    "datos THEMIS: Christensen, P. R. et al. (2004), Space Sci. Rev. 110, 85-130.",
    },
}

# Productos del catálogo de capas que NO se han podido obtener por ventana. Se declaran en
# el manifiesto en lugar de inventarlos.
UNAVAILABLE = [
    {
        "key": "themis_thermal_inertia_quantitative",
        "catalog_layer_id": "THEMIS_THERMAL_INERTIA",
        "product_type": "Mapa cuantitativo de inercia térmica THEMIS (TIU) y TES (Putzig et al.)",
        "status": "sin_producto_accesible_por_ventana",
        "detail": "Ni el catálogo STAC de USGS ni el repositorio de mosaicos "
                  "planetarymaps.usgs.gov/mosaic exponen un ráster de inercia térmica "
                  "cuantitativa. Solo hay mosaicos THEMIS IR día/noche de 8 bits (cualitativos) "
                  "y el albedo TES de 7,4 km. No se deriva TIU a partir de los DN.",
    },
    {
        "key": "hrsc_dtm_single_strip",
        "catalog_layer_id": "MOLA_HRSC_DEM",
        "product_type": "MEX-M-HRSC-5-REFDR-DTM-V1.0 (tiras HRSC de 50-100 m)",
        "status": "no_buscado_por_ventana",
        "detail": "Las tiras HRSC individuales se distribuyen en PSA/PDS como ficheros "
                  "completos, sin COG. Su información entra a través de la mezcla HRSC+MOLA "
                  "de 200 m.",
    },
    {
        "key": "murray_lab_ctx_5m",
        "catalog_layer_id": "HiRISE_CTX_ORTHO",
        "product_type": "Mosaico global CTX 5 m (Murray Lab, Caltech)",
        "status": "no_accesible_por_ventana",
        "detail": "Se distribuye en teselas ZIP de 4°×4° de descarga completa. Se sustituye "
                  "por el mosaico CTX controlado de 6 m de USGS (Robbins et al. 2023), que sí "
                  "es un GeoTIFF teselado legible por ventana.",
    },
    {
        "key": "crism_sharad",
        "catalog_layer_id": "CRISM_SHARAD_ISRU",
        "product_type": "MRO CRISM (TRDR/MTRDR) y SHARAD",
        "status": "fuera_del_alcance_del_modulo_de_terreno",
        "detail": "No hay colección CRISM ni SHARAD en el catálogo STAC de USGS; no se ha "
                  "comprobado cobertura en PDS ODE.",
    },
]

# --- Ficheros de salida ---------------------------------------------------------
SOURCES_MANIFEST_JSON = config.LAYERS_DIR / "sources_manifest.json"
SITE_REALITY_JSON = config.LAYERS_DIR / "site_reality_check.json"
SITE_REALITY_MD = config.LAYERS_DIR / "SITE_REALITY_CHECK.md"
TERRAIN_OUTPUTS_JSON = config.LAYERS_DIR / "terrain_outputs.json"
SCENARIO_OVERLAY_GEOJSON = config.LAYERS_DIR / "scenario_overlay.geojson"
SITE_SEARCH_JSON = config.LAYERS_DIR / "site_search.json"
ORIGINAL_REALITY_JSON = config.LAYERS_DIR / "site_reality_check_original_site.json"
