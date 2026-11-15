"""Comprobación de realidad del sitio: el escenario de diseño frente a los DEM reales.

No modifica el escenario ni la documentación. Mide, compara y deja por escrito qué frases
y etiquetas de procedencia habría que corregir.
"""
from __future__ import annotations

import heapq
import math

import numpy as np
from scipy import ndimage

from .. import config
from . import derive
from . import settings as S
from .rasters import Raster, sample, sample_raster


# ---------------------------------------------------------------------------
# Hidrología mínima: cota de desbordamiento
# ---------------------------------------------------------------------------
def priority_flood(z: np.ndarray) -> np.ndarray:
    """Relleno de depresiones (Barnes et al. 2014) desde el borde de la ventana.

    Devuelve, para cada celda, la cota mínima a la que el agua vertida en ella alcanzaría
    el borde de la ventana (camino minimax, conectividad 8). Si el valor supera la cota
    del terreno, la celda está dentro de una depresión cerrada respecto a la ventana.
    Las celdas sin dato actúan como desagüe.
    """
    nr, nc = z.shape
    zl = np.where(np.isfinite(z), z, -np.inf).ravel().tolist()
    filled = list(zl)
    seen = bytearray(nr * nc)
    heap: list[tuple[float, int]] = []
    for r in range(nr):
        for c in range(nc):
            i = r * nc + c
            if r in (0, nr - 1) or c in (0, nc - 1) or zl[i] == -math.inf:
                seen[i] = 1
                heap.append((zl[i], i))
    heapq.heapify(heap)
    while heap:
        level, i = heapq.heappop(heap)
        r, c = divmod(i, nc)
        for dr in (-1, 0, 1):
            rr = r + dr
            if rr < 0 or rr >= nr:
                continue
            for dc in (-1, 0, 1):
                cc = c + dc
                if cc < 0 or cc >= nc:
                    continue
                j = rr * nc + cc
                if seen[j]:
                    continue
                seen[j] = 1
                v = zl[j] if zl[j] > level else level
                filled[j] = v
                heapq.heappush(heap, (v, j))
    out = np.array(filled, dtype="float64").reshape(nr, nc)
    out[~np.isfinite(out)] = np.nan
    return out


def enclosed_by_contour(dem: Raster, lon: float, lat: float, level: float) -> dict:
    """Región conectada al punto con cota < `level`: ¿es un recinto cerrado dentro de la ventana?"""
    z = dem.band(0)
    row, col = (int(round(float(v))) for v in dem.index(lon, lat))
    if not z[row, col] < level:
        return {"level_m": level, "point_below_level": False}
    labels, _ = ndimage.label(np.isfinite(z) & (z < level), structure=np.ones((3, 3)))
    reg = labels == labels[row, col]
    rr, cc = np.where(reg)
    touches = bool(reg[0].any() or reg[-1].any() or reg[:, 0].any() or reg[:, -1].any())
    area = float((reg * (dem.dx_m()[:, None] * dem.dy_m / 1e6)).sum())
    return {
        "level_m": level, "point_below_level": True,
        "closed_within_window": not touches,
        "area_km2": round(area, 1),
        "extent_km": {
            "east_west": round(float((cc.max() - cc.min() + 1) * np.mean(dem.dx_m()) / 1e3), 1),
            "north_south": round(float((rr.max() - rr.min() + 1) * dem.dy_m / 1e3), 1)},
        "min_elevation_m": round(float(np.nanmin(z[reg])), 1),
    }


def nearest_slope(dem: Raster, slope: np.ndarray, lon: float, lat: float, threshold_deg: float) -> dict:
    """Celda más cercana con pendiente ≥ umbral (para buscar un escarpe real donde reubicar nodos)."""
    lons, lats = np.meshgrid(dem.col_lons(), dem.row_lats())
    mask = np.isfinite(slope) & (slope >= threshold_deg)
    if not mask.any():
        return {"threshold_deg": threshold_deg, "found": False,
                "max_slope_in_window_deg": round(float(np.nanmax(slope)), 1)}
    dist = np.where(mask, derive.distance_m(lon, lat, lons, lats), np.inf)
    r, c = np.unravel_index(np.argmin(dist), dist.shape)
    return {"threshold_deg": threshold_deg, "found": True,
            "distance_km": round(float(dist[r, c]) / 1e3, 2),
            "bearing_deg": round(float(derive.bearing_deg(lon, lat, lons[r, c], lats[r, c])), 0),
            "slope_deg": round(float(slope[r, c]), 1),
            "lon_e": round(float(lons[r, c]), 4), "lat": round(float(lats[r, c]), 4)}


def closed_basin(dem: Raster, lon: float, lat: float) -> dict:
    """¿Está el punto dentro de una depresión cerrada? Cota de desbordamiento y estanque."""
    z = dem.band(0)
    filled = priority_flood(z)
    row, col = (int(round(float(v))) for v in dem.index(lon, lat))
    z0, spill = float(z[row, col]), float(filled[row, col])
    lons, lats = np.meshgrid(dem.col_lons(), dem.row_lats())
    cell_km2 = (dem.dx_m()[:, None] * dem.dy_m / 1e6) * np.ones_like(z)
    out = {
        "dem_pixel_m": round(dem.pixel_m, 1),
        "window": {k: round(v, 4) for k, v in dem.bounds.items()},
        "point_elevation_m": round(z0, 1),
        "spill_elevation_m": round(spill, 1),
        "depth_below_spill_m": round(spill - z0, 1),
        "inside_closed_depression": bool(spill - z0 > 0.5),
    }
    if not out["inside_closed_depression"]:
        out["note"] = ("El punto drena hasta el borde de la ventana sin remontar: no está en "
                       "una depresión cerrada a esta resolución.")
        return out
    labels, _ = ndimage.label(np.isfinite(filled) & (np.abs(filled - spill) < 1e-6),
                              structure=np.ones((3, 3)))
    pond = labels == labels[row, col]
    edge = np.zeros_like(pond)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    rr, cc = np.where(pond)
    zmin_idx = np.nanargmin(np.where(pond, z, np.nan))
    r_min, c_min = np.unravel_index(zmin_idx, z.shape)
    # Punto de vertido: celda del estanque a la cota de desbordamiento vecina de terreno
    # exterior que drena más bajo.
    lower_out = ndimage.binary_dilation(np.isfinite(filled) & (filled < spill - 1e-6),
                                        structure=np.ones((3, 3)))
    cand = pond & lower_out & (np.abs(z - spill) < 1e-6)
    out.update({
        "pond_area_km2": round(float(cell_km2[pond].sum()), 1),
        "pond_extent_km": {
            "east_west": round(float((cc.max() - cc.min() + 1) * np.mean(dem.dx_m()) / 1e3), 1),
            "north_south": round(float((rr.max() - rr.min() + 1) * dem.dy_m / 1e3), 1),
        },
        "pond_min_elevation_m": round(float(z[r_min, c_min]), 1),
        "pond_min_location": {"lon_e": round(float(lons[r_min, c_min]), 4),
                              "lat": round(float(lats[r_min, c_min]), 4)},
        "pond_max_depth_m": round(spill - float(z[r_min, c_min]), 1),
        "pond_touches_window_edge": bool((pond & edge).any()),
    })
    if cand.any():
        r_s, c_s = (int(v[0]) for v in np.where(cand))
        out["spill_point"] = {
            "lon_e": round(float(lons[r_s, c_s]), 4), "lat": round(float(lats[r_s, c_s]), 4),
            "distance_km": round(float(derive.distance_m(lon, lat, lons[r_s, c_s],
                                                         lats[r_s, c_s])) / 1e3, 1),
            "bearing_deg": round(float(derive.bearing_deg(lon, lat, lons[r_s, c_s],
                                                          lats[r_s, c_s])), 0),
        }
    return out


# ---------------------------------------------------------------------------
# Relieve y escarpes
# ---------------------------------------------------------------------------
def _grid(dem: Raster):
    lons, lats = np.meshgrid(dem.col_lons(), dem.row_lats())
    return dem.band(0), lons, lats


def nearest_relief(dem: Raster, lon: float, lat: float, z0: float, dz: float) -> dict | None:
    """Celda más cercana al punto cuya cota supera z0+dz (dz>0) o queda bajo z0+dz (dz<0)."""
    z, lons, lats = _grid(dem)
    mask = (z >= z0 + dz) if dz > 0 else (z <= z0 + dz)
    if not mask.any():
        return None
    dist = np.where(mask, derive.distance_m(lon, lat, lons, lats), np.inf)
    r, c = np.unravel_index(np.argmin(dist), z.shape)
    d = float(dist[r, c])
    brg = float(derive.bearing_deg(lon, lat, lons[r, c], lats[r, c]))
    # Anchura de la rampa: tramo del perfil entre la última cota < z0 + 10 % de dz y el punto.
    n = max(2, int(d / dem.pixel_m))
    t = np.linspace(0, 1, n + 1)
    prof = sample(z, *dem.index(lon + t * (lons[r, c] - lon), lat + t * (lats[r, c] - lat)))
    low = np.where((prof < z0 + 0.1 * dz) if dz > 0 else (prof > z0 + 0.1 * dz))[0]
    ramp = d * (1 - t[low[-1]]) if low.size else d
    return {
        "threshold_m": round(z0 + dz, 0),
        "distance_km": round(d / 1e3, 2),
        "bearing_deg": round(brg, 0),
        "elevation_m": round(float(z[r, c]), 0),
        "lon_e": round(float(lons[r, c]), 4), "lat": round(float(lats[r, c]), 4),
        "ramp_width_km": round(ramp / 1e3, 2),
        "ramp_mean_slope_deg": round(math.degrees(math.atan(0.9 * abs(dz) / max(ramp, 1.0))), 1),
    }


def relief_by_radius(dem: Raster, lon: float, lat: float, z0: float, radii_km) -> list[dict]:
    z, lons, lats = _grid(dem)
    dist = derive.distance_m(lon, lat, lons, lats)
    out = []
    for rk in radii_km:
        m = (dist <= rk * 1e3) & np.isfinite(z)
        if not m.any():
            continue
        zz = np.where(m, z, np.nan)
        r1, c1 = np.unravel_index(np.nanargmax(zz), z.shape)
        r2, c2 = np.unravel_index(np.nanargmin(zz), z.shape)
        out.append({
            "radius_km": rk,
            "max_elevation_m": round(float(z[r1, c1]), 0),
            "max_bearing_deg": round(float(derive.bearing_deg(lon, lat, lons[r1, c1], lats[r1, c1])), 0),
            "min_elevation_m": round(float(z[r2, c2]), 0),
            "min_bearing_deg": round(float(derive.bearing_deg(lon, lat, lons[r2, c2], lats[r2, c2])), 0),
            "relief_above_point_m": round(float(z[r1, c1]) - z0, 0),
            "relief_below_point_m": round(z0 - float(z[r2, c2]), 0),
            "total_relief_m": round(float(z[r1, c1] - z[r2, c2]), 0),
        })
    return out


def _local_stats(z, slope, lons, lats, lon, lat, radius_m) -> dict:
    m = derive.distance_m(lon, lat, lons, lats) <= radius_m
    return {
        "radius_m": radius_m,
        "relief_m": round(float(np.nanmax(z[m]) - np.nanmin(z[m])), 1),
        "slope_max_deg": round(float(np.nanmax(slope[m])), 1),
        "slope_median_deg": round(float(np.nanmedian(slope[m])), 1),
    }


# ---------------------------------------------------------------------------
# Informe
# ---------------------------------------------------------------------------
def site_reality(
    *,
    ctx_near: Raster,
    blend: Raster,
    mola: Raster,
    route_dem: Raster,
    slope_route: np.ndarray,
    horizon_route: np.ndarray,
    svf_route: np.ndarray,
    los_route: np.ndarray,
    margin_route: np.ndarray,
    manifest: dict,
    horizon_truncation: dict | None = None,
) -> dict:
    nodes = config.scenario_nodes()
    legs = config.scenario_legs()
    z_ctx = ctx_near.band(0)
    slope_near, _ = derive.slope_aspect_raster(ctx_near)
    slope_blend, _ = derive.slope_aspect_raster(blend)
    slope_mola, _ = derive.slope_aspect_raster(mola)
    lons_n, lats_n = np.meshgrid(ctx_near.col_lons(), ctx_near.row_lats())
    azimuths = np.arange(0.0, 360.0, S.HORIZON_AZIMUTH_STEP_DEG)

    # Dispersión entre pares CTX (incertidumbre vertical práctica).
    ctx_pairs = [p for p in manifest["products"]
                 if p.get("stac_collection") == "mro_ctx_controlled_usgs_dtms"
                 and p.get("node_elevation_m")]

    node_out = {}
    for nid, p in nodes.items():
        lon, lat = p["lon_e_deg"], p["lat_pc_deg"]
        rr, cc = (int(round(float(v))) for v in route_dem.index(lon, lat))
        z_real = float(sample_raster(ctx_near, lon, lat))
        others = [q["node_elevation_m"][nid] for q in ctx_pairs if q["node_elevation_m"][nid] is not None]
        hz = horizon_route[:, rr, cc]
        node_out[nid] = {
            "lon_e_deg": lon, "lat_pc_deg": lat,
            "elevation_m": {
                "scenario": p["elev_mola_m"],
                "ctx_20m": round(z_real, 1),
                "ctx_pairs_min_max": [min(others), max(others)] if others else None,
                "ctx_pairs_n": len(others),
                "hrsc_mola_200m": round(float(sample_raster(blend, lon, lat, bilinear=False)), 1),
                "mola_463m": round(float(sample_raster(mola, lon, lat, bilinear=False)), 1),
                "real_minus_scenario_m": round(z_real - p["elev_mola_m"], 1),
            },
            "slope_deg": {
                "scenario": p["slope_local_deg"],
                "ctx_20m": round(float(sample(slope_near, *ctx_near.index(lon, lat), bilinear=False)), 1),
                "hrsc_mola_200m": round(float(sample(slope_blend, *blend.index(lon, lat), bilinear=False)), 1),
                "mola_463m": round(float(sample(slope_mola, *mola.index(lon, lat), bilinear=False)), 1),
            },
            "local_100m": _local_stats(z_ctx, slope_near, lons_n, lats_n, lon, lat, 100.0),
            "local_300m": _local_stats(z_ctx, slope_near, lons_n, lats_n, lon, lat, 300.0),
            "sky_view_factor": {"scenario": p["sky_view_factor"],
                                "derived_ctx_20m": round(float(svf_route[rr, cc]), 3)},
            "horizon": {"max_deg": round(float(np.nanmax(hz)), 1),
                        "azimuth_of_max_deg": float(azimuths[int(np.nanargmax(hz))]),
                        "mean_deg": round(float(np.nanmean(np.clip(hz, 0, None))), 1)},
            "radio_los_base": {"scenario": p["radio_los_base"],
                               "derived_ctx_20m": bool(los_route[rr, cc] > 0.5) if nid != "BASE" else True,
                               "margin_m": (round(float(margin_route[rr, cc]), 1)
                                            if nid != "BASE" and np.isfinite(margin_route[rr, cc]) else None)},
        }

    leg_out = {}
    for lid, leg in legs.items():
        a, b = nodes[leg["from"]], nodes[leg["to"]]
        d = float(derive.distance_m(a["lon_e_deg"], a["lat_pc_deg"], b["lon_e_deg"], b["lat_pc_deg"]))
        t = np.linspace(0, 1, max(2, int(d / 10.0)) + 1)
        lon = a["lon_e_deg"] + t * (b["lon_e_deg"] - a["lon_e_deg"])
        lat = a["lat_pc_deg"] + t * (b["lat_pc_deg"] - a["lat_pc_deg"])
        zp = sample(z_ctx, *ctx_near.index(lon, lat))
        sp = sample(slope_near, *ctx_near.index(lon, lat), bilinear=False)
        dz = float(zp[-1] - zp[0])
        leg_out[lid] = {
            "from": leg["from"], "to": leg["to"],
            "distance_m": {"scenario": leg["distance_m"], "real": round(d, 0)},
            "bearing_deg": {"scenario": leg["bearing_deg"],
                            "real": round(float(derive.bearing_deg(a["lon_e_deg"], a["lat_pc_deg"],
                                                                   b["lon_e_deg"], b["lat_pc_deg"])), 0)},
            "delta_elev_m": {"scenario": leg["delta_elev_m"], "real_ctx_20m": round(dz, 1)},
            "mean_slope_deg": round(math.degrees(math.atan(dz / d)), 2),
            "slope_along_leg_deg": {"median": round(float(np.nanmedian(sp)), 1),
                                    "p90": round(float(np.nanpercentile(sp, 90)), 1),
                                    "max": round(float(np.nanmax(sp)), 1)},
            "fully_covered": bool(np.isfinite(zp).all() and np.isfinite(sp).all()),
            "profile_min_max_m": [round(float(np.nanmin(zp)), 1), round(float(np.nanmax(zp)), 1)],
        }

    base = nodes["BASE"]
    blon, blat = base["lon_e_deg"], base["lat_pc_deg"]
    z_base = node_out["BASE"]["elevation_m"]["ctx_20m"]
    zr = route_dem.band(0)
    sl = slope_route[np.isfinite(slope_route)]
    route_stats = {
        "dem": "DTM CTX 20 m",
        "elevation_min_max_m": [round(float(np.nanmin(zr)), 1), round(float(np.nanmax(zr)), 1)],
        "relief_m": round(float(np.nanmax(zr) - np.nanmin(zr)), 1),
        "slope_deg": {"median": round(float(np.median(sl)), 1), "p95": round(float(np.percentile(sl, 95)), 1),
                      "p99": round(float(np.percentile(sl, 99)), 1), "max": round(float(sl.max()), 1)},
        "fraction_slope_over_10deg": round(float((sl > 10).mean()), 4),
        "fraction_slope_over_20deg": round(float((sl > 20).mean()), 4),
        "svf_min_max": [round(float(np.nanmin(svf_route)), 3), round(float(np.nanmax(svf_route)), 3)],
        "fraction_without_los_to_base": round(float((los_route[np.isfinite(los_route)] < 0.5).mean()), 4),
        "fraction_los_margin_within_5m": round(float(
            (np.abs(margin_route[np.isfinite(margin_route)]) < 5.0).mean()), 4),
        "los_margin_p05_p50_p95_m": [round(float(v), 1) for v in np.percentile(
            margin_route[np.isfinite(margin_route)], [5, 50, 95])],
    }
    wp2, wp3 = nodes["WP2"], nodes["WP3"]
    steep = {
        "definition": "Celda más cercana con pendiente ≥ umbral; busca dónde hay de verdad una "
                      "rampa (WP2) o un escarpe (WP3).",
        "from_WP2_ctx_20m_15deg": nearest_slope(ctx_near, slope_near, wp2["lon_e_deg"], wp2["lat_pc_deg"], 15.0),
        "from_WP2_ctx_20m_20deg": nearest_slope(ctx_near, slope_near, wp2["lon_e_deg"], wp2["lat_pc_deg"], 20.0),
        "from_WP3_ctx_20m_30deg": nearest_slope(ctx_near, slope_near, wp3["lon_e_deg"], wp3["lat_pc_deg"], 30.0),
        "from_WP3_hrsc_mola_200m_20deg": nearest_slope(blend, slope_blend, wp3["lon_e_deg"], wp3["lat_pc_deg"], 20.0),
        "from_WP3_hrsc_mola_200m_30deg": nearest_slope(blend, slope_blend, wp3["lon_e_deg"], wp3["lat_pc_deg"], 30.0),
    }

    scarps = {
        "definition": (f"Celda más cercana a la Base con cota ≥ cota_Base + {S.SCARP_RELIEF_M:.0f} m "
                       f"(subida) o ≤ cota_Base − {S.SCARP_RELIEF_M:.0f} m (bajada). «Anchura de rampa» "
                       "= tramo final del perfil recto en el que se gana el 90 % de ese desnivel."),
        "up_hrsc_mola_200m": nearest_relief(blend, blon, blat, z_base, +S.SCARP_RELIEF_M),
        "up_mola_463m": nearest_relief(mola, blon, blat, z_base, +S.SCARP_RELIEF_M),
        "down_hrsc_mola_200m": nearest_relief(blend, blon, blat, z_base, -S.SCARP_RELIEF_M),
        "down_mola_463m": nearest_relief(mola, blon, blat, z_base, -S.SCARP_RELIEF_M),
        "up_from_WP3_hrsc_mola_200m": nearest_relief(
            blend, nodes["WP3"]["lon_e_deg"], nodes["WP3"]["lat_pc_deg"],
            node_out["WP3"]["elevation_m"]["ctx_20m"], +S.SCARP_RELIEF_M),
    }
    plateau = {
        "definition": "Celda más cercana a la Base con cota ≥ +3.000 m MOLA (borde de meseta).",
        "nearest_mola_463m": nearest_relief(mola, blon, blat, z_base, 3000.0 - z_base),
        "relief_by_radius_mola_463m": relief_by_radius(mola, blon, blat, z_base, [5, 10, 25, 50, 100, 150]),
        "relief_by_radius_hrsc_mola_200m": relief_by_radius(blend, blon, blat, z_base, [5, 10, 25, 50]),
    }

    basin_mola = closed_basin(mola, blon, blat)
    basin_blend = closed_basin(blend, blon, blat)

    hirise = next((p for p in manifest["products"]
                   if p.get("stac_collection") == "mro_hirise_socet_dtms"
                   and (p.get("coverage") or {}).get("route", 0) > 0), {})

    # --- Reubicación, atmósfera y condiciones de la colocación -----------------
    o = S.ORIGINAL_SITE
    relocation = {
        "original_base": o,
        "new_base": {"lat_pc_deg": blat, "lon_e_deg": blon},
        "displacement_km": round(float(derive.distance_m(o["lon_e_deg"], o["lat_pc_deg"], blon, blat)) / 1e3, 2),
        "bearing_deg": round(float(derive.bearing_deg(o["lon_e_deg"], o["lat_pc_deg"], blon, blat)), 0),
        "inside_original_basin": bool(basin_mola["inside_closed_depression"]),
    }

    def pressure(z_m: float) -> float:
        return S.PRESSURE_DATUM_PA * math.exp(-z_m / S.SCALE_HEIGHT_M)

    p_base = pressure(z_base)
    atmosphere = {
        "formula": (f"P = {S.PRESSURE_DATUM_PA:.0f} Pa · exp(−z / {str(S.SCALE_HEIGHT_M / 1e3).replace('.', ',')} km); "
                    "columna de CO₂ = P / g. Es la fórmula que reproduce los valores canónicos "
                    "del proyecto (724 Pa y 19,5 g/cm² a −1.905 m)."),
        "base_elevation_m": round(z_base, 0),
        "surface_pressure_pa": round(p_base, 0),
        "co2_column_g_cm2": round(p_base / config.G_MARS / 10.0, 2),
        "original_site": {"elevation_m": -1905, "surface_pressure_pa": round(pressure(-1905.0), 0),
                          "co2_column_g_cm2": round(pressure(-1905.0) / config.G_MARS / 10.0, 2)},
        "per_node": {k: {"surface_pressure_pa": round(pressure(v["elevation_m"]["ctx_20m"]), 0),
                         "co2_column_g_cm2": round(pressure(v["elevation_m"]["ctx_20m"]) / config.G_MARS / 10.0, 2)}
                     for k, v in node_out.items()},
        "water_triple_point_pa": 611.66,
        "above_triple_point": bool(p_base > 611.66),
        "gale_co2_column_g_cm2": 23.0,
    }
    safe = _local_stats(z_ctx, slope_near, lons_n, lats_n, blon, blat, 60.0)["slope_max_deg"]
    nd = node_out
    svf_valid = svf_route[np.isfinite(svf_route)]
    m2, m3 = nd["WP2"]["radio_los_base"]["margin_m"], nd["WP3"]["radio_los_base"]["margin_m"]
    m1 = nd["WP1"]["radio_los_base"]["margin_m"]
    covered = bool(all(np.isfinite(v["elevation_m"]["ctx_20m"]) for v in nd.values())
                   and all(v["fully_covered"] for v in leg_out.values()))
    rlons, rlats = np.meshgrid(route_dem.col_lons(), route_dem.row_lats())
    # Se excluyen las celdas pegadas a huecos del DTM (pendiente sin dato): ahí el SVF es
    # un artefacto de borde, no cielo cerrado.
    svf_clean = np.where(np.isfinite(slope_route) & (ndimage.minimum_filter(
        np.isfinite(zr).astype("uint8"), size=7) > 0), svf_route, np.nan)
    r_m, c_m = np.unravel_index(np.nanargmin(svf_clean), svf_clean.shape)
    w3 = nodes["WP3"]
    svf_min_cell = {
        "svf": round(float(svf_route[r_m, c_m]), 2),
        "lon_e": round(float(rlons[r_m, c_m]), 5), "lat": round(float(rlats[r_m, c_m]), 5),
        "slope_deg": round(float(slope_route[r_m, c_m]), 1),
        "elevation_m": round(float(zr[r_m, c_m]), 0),
        "distance_from_wp3_m": round(float(derive.distance_m(
            w3["lon_e_deg"], w3["lat_pc_deg"], rlons[r_m, c_m], rlats[r_m, c_m])), 0),
        "bearing_from_wp3_deg": round(float(derive.bearing_deg(
            w3["lon_e_deg"], w3["lat_pc_deg"], rlons[r_m, c_m], rlats[r_m, c_m])), 0),
        "fraction_of_route_aoi_with_svf_below_0_70": round(float(
            (svf_clean[np.isfinite(svf_clean)] < 0.70).mean()), 4),
        "route_svf_p01": round(float(np.nanpercentile(svf_clean, 1)), 3),
        "raw_min_including_dtm_edge_artifacts": round(float(svf_valid.min()), 2),
    }
    conditions = {
        "a_cobertura_ctx": {"ok": covered, "route_valid_fraction": round(route_dem.valid_fraction(0), 4),
                            "near_valid_fraction": round(ctx_near.valid_fraction(0), 4)},
        "b_base_llana_segura": {"ok": bool(nd["BASE"]["slope_deg"]["ctx_20m"] < 3.0 and safe < 5.0),
                                "slope_deg": nd["BASE"]["slope_deg"]["ctx_20m"],
                                "max_slope_within_60m_deg": safe, "limits": "<3° y <5° a 60 m"},
        "c_wp2_18_26": {"ok": bool(18.0 <= nd["WP2"]["slope_deg"]["ctx_20m"] <= 26.0),
                        "slope_deg": nd["WP2"]["slope_deg"]["ctx_20m"],
                        "max_slope_within_100m_deg": nd["WP2"]["local_100m"]["slope_max_deg"]},
        "d_wp3_horizonte_svf": {
            "svf_dem": nd["WP3"]["sky_view_factor"]["derived_ctx_20m"],
            "horizon_max_deg": nd["WP3"]["horizon"]["max_deg"],
            "horizon_mean_deg": nd["WP3"]["horizon"]["mean_deg"],
            "route_svf_min": round(float(svf_valid.min()), 3),
            "route_svf_percentile_of_wp3": round(float(
                (svf_valid < nd["WP3"]["sky_view_factor"]["derived_ctx_20m"]).mean() * 100), 1),
            "base_svf_dem": nd["BASE"]["sky_view_factor"]["derived_ctx_20m"],
            "wp3_slope_deg": nd["WP3"]["slope_deg"]["ctx_20m"],
            "route_svf_min_cell": svf_min_cell,
            "note": "Condición de optimización, no de umbral: se usó como desempate tras "
                    "a, b, c, e, f y g. Es la condición más débil de la colocación."},
        "e_wp1_menor_8": {"ok": bool(nd["WP1"]["slope_deg"]["ctx_20m"] < 8.0),
                          "slope_deg": nd["WP1"]["slope_deg"]["ctx_20m"]},
        "f_radio": {"ok": bool(m1 is not None and m1 > 0 and m2 <= -10.0 and m3 <= -10.0),
                    "margin_m": {"WP1": m1, "WP2": m2, "WP3": m3},
                    "limits": "WP1 > 0 m; WP2 y WP3 ≤ −10 m (ruido del DTM ~5 m)"},
        "g_tramos_transitables": {
            "ok": bool(leg_out["L1"]["slope_along_leg_deg"]["max"] <= 25.0
                       and leg_out["L4"]["slope_along_leg_deg"]["max"] <= 25.0),
            "max_slope_deg": {k: v["slope_along_leg_deg"]["max"] for k, v in leg_out.items()},
            "limits": "L1 y L4 sin celdas por encima de 25°"},
    }
    alt = sample_point_alt(mola)
    return {
        "schema_version": "1.0",
        "owner": "Red Project",
        "generator": "uv run python -m red_atlas_pipeline.terrain",
        "site": {"lat_pc_deg": blat, "lon_e_deg": blon, "lon_w_deg": round(360 - blon, 4)},
        "dems_used": {
            "ctx_20m": manifest["working_dem"]["id"],
            "hrsc_mola_200m": S.STATIC_SOURCES["hrsc_mola_blend_200m"]["id"],
            "mola_463m": S.STATIC_SOURCES["mola_megdr_463m"]["id"],
        },
        "vertical_uncertainty_note": (
            "Los pares CTX están alineados a MOLA; su desviación típica frente a los disparos "
            "MOLA es de 14-41 m en toda la escena y la dispersión entre pares en los nodos es de "
            "unos 10 m. Diferencias con el escenario menores de ~15 m no son significativas."),
        "nodes": node_out,
        "legs": leg_out,
        "route_aoi": route_stats,
        "scarps": scarps,
        "steep_slopes": steep,
        "plateau": plateau,
        "closed_basin": {
            "method": ("Relleno de depresiones por prioridad desde el borde de la ventana: cota de "
                       "desbordamiento = mínima cota a la que el agua vertida en el punto alcanza el "
                       "borde. «Estanque» = celdas conectadas que comparten esa cota."),
            "claim_checked": "Depresión cerrada colgada ~1 km sobre el piso, siguiendo la curva de −1.800 m",
            "mola_463m_regional": basin_mola,
            "hrsc_mola_200m_horizon": basin_blend,
            "contour_minus_1800_mola_463m": enclosed_by_contour(mola, blon, blat, -1800.0),
            "contour_minus_1800_hrsc_mola_200m": enclosed_by_contour(blend, blon, blat, -1800.0),
        },
        "site_identity": {
            "hirise_dtm_id": hirise.get("id"),
            "hirise_dtm_stac_description": hirise.get("stac_description"),
            "hirise_dtm_route_coverage": (hirise.get("coverage") or {}).get("route"),
            "alternative_coordinates_in_5_2": alt,
        },
        "horizon_truncation": horizon_truncation,
        "route_aoi_bounds": dict(config.AOI_ROUTE),
        "relocation": relocation,
        "atmosphere": atmosphere,
        "placement_conditions": conditions,
    }


def sample_point_alt(mola: Raster) -> dict:
    """La coordenada alternativa citada en 5.2 (12,2°S, 290,0°E) cae fuera de la ventana."""
    lon, lat = 290.0, -12.2
    b = mola.bounds
    inside = b["lon_e_min"] <= lon <= b["lon_e_max"] and b["lat_min"] <= lat <= b["lat_max"]
    d = float(derive.distance_m(283.6, -9.8, lon, lat))
    return {"lat": lat, "lon_e": lon, "distance_from_site_km": round(d / 1e3, 0),
            "inside_regional_window": inside}
