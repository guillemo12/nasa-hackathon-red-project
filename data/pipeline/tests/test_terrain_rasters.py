"""Mallas, COG, cuenca cerrada y capa de escenario sobre datos sintéticos (sin red)."""
from __future__ import annotations

import math

import numpy as np
import pytest
import rasterio
from affine import Affine
from rio_cogeo.cogeo import cog_validate

from red_atlas_pipeline import config
from red_atlas_pipeline.terrain import overlay, reality, settings
from red_atlas_pipeline.terrain.rasters import (Raster, from_array, read_cog, read_window, sample,
                                          sample_raster, write_cog)

R = config.MARS_RADIUS_M
ORIGINAL_ROUTE = {"lat_min": -9.84, "lat_max": -9.78, "lon_e_min": 283.58, "lon_e_max": 283.64}


def _raster(n=64, cell_deg=0.001, lon0=283.58, lat0=-9.78) -> Raster:
    z = np.add.outer(np.arange(n), np.arange(n)).astype("float32")
    return Raster(z, Affine(cell_deg, 0, lon0, 0, -cell_deg, lat0), -9999.0)


def test_metrica_de_la_malla():
    r = _raster()
    assert r.dy_m == pytest.approx(59_274.7 * 0.001, rel=1e-5)          # 1° lat = 59.274,7 m
    assert float(r.dx_m()[0]) == pytest.approx(58_409.8 * 0.001, rel=2e-4)   # 1° lon en el sitio
    assert (np.diff(r.dx_m()) < 0).all()            # hacia el sur (más lejos del ecuador) se estrecha


def test_muestreo_bilineal_y_fuera_de_malla():
    r = _raster()
    lon, lat = r.col_lons()[10], r.row_lats()[20]
    assert float(sample_raster(r, lon, lat)) == pytest.approx(30.0)
    assert float(sample_raster(r, lon + 0.0005, lat)) == pytest.approx(30.5)
    assert np.isnan(sample_raster(r, 200.0, 0.0))
    a = r.band(0)
    a[20, 11] = np.nan
    assert float(sample(a, 20.0, 10.4)) == pytest.approx(30.0)      # recurre al vecino válido


def test_recorte_alineado_a_pixel():
    r = _raster()
    aoi = {"lon_e_min": 283.5905, "lon_e_max": 283.6001, "lat_min": -9.8001, "lat_max": -9.7905}
    c = r.crop(aoi)
    assert c.meta["crop_offset"] == (10, 10)
    assert c.shape == (11, 11)
    assert c.bounds["lon_e_min"] <= aoi["lon_e_min"] and c.bounds["lon_e_max"] >= aoi["lon_e_max"]
    assert np.array_equal(c.data[0], r.data[0][10:21, 10:21])


def test_cog_valido_con_procedencia(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "PIPELINE_DIR", tmp_path)
    data = np.random.default_rng(0).normal(size=(2, 700, 600))
    data[0, :5, :5] = np.nan
    r = from_array(data, _raster())
    info = write_cog(tmp_path / "x.tif", r, band_names=["a", "b"], band_units=["m", "grados"],
                     tags={"PROVENANCE": "derivado", "SOURCE_RESOLUTION": "20 m"})
    assert cog_validate(str(tmp_path / "x.tif"), quiet=True)[0]
    assert info["path"] == "x.tif" and info["cog_valid"]
    with rasterio.open(tmp_path / "x.tif") as ds:
        tags = ds.tags()
        assert tags["PROVENANCE"] == "derivado" and tags["BAND_2_UNIT"] == "grados"
        assert ds.nodata == settings.NODATA_F32
        assert ds.overviews(1)                        # 700×600 > 512: lleva vistas reducidas
        crs = ds.crs.to_dict()
        assert float(crs.get("R", crs.get("a"))) == pytest.approx(R)
    back = read_cog(tmp_path / "x.tif")
    assert np.isnan(back.band(0)[0, 0]) and back.transform == r.transform


def test_lectura_por_ventana_equirrectangular_a_grados(tmp_path):
    """Un GeoTIFF equirrectangular (x = R·λ) se lee por ventana y sale en grados 0-360."""
    for lon_0 in (0.0, 180.0):
        res = 100.0
        lon_c, lat_c = 283.6, -9.8
        x_c = R * math.radians(((lon_c - lon_0 + 180) % 360) - 180)
        y_c = R * math.radians(lat_c)
        t = Affine(res, 0, x_c - 50 * res, 0, -res, y_c + 50 * res)
        z = np.arange(100 * 100, dtype="int16").reshape(100, 100)
        crs = f"+proj=eqc +lat_ts=0 +lat_0=0 +lon_0={lon_0} +x_0=0 +y_0=0 +R={R} +units=m +no_defs"
        path = tmp_path / f"eqc_{int(lon_0)}.tif"
        with rasterio.open(path, "w", driver="GTiff", width=100, height=100, count=1, dtype="int16",
                           crs=crs, transform=t, nodata=-32768) as ds:
            ds.write(z, 1)
        d = math.degrees(10 * res / R)
        aoi = {"lon_e_min": lon_c - d, "lon_e_max": lon_c + d, "lat_min": lat_c - d, "lat_max": lat_c + d}
        r = read_window(str(path), aoi)
        assert r.shape == (20, 20)
        assert np.array_equal(r.data[0], z[40:60, 40:60])            # sin remuestreo
        assert r.bounds["lon_e_min"] == pytest.approx(aoi["lon_e_min"], abs=1e-9)
        assert r.bounds["lat_max"] == pytest.approx(aoi["lat_max"], abs=1e-9)
        assert r.dy_m == pytest.approx(res, rel=1e-9)
        assert float(sample_raster(r, lon_c + 1e-6, lat_c - 1e-6, bilinear=False)) == z[50, 50]


def test_lectura_por_ventana_rechaza_otra_esfera(tmp_path):
    path = tmp_path / "tierra.tif"
    with rasterio.open(path, "w", driver="GTiff", width=4, height=4, count=1, dtype="int16",
                       crs="+proj=eqc +lat_ts=0 +lon_0=0 +R=6371000 +units=m +no_defs",
                       transform=Affine(100, 0, 0, 0, -100, 0)) as ds:
        ds.write(np.zeros((4, 4), dtype="int16"), 1)
    with pytest.raises(ValueError):
        read_window(str(path), ORIGINAL_ROUTE)


# --- cuenca cerrada --------------------------------------------------------------
def _bowl(n=81, spill_notch=None) -> Raster:
    """Cuenco parabólico con el borde a +100 m; opcionalmente con un portillo en el borde."""
    y, x = np.mgrid[0:n, 0:n] - n // 2
    rad = np.hypot(x, y)
    z = np.where(rad <= 30, -100.0 + rad**2 / 9.0, 100.0 - (rad - 30) * 20.0)
    if spill_notch is not None:
        z[n // 2, n // 2 + 27: n // 2 + 37] = spill_notch      # atraviesa todo el borde
    d = math.degrees(500.0 / R)
    return Raster(z.astype("float32"), Affine(d, 0, 283.6 - n / 2 * d, 0, -d, -9.8 + n / 2 * d), -9999.0)


def test_cuenca_cerrada_y_cota_de_desbordamiento():
    dem = _bowl()
    b = reality.closed_basin(dem, 283.6, -9.8)
    assert b["inside_closed_depression"] and not b["pond_touches_window_edge"]
    assert b["point_elevation_m"] == pytest.approx(-100.0, abs=1.0)
    assert 60.0 < b["spill_elevation_m"] <= 100.0          # el collado discreto del borde
    notch = reality.closed_basin(_bowl(spill_notch=-20.0), 283.6, -9.8)
    assert notch["spill_elevation_m"] == pytest.approx(-20.0, abs=0.1)
    assert notch["spill_point"]["bearing_deg"] == pytest.approx(90.0, abs=3.0)
    assert notch["pond_area_km2"] < b["pond_area_km2"]


def test_ladera_abierta_no_es_cuenca():
    dem = _bowl()
    y, x = np.mgrid[0:81, 0:81]
    dem.data = (x * 10.0).astype("float32")[np.newaxis]
    b = reality.closed_basin(dem, 283.6, -9.8)
    assert not b["inside_closed_depression"] and b["depth_below_spill_m"] == 0.0


def test_escarpe_mas_cercano():
    dem = _bowl()
    y, x = np.mgrid[0:81, 0:81]
    dem.data = np.where(x >= 60, 1500.0, 0.0).astype("float32")[np.newaxis]   # pared al este
    s = reality.nearest_relief(dem, 283.6, -9.8, 0.0, 1000.0)
    assert s["distance_km"] == pytest.approx(10.0, abs=0.6)       # 20 celdas de 500 m
    assert s["bearing_deg"] == pytest.approx(90.0, abs=2.0)
    assert s["ramp_width_km"] < 1.1                                # es un escalón, no una rampa
    assert reality.nearest_relief(dem, 283.6, -9.8, 0.0, -1000.0) is None


# --- capa de escenario ---------------------------------------------------------------
FAKE_NODES = {
    "BASE": {"lon_e_deg": 283.600, "lat_pc_deg": -9.800, "slope_local_deg": 1.5,
             "elev_mola_m": -1905, "sky_view_factor": 0.92, "thermal_inertia_tiu": 320, "radio_los_base": True},
    "WP1": {"lon_e_deg": 283.620, "lat_pc_deg": -9.810, "slope_local_deg": 6.0,
            "elev_mola_m": -1878, "sky_view_factor": 0.90, "thermal_inertia_tiu": 410, "radio_los_base": True},
    "WP2": {"lon_e_deg": 283.620, "lat_pc_deg": -9.830, "slope_local_deg": 22.0,
            "elev_mola_m": -1820, "sky_view_factor": 0.78, "thermal_inertia_tiu": 110, "radio_los_base": False},
    "WP3": {"lon_e_deg": 283.610, "lat_pc_deg": -9.824, "slope_local_deg": 9.0,
            "elev_mola_m": -1790, "sky_view_factor": 0.15, "thermal_inertia_tiu": 620, "radio_los_base": False},
}
FAKE_ZONES = {
    "ti_radius_m": {"BASE": 100.0, "WP1": 100.0, "WP2": 150.0, "WP3": 40.0},
    "slope_radius_m": {"WP2": 150.0}, "svf_radius_m": {"WP3": 40.0},
    "nlos_radius_m": {"WP2": 150.0, "WP3": 400.0},
    "nlos_corridor_leg": "L3", "nlos_corridor_halfwidth_m": 50.0,
}


def _overlay(monkeypatch, zones):
    monkeypatch.setattr(config, "scenario_nodes", lambda: FAKE_NODES)
    monkeypatch.setattr(config, "scenario_legs", lambda: {"L3": {"from": "WP2", "to": "WP3"}})
    monkeypatch.setattr(settings, "SCENARIO_ZONES", zones)
    d = math.degrees(20.0 / R)
    n = int(0.06 / d)
    dem = Raster(np.zeros((1, n, n), dtype="float32"), Affine(d, 0, 283.58, 0, -d, -9.78), -9999.0)
    slope, svf, los = np.full((n, n), 3.0), np.full((n, n), 0.97), np.ones((n, n))
    originals = (slope.copy(), svf.copy(), los.copy())
    fake = {"nodes": {k: {"elevation_m": {"ctx_20m": -1900.0}, "slope_deg": {"ctx_20m": 3.0},
                          "sky_view_factor": {"derived_ctx_20m": 0.97},
                          "radio_los_base": {"derived_ctx_20m": True, "margin_m": 5.0}}
                      for k in FAKE_NODES}}
    bands, names, _, gj = overlay.build(dem, slope, svf, los, fake)
    assert all(np.array_equal(a, b) for a, b in zip((slope, svf, los), originals))   # no pisa lo medido
    b = dict(zip(names, bands))

    def at(node, name):
        row, col = (int(round(float(v))) for v in dem.index(FAKE_NODES[node]["lon_e_deg"],
                                                            FAKE_NODES[node]["lat_pc_deg"]))
        return float(b[name][row, col])

    return at, b, gj


def test_la_capa_de_escenario_no_pisa_lo_medido(monkeypatch):
    at, b, gj = _overlay(monkeypatch, FAKE_ZONES)
    assert at("WP2", "slope_deg_escenario") == 22.0 and at("WP2", "slope_procedencia") == 3
    assert at("WP3", "svf_escenario") == 0.15 and at("WP3", "svf_procedencia") == 3
    assert at("WP2", "radio_los_base_escenario") == 0 and at("WP3", "radio_los_base_escenario") == 0
    assert at("WP2", "thermal_inertia_tiu_escenario") == 110 and at("WP3", "thermal_inertia_tiu_escenario") == 620
    assert at("BASE", "slope_deg_escenario") == 3.0 and at("BASE", "slope_procedencia") == 2
    assert at("WP1", "radio_los_base_escenario") == 1 and at("WP1", "radio_los_procedencia") == 2
    # Fuera de las zonas no hay inercia térmica: ni medida ni inventada.
    assert np.isnan(b["thermal_inertia_tiu_escenario"][0, 0]) and b["thermal_inertia_procedencia"][0, 0] == 0
    assert set(np.unique(b["slope_procedencia"])) <= {2.0, 3.0}
    wp2 = next(f for f in gj["features"] if f["id"] == "node_WP2")["properties"]
    assert wp2["slope_local_deg"]["escenario"] == 22.0 and wp2["slope_local_deg"]["derivado"] == 3.0
    assert wp2["slope_local_deg"]["procedencia_vigente"] == "escenario"
    assert all(f["properties"]["provenance"] == "escenario"
               for f in gj["features"] if f["id"].startswith("zone_"))


def test_capa_de_escenario_sin_zonas_de_pendiente_ni_radio(monkeypatch):
    """Configuración vigente tras la reubicación: solo son de diseño la alcoba y la inercia térmica."""
    zones = {**FAKE_ZONES, "slope_radius_m": {}, "nlos_radius_m": {}, "nlos_corridor_leg": None}
    at, b, gj = _overlay(monkeypatch, zones)
    assert set(np.unique(b["slope_procedencia"])) == {2.0}
    assert set(np.unique(b["radio_los_procedencia"])) == {2.0}
    assert at("WP2", "slope_deg_escenario") == 3.0 and at("WP2", "radio_los_base_escenario") == 1
    assert at("WP3", "svf_escenario") == 0.15 and at("WP3", "svf_procedencia") == 3
    assert {f["properties"]["zone_kind"] for f in gj["features"] if f["id"].startswith("zone_")} == {
        "svf", "thermal_inertia"}
