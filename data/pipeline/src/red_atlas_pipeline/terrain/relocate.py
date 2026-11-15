"""Reubicación del Triángulo de Supervivencia sobre el emplazamiento elegido.

Dos pasos, ambos conservando el esquema de `triangulo_supervivencia.geojson`:

1. `write_coordinates`: fija las coordenadas de la colocación rígida elegida.
2. `fill_from_reality`: una vez ejecutado el pipeline, rellena cotas, pendientes, SVF,
   línea de vista, rumbos y desniveles reales, con la procedencia de cada propiedad.

    uv run python -m red_atlas_pipeline.terrain.relocate      # hace los dos pasos y regenera
"""
from __future__ import annotations

import json

import numpy as np

from .. import config
from . import derive, site_search
from . import settings as S
from .rasters import read_cog

# Colocación elegida (site_search.refine): traslación + rotación, sin simetría.
CHOSEN = {"base_lon": 283.38920, "base_lat": -9.89646, "rot_deg": 37.0, "mirror": False}
MEDIDO, DERIVADO, ESCENARIO = "medido", "derivado", "escenario"


def _load() -> dict:
    return json.loads(config.SCENARIO_GEOJSON.read_text(encoding="utf-8"))


def _save(gj: dict) -> None:
    config.SCENARIO_GEOJSON.write_text(json.dumps(gj, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
    config.load_scenario.cache_clear()


def write_coordinates() -> dict:
    """Paso 1: mueve nodos y tramos a la colocación elegida (sin tocar aún los atributos)."""
    gj = _load()
    nodes = site_search.place(**CHOSEN)
    xy = {n: (round(lon, 6), round(lat, 6)) for n, (lon, lat) in nodes.items()}
    for f in gj["features"]:
        g, p = f["geometry"], f["properties"]
        if g["type"] == "Point":
            lon, lat = xy[f["id"]]
            g["coordinates"][:2] = [lon, lat]
            p["lat_pc_deg"], p["lon_e_deg"], p["lon_w_deg"] = lat, lon, round(360.0 - lon, 6)
        else:
            for k, end in enumerate((p["from"], p["to"])):
                g["coordinates"][k][:2] = list(xy[end])
    _save(gj)
    return xy


def _los_recovery_m(los, a, b) -> float | None:
    """Distancia desde `a` (yendo hacia `b`) a partir de la cual hay LOS sostenida con la Base."""
    band = los.band(0)
    d = float(derive.distance_m(a[0], a[1], b[0], b[1]))
    t = np.linspace(0, 1, int(d / 10.0) + 1)
    v = np.array([band[tuple(int(round(float(q))) for q in los.index(a[0] + s * (b[0] - a[0]),
                                                                      a[1] + s * (b[1] - a[1])))]
                  for s in t])
    blocked = np.where(v < 0.5)[0]
    if blocked.size == 0:
        return 0.0
    return None if blocked[-1] == len(t) - 1 else float(round(t[blocked[-1] + 1] * d, 0))


def fill_from_reality() -> dict:
    """Paso 2: atributos reales y procedencia por propiedad."""
    check = json.loads(S.SITE_REALITY_JSON.read_text(encoding="utf-8"))
    los = read_cog(config.COG_DIR / "radio_los_base_ctx_20m_route.tif")
    gj = _load()
    elev = {n: int(round(v["elevation_m"]["ctx_20m"])) for n, v in check["nodes"].items()}
    xy = {}
    for f in gj["features"]:
        if f["geometry"]["type"] != "Point":
            continue
        nid, p, real = f["id"], f["properties"], check["nodes"][f["id"]]
        xy[nid] = (p["lon_e_deg"], p["lat_pc_deg"])
        f["geometry"]["coordinates"][2] = elev[nid]
        svf_dem = round(real["sky_view_factor"]["derived_ctx_20m"], 2)
        p["elev_mola_m"] = elev[nid]
        p["slope_local_deg"] = real["slope_deg"]["ctx_20m"]
        p["sky_view_factor"] = S.SCENARIO_VALUES["WP3_sky_view_factor"] if nid == "WP3" else svf_dem
        p["sky_view_factor_dem"] = svf_dem
        p["radio_los_base"] = True if nid == "BASE" else real["radio_los_base"]["derived_ctx_20m"]
        p["radio_los_margin_m"] = real["radio_los_base"]["margin_m"]
        p["horizon_max_deg"] = real["horizon"]["max_deg"]
        p["property_provenance"] = {
            "lat_pc_deg": DERIVADO, "lon_e_deg": DERIVADO, "lon_w_deg": DERIVADO,
            "elev_mola_m": MEDIDO, "slope_local_deg": DERIVADO,
            "thermal_inertia_tiu": ESCENARIO,
            "sky_view_factor": ESCENARIO if nid == "WP3" else DERIVADO,
            "sky_view_factor_dem": DERIVADO, "radio_los_base": DERIVADO,
            "radio_los_margin_m": DERIVADO, "horizon_max_deg": DERIVADO,
            "h2o_wt_pct": ESCENARIO, "geology": ESCENARIO, "hazards": ESCENARIO,
        }
        p["provenance"] = (
            "posicion elegida por busqueda rigida sobre DTM CTX 20 m (D); cota medida en el DTM CTX "
            f"{check['dems_used']['ctx_20m'][:27]} (M); pendiente, sky_view_factor_dem, horizonte y "
            "linea de vista derivados de ese DTM (D); inercia termica, geologia y agua son "
            "escenario de diseno (E)"
            + ("; sky_view_factor 0.15 es la alcoba con cornisa de diseno, que un DEM no "
               "representa (E)" if nid == "WP3" else ""))
    for f in gj["features"]:
        if f["geometry"]["type"] != "LineString":
            continue
        p, real = f["properties"], check["legs"][f["id"]]
        a, b = p["from"], p["to"]
        f["geometry"]["coordinates"][0][2], f["geometry"]["coordinates"][1][2] = elev[a], elev[b]
        p["delta_elev_m"] = elev[b] - elev[a]
        p["bearing_deg"] = int(real["bearing_deg"]["real"])
        p["slope_max_deg"] = real["slope_along_leg_deg"]["max"]
        p["mean_slope_deg"] = real["mean_slope_deg"]
        p["property_provenance"] = {"distance_m": DERIVADO, "delta_elev_m": DERIVADO,
                                    "bearing_deg": DERIVADO, "slope_max_deg": DERIVADO,
                                    "mean_slope_deg": DERIVADO, "risk": "derivado + escenario"}
        smax = f"{real['slope_along_leg_deg']['max']:.0f}"
        if f["id"] == "L1":
            p["risk"] = f"bajo: pendiente maxima {smax} grados, con linea de vista a la Base"
        elif f["id"] == "L2":
            p["risk"] = (f"alto: pendiente real hasta {smax} grados, <150 TIU (E), "
                         "sombra de radio real")
        elif f["id"] == "L3":
            p["risk"] = (f"medio-alto: ruta de escape en ladera, pendiente real hasta {smax} grados, "
                         "8 min a marcha urgente (E)")
        elif f["id"] == "L4":
            rec = _los_recovery_m(los, xy[a], xy[b])
            p["los_recovered_at_m"] = rec
            p["property_provenance"]["los_recovered_at_m"] = DERIVADO
            txt = f"recupera LOS a ~{rec:.0f} m del WP3" if rec else "LOS no sostenida hasta la Base"
            p["risk"] = f"medio: descenso, pendiente real hasta {smax} grados, {txt}"
        elif f["id"] == "R1":
            p["risk"] = (f"retorno directo: 2150 m en linea recta, pendiente real hasta {smax} grados; "
                         "2500 m por ruta segura D* Lite (rodeo 1.16) (E)")
    base = check["nodes"]["BASE"]
    gj["metadata"]["region"] = "Valles Marineris - Melas Chasma (cuenca SW, pie de la pared suroeste)"
    gj["metadata"]["site_relocation"] = {
        "original_base": S.ORIGINAL_SITE,
        "new_base": {"lat_pc_deg": base["lat_pc_deg"], "lon_e_deg": base["lon_e_deg"]},
        "displacement_km": check["relocation"]["displacement_km"],
        "bearing_deg": check["relocation"]["bearing_deg"],
        "transform": "figura rigida: traslacion + rotacion horaria de "
                     f"{CHOSEN['rot_deg']:.0f} grados, sin simetria especular",
        "reason": "En 9.8S 283.6E no existen ni la rampa del WP2 ni el escarpe del WP3 "
                  "(ver data/nasa-layers/SITE_REALITY_CHECK.md).",
        "original_geojson": "triangulo_supervivencia_original_9.8S_283.6E.geojson",
    }
    gj["metadata"]["provenance_legend"] = {
        MEDIDO: "leido de un producto real (DTM CTX 20 m)",
        DERIVADO: "calculado a partir de datos medidos",
        ESCENARIO: "supuesto de diseno, no contrastado con datos"}
    _save(gj)
    return gj


def main() -> int:
    from .build import Builder

    site_search.record_chosen(**CHOSEN)   # usa los recortes en caché de la búsqueda
    write_coordinates()
    Builder(reuse=False).run()          # nuevo sitio: se vuelve a descubrir y recortar todo
    fill_from_reality()
    Builder(reuse=True).run()           # informe coherente con el GeoJSON ya actualizado
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
