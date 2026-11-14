"""Derivados topográficos sobre terrenos sintéticos con solución conocida (sin red)."""
from __future__ import annotations

import math

import numpy as np
import pytest
from affine import Affine

from red_atlas_p1 import config
from red_atlas_p1.terrain import derive
from red_atlas_p1.terrain.rasters import Raster, sample

R = config.MARS_RADIUS_M
LAT0, LON0 = -9.8, 283.6        # latitud del sitio: aquí cos(lat) ≈ 0,985 y el error se nota


def make_grid(n: int, cell_m: float, fn) -> Raster:
    """Malla geográfica n×n centrada en el sitio con celdas de `cell_m` metros N-S.

    `fn(x_m, y_m)` da la cota en función de la posición en metros reales respecto al
    centro (x al este, y al norte).
    """
    d = math.degrees(cell_m / R)
    t = Affine(d, 0, LON0 - n / 2 * d, 0, -d, LAT0 + n / 2 * d)
    r = Raster(np.zeros((1, n, n), dtype="float32"), t, -9999.0)
    lons, lats = np.meshgrid(r.col_lons(), r.row_lats())
    x = np.radians(lons - LON0) * R * np.cos(np.radians(lats))
    y = np.radians(lats - LAT0) * R
    r.data = fn(x, y).astype("float64")[np.newaxis]
    return r


# --- pendiente ---------------------------------------------------------------
@pytest.mark.parametrize("slope_deg, toward", [(10.0, 90.0), (22.0, 0.0), (5.0, 225.0)])
def test_plano_inclinado_en_metros_reales(slope_deg, toward):
    """Un plano que sube hacia `toward` da esa pendiente y baja hacia el acimut opuesto."""
    g = math.tan(math.radians(slope_deg))
    az = math.radians(toward)
    dem = make_grid(60, 20.0, lambda x, y: g * (x * math.sin(az) + y * math.cos(az)))
    slope, aspect = derive.slope_aspect_raster(dem)
    inner = slope[5:-5, 5:-5]
    assert np.allclose(inner, slope_deg, atol=0.02)
    assert np.allclose(aspect[5:-5, 5:-5], (toward + 180.0) % 360.0, atol=0.2)


def test_pendiente_en_grados_estaria_mal():
    """Ignorar cos(lat) en el paso E-O subestima un plano que sube al este: debe detectarse."""
    g = math.tan(math.radians(20.0))
    dem = make_grid(40, 20.0, lambda x, y: g * x)
    bien, _ = derive.slope_aspect(dem.band(0), dem.dx_m(), dem.dy_m)
    mal, _ = derive.slope_aspect(dem.band(0), dem.dy_m, dem.dy_m)     # dx sin cos(lat)
    assert abs(float(np.nanmean(bien)) - 20.0) < 0.02
    assert float(np.nanmean(mal)) < 19.8


def test_llano_sin_orientacion_y_borde_sin_dato():
    dem = make_grid(10, 20.0, lambda x, y: np.zeros_like(x))
    slope, aspect = derive.slope_aspect_raster(dem)
    assert np.allclose(slope[1:-1, 1:-1], 0.0)
    assert np.isnan(aspect[1:-1, 1:-1]).all()
    assert np.isnan(slope[0]).all() and np.isnan(slope[:, -1]).all()


# --- horizonte y SVF ------------------------------------------------------------
def _horizon_at_centre(dem: Raster, max_m: float, step_m: float, az_step: float = 10.0):
    az = np.arange(0.0, 360.0, az_step)
    z0 = float(sample(dem.band(0), *dem.index(LON0, LAT0)))
    h = derive.horizon_angles(np.array([LON0]), np.array([LAT0]), np.array([z0]),
                              [(dem, step_m, max_m, step_m)], az)
    return az, h[:, 0]


@pytest.mark.parametrize("radius, depth", [(100.0, 100.0), (150.0, 50.0), (60.0, 200.0)])
def test_pozo_cilindrico(radius, depth):
    """Centro del fondo de un pozo: θ = atan(h/r) en todo acimut y SVF = 1 − h/√(h²+r²)."""
    dem = make_grid(240, 2.0, lambda x, y: np.where(np.hypot(x, y) <= radius, -depth, 0.0))
    _, hz = _horizon_at_centre(dem, max_m=220.0, step_m=1.0)
    theta = math.degrees(math.atan(depth / radius))
    assert np.allclose(hz, theta, atol=1.0)
    svf = float(derive.sky_view_factor(hz[:, None])[0])
    assert svf == pytest.approx(1.0 - depth / math.hypot(depth, radius), abs=0.02)


def test_llano_svf_uno_y_pared_medio_cielo():
    llano = make_grid(100, 10.0, lambda x, y: np.zeros_like(x))
    _, hz = _horizon_at_centre(llano, max_m=400.0, step_m=10.0)
    assert float(derive.sky_view_factor(hz[:, None])[0]) == pytest.approx(1.0, abs=1e-3)
    # Pared vertical muy alta pegada al norte: tapa medio cielo (SVF ≈ 0,5), como dice el
    # entregable. Para bajar de ahí hace falta techo, que un DEM 2,5D no puede representar.
    pared = make_grid(200, 2.0, lambda x, y: np.where(y > 3.0, 5000.0, 0.0))
    _, hz = _horizon_at_centre(pared, max_m=190.0, step_m=1.0, az_step=5.0)
    assert float(derive.sky_view_factor(hz[:, None])[0]) == pytest.approx(0.5, abs=0.06)


def test_horizonte_incluye_la_curvatura():
    """Un pico de 1.000 m a 50 km se ve ~0,42° más bajo que en plano (caída d²/2R ≈ 368 m)."""
    assert float(derive.elevation_angle_deg(0.0, 1000.0, 50_000.0)) == pytest.approx(
        math.degrees(math.atan((1000.0 - 50_000.0**2 / (2 * R)) / 50_000.0)), abs=0.01)
    assert float(derive.elevation_angle_deg(0.0, 0.0, 50_000.0)) < 0.0


def test_horizonte_recurre_a_la_capa_gruesa():
    """Si la capa fina no tiene dato en un paso del rayo, se usa la gruesa."""
    fina = make_grid(100, 10.0, lambda x, y: np.zeros_like(x))
    fina.data[0][:, 70:] = np.nan
    gruesa = make_grid(100, 10.0, lambda x, y: np.where(x > 300.0, 300.0, 0.0))
    hz = derive.horizon_angles(np.array([LON0]), np.array([LAT0]), np.array([0.0]),
                               [(fina, 10.0, 400.0, 10.0), (gruesa, 410.0, 450.0, 10.0)],
                               np.array([90.0, 270.0]))[:, 0]
    assert hz[0] > 35.0          # hacia el este ve el escalón de la capa gruesa
    assert abs(hz[1]) < 0.1      # hacia el oeste, llano


# --- línea de vista -----------------------------------------------------------------
def test_los_bloqueada_por_una_cresta():
    """Cresta de 30 m a 500 m al este del emisor: oculta lo que hay detrás y nada delante."""
    dem = make_grid(200, 10.0, lambda x, y: np.where(np.abs(x - 500.0) <= 15.0, 30.0, 0.0))
    lats = np.full(4, LAT0)
    east_m = np.array([300.0, 800.0, 950.0, -800.0])
    lons = LON0 + np.degrees(east_m / (R * math.cos(math.radians(LAT0))))
    vis, margin = derive.line_of_sight(dem, LON0, LAT0, 3.0, lons, lats, 2.0)
    assert vis.tolist() == [True, False, False, True]
    assert margin[1] == pytest.approx(-(30.0 - 2.4), abs=1.5)     # rayo a ~2,4 m sobre el llano
    assert margin[0] > 2.0 and margin[3] > 2.0


def test_los_antena_alta_salva_la_cresta():
    dem = make_grid(200, 10.0, lambda x, y: np.where(np.abs(x - 500.0) <= 15.0, 30.0, 0.0))
    lon = LON0 + math.degrees(900.0 / (R * math.cos(math.radians(LAT0))))
    baja, _ = derive.line_of_sight(dem, LON0, LAT0, 3.0, np.array([lon]), np.array([LAT0]), 2.0)
    alta, _ = derive.line_of_sight(dem, LON0, LAT0, 80.0, np.array([lon]), np.array([LAT0]), 2.0)
    assert not baja[0] and alta[0]


def test_los_horizonte_de_radio_por_curvatura():
    """Esfera lisa, antenas de 3 m y 2 m: alcance √(2R·3) + √(2R·2) ≈ 8,2 km."""
    dem = make_grid(260, 100.0, lambda x, y: np.zeros_like(x))
    reach = math.sqrt(2 * R * 3.0) + math.sqrt(2 * R * 2.0)
    assert reach == pytest.approx(8200.0, abs=20.0)
    north_m = np.array([6000.0, 7500.0, 9000.0, 11000.0])
    lats = LAT0 + np.degrees(north_m / R)
    vis, _ = derive.line_of_sight(dem, LON0, LAT0, 3.0, np.full(4, LON0), lats, 2.0)
    assert vis.tolist() == [True, True, False, False]


# --- geometría esférica ------------------------------------------------------------
def test_destino_y_distancia_son_inversos():
    lon, lat = derive.destination(LON0, LAT0, 115.0, 1500.0)
    assert float(derive.distance_m(LON0, LAT0, lon, lat)) == pytest.approx(1500.0, abs=0.01)
    assert float(derive.bearing_deg(LON0, LAT0, lon, lat)) == pytest.approx(115.0, abs=0.01)
    assert float(derive.distance_m(LON0, LAT0, lon, lat)) == pytest.approx(
        config.haversine_m(LAT0, LON0, float(lat), float(lon)), abs=1e-6)
