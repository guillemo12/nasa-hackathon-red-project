"""Derivados topográficos en metros reales de Marte: pendiente, horizonte, SVF y línea de vista.

Todas las funciones son NumPy puro sobre matrices con NaN como «sin dato» y no dependen
de la red, de modo que se prueban con terrenos sintéticos de solución conocida.
"""
from __future__ import annotations

import math

import numpy as np

from .. import config
from .rasters import Raster, sample

R_MARS = config.MARS_RADIUS_M


# ---------------------------------------------------------------------------
# Pendiente y orientación
# ---------------------------------------------------------------------------
def slope_aspect(z: np.ndarray, dx_m, dy_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Pendiente y orientación (método de Horn, ventana 3×3).

    `z` tiene la fila 0 al norte. `dx_m` es el paso este-oeste en metros (escalar o un
    valor por fila, porque en malla geográfica se estrecha con cos(lat)); `dy_m` es el
    paso norte-sur. Devuelve (pendiente en grados, orientación en grados): la orientación
    es el acimut hacia el que BAJA la ladera, en sentido horario desde el norte, y vale
    NaN en llano. El marco exterior de un píxel queda en NaN.
    """
    z = np.asarray(z, dtype="float64")
    dx = np.asarray(dx_m, dtype="float64")
    dx = (np.full(z.shape[0], float(dx)) if dx.ndim == 0 else dx).reshape(-1, 1)
    slope = np.full(z.shape, np.nan)
    aspect = np.full(z.shape, np.nan)
    if z.shape[0] < 3 or z.shape[1] < 3:
        return slope, aspect
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    dz_de = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * dx[1:-1])     # hacia el este
    dz_dn = ((a + 2 * b + c) - (g + 2 * h + i)) / (8.0 * dy_m)         # hacia el norte
    grad = np.hypot(dz_de, dz_dn)
    slope[1:-1, 1:-1] = np.degrees(np.arctan(grad))
    asp = np.degrees(np.arctan2(-dz_de, -dz_dn)) % 360.0
    asp[grad < 1e-12] = np.nan
    aspect[1:-1, 1:-1] = asp
    return slope, aspect


def slope_aspect_raster(dem: Raster) -> tuple[np.ndarray, np.ndarray]:
    return slope_aspect(dem.band(0), dem.dx_m(), dem.dy_m)


# ---------------------------------------------------------------------------
# Geometría esférica
# ---------------------------------------------------------------------------
def destination(lon, lat, azimuth_deg: float, dist_m: float, radius: float = R_MARS):
    """Punto a `dist_m` del origen siguiendo el círculo máximo de acimut `azimuth_deg`."""
    phi = np.radians(lat)
    delta = dist_m / radius
    az = math.radians(azimuth_deg)
    sin_phi2 = np.sin(phi) * math.cos(delta) + np.cos(phi) * math.sin(delta) * math.cos(az)
    phi2 = np.arcsin(np.clip(sin_phi2, -1.0, 1.0))
    dlam = np.arctan2(math.sin(az) * math.sin(delta) * np.cos(phi),
                      math.cos(delta) - np.sin(phi) * sin_phi2)
    return np.asarray(lon) + np.degrees(dlam), np.degrees(phi2)


def bearing_deg(lon1, lat1, lon2, lat2):
    """Rumbo inicial de 1 a 2, en grados horarios desde el norte."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    y = np.sin(dl) * np.cos(p2)
    x = np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl)
    return np.degrees(np.arctan2(y, x)) % 360.0


def distance_m(lon1, lat1, lon2, lat2, radius: float = R_MARS):
    """Distancia de círculo máximo (haversine), vectorizada."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dlat = p2 - p1
    dlon = np.radians(np.asarray(lon2) - np.asarray(lon1))
    h = np.sin(dlat / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlon / 2) ** 2
    return 2 * radius * np.arcsin(np.sqrt(np.clip(h, 0.0, 1.0)))


def elevation_angle_deg(h_obs, h_target, dist_m: float, radius: float = R_MARS):
    """Ángulo de elevación, con curvatura, de un punto a cota `h_target` visto desde `h_obs`."""
    gamma = dist_m / radius
    r0 = radius + np.asarray(h_obs, dtype="float64")
    r1 = radius + np.asarray(h_target, dtype="float64")
    return np.degrees(np.arctan2(r1 * math.cos(gamma) - r0, r1 * math.sin(gamma)))


# ---------------------------------------------------------------------------
# Horizonte y Sky View Factor
# ---------------------------------------------------------------------------
def horizon_angles(
    obs_lon,
    obs_lat,
    obs_h,
    layers: list[tuple[Raster, float, float, float]],
    azimuths_deg,
    radius: float = R_MARS,
) -> np.ndarray:
    """Ángulo de horizonte (grados) por acimut para cada observador.

    `layers` es una lista de (DEM, distancia inicial, distancia final, paso) en metros,
    de la más fina a la más gruesa. En cada paso del rayo se usa la primera capa que
    tenga dato (bilineal); si ninguna lo tiene, el paso se ignora. La curvatura del
    planeta entra en el ángulo de elevación. Devuelve una matriz (n_acimuts, *forma) con
    NaN donde el rayo no encontró ningún dato.
    """
    obs_lon = np.asarray(obs_lon, dtype="float64")
    obs_lat = np.asarray(obs_lat, dtype="float64")
    obs_h = np.asarray(obs_h, dtype="float64")
    bands = [layer[0].band(0) for layer in layers]
    steps: list[tuple[float, int]] = []
    for k, (_, d0, d1, step) in enumerate(layers):
        for d in np.arange(d0, d1 + 1e-9, step):
            steps.append((float(d), k))
    out = np.full((len(azimuths_deg),) + obs_lon.shape, np.nan)
    for ia, az in enumerate(azimuths_deg):
        best = np.full(obs_lon.shape, -np.inf)
        for d, k in steps:
            lon2, lat2 = destination(obs_lon, obs_lat, az, d, radius)
            h = np.full(obs_lon.shape, np.nan)
            for j in range(k, len(layers)):       # recurre a las capas más gruesas
                need = ~np.isfinite(h)
                if not need.any():
                    break
                row, col = layers[j][0].index(lon2[need], lat2[need])
                h[need] = sample(bands[j], row, col, bilinear=True)
            ang = elevation_angle_deg(obs_h, h, d, radius)
            best = np.fmax(best, ang)
        out[ia] = np.where(np.isfinite(best), best, np.nan)
    return out


def sky_view_factor(horizon_deg: np.ndarray) -> np.ndarray:
    """SVF como fracción de ángulo sólido de la semiesfera superior no ocultada.

    SVF = 1 − media_acimut(sen θ_h), con θ_h ≥ 0. Es la definición que corresponde a un
    campo de radiación isótropo (dosis ∝ ángulo sólido de cielo visible), que es como el
    documento científico usa el SVF. Para un pozo cilíndrico de radio r y profundidad h visto desde
    el centro del fondo, SVF = 1 − h/√(h² + r²). No es la variante ponderada por coseno
    (1 − media(sen² θ_h)) de los balances de irradiancia sobre superficie horizontal.
    """
    theta = np.radians(np.clip(horizon_deg, 0.0, 90.0))
    return 1.0 - np.nanmean(np.sin(theta), axis=0)


# ---------------------------------------------------------------------------
# Línea de vista de radio
# ---------------------------------------------------------------------------
def line_of_sight(
    dem: Raster,
    tx_lon: float,
    tx_lat: float,
    tx_agl_m: float,
    rx_lon,
    rx_lat,
    rx_agl_m: float,
    step_m: float | None = None,
    radius: float = R_MARS,
) -> tuple[np.ndarray, np.ndarray]:
    """Línea de vista geométrica entre un emisor fijo y un conjunto de receptores.

    Devuelve (visible, margen_m). `margen_m` es la separación mínima entre el rayo recto
    emisor-receptor y el terreno a lo largo del perfil (negativa si el terreno lo corta).
    El rayo se compara con el terreno en un marco donde la curvatura aparece como una
    flecha t·(1−t)·D²/(2R) (válido para D ≪ R). No se evalúa la zona de Fresnel: el margen
    se entrega para que el consumidor aplique su propio criterio de despeje.
    """
    z = dem.band(0)
    rx_lon = np.asarray(rx_lon, dtype="float64")
    rx_lat = np.asarray(rx_lat, dtype="float64")
    step = step_m or dem.pixel_m
    h_tx = float(sample(z, *dem.index(tx_lon, tx_lat))) + tx_agl_m
    h_rx = sample(z, *dem.index(rx_lon, rx_lat)) + rx_agl_m
    dist = distance_m(tx_lon, tx_lat, rx_lon, rx_lat, radius)
    n = max(2, int(math.ceil(float(np.nanmax(dist)) / step)))
    margin = np.full(rx_lon.shape, np.inf)
    for k in range(1, n):
        t = k / n
        # No se evalúa a menos de un paso de los extremos: allí el «obstáculo» sería el
        # propio suelo bajo la antena.
        use = (t * dist >= step) & ((1 - t) * dist >= step)
        if not use.any():
            continue
        lon = tx_lon + t * (rx_lon - tx_lon)
        lat = tx_lat + t * (rx_lat - tx_lat)
        terrain = sample(z, *dem.index(lon, lat))
        ray = h_tx + t * (h_rx - h_tx) - t * (1 - t) * dist**2 / (2 * radius)
        m = np.where(use, ray - terrain, np.inf)
        margin = np.fmin(margin, m)
    margin = np.where(np.isfinite(h_rx) & np.isfinite(h_tx), margin, np.nan)
    visible = margin > 0
    # Receptores a menos de dos pasos: sin perfil intermedio, se consideran visibles.
    margin = np.where(np.isinf(margin), np.nan, margin)
    return visible, margin
