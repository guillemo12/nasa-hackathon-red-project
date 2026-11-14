"""Búsqueda del emplazamiento del Triángulo de Supervivencia sobre terreno real.

El cuadrilátero Base-WP1-WP2-WP3 se mantiene rígido (mismas distancias y ángulos que el
escenario original); solo se permiten traslación, rotación y simetría especular. Se
recorre el borde sur y este de la cuenca en cada par CTX de 20 m por separado (sin
mosaico) y se ordenan las colocaciones según las condiciones (a)-(g) del encargo.

    uv run python -m red_atlas_p1.terrain.site_search

Escribe `data/nasa-layers/site_search.json`. No modifica el escenario.
"""
from __future__ import annotations

import json
import math

import numpy as np
from scipy import ndimage

from .. import config
from . import derive, sources
from . import settings as S
from .rasters import Raster, read_cog, read_window, sample, to_float32

R = config.MARS_RADIUS_M
SEARCH_AOI = {"lat_min": -10.06, "lat_max": -9.74, "lon_e_min": 283.30, "lon_e_max": 283.92}
SEARCH_JSON = config.LAYERS_DIR / "site_search.json"
CACHE = config.BUILD_DIR / "cache" / "site_search"

# Geometría rígida original (plano local en la Base original): este, norte en metros.
ORIGINAL = {"BASE": (283.6, -9.8), "WP1": (283.62327, -9.81069),
            "WP2": (283.61971, -9.83063), "WP3": (283.61156, -9.82447)}
LEGS = [("L1", "BASE", "WP1"), ("L2", "WP1", "WP2"), ("L3", "WP2", "WP3"), ("L4", "WP3", "BASE")]

# Umbrales de las condiciones del encargo.
BASE_SLOPE_MAX = 3.0
BASE_SAFE_RADIUS_M = 60.0          # «llano y seguro»: nada por encima de 5° a 60 m
BASE_SAFE_SLOPE_MAX = 5.0
WP2_SLOPE = (18.0, 26.0)
WP1_SLOPE_MAX = 8.0
LEG_SLOPE_MAX = 25.0               # tramos L1 y L4
NLOS_MARGIN_M = -10.0              # «claramente fuera del ruido» (ruido del DTM ~5 m)
ROT_STEP_DEG = 3.0
STRIDE = 2                         # paso de la Base en píxeles (40 m)


def shape_offsets() -> dict[str, tuple[float, float]]:
    """Desplazamientos (este, norte) en metros de cada nodo respecto a la Base original."""
    lon0, lat0 = ORIGINAL["BASE"]
    k = R * math.pi / 180.0
    return {n: ((lon - lon0) * k * math.cos(math.radians(lat0)), (lat - lat0) * k)
            for n, (lon, lat) in ORIGINAL.items()}


def transform(offsets: dict, rot_deg: float, mirror: bool) -> dict[str, tuple[float, float]]:
    """Rota (horario, como un rumbo) y opcionalmente refleja la figura alrededor de la Base."""
    a = math.radians(rot_deg)
    out = {}
    for n, (e, nn) in offsets.items():
        if mirror:
            e = -e
        out[n] = (e * math.cos(a) + nn * math.sin(a), -e * math.sin(a) + nn * math.cos(a))
    return out


def place(base_lon: float, base_lat: float, rot_deg: float, mirror: bool) -> dict:
    """Coordenadas (lon E, lat) de los cuatro nodos para una colocación."""
    k = R * math.pi / 180.0
    return {n: (base_lon + e / (k * math.cos(math.radians(base_lat))), base_lat + nn / k)
            for n, (e, nn) in transform(shape_offsets(), rot_deg, mirror).items()}


def _load_pair(p: dict) -> Raster | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{p['id'][:27]}.npz"
    if f.exists():
        d = np.load(f)
        if d["data"].size == 0:
            return None
        from affine import Affine
        return Raster(d["data"], Affine(*d["t"]), float(d["nodata"]))
    r = read_window(p["url"], SEARCH_AOI)
    if r.data.size == 0 or r.valid_fraction(0) < 0.02:
        np.savez_compressed(f, data=np.zeros(0), t=np.zeros(6), nodata=0.0)
        return None
    r = to_float32(r)
    np.savez_compressed(f, data=r.data, t=np.array(r.transform)[:6], nodata=r.nodata)
    return r


def _shift(a: np.ndarray, dr: int, dc: int, fill=np.nan) -> np.ndarray:
    """out[r, c] = a[r + dr, c + dc] (fuera de la matriz: `fill`)."""
    out = np.full(a.shape, fill, dtype=a.dtype)
    nr, nc = a.shape
    r0, r1 = max(0, -dr), min(nr, nr - dr)
    c0, c1 = max(0, -dc), min(nc, nc - dc)
    if r1 > r0 and c1 > c0:
        out[r0:r1, c0:c1] = a[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
    return out


def _leg_stats(slope, dem: Raster, a, b) -> tuple[float, bool]:
    d = float(derive.distance_m(a[0], a[1], b[0], b[1]))
    t = np.linspace(0, 1, int(d / 10.0) + 1)
    s = sample(slope, *dem.index(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])), bilinear=False)
    return (float(np.nanmax(s)) if np.isfinite(s).any() else float("nan")), bool(np.isfinite(s).all())


def search_pair(p: dict, blend: Raster, log=print) -> tuple[list[dict], dict]:
    """Candidatos de un par CTX y recuento de cuántas colocaciones superan cada condición."""
    dem = _load_pair(p)
    funnel = {k: 0 for k in ("evaluadas", "a_cobertura_nodos", "b_base_llana", "e_wp1_menor_8",
                             "c_wp2_18_26", "g_tramos_y_cobertura_ruta")}
    if dem is None:
        return [], funnel
    slope, _ = derive.slope_aspect_raster(dem)
    z = dem.band(0)
    dy, dx = dem.dy_m, float(np.mean(dem.dx_m()))
    rad = int(round(BASE_SAFE_RADIUS_M / dy))
    safe = ndimage.maximum_filter(np.where(np.isfinite(slope), slope, 99.0), size=2 * rad + 1)
    base_ok = (slope < BASE_SLOPE_MAX) & (safe < BASE_SAFE_SLOPE_MAX)
    grid = np.zeros(slope.shape, dtype=bool)
    grid[::STRIDE, ::STRIDE] = True
    offs = shape_offsets()
    cands = []
    for mirror in (False, True):
        for rot in np.arange(0.0, 360.0, ROT_STEP_DEG):
            t = transform(offs, rot, mirror)
            px = {n: (int(round(-nn / dy)), int(round(e / dx))) for n, (e, nn) in t.items()}
            s1, s2, s3 = (_shift(slope, *px[n]) for n in ("WP1", "WP2", "WP3"))
            m = grid & np.isfinite(slope) & np.isfinite(s1) & np.isfinite(s2) & np.isfinite(s3)
            funnel["evaluadas"] += int(grid.sum())
            funnel["a_cobertura_nodos"] += int(m.sum())
            m &= base_ok
            funnel["b_base_llana"] += int(m.sum())
            m &= s1 < WP1_SLOPE_MAX
            funnel["e_wp1_menor_8"] += int(m.sum())
            m &= (s2 >= WP2_SLOPE[0]) & (s2 <= WP2_SLOPE[1])
            funnel["c_wp2_18_26"] += int(m.sum())
            for r, c in zip(*np.where(m)):
                cands.append((int(r), int(c), float(rot), mirror))
    log(f"  {p['id'][:27]}: {len(cands)} colocaciones cumplen a, b, c y e en los nodos")
    if not cands:
        return [], funnel
    lons, lats = dem.col_lons(), dem.row_lats()
    out = []
    for r, c, rot, mirror in cands:
        nodes = place(float(lons[c]), float(lats[r]), rot, mirror)
        legs, covered = {}, True
        for lid, a, b in LEGS:
            mx, ok = _leg_stats(slope, dem, nodes[a], nodes[b])
            legs[lid], covered = mx, covered and ok
        if not covered or not (legs["L1"] <= LEG_SLOPE_MAX and legs["L4"] <= LEG_SLOPE_MAX):
            continue
        out.append({"pair": p["id"], "base_lon": float(lons[c]), "base_lat": float(lats[r]),
                    "rot_deg": rot, "mirror": mirror, "nodes": nodes, "leg_max_slope": legs})
    funnel["g_tramos_y_cobertura_ruta"] = len(out)
    if not out:
        return [], funnel
    # Línea de vista real desde la Base y horizonte real en el WP3.
    for cnd in out:
        nd = cnd["nodes"]
        tgt = [nd[n] for n in ("WP1", "WP2", "WP3")]
        _, margin = derive.line_of_sight(
            dem, nd["BASE"][0], nd["BASE"][1], S.ANTENNA_BASE_AGL_M,
            np.array([q[0] for q in tgt]), np.array([q[1] for q in tgt]), S.ANTENNA_SUIT_AGL_M)
        cnd["los_margin_m"] = dict(zip(("WP1", "WP2", "WP3"), (float(v) for v in margin)))
        cnd["slope_deg"] = {n: float(sample(slope, *dem.index(*nd[n]), bilinear=False)) for n in nd}
        cnd["elev_m"] = {n: float(sample(z, *dem.index(*nd[n]))) for n in nd}
    az = np.arange(0.0, 360.0, S.HORIZON_AZIMUTH_STEP_DEG)
    lon3 = np.array([cnd["nodes"]["WP3"][0] for cnd in out])
    lat3 = np.array([cnd["nodes"]["WP3"][1] for cnd in out])
    z3 = np.array([cnd["elev_m"]["WP3"] for cnd in out])
    hz = derive.horizon_angles(lon3, lat3, z3, [
        (dem, S.HORIZON_NEAR_STEP_M, S.HORIZON_NEAR_MAX_M, S.HORIZON_NEAR_STEP_M),
        (blend, S.HORIZON_NEAR_MAX_M + S.HORIZON_FAR_STEP_M, S.HORIZON_FAR_MAX_M,
         S.HORIZON_FAR_STEP_M)], az)
    svf = derive.sky_view_factor(hz)
    for i, cnd in enumerate(out):
        cnd["wp3_svf"] = float(svf[i])
        cnd["wp3_horizon_max_deg"] = float(np.nanmax(hz[:, i]))
    return out, funnel


def meets_f(c: dict) -> bool:
    m = c["los_margin_m"]
    return m["WP1"] > 0 and m["WP2"] <= NLOS_MARGIN_M and m["WP3"] <= NLOS_MARGIN_M


def run(log=print) -> dict:
    manifest = sources.load_manifest()
    blend = read_cog(config.COG_DIR / "dem_hrsc_mola_200m_horizon.tif")
    pairs = [p for p in manifest["products"]
             if p.get("stac_collection") == "mro_ctx_controlled_usgs_dtms"]
    all_c, funnels = [], {}
    for p in pairs:
        c, f = search_pair(p, blend, log)
        all_c += c
        if f["evaluadas"]:
            funnels[p["id"]] = f
    total = {k: sum(f[k] for f in funnels.values()) for k in next(iter(funnels.values()))}
    with_f = [c for c in all_c if meets_f(c)]
    total["f_radio"] = len(with_f)
    # Orden: entre las que cumplen todo, mínimo SVF real en el WP3 (condición d).
    pool = with_f or all_c
    pool.sort(key=lambda c: c["wp3_svf"])
    result = {
        "schema_version": "1.0",
        "search_aoi": SEARCH_AOI,
        "rigid_shape_offsets_m": shape_offsets(),
        "degrees_of_freedom": "traslación (paso 40 m), rotación (paso 3°) y simetría especular",
        "thresholds": {
            "base_slope_max_deg": BASE_SLOPE_MAX, "base_safe_radius_m": BASE_SAFE_RADIUS_M,
            "base_safe_slope_max_deg": BASE_SAFE_SLOPE_MAX, "wp2_slope_deg": WP2_SLOPE,
            "wp1_slope_max_deg": WP1_SLOPE_MAX, "leg_slope_max_deg": LEG_SLOPE_MAX,
            "nlos_margin_m": NLOS_MARGIN_M},
        "funnel_total": total,
        "funnel_by_pair": funnels,
        "all_conditions_met": bool(with_f),
        "candidates_ranked": pool[:40],
        "n_candidates_a_b_c_e_g": len(all_c),
    }
    if SEARCH_JSON.exists():          # no perder el afinado ni la colocación elegida
        prev = json.loads(SEARCH_JSON.read_text(encoding="utf-8"))
        result.update({k: prev[k] for k in ("refinement", "chosen") if k in prev})
    SEARCH_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    res = run()
    print(json.dumps(res["funnel_total"], indent=1))
    for c in res["candidates_ranked"][:12]:
        print(c["pair"][:12], f"{c['base_lat']:.4f} {c['base_lon']:.4f} rot {c['rot_deg']:.0f} m{int(c['mirror'])}",
              "svf3 %.3f hz %.1f" % (c["wp3_svf"], c["wp3_horizon_max_deg"]),
              "slope", {k: round(v, 1) for k, v in c["slope_deg"].items()},
              "los", {k: round(v, 1) for k, v in c["los_margin_m"].items()},
              "legs", {k: round(v, 1) for k, v in c["leg_max_slope"].items()})


# ---------------------------------------------------------------------------
# Afinado: la colocación debe sostenerse en varios pares CTX independientes
# ---------------------------------------------------------------------------
def evaluate(dem: Raster, slope: np.ndarray, base_lon: float, base_lat: float, rot: float,
             mirror: bool) -> dict | None:
    """Condiciones (a)-(g) de una colocación sobre un par CTX; None si falta cobertura."""
    nodes = place(base_lon, base_lat, rot, mirror)
    sl = {n: float(sample(slope, *dem.index(*nodes[n]), bilinear=False)) for n in nodes}
    if not all(np.isfinite(v) for v in sl.values()):
        return None
    legs, covered = {}, True
    for lid, a, b in LEGS:
        mx, ok = _leg_stats(slope, dem, nodes[a], nodes[b])
        legs[lid], covered = mx, covered and ok
    if not covered:
        return None
    r, c = (int(round(float(v))) for v in dem.index(*nodes["BASE"]))
    rad = int(round(BASE_SAFE_RADIUS_M / dem.dy_m))
    safe = float(np.nanmax(slope[max(0, r - rad):r + rad + 1, max(0, c - rad):c + rad + 1]))
    tgt = [nodes[n] for n in ("WP1", "WP2", "WP3")]
    _, margin = derive.line_of_sight(
        dem, nodes["BASE"][0], nodes["BASE"][1], S.ANTENNA_BASE_AGL_M,
        np.array([q[0] for q in tgt]), np.array([q[1] for q in tgt]), S.ANTENNA_SUIT_AGL_M)
    m = dict(zip(("WP1", "WP2", "WP3"), (float(v) for v in margin)))
    ok = {
        "b": sl["BASE"] < BASE_SLOPE_MAX and safe < BASE_SAFE_SLOPE_MAX,
        "c": WP2_SLOPE[0] <= sl["WP2"] <= WP2_SLOPE[1],
        "e": sl["WP1"] < WP1_SLOPE_MAX,
        "f": m["WP1"] > 0 and m["WP2"] <= NLOS_MARGIN_M and m["WP3"] <= NLOS_MARGIN_M,
        "g": legs["L1"] <= LEG_SLOPE_MAX and legs["L4"] <= LEG_SLOPE_MAX,
    }
    return {"nodes": nodes, "slope_deg": sl, "leg_max_slope": legs, "los_margin_m": m,
            "base_safe_max_slope": safe, "ok": ok, "all_ok": all(ok.values())}


def refine(base_lon: float, base_lat: float, rot: float, mirror: bool, *, half_m: float = 200.0,
           step_m: float = 20.0, rot_half: float = 8.0, log=print) -> dict:
    """Barrido fino alrededor de una colocación, exigiendo acuerdo entre pares CTX."""
    manifest = sources.load_manifest()
    blend = read_cog(config.COG_DIR / "dem_hrsc_mola_200m_horizon.tif")
    k = R * math.pi / 180.0
    probe = place(base_lon, base_lat, rot, mirror)
    pairs = []
    for p in manifest["products"]:
        if p.get("stac_collection") != "mro_ctx_controlled_usgs_dtms":
            continue
        dem = _load_pair(p)
        if dem is None:
            continue
        slope, _ = derive.slope_aspect_raster(dem)
        if evaluate(dem, slope, base_lon, base_lat, rot, mirror) is None:
            continue
        pairs.append((p["id"], dem, slope))
    log(f"pares con cobertura de la colocación: {[i[:12] for i, _, _ in pairs]}")
    best = []
    offs = np.arange(-half_m, half_m + 1, step_m)
    for dn in offs:
        for de in offs:
            lat = base_lat + dn / k
            lon = base_lon + de / (k * math.cos(math.radians(base_lat)))
            for r in np.arange(rot - rot_half, rot + rot_half + 0.5, 1.0):
                ev = [(pid, evaluate(dem, slope, lon, lat, float(r), mirror)) for pid, dem, slope in pairs]
                good = [pid for pid, e in ev if e and e["all_ok"]]
                if len(good) >= 2:
                    wp2 = [e["los_margin_m"]["WP2"] for _, e in ev if e]
                    wp3 = [e["los_margin_m"]["WP3"] for _, e in ev if e]
                    best.append({"base_lon": lon, "base_lat": lat, "rot_deg": float(r), "mirror": mirror,
                                 "pairs_all_ok": good, "n_pairs_ok": len(good), "n_pairs": len(pairs),
                                 "worst_nlos_margin_m": max(max(wp2), max(wp3))})
    if not best:
        return {"found": False, "pairs": [i for i, _, _ in pairs], "probe": probe}
    # Horizonte real del WP3 en el par de más cobertura para las mejor avaladas.
    top_n = max(b["n_pairs_ok"] for b in best)
    top = [b for b in best if b["n_pairs_ok"] == top_n]
    pid, dem, _ = pairs[0]
    az = np.arange(0.0, 360.0, S.HORIZON_AZIMUTH_STEP_DEG)
    pts = [place(b["base_lon"], b["base_lat"], b["rot_deg"], mirror)["WP3"] for b in top]
    lon3, lat3 = np.array([q[0] for q in pts]), np.array([q[1] for q in pts])
    z3 = sample(dem.band(0), *dem.index(lon3, lat3))
    hz = derive.horizon_angles(lon3, lat3, z3, [
        (dem, S.HORIZON_NEAR_STEP_M, S.HORIZON_NEAR_MAX_M, S.HORIZON_NEAR_STEP_M),
        (blend, S.HORIZON_NEAR_MAX_M + S.HORIZON_FAR_STEP_M, S.HORIZON_FAR_MAX_M,
         S.HORIZON_FAR_STEP_M)], az)
    svf = derive.sky_view_factor(hz)
    for i, b in enumerate(top):
        b["wp3_svf"], b["wp3_horizon_max_deg"] = float(svf[i]), float(np.nanmax(hz[:, i]))
    top.sort(key=lambda b: b["wp3_svf"])
    return {"found": True, "pairs": [i for i, _, _ in pairs], "n_refined_candidates": len(best),
            "max_pairs_agreeing": top_n, "horizon_pair": pid, "ranked": top[:20]}


def record_chosen(base_lon: float, base_lat: float, rot_deg: float, mirror: bool) -> dict:
    """Evalúa la colocación elegida en cada par CTX con cobertura y la anota en site_search.json."""
    manifest = sources.load_manifest()
    by_pair = {}
    for p in manifest["products"]:
        if p.get("stac_collection") != "mro_ctx_controlled_usgs_dtms":
            continue
        dem = _load_pair(p)
        if dem is None:
            continue
        slope, _ = derive.slope_aspect_raster(dem)
        e = evaluate(dem, slope, base_lon, base_lat, rot_deg, mirror)
        if e is not None:
            e["elev_m"] = {n: float(sample(dem.band(0), *dem.index(*q))) for n, q in e["nodes"].items()}
            by_pair[p["id"]] = e
    chosen = {"base_lon": base_lon, "base_lat": base_lat, "rot_deg": rot_deg, "mirror": mirror,
              "by_pair": by_pair}
    d = json.loads(SEARCH_JSON.read_text(encoding="utf-8")) if SEARCH_JSON.exists() else {}
    d["chosen"] = chosen
    SEARCH_JSON.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return chosen
