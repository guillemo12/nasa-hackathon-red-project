"""Descubrimiento de productos reales y manifiesto de fuentes.

Consulta el catálogo STAC de USGS Astrogeology, mide la cobertura REAL de cada producto
sobre las AOIs (fracción de píxeles válidos leída por ventana, no la caja del catálogo)
y elige el DTM CTX de trabajo con un criterio declarado.
"""
from __future__ import annotations

import datetime as dt
import json
import re

import requests
from pystac_client import Client

from .. import config
from . import settings as S
from .rasters import aoi_coverage, read_window, sample_raster

_COVERAGE_MAX_SIZE = 256      # lado máximo de la vista reducida con la que se mide cobertura


def _bbox180(aoi: dict) -> list[float]:
    return [config.lon180(aoi["lon_e_min"]), aoi["lat_min"],
            config.lon180(aoi["lon_e_max"]), aoi["lat_max"]]


def stac_search(collection: str, aoi: dict) -> list[dict]:
    """Ítems STAC de una colección cuya caja intersecta la AOI (longitudes −180..180)."""
    client = Client.open(S.STAC_API)
    search = client.search(collections=[collection], bbox=_bbox180(aoi), limit=100)
    return [item.to_dict() for item in search.items()]


def coverage(url: str, aoi: dict) -> float:
    """Fracción de la AOI con píxeles válidos, medida sobre una vista reducida."""
    return aoi_coverage(read_window(url, aoi, max_size=_COVERAGE_MAX_SIZE), aoi)


def _qa_std(url: str) -> float | None:
    """Desviación típica DTM − disparos MOLA que publica USGS en `qa_metrics.txt`."""
    try:
        text = requests.get(url, timeout=30).text
    except requests.RequestException:
        return None
    m = re.search(r"StdDev of difference:\s*([-\d.]+)", text)
    return float(m.group(1)) if m else None


def _node_coords() -> dict[str, tuple[float, float]]:
    return {k: (p["lon_e_deg"], p["lat_pc_deg"]) for k, p in config.scenario_nodes().items()}


def _sample_nodes(url: str) -> dict[str, float | None]:
    """Cota en los cuatro nodos (vecino más próximo, sin interpolar)."""
    nodes = _node_coords()
    pad = 0.002
    out: dict[str, float | None] = {}
    for k, (lon, lat) in nodes.items():
        aoi = {"lon_e_min": lon - pad, "lon_e_max": lon + pad,
               "lat_min": lat - pad, "lat_max": lat + pad}
        r = read_window(url, aoi)
        v = float(sample_raster(r, lon, lat, bilinear=False)) if r.data.size else float("nan")
        out[k] = round(v, 2) if v == v else None
    return out


def _entry_from_item(item: dict, asset_key: str, kind: str, layer_id: str, unit: str,
                     access: str = "COG; lectura por ventana /vsicurl") -> dict:
    p = item["properties"]
    return {
        "id": item["id"],
        "stac_collection": item["collection"],
        "stac_item": f"{S.STAC_API}/collections/{item['collection']}/items/{item['id']}",
        "url": item["assets"][asset_key]["href"],
        "asset": asset_key,
        "mission": "; ".join(p.get("missions", [])),
        "instrument": "; ".join(p.get("instruments", [])),
        "kind": kind,
        "unit": unit,
        "native_resolution_m": round(float(p.get("gsd", float("nan"))), 3),
        "crs": "Equirrectangular (lat_ts=0, lon_0=0) sobre la esfera R=3396190 m",
        "catalog_layer_id": layer_id,
        "access": access,
        "license": p.get("license", "CC0-1.0"),
        "stac_description": p.get("description", ""),
    }


def discover(log=print) -> dict:
    """Construye el manifiesto de fuentes con cobertura medida."""
    route, near, horizon = S.AOIS["route"], S.AOIS["near"], S.AOIS["horizon"]
    products: list[dict] = []

    # --- DTM CTX ------------------------------------------------------------
    log("STAC: DTM CTX…")
    ctx_route = {i["id"]: i for i in stac_search("mro_ctx_controlled_usgs_dtms", route)}
    ctx_horizon = {i["id"]: i for i in stac_search("mro_ctx_controlled_usgs_dtms", horizon)}
    ctx_entries = []
    for iid, item in sorted(ctx_horizon.items()):
        e = _entry_from_item(item, "dtm", "dem", "MOLA_HRSC_DEM", "m sobre el areoide MOLA")
        e["product_type"] = "DTM CTX estéreo de 20 m (USGS, Ames Stereo Pipeline, alineado a MOLA)"
        e["citation"] = ("Laura, J. R. et al. (2023), MRO CTX orthoimage generated using Ames "
                         "stereo pipeline derived digital terrain models, "
                         "https://doi.org/10.5066/P9JKVWR3")
        e["orthoimage_url"] = item["assets"]["orthoimage"]["href"]
        e["coverage"] = {"horizon": coverage(e["url"], horizon)}
        e["bbox_intersects_route"] = iid in ctx_route
        if iid in ctx_route:
            e["coverage"]["route"] = coverage(e["url"], route)
            e["coverage"]["near"] = coverage(e["url"], near)
            e["qa_std_vs_mola_m"] = _qa_std(item["assets"]["qa_metrics"]["href"])
            if e["coverage"]["route"] > 0:
                e["node_elevation_m"] = _sample_nodes(e["url"])
        else:
            e["coverage"]["route"] = 0.0
        ctx_entries.append(e)
    full = [e for e in ctx_entries if e["coverage"]["route"] >= 0.999]
    if not full:
        raise RuntimeError("Ningún DTM CTX cubre por completo la AOI de ruta")
    # Criterio: cobertura total de la ruta; después, mayor cobertura del entorno cercano
    # (redondeada al 5 %) y, a igualdad, menor dispersión frente a los disparos MOLA.
    full.sort(key=lambda e: (-round(e["coverage"]["near"] * 20) / 20,
                             e["qa_std_vs_mola_m"] if e["qa_std_vs_mola_m"] is not None else 1e9))
    chosen = full[0]
    pinned = next((e for e in ctx_entries if e["id"] == S.WORKING_DEM_PIN
                   and e["coverage"]["route"] >= S.WORKING_DEM_PIN_MIN_ROUTE_COVERAGE), None)
    if pinned is not None:
        chosen = pinned
    for e in ctx_entries:
        e["selected_as_working_dem"] = e is chosen
    products += ctx_entries

    # --- DTM HiRISE ---------------------------------------------------------
    log("STAC: DTM HiRISE…")
    hirise_route_ids = {i["id"] for i in stac_search("mro_hirise_socet_dtms", route)}
    for item in stac_search("mro_hirise_socet_dtms", horizon):
        e = _entry_from_item(item, "dtm", "dem", "MOLA_HRSC_DEM", "m sobre el areoide MOLA")
        e["product_type"] = "MRO-M-HIRISE-5-DTM-V1.0 (DTM HiRISE de 1 m, SOCET SET)"
        e["citation"] = ("Kirk, R. L. et al. (2008), JGR 113, E00A24; equipo HiRISE "
                         "(Universidad de Arizona) / USGS Astrogeology.")
        e["orthoimages"] = {k: a["href"] for k, a in item["assets"].items()
                            if re.fullmatch(r"ortho_\d+", k)}
        e["coverage"] = {"horizon": coverage(e["url"], horizon)}
        e["bbox_intersects_route"] = item["id"] in hirise_route_ids
        e["coverage"]["route"] = coverage(e["url"], route) if e["bbox_intersects_route"] else 0.0
        if e["bbox_intersects_route"]:
            e["node_elevation_m"] = _sample_nodes(e["url"])
        products.append(e)

    # --- HiRISE RDR sin control -------------------------------------------------
    log("STAC: HiRISE RDR…")
    rdr_horizon = stac_search("mro_hirise_uncontrolled_observations", horizon)
    rdr_route = [i for i in stac_search("mro_hirise_uncontrolled_observations", route)
                 if i["id"].endswith("_RED")]
    rdr_entries = []
    for item in rdr_route:
        e = _entry_from_item(item, "image", "ortho", "HiRISE_CTX_ORTHO",
                             "I/F (entero de 16 bits con escala y desplazamiento del fichero)")
        e["product_type"] = "MRO-M-HIRISE-3-RDR-V1.1 (RDR proyectado, sin control: ±100 m)"
        e["citation"] = ("Laura, J. R. et al. (2023), Analysis Ready Data: Uncontrolled MRO "
                         "HiRISE RDRs, https://doi.org/10.5066/P944DLP8")
        e["coverage"] = {"route": coverage(e["url"], route)}
        e["sun_elevation_deg"] = item["properties"].get("view:sun_elevation")
        rdr_entries.append(e)
    rdr_entries.sort(key=lambda e: -e["coverage"]["route"])
    for k, e in enumerate(rdr_entries):
        e["selected_as_route_ortho"] = k == 0
    products += rdr_entries

    # --- Fuentes fijas (mosaicos globales y por cuadrángulo) -----------------
    log("Mosaicos de USGS…")
    for key, src in S.STATIC_SOURCES.items():
        e = dict(src)
        e["key"] = key
        e["crs"] = read_window(src["url"], route, max_size=4).meta["source_crs"]
        # Los mosaicos globales son continuos: la cobertura se mide sobre el recorte final.
        e["coverage"] = {"route": None, "horizon": None}
        products.append(e)

    return {
        "schema_version": "1.0",
        "owner": "Persona 1",
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "uv run python -m red_atlas_p1.terrain",
        "stac_api": S.STAC_API,
        "aois": {k: S.AOIS[k] for k in ("route", "near", "horizon", "regional")},
        "coverage_method": (
            "Fracción de píxeles válidos dentro de la AOI, leída por ventana sobre una vista "
            f"reducida de lado ≤ {_COVERAGE_MAX_SIZE} px. La caja del catálogo STAC no basta: "
            "hay productos cuya caja intersecta la ruta y que no tienen ni un píxel válido en ella."),
        "working_dem": {
            "id": chosen["id"],
            "url": chosen["url"],
            "criterion": (
                "Un único par estéreo CTX (sin mosaico, para no crear pendientes falsas en las "
                "costuras) con cobertura total de la AOI de ruta. "
                + ("Fijado en settings.WORKING_DEM_PIN: uno de los dos pares en los que la "
                   "colocación del triángulo cumple todas las condiciones, y el de mayor "
                   "cobertura del entorno cercano. Los nodos y los tramos tienen cobertura "
                   "completa; quedan sin dato algunas celdas del borde de la caja de la AOI." if pinned is not None else
                   "Entre los que la cumplen, mayor cobertura del entorno cercano y, a igualdad, "
                   "menor desviación típica frente a los disparos MOLA.")),
            "automatic_choice": full[0]["id"],
            "candidates_full_route_coverage": [e["id"] for e in full],
        },
        "counts": {
            "ctx_dtm_bbox_route": len(ctx_route),
            "ctx_dtm_bbox_horizon": len(ctx_horizon),
            "ctx_dtm_valid_on_route": sum(1 for e in ctx_entries if e["coverage"]["route"] > 0),
            "hirise_dtm_bbox_route": len(hirise_route_ids),
            "hirise_rdr_bbox_horizon": len(rdr_horizon),
            "hirise_rdr_red_bbox_route": len(rdr_route),
        },
        "products": products,
        "not_available": S.UNAVAILABLE,
    }


def write_manifest(manifest: dict) -> None:
    S.SOURCES_MANIFEST_JSON.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_manifest() -> dict:
    return json.loads(S.SOURCES_MANIFEST_JSON.read_text(encoding="utf-8"))


def product(manifest: dict, *, key: str | None = None, pid: str | None = None) -> dict:
    for p in manifest["products"]:
        if (key and p.get("key") == key) or (pid and p["id"] == pid):
            return p
    raise KeyError(key or pid)
