"""Textura orbital del gemelo 3D (`red_atlas_pipeline.terrain.ortho_texture`).

Sin red: se comprueba la correlación de fase con un desplazamiento sintético y la coherencia de
la textura versionada en `data/nasa-layers/` (límites, tamaño, co-registro y procedencia).
"""
from __future__ import annotations

import json
import warnings

import numpy as np
import pytest
import rasterio

from red_atlas_pipeline import config
from red_atlas_pipeline.terrain.ortho_texture import OUT_JSON, OUT_PNG, phase_shift


def test_phase_shift_recovers_a_synthetic_offset():
    rng = np.random.default_rng(7)
    from scipy.ndimage import gaussian_filter

    ref = gaussian_filter(rng.normal(size=(160, 200)), 1.5)
    img = np.roll(np.roll(ref, 4, axis=0), -6, axis=1)  # img = ref movida 4 filas abajo, 6 columnas a la izquierda
    di, dj, peak = phase_shift(ref, img)
    assert round(di) == -4 and round(dj) == 6  # lo que hay que aplicar a img para casar con ref
    assert peak > 10


@pytest.fixture(scope="module")
def meta() -> dict:
    if not OUT_JSON.exists():
        pytest.skip("textura no generada")
    return json.loads(OUT_JSON.read_text(encoding="utf-8"))


def test_texture_matches_its_metadata(meta):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with rasterio.open(OUT_PNG) as png:
            assert (png.width, png.height) == (meta["width"], meta["height"])
            assert png.count == 2 and png.dtypes[0] == "uint8"
            alpha = png.read(2)
    assert (alpha == 255).mean() > 0.99  # el mosaico CTX cubre toda la AOI de ruta


def test_texture_covers_the_route_aoi_in_east_longitude(meta):
    b, aoi = meta["bounds"], config.AOI_ROUTE
    assert 0 <= b["lon_e_min"] < b["lon_e_max"] <= 360  # longitud Este 0-360, no -180..180
    tol = 150.0 / (config.MARS_RADIUS_M * np.pi / 180)  # el co-registro mueve < 150 m
    assert abs(b["lon_e_min"] - aoi["lon_e_min"]) < tol and abs(b["lon_e_max"] - aoi["lon_e_max"]) < tol
    assert abs(b["lat_min"] - aoi["lat_min"]) < tol and abs(b["lat_max"] - aoi["lat_max"]) < tol
    assert b["lat_min"] < b["lat_max"]


def test_coregistration_is_a_consistent_translation(meta):
    c = meta["coregistration"]
    assert np.hypot(c["shift_east_m"], c["shift_north_m"]) < 150
    assert c["quadrant_spread_m"] <= 15.0
    assert c["residual_m"] <= 5.0
    for q in c["quadrants"]:
        assert abs(q["east_m"] - c["shift_east_m"]) < 15 and abs(q["north_m"] - c["shift_north_m"]) < 15
    assert meta["provenance"] == "medido"
    assert meta["resolution_m"] == pytest.approx(6.0)
    assert "CTX" in meta["instrument"] and meta["source_url"].startswith("https://")
