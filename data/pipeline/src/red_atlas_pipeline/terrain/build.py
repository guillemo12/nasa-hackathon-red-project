"""Orquestación del módulo de terreno: descubrir, recortar, derivar y documentar.

    uv run python -m red_atlas_pipeline.terrain            # regenera todo desde cero
    uv run python -m red_atlas_pipeline.terrain --reuse    # reutiliza los recortes ya descargados
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import time

import numpy as np

from .. import config
from . import derive, overlay, reality, report, sources
from . import settings as S
from .rasters import (Raster, aoi_coverage, from_array, read_cog, read_window, sample_raster, to_float32,
                      write_cog)

COG = config.COG_DIR


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _src_tags(p: dict, aoi_name: str, processing: str) -> dict:
    return {
        "PROVENANCE": "medido",
        "SOURCE_ID": p["id"],
        "SOURCE_URL": p["url"],
        "SOURCE_MISSION": p["mission"],
        "SOURCE_INSTRUMENT": p["instrument"],
        "SOURCE_PRODUCT_TYPE": p.get("product_type", ""),
        "SOURCE_RESOLUTION_M": p["native_resolution_m"],
        "SOURCE_CRS": p["crs"],
        "SOURCE_LICENSE": p["license"],
        "SOURCE_CITATION": p.get("citation", ""),
        "AOI": f"{aoi_name}: {json.dumps(S.AOIS[aoi_name])}",
        "PROCESSING": processing,
        "GENERATED_UTC": _now(),
        "GENERATOR": "red_atlas_pipeline.terrain",
    }


class Builder:
    def __init__(self, reuse: bool = False, log=print):
        self.reuse = reuse
        self.log = log
        self.outputs: list[dict] = []
        self.t0 = time.time()

    def say(self, msg: str) -> None:
        self.log(f"[{time.time() - self.t0:6.1f} s] {msg}")

    # -- recortes ------------------------------------------------------------
    def clip(self, name: str, p: dict, aoi_name: str, *, layer: str, band: str, unit: str,
             as_float: bool, decimate: int = 1, note: str = "", resampling: str = "average",
             extra_tags: dict | None = None) -> Raster:
        path = COG / name
        if self.reuse and path.exists():
            r = read_cog(path)
            self.say(f"reutilizado {name}")
        else:
            self.say(f"leyendo {name} por ventana…")
            r = read_window(p["url"], S.AOIS[aoi_name], decimate=decimate)
            if r.data.size == 0:
                raise RuntimeError(f"{p['id']} no cubre la AOI {aoi_name}")
            scale, offset = r.meta["source_scale"], r.meta["source_offset"]
            if as_float:
                r = to_float32(r)
        processing = ("Recorte por ventana sin remuestreo; geotransformación reescrita de "
                      "equirrectangular (x = R·λ) a grados, longitud Este 0-360.")
        if decimate > 1:
            processing = (f"Recorte por ventana leído de la vista reducida ×{decimate} del COG de "
                          "origen; geotransformación reescrita a grados, longitud Este 0-360.")
        tags = _src_tags(p, aoi_name, processing + (" " + note if note else ""))
        if not (self.reuse and path.exists()):
            if scale != 1.0 or offset != 0.0:
                tags["VALUE_SCALE"], tags["VALUE_OFFSET"] = scale, offset
            tags.update(extra_tags or {})
            tags["VALID_FRACTION"] = round(r.valid_fraction(0), 4)
            info = write_cog(path, r, band_names=[band], band_units=[unit], tags=tags,
                             resampling=resampling)
        else:
            info = _info_from_existing(path, r)
        valid = aoi_coverage(r, S.AOIS[aoi_name])
        info.update({
            "layer": layer, "aoi": aoi_name, "provenance": "medido",
            "source": {"id": p["id"], "url": p["url"], "mission": p["mission"],
                       "instrument": p["instrument"], "native_resolution_m": p["native_resolution_m"],
                       "license": p["license"]},
            "aoi_coverage": valid,
            "valid_fraction": round(r.valid_fraction(0), 4),
            "value_scale_offset": [float(r.meta.get("VALUE_SCALE", r.meta.get("source_scale", 1.0))),
                                   float(r.meta.get("VALUE_OFFSET", r.meta.get("source_offset", 0.0)))],
            "note": note,
        })
        self.outputs.append(info)
        p.setdefault("coverage", {})[aoi_name] = valid
        p["clipped_to"] = sorted(set(p.get("clipped_to", [])) | {info["path"]})
        return r

    def derived(self, name: str, data: np.ndarray, like: Raster, *, layer: str, bands: list[str],
                units: list[str], aoi_name: str, provenance: str, source_res: str, method: str,
                inputs: list[str], note: str = "") -> None:
        r = from_array(data, like)
        tags = {
            "PROVENANCE": provenance,
            "SOURCE_RESOLUTION": source_res,
            "PRECISION_NOTE": note,
            "METHOD": method,
            "INPUTS": "; ".join(inputs),
            "AOI": f"{aoi_name}: {json.dumps(S.AOIS[aoi_name])}",
            "MARS_RADIUS_M": config.MARS_RADIUS_M,
            "GENERATED_UTC": _now(),
            "GENERATOR": "red_atlas_pipeline.terrain",
        }
        info = write_cog(COG / name, r, band_names=bands, band_units=units, tags=tags,
                         resampling="nearest")
        info.update({"layer": layer, "aoi": aoi_name, "provenance": provenance,
                     "source_resolution": source_res, "method": method, "inputs": inputs,
                     "valid_fraction": round(r.valid_fraction(0), 4), "note": note})
        self.outputs.append(info)
        self.say(f"escrito {name}")

    # -- ejecución -------------------------------------------------------------
    def run(self) -> dict:
        COG.mkdir(parents=True, exist_ok=True)
        if self.reuse and S.SOURCES_MANIFEST_JSON.exists():
            manifest = sources.load_manifest()
            self.say("manifiesto de fuentes reutilizado")
        else:
            manifest = sources.discover(log=self.say)
        prod = lambda **kw: sources.product(manifest, **kw)      # noqa: E731
        ctx = prod(pid=manifest["working_dem"]["id"])
        hirise_dtm = next((p for p in manifest["products"]
                           if p.get("stac_collection") == "mro_hirise_socet_dtms"
                           and p["coverage"].get("route", 0) > 0), None)
        hirise_rdr = next((p for p in manifest["products"] if p.get("selected_as_route_ortho")
                           and p["coverage"].get("route", 0) > 0), None)

        # 1. Recortes medidos -------------------------------------------------
        dem_note = "Cota sobre el areoide MOLA."
        ctx_near = self.clip("dem_ctx_20m_near.tif", ctx, "near", layer="dem", band="elevation_m",
                             unit="m", as_float=True, note=dem_note)
        route_dem = ctx_near.crop(S.AOIS["route"])
        tags = _src_tags(ctx, "route", "Subventana alineada a píxel de dem_ctx_20m_near.tif.")
        info = write_cog(COG / "dem_ctx_20m_route.tif", route_dem, band_names=["elevation_m"],
                         band_units=["m"], tags=tags)
        info.update({"layer": "dem", "aoi": "route", "provenance": "medido",
                     "source": {"id": ctx["id"], "url": ctx["url"], "mission": ctx["mission"],
                                "instrument": ctx["instrument"],
                                "native_resolution_m": ctx["native_resolution_m"],
                                "license": ctx["license"]},
                     "valid_fraction": round(route_dem.valid_fraction(0), 4),
                     "note": "Malla de referencia de todos los derivados de ruta."})
        self.outputs.append(info)
        ctx["clipped_to"] = sorted(set(ctx.get("clipped_to", [])) | {info["path"]})

        blend = self.clip("dem_hrsc_mola_200m_horizon.tif", prod(key="hrsc_mola_blend_200m"),
                          "horizon", layer="dem", band="elevation_m", unit="m", as_float=True,
                          note=dem_note)
        mola = self.clip("dem_mola_463m_regional.tif", prod(key="mola_megdr_463m"), "regional",
                         layer="dem", band="elevation_m", unit="m", as_float=True, note=dem_note)
        if hirise_dtm is not None:
            cov = hirise_dtm["coverage"]["route"]
            self.clip("dem_hirise_1m_route_partial.tif", hirise_dtm, "route", layer="dem",
                      band="elevation_m", unit="m", as_float=True,
                      note=f"Cobertura parcial ({100 * cov:.0f} % de la AOI de ruta). "
                           "No se usa en los derivados.")
        else:
            (COG / "dem_hirise_1m_route_partial.tif").unlink(missing_ok=True)
            self.say("sin DTM HiRISE sobre la AOI de ruta")
        self.clip("ortho_ctx_6m_route.tif", prod(key="ctx_mosaic_6m_mc18"), "route", layer="ortho",
                  band="ctx_dn", unit="DN int16; I/F = DN·VALUE_SCALE + VALUE_OFFSET",
                  as_float=False)
        if hirise_rdr is not None:
            dec = max(1, round(1.0 / hirise_rdr["native_resolution_m"]))
            self.clip("ortho_hirise_1m_route.tif", hirise_rdr, "route", layer="ortho",
                      band="hirise_red_dn", unit="DN uint16; I/F = DN·VALUE_SCALE + VALUE_OFFSET",
                      as_float=False, decimate=dec,
                      note="Observación sin control: error de posición de ~100 m respecto al DTM "
                           f"CTX. Cubre el {100 * hirise_rdr['coverage']['route']:.0f} % de la AOI.")
        else:
            (COG / "ortho_hirise_1m_route.tif").unlink(missing_ok=True)
            self.say("sin HiRISE RDR sobre la AOI de ruta")
        qual = "DN cualitativo de 8 bits: NO es temperatura ni inercia térmica."
        self.clip("themis_day_ir_100m_horizon.tif", prod(key="themis_day_ir_100m_mc18"), "horizon",
                  layer="thermal_qualitative", band="themis_day_ir_dn", unit="DN uint8",
                  as_float=False, note=qual)
        self.clip("themis_night_ir_100m_horizon.tif", prod(key="themis_night_ir_100m_mc18"),
                  "horizon", layer="thermal_qualitative", band="themis_night_ir_dn", unit="DN uint8",
                  as_float=False, note=qual)

        # 2. Derivados ----------------------------------------------------------
        self.say("pendiente y orientación…")
        res20 = f"DTM CTX de {ctx_near.pixel_m:.1f} m ({ctx['id']})"
        res200 = "mezcla HRSC+MOLA de 200 m"
        slope_n, aspect_n = derive.slope_aspect_raster(ctx_near)
        r0, c0 = route_dem.meta["crop_offset"]
        nr, nc = route_dem.shape
        slope = slope_n[r0:r0 + nr, c0:c0 + nc]
        aspect = aspect_n[r0:r0 + nr, c0:c0 + nc]
        self.derived(
            "slope_aspect_ctx_20m_route.tif", np.stack([slope, aspect]), route_dem, layer="slope",
            bands=["slope_deg", "aspect_deg"], units=["grados", "grados desde el norte, horario"],
            aoi_name="route", provenance="derivado", source_res=res20,
            method="Horn 3×3 en metros reales: dy = R·Δφ, dx = R·Δλ·cos φ, R = 3.396.190 m. "
                   "La orientación es el acimut hacia el que baja la ladera.",
            inputs=["build/cog/dem_ctx_20m_near.tif"],
            note="Pendiente sobre una base de 40 m (3 píxeles de 20 m): no resuelve rampas, "
                 "bloques ni escalones menores de ~40-60 m. Ruido vertical del DTM de varios metros.")

        self.say("horizonte por acimut (tarda del orden de un minuto)…")
        azimuths = np.arange(0.0, 360.0, S.HORIZON_AZIMUTH_STEP_DEG)
        lons, lats = np.meshgrid(route_dem.col_lons(), route_dem.row_lats())
        layers = [(ctx_near, S.HORIZON_NEAR_STEP_M, S.HORIZON_NEAR_MAX_M, S.HORIZON_NEAR_STEP_M),
                  (blend, S.HORIZON_NEAR_MAX_M + S.HORIZON_FAR_STEP_M, S.HORIZON_FAR_MAX_M,
                   S.HORIZON_FAR_STEP_M)]
        horizon = derive.horizon_angles(lons, lats, route_dem.band(0), layers, azimuths)
        horizon[:, ~np.isfinite(route_dem.band(0))] = np.nan
        hz_method = (
            f"Rayo por acimut cada {S.HORIZON_AZIMUTH_STEP_DEG:.0f}°: pasos de "
            f"{S.HORIZON_NEAR_STEP_M:.0f} m sobre el DTM CTX hasta {S.HORIZON_NEAR_MAX_M / 1e3:.0f} km "
            f"y de {S.HORIZON_FAR_STEP_M:.0f} m sobre la mezcla HRSC+MOLA hasta salir de AOI_HORIZON "
            "(~47 km). Ángulo de elevación con curvatura (R = 3.396.190 m), observador a ras de suelo.")
        hz_note = ("Campo cercano a 20 m y lejano a 200 m. Un DEM 2,5D no representa cornisas ni "
                   "alcobas. El horizonte se trunca en el borde de AOI_HORIZON.")
        self.derived(
            "horizon_ctx20_hrscmola200_route.tif", horizon, route_dem, layer="horizon",
            bands=[f"horizon_deg_az{int(a):03d}" for a in azimuths], units=["grados"] * len(azimuths),
            aoi_name="route", provenance="derivado", source_res=f"{res20} + {res200}",
            method=hz_method, inputs=["build/cog/dem_ctx_20m_near.tif",
                                      "build/cog/dem_hrsc_mola_200m_horizon.tif"], note=hz_note)
        svf = derive.sky_view_factor(horizon)
        self.derived(
            "svf_ctx20_hrscmola200_route.tif", svf, route_dem, layer="svf", bands=["sky_view_factor"],
            units=["adimensional 0-1"], aoi_name="route", provenance="derivado",
            source_res=f"{res20} + {res200}",
            method="SVF = 1 − media_acimut(sen θ_h), θ_h ≥ 0: fracción de ángulo sólido de cielo "
                   "visible (campo isótropo). " + hz_method,
            inputs=["build/cog/horizon_ctx20_hrscmola200_route.tif"], note=hz_note)

        self.say("línea de vista de radio desde la Base…")
        base = config.scenario_nodes()["BASE"]
        vis, margin = derive.line_of_sight(
            ctx_near, base["lon_e_deg"], base["lat_pc_deg"], S.ANTENNA_BASE_AGL_M,
            lons, lats, S.ANTENNA_SUIT_AGL_M)
        los = np.where(np.isfinite(route_dem.band(0)), vis.astype("float64"), np.nan)
        margin = np.where(np.isfinite(los), margin, np.nan)
        self.derived(
            "radio_los_base_ctx_20m_route.tif", np.stack([los, margin]), route_dem, layer="radio_los",
            bands=["radio_los_base", "los_margin_m"], units=["booleano 0/1", "m"], aoi_name="route",
            provenance="derivado", source_res=res20,
            method=f"Línea de vista geométrica desde la Base (antena a {S.ANTENNA_BASE_AGL_M:.0f} m "
                   f"sobre el suelo) hasta cada celda (antena a {S.ANTENNA_SUIT_AGL_M:.0f} m), perfil "
                   "muestreado cada 20 m con curvatura. Banda 2: separación mínima rayo-terreno "
                   "(negativa = obstruido; sin dato a menos de 40 m de la Base).",
            inputs=["build/cog/dem_ctx_20m_near.tif"],
            note="Solo línea de vista geométrica sobre un DTM de 20 m con ruido de varios metros: "
                 "márgenes de |m| < ~5 m son indeterminados. No incluye zona de Fresnel ni "
                 "difracción; no resuelve espolones menores de ~40 m.")

        # 3. Comprobación de realidad ---------------------------------------------
        self.say("comprobación de realidad del sitio…")
        trunc = self._horizon_truncation(ctx_near, blend, mola, base, azimuths)
        check = reality.site_reality(
            ctx_near=ctx_near, blend=blend, mola=mola, route_dem=route_dem, slope_route=slope,
            horizon_route=horizon, svf_route=svf, los_route=los, margin_route=margin,
            manifest=manifest, horizon_truncation=trunc)
        check["generated_utc"] = _now()
        check["verdict"] = report.verdict(check)
        S.SITE_REALITY_JSON.write_text(json.dumps(check, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
        S.SITE_REALITY_MD.write_text(report.markdown(check, manifest), encoding="utf-8")

        # 4. Capa de escenario --------------------------------------------------------
        self.say("capa de escenario…")
        bands, names, units, geojson = overlay.build(route_dem, slope, svf, los, check)
        self.derived(
            "scenario_overlay_route.tif", bands, route_dem, layer="scenario_overlay", bands=names,
            units=units, aoi_name="route", provenance="escenario (mixto, ver bandas de procedencia)",
            source_res=f"{res20}; zonas de escenario vectoriales rasterizadas a 20 m",
            method="Valores derivados de los datos reales, sustituidos por los de diseño dentro de "
                   "las zonas de escenario. Cada variable lleva una banda de procedencia: 0 = sin "
                   "dato, 1 = medido, 2 = derivado, 3 = escenario.",
            inputs=["build/cog/slope_aspect_ctx_20m_route.tif",
                    "build/cog/svf_ctx20_hrscmola200_route.tif",
                    "build/cog/radio_los_base_ctx_20m_route.tif",
                    "../mission-scenarios/triangulo_supervivencia.geojson"],
            note="Capa de diseño: no usar como dato medido. La inercia térmica solo existe como "
                 "escenario; fuera de las zonas no hay dato.")
        S.SCENARIO_OVERLAY_GEOJSON.write_text(
            json.dumps(geojson, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        # 5. Manifiesto y contrato -------------------------------------------------------
        sources.write_manifest(manifest)
        contract = self._contract(manifest, check)
        S.TERRAIN_OUTPUTS_JSON.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
                                          encoding="utf-8")
        self.say(f"hecho: {len(self.outputs)} COG en {COG.relative_to(config.PIPELINE_DIR)}")
        return contract

    def _horizon_truncation(self, ctx_near, blend, mola, base, azimuths) -> dict:
        """Cuánto horizonte se pierde por cortar los rayos en AOI_HORIZON (solo en la Base)."""
        lon, lat = np.array([base["lon_e_deg"]]), np.array([base["lat_pc_deg"]])
        z0 = float(sample_raster(ctx_near, lon[0], lat[0]))
        near = (ctx_near, S.HORIZON_NEAR_STEP_M, S.HORIZON_NEAR_MAX_M, S.HORIZON_NEAR_STEP_M)
        a = derive.horizon_angles(lon, lat, np.array([z0]), [
            near, (blend, S.HORIZON_NEAR_MAX_M + 200.0, S.HORIZON_FAR_MAX_M, 200.0)], azimuths)[:, 0]
        b = derive.horizon_angles(lon, lat, np.array([z0]), [
            near, (blend, S.HORIZON_NEAR_MAX_M + 200.0, S.HORIZON_FAR_MAX_M, 200.0),
            (mola, S.HORIZON_FAR_MAX_M + 463.0, 170_000.0, 463.0)], azimuths)[:, 0]
        diff = b - a
        return {
            "note": ("Horizonte en la Base con los rayos cortados en AOI_HORIZON frente al mismo "
                     "cálculo prolongado sobre MOLA 463 m hasta 170 km."),
            "max_increase_deg": round(float(np.nanmax(diff)), 2),
            "azimuth_of_max_increase_deg": float(azimuths[int(np.nanargmax(diff))]),
            "svf_truncated": round(float(derive.sky_view_factor(a[:, None])[0]), 4),
            "svf_extended": round(float(derive.sky_view_factor(b[:, None])[0]), 4),
        }

    def _contract(self, manifest: dict, check: dict) -> dict:
        return {
            "schema_version": "1.0",
            "owner": "Red Project",
            "generated_utc": _now(),
            "regenerate_with": "cd data/pipeline && uv run python -m red_atlas_pipeline.terrain",
            "paths_relative_to": "data/pipeline",
            "rasters_versioned": False,
            "rasters_note": "Los COG son salidas de compilación (build/ está en .gitignore).",
            "crs": config.CRS_GEOGRAPHIC,
            "crs_proj4": config.CRS_GEOGRAPHIC_PROJ4,
            "grid_conventions": {
                "longitude": "Este positiva 0-360 en todos los ficheros; aplicar config.lon180() "
                             "antes de indexar en H3, CesiumJS o DuckDB Spatial.",
                "latitude": "planetocéntrica",
                "pixel": "área; la geotransformación da la esquina superior izquierda",
                "metric": "Paso N-S = R·Δφ; paso E-O = R·Δλ·cos φ; R = 3.396.190 m. "
                          "No usar las funciones métricas de H3 sin H3_LENGTH_SCALE.",
                "nodata_float32": S.NODATA_F32,
            },
            "aois": {k: S.AOIS[k] for k in ("route", "near", "horizon", "regional")},
            "reference_grid": {
                "file": "build/cog/dem_ctx_20m_route.tif",
                "note": "Todos los ficheros con aoi = route comparten esta malla píxel a píxel, "
                        "salvo las ortoimágenes y el DTM HiRISE, que conservan su resolución nativa.",
            },
            "provenance_codes": S.PROV_CODES,
            "working_dem": manifest["working_dem"]["id"],
            "h3_guidance": {
                "res_12_nav": "Arista ~5 m: más fina que el DTM de 20 m. Cada píxel CTX contiene "
                              "varias celdas; asignar el valor del píxel sin interpolar y conservar "
                              "la resolución de la fuente como atributo.",
                "res_9_themis": "Arista ~93 m: agregar ~20-25 píxeles CTX por celda (media y máximo "
                                "de pendiente, mínimo de SVF, fracción sin LOS).",
            },
            "files": self.outputs,
            "vectors": [{
                "path": "../nasa-layers/scenario_overlay.geojson",
                "layer": "scenario_overlay",
                "provenance": "escenario",
                "content": "Nodos con valor de escenario junto al medido o derivado, y polígonos "
                           "de las zonas de diseño (pendiente, SVF, sombra de radio, inercia térmica).",
            }],
            "companion_documents": {
                "sources_manifest": "../nasa-layers/sources_manifest.json",
                "site_reality_check": "../nasa-layers/site_reality_check.json",
                "site_reality_summary": "../nasa-layers/SITE_REALITY_CHECK.md",
            },
            "not_available": [u["key"] for u in S.UNAVAILABLE],
            "reality_verdict": check["verdict"]["summary"],
        }


def _info_from_existing(path, r: Raster) -> dict:
    import rasterio
    from rio_cogeo.cogeo import cog_validate
    ok, errors, warns = cog_validate(str(path), quiet=True)
    if not ok:
        raise ValueError(f"COG no válido {path.name}: {errors}")
    with rasterio.open(path) as ds:
        units = [ds.tags().get(f"BAND_{i}_UNIT", "") for i in range(1, ds.count + 1)]
        names = list(ds.descriptions)
    b = r.bounds
    return {
        "path": str(path.relative_to(config.PIPELINE_DIR)),
        "format": "COG (GeoTIFF, deflate, teselas 512)",
        "dtype": r.data.dtype.name, "nodata": r.nodata, "crs": config.CRS_GEOGRAPHIC,
        "lon_convention": "Este 0-360 (usar config.lon180 para H3, CesiumJS y DuckDB Spatial)",
        "width": r.shape[1], "height": r.shape[0],
        "pixel_size_deg": [r.dlon, r.dlat],
        "pixel_size_m": [round(float(np.mean(r.dx_m())), 3), round(r.dy_m, 3)],
        "bounds": {k: round(v, 8) for k, v in b.items()},
        "bands": [{"index": i + 1, "name": n, "unit": u} for i, (n, u) in enumerate(zip(names, units))],
        "cog_valid": True, "cog_warnings": list(warns),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m red_atlas_pipeline.terrain", description=__doc__)
    ap.add_argument("--reuse", action="store_true",
                    help="reutiliza el manifiesto y los recortes ya presentes en build/cog")
    args = ap.parse_args(argv)
    Builder(reuse=args.reuse).run()
    return 0
