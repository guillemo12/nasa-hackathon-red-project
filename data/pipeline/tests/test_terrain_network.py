"""Tests que tocan la red (STAC y mosaicos de USGS) o las salidas ya compiladas.

Se ejecutan con `uv run pytest`; si no hay conexión se saltan solos, de modo que la
batería sigue en verde sin red. Para excluirlos: `uv run pytest -m "not network"`.
"""
from __future__ import annotations

import json

import pytest
import requests
from rio_cogeo.cogeo import cog_validate

from red_atlas_pipeline import config
from red_atlas_pipeline.terrain import settings as S
from red_atlas_pipeline.terrain import sources
from red_atlas_pipeline.terrain.rasters import read_window, sample_raster

pytestmark = pytest.mark.network

CTX_P04 = ("https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mro/ctx/controlled/usgs/"
           "P04_002551_1712_XI_08S076W__P05_002828_1711_XI_08S076W/"
           "P04_002551_1712_XI_08S076W__P05_002828_1711_XI_08S076W_dtm.tif")


# AOI de ruta del emplazamiento original (9,8°S, 283,6°E): los tests de red que comprueban
# productos concretos usan esta huella fija, no la AOI vigente.
ORIGINAL_ROUTE = {"lat_min": -9.84, "lat_max": -9.78, "lon_e_min": 283.58, "lon_e_max": 283.64}
ORIGINAL_BASE = (283.6, -9.8, -1905.0)


@pytest.fixture(scope="module")
def online():
    """Salta el módulo entero si el catálogo STAC no responde."""
    try:
        requests.get(S.STAC_API, timeout=15).raise_for_status()
    except requests.RequestException as exc:
        pytest.skip(f"sin acceso a la red: {exc}")


def test_stac_tiene_productos_reales_sobre_la_ruta(online):
    ctx = sources.stac_search("mro_ctx_controlled_usgs_dtms", ORIGINAL_ROUTE)
    hirise = sources.stac_search("mro_hirise_socet_dtms", ORIGINAL_ROUTE)
    assert len(sources.stac_search("mro_ctx_controlled_usgs_dtms", config.AOI_ROUTE)) >= 2
    assert len(ctx) >= 4
    assert any(i["id"].startswith("DTEEC_044325_1700_044180_1700") for i in hirise)
    assert all("dtm" in i["assets"] for i in ctx)


def test_la_caja_del_catalogo_no_garantiza_cobertura(online):
    """Un par CTX cuya caja intersecta la ruta puede no tener ni un píxel válido en ella."""
    items = {i["id"]: i for i in sources.stac_search("mro_ctx_controlled_usgs_dtms", ORIGINAL_ROUTE)}
    empty = next(k for k in items if k.startswith("D18_034092"))
    assert sources.coverage(items[empty]["assets"]["dtm"]["href"], ORIGINAL_ROUTE) == 0.0
    assert sources.coverage(CTX_P04, ORIGINAL_ROUTE) == pytest.approx(1.0, abs=1e-3)


def test_cota_real_de_la_base_original_por_ventana(online):
    lon, lat, z_scn = ORIGINAL_BASE
    pad = 0.003
    aoi = {"lon_e_min": lon - pad, "lon_e_max": lon + pad, "lat_min": lat - pad, "lat_max": lat + pad}
    r = read_window(CTX_P04, aoi)
    assert r.shape[0] < 40 and r.shape[1] < 40                 # solo la ventana, no la escena
    assert r.pixel_m == pytest.approx(20.0, abs=0.3)
    assert float(sample_raster(r, lon, lat)) == pytest.approx(z_scn, abs=15.0)   # −1.906 m real


def test_cota_del_geojson_coincide_con_el_dtm_de_trabajo(online):
    """Tras la reubicación, la cota de cada nodo del escenario es la medida en el DTM CTX."""
    if not S.SOURCES_MANIFEST_JSON.exists():
        pytest.skip("sin manifiesto de fuentes")
    url = sources.load_manifest()["working_dem"]["url"]
    pad = 0.002
    for nid, p in config.scenario_nodes().items():
        lon, lat = p["lon_e_deg"], p["lat_pc_deg"]
        aoi = {"lon_e_min": lon - pad, "lon_e_max": lon + pad, "lat_min": lat - pad, "lat_max": lat + pad}
        z = float(sample_raster(read_window(url, aoi), lon, lat))
        assert z == pytest.approx(p["elev_mola_m"], abs=2.0), nid


def test_mosaico_global_en_tiras_se_lee_por_ventana(online):
    """MOLA 463 m es un GeoTIFF de 2 GB sin teselar: se leen unas pocas filas con rangos HTTP."""
    r = read_window(S.STATIC_SOURCES["mola_megdr_463m"]["url"], ORIGINAL_ROUTE)
    assert 6 <= r.shape[0] <= 10 and 6 <= r.shape[1] <= 10      # la ruta ocupa ~8×8 píxeles MOLA
    assert -1950 < float(r.band(0).mean()) < -1850


# --- salidas compiladas (se saltan si aún no se ha ejecutado el pipeline) ----------
def _contract():
    if not S.TERRAIN_OUTPUTS_JSON.exists():
        pytest.skip("terrain_outputs.json no existe: ejecutar `python -m red_atlas_pipeline.terrain`")
    return json.loads(S.TERRAIN_OUTPUTS_JSON.read_text(encoding="utf-8"))


def test_contrato_y_cog_compilados_son_coherentes():
    import rasterio

    contract = _contract()
    missing = [f["path"] for f in contract["files"] if not (config.PIPELINE_DIR / f["path"]).exists()]
    if missing:
        pytest.skip("build/cog no está compilado en esta máquina")
    ref = None
    for f in contract["files"]:
        path = config.PIPELINE_DIR / f["path"]
        ok, errors, _ = cog_validate(str(path), quiet=True)
        assert ok, f"{f['path']}: {errors}"
        with rasterio.open(path) as ds:
            tags = ds.tags()
            assert ds.count == len(f["bands"]) and ds.nodata == f["nodata"]
            assert tags["PROVENANCE"].startswith(f["provenance"].split(" ")[0])
            assert ("SOURCE_URL" in tags) or ("SOURCE_RESOLUTION" in tags)
            assert 280 < ds.bounds.left < 287                   # longitud Este 0-360
            if f["path"].endswith("dem_ctx_20m_route.tif"):
                ref = (ds.transform, ds.width, ds.height)
    for f in contract["files"]:
        if f["aoi"] == "route" and f["layer"] in {"slope", "svf", "horizon", "radio_los", "scenario_overlay"}:
            with rasterio.open(config.PIPELINE_DIR / f["path"]) as ds:
                assert (ds.transform, ds.width, ds.height) == ref, f["path"]


def test_los_rasteres_medidos_no_llevan_valores_de_escenario():
    import numpy as np
    import rasterio

    contract = _contract()
    path = config.PIPELINE_DIR / "build/cog/svf_ctx20_hrscmola200_route.tif"
    if not path.exists():
        pytest.skip("build/cog no está compilado en esta máquina")
    with rasterio.open(path) as ds:
        svf = ds.read(1, masked=True)
    assert float(svf.min()) > 0.3               # el 0,15 de la alcoba solo vive en la capa de escenario
    with rasterio.open(config.PIPELINE_DIR / "build/cog/scenario_overlay_route.tif") as ds:
        names = list(ds.descriptions)
        prov = ds.read(names.index("svf_procedencia") + 1)
        esc = ds.read(names.index("svf_escenario") + 1)
        ti_prov = ds.read(names.index("thermal_inertia_procedencia") + 1)
    assert set(np.unique(prov)) <= {0.0, 2.0, 3.0}
    assert (prov == 3).any() and np.allclose(esc[prov == 3], 0.15)
    assert set(np.unique(ti_prov)) <= {0.0, 3.0}          # la inercia térmica nunca es «medida»
    assert any(f["layer"] == "scenario_overlay" for f in contract["files"])


def test_geojson_reubicado_conserva_la_figura_rigida():
    """Distancias canónicas (1.500 / 1.200 / 600 / 1.600 / 2.150 m) tras la reubicación."""
    from red_atlas_pipeline.terrain import derive

    nodes = config.scenario_nodes()
    for lid, leg in config.scenario_legs().items():
        a, b = nodes[leg["from"]], nodes[leg["to"]]
        d = float(derive.distance_m(a["lon_e_deg"], a["lat_pc_deg"], b["lon_e_deg"], b["lat_pc_deg"]))
        assert d == pytest.approx(leg["distance_m"], abs=1.5), lid
    for p in nodes.values():
        assert config.AOI_ROUTE["lat_min"] < p["lat_pc_deg"] < config.AOI_ROUTE["lat_max"]
        assert config.AOI_ROUTE["lon_e_min"] < p["lon_e_deg"] < config.AOI_ROUTE["lon_e_max"]
        assert set(p["property_provenance"].values()) <= {"medido", "derivado", "escenario"}
