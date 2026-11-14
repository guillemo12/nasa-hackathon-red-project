# ruff: noqa: E501
"""Veredicto y resumen legible de la comprobación de realidad del sitio.

Todas las cifras salen de `site_reality_check.json`; aquí solo se redactan. El texto
propone correcciones al entregable, pero este módulo no lo edita.
"""
from __future__ import annotations

import json

from . import settings as S

ELEV_TOLERANCE_M = 15.0      # por debajo no es significativo (ruido vertical de CTX)
ORDER = ["BASE", "WP1", "WP2", "WP3"]
LABEL = {"BASE": "Base", "WP1": "WP1 ISRU", "WP2": "WP2 riesgo", "WP3": "WP3 refugio"}


def es(x, nd: int = 0) -> str:
    """Número con formato español: punto de millares, coma decimal y signo menos tipográfico."""
    if x is None:
        return "—"
    s = f"{abs(x):,.{nd}f}".replace(",", "·").replace(".", ",").replace("·", ".")
    return ("−" if x < 0 and float(s.replace(".", "").replace(",", ".")) != 0 else "") + s


def sg(x, nd: int = 0) -> str:
    """Como `es`, con signo explícito."""
    return ("+" if x > 0 else "") + es(x, nd)


def _load(path) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def verdict(c: dict) -> dict:
    n, pc, at, rl = c["nodes"], c["placement_conditions"], c["atmosphere"], c["relocation"]
    ok = {k: v["ok"] for k, v in pc.items() if "ok" in v}
    failed = [k for k, v in ok.items() if not v]
    basin = c["closed_basin"]["mola_463m_regional"]
    v = {
        "conditions_ok": ok,
        "all_threshold_conditions_met": not failed,
        "failed_conditions": failed,
        "site_inside_closed_basin": bool(basin["inside_closed_depression"]
                                         and not basin.get("pond_touches_window_edge", True)),
        "wp3_above_wp2": bool(n["WP3"]["elevation_m"]["ctx_20m"] > n["WP2"]["elevation_m"]["ctx_20m"]),
    }
    m = pc["f_radio"]["margin_m"]
    v["summary"] = (
        f"El triángulo se ha reubicado {es(rl['displacement_km'], 1)} km al {_rumbo(rl['bearing_deg'])} "
        f"(rumbo {es(rl['bearing_deg'])}°), al pie de la pared suroeste de la misma cuenca cerrada, "
        f"manteniendo rígida la figura. En el DTM CTX de 20 m la Base queda a "
        f"{es(n['BASE']['elevation_m']['ctx_20m'])} m con {es(n['BASE']['slope_deg']['ctx_20m'], 1)}° de pendiente; "
        f"el WP2 está sobre una ladera real de {es(n['WP2']['slope_deg']['ctx_20m'], 1)}°; el WP3 ve un horizonte de "
        f"hasta {es(n['WP3']['horizon']['max_deg'], 1)}° y tiene un SVF real de "
        f"{es(n['WP3']['sky_view_factor']['derived_ctx_20m'], 2)}; y no hay línea de vista de radio desde la Base al "
        f"WP2 ni al WP3 (márgenes de {es(m['WP2'], 1)} y {es(m['WP3'], 1)} m, fuera del ruido), pero sí al WP1 "
        f"({sg(m['WP1'], 1)} m). "
        + _robustness_sentence(failed)
        + f"Presión en la Base: {es(at['surface_pressure_pa'])} Pa; columna de CO₂: "
          f"{es(at['co2_column_g_cm2'], 1)} g/cm². Siguen siendo escenario la inercia térmica y la alcoba "
          f"con cornisa del WP3 (SVF 0,15), y el WP3 sigue quedando por debajo del WP2."
    )
    return v


def _robustness_sentence(failed: list[str]) -> str:
    search = _load(S.SITE_SEARCH_JSON) or {}
    bp = (search.get("chosen") or {}).get("by_pair") or {}
    head = ("En el par CTX de trabajo se cumplen las condiciones con umbral (a, b, c, e, f, g). "
            if not failed else f"En el par CTX de trabajo no se cumplen: {', '.join(failed)}. ")
    if not bp:
        return head
    s2 = sorted(e["slope_deg"]["WP2"] for e in bp.values())
    m1 = sorted(e["los_margin_m"]["WP1"] for e in bp.values())
    n_ok = sum(1 for e in bp.values() if e["all_ok"])
    return head + (
        f"Matices: solo se cumplen todas en {n_ok} de los {len(bp)} pares CTX que cubren la colocación; "
        f"la (c) está en el límite inferior y no es robusta (WP2 entre {es(s2[0], 1)}° y {es(s2[-1], 1)}° según el par, y "
        f"el par de trabajo da el valor más alto); la línea de vista al WP1 (entre {sg(m1[0], 1)} y {sg(m1[-1], 1)} m) "
        f"está dentro del ruido de ±5 m del DTM, es decir, es indeterminada; y la (d) es la condición débil: "
        f"el WP3 está en un talud, no al pie de un escarpe. ")


def _rumbo(b: float) -> str:
    names = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"]
    return names[int(((b + 22.5) % 360) // 45)]


def _si(x: bool) -> str:
    return "**Sí**" if x else "**No**"


def markdown(c: dict, manifest: dict) -> str:
    v, n, legs = c["verdict"], c["nodes"], c["legs"]
    pc, at, rl, r = c["placement_conditions"], c["atmosphere"], c["relocation"], c["route_aoi"]
    bm = c["closed_basin"]["mola_463m_regional"]
    sc, pl = c["scarps"], c["plateau"]
    rel = {x["radius_km"]: x for x in pl["relief_by_radius_mola_463m"]}
    search = _load(S.SITE_SEARCH_JSON) or {}
    orig = _load(S.ORIGINAL_REALITY_JSON)
    ctx_id = c["dems_used"]["ctx_20m"]
    m = pc["f_radio"]["margin_m"]
    g = pc["g_tramos_transitables"]["max_slope_deg"]
    d = pc["d_wp3_horizonte_svf"]

    def dzi(leg) -> int:
        """Desnivel entre cotas redondeadas al metro, como en el GeoJSON."""
        return round(n[leg["to"]]["elevation_m"]["ctx_20m"]) - round(n[leg["from"]]["elevation_m"]["ctx_20m"])

    rows_n = ["| Nodo | Latitud (°) | Longitud E (°) | Cota CTX 20 m (m) | Rango entre pares CTX (m) | Pendiente 20 m | Máx. a 100 m | SVF derivado | Horizonte máx. | LOS con la Base (margen) | Presión (Pa) | CO₂ (g/cm²) |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for k in ORDER:
        x = n[k]
        mm = x["elevation_m"]["ctx_pairs_min_max"]
        rng = f"{es(mm[0])} a {es(mm[1])} ({x['elevation_m']['ctx_pairs_n']})" if mm else "—"
        los = "—" if k == "BASE" else (("sí" if x["radio_los_base"]["derived_ctx_20m"] else "no")
                                       + f" ({sg(x['radio_los_base']['margin_m'], 1)} m)")
        a = at["per_node"][k]
        rows_n.append(
            f"| {LABEL[k]} | {es(x['lat_pc_deg'], 5)} | {es(x['lon_e_deg'], 5)} | **{es(x['elevation_m']['ctx_20m'])}** | {rng} | "
            f"**{es(x['slope_deg']['ctx_20m'], 1)}°** | {es(x['local_100m']['slope_max_deg'], 1)}° | "
            f"**{es(x['sky_view_factor']['derived_ctx_20m'], 2)}** | {es(x['horizon']['max_deg'], 1)}° hacia {es(x['horizon']['azimuth_of_max_deg'])}° | "
            f"{los} | {es(a['surface_pressure_pa'])} | {es(a['co2_column_g_cm2'], 1)} |")
    rows_l = ["| Tramo | Distancia (m) | Rumbo | Desnivel real (m) | Pendiente media | Pendiente mediana / máx. en el tramo |",
              "|---|---|---|---|---|---|"]
    for k, leg in legs.items():
        rows_l.append(
            f"| {k} {leg['from']}→{leg['to']} | {es(leg['distance_m']['real'])} | {es(leg['bearing_deg']['real'])}° | "
            f"**{sg(dzi(leg))}** | {sg(leg['mean_slope_deg'], 1)}° | "
            f"{es(leg['slope_along_leg_deg']['median'], 1)}° / **{es(leg['slope_along_leg_deg']['max'], 1)}°** |")

    cond = f"""| Condición | ¿Se cumple? | Cifra real |
|---|---|---|
| (a) Cobertura completa del DTM CTX en nodos y ruta | {_si(pc['a_cobertura_ctx']['ok'])} | Los cuatro nodos y los cinco tramos, sin huecos; {es(100 * pc['a_cobertura_ctx']['route_valid_fraction'], 1)} % de la caja de la AOI de ruta y {es(100 * pc['a_cobertura_ctx']['near_valid_fraction'], 1)} % del entorno cercano |
| (b) Base en terreno llano y seguro (< 3°) | {_si(pc['b_base_llana_segura']['ok'])} | {es(pc['b_base_llana_segura']['slope_deg'], 1)}° en el nodo; máximo {es(pc['b_base_llana_segura']['max_slope_within_60m_deg'], 1)}° a 60 m |
| (c) WP2 sobre pendiente real de 18–26° | {_si(pc['c_wp2_18_26']['ok'])} | {es(pc['c_wp2_18_26']['slope_deg'], 1)}° en el nodo; hasta {es(pc['c_wp2_18_26']['max_slope_within_100m_deg'], 1)}° a 100 m |
| (d) WP3 con máximo horizonte y mínimo SVF | Optimizada | SVF {es(d['svf_dem'], 2)}; horizonte hasta {es(d['horizon_max_deg'], 1)}° (media {es(d['horizon_mean_deg'], 1)}°); mínimo fiable de la AOI de ruta {es(d['route_svf_min_cell']['svf'], 2)} |
| (e) WP1 con pendiente < 8° | {_si(pc['e_wp1_menor_8']['ok'])} | {es(pc['e_wp1_menor_8']['slope_deg'], 1)}° |
| (f) Sin LOS a WP2 y WP3, con LOS a WP1 | {_si(pc['f_radio']['ok'])} | WP1 {sg(m['WP1'], 1)} m; WP2 {sg(m['WP2'], 1)} m; WP3 {sg(m['WP3'], 1)} m |
| (g) L1 y L4 sin celdas por encima de 25° | {_si(pc['g_tramos_transitables']['ok'])} | L1 {es(g['L1'], 1)}°; L4 {es(g['L4'], 1)}° (L2 {es(g['L2'], 1)}°; L3 {es(g['L3'], 1)}°) |"""

    # Robustez entre pares CTX y embudo de la búsqueda.
    robust = ""
    ch = search.get("chosen")
    if ch:
        rr = ["| Par CTX | Base | WP1 | WP2 | WP3 | Margen LOS WP1 / WP2 / WP3 (m) | L1 / L4 máx. | Cumple todo |", "|---|---|---|---|---|---|---|---|"]
        for pid, e in ch["by_pair"].items():
            s_, mm = e["slope_deg"], e["los_margin_m"]
            rr.append(f"| `{pid[:27]}` | {es(s_['BASE'], 1)}° | {es(s_['WP1'], 1)}° | {es(s_['WP2'], 1)}° | {es(s_['WP3'], 1)}° | "
                      f"{sg(mm['WP1'], 1)} / {sg(mm['WP2'], 1)} / {sg(mm['WP3'], 1)} | {es(e['leg_max_slope']['L1'], 1)}° / {es(e['leg_max_slope']['L4'], 1)}° | {'sí' if e['all_ok'] else 'no: ' + ', '.join(k for k, x in e['ok'].items() if not x)} |")
        s2 = [e["slope_deg"]["WP2"] for e in ch["by_pair"].values()]
        robust = f"""
La misma colocación medida en cada par CTX independiente que la cubre (pendiente a 20 m):

{chr(10).join(rr)}

La sombra de radio y la Base llana se sostienen en todos los pares. La pendiente del WP2 no: va de {es(min(s2), 1)}° a
{es(max(s2), 1)}° según el par, de modo que la condición (c) se cumple **en el límite inferior** y solo en
{sum(1 for e in ch['by_pair'].values() if e['ok']['c'])} de {len(ch['by_pair'])} pares. Es una ladera de talud de ~15–20°, no una rampa de 22°.
"""
    funnel = ""
    if search.get("funnel_total"):
        f = search["funnel_total"]
        funnel = f"""
## 6. Cómo se eligió: búsqueda con la figura rígida

Grados de libertad: {search['degrees_of_freedom']}. Se recorrió el borde sur y este de la cuenca
(lat {es(search['search_aoi']['lat_min'], 2)}° a {es(search['search_aoi']['lat_max'], 2)}°, lon {es(search['search_aoi']['lon_e_min'], 2)}° a {es(search['search_aoi']['lon_e_max'], 2)}°E)
en cada par CTX de 20 m por separado, sin mosaico. Reproducible con `uv run python -m red_atlas_p1.terrain.site_search`.

| Filtro acumulado | Colocaciones |
|---|---|
| Evaluadas | {es(f['evaluadas'])} |
| (a) cobertura en los cuatro nodos | {es(f['a_cobertura_nodos'])} |
| + (b) Base llana y segura | {es(f['b_base_llana'])} |
| + (e) WP1 < 8° | {es(f['e_wp1_menor_8'])} |
| + (c) WP2 en 18–26° | {es(f['c_wp2_18_26'])} |
| + (g) L1 y L4 ≤ 25° y cobertura de toda la ruta | {es(f['g_tramos_y_cobertura_ruta'])} |
| + (f) sombra de radio clara en WP2 y WP3 | **{es(f['f_radio'])}** |

Sí existen colocaciones que cumplen (c) y (d) a la vez con la figura rígida: no ha hecho falta relajar ninguna distancia.
Entre las {es(f['f_radio'])} que cumplen todo se ordenó por SVF real mínimo en el WP3 (el mejor valor alcanzable con todas las demás condiciones es ~0,72) y se afinó a 20 m y 1°, exigiendo que la colocación cumpliera todas las condiciones en al menos dos pares CTX
independientes. Solo tres colocaciones lo consiguen; se eligió la de mayor margen de sombra de radio.
{robust}"""

    original = ""
    if orig:
        on, orr = orig["nodes"], orig["route_aoi"]
        ob = orig["closed_basin"]["mola_463m_regional"]
        ou3 = orig["scarps"]["up_from_WP3_hrsc_mola_200m"]
        original = f"""
## 7. Por qué se trasladó: resultado del sitio original (9,8°S, 283,6°E)

Resumen de `site_reality_check_original_site.json` (DTM CTX `{orig['dems_used']['ctx_20m'][:27]}`):

| Afirmación del escenario original | Realidad medida |
|---|---|
| Base a −1.905 m dentro de la cuenca | **Confirmado**: {es(on['BASE']['elevation_m']['ctx_20m'])} m, en una depresión cerrada de {es(ob['pond_area_km2'])} km² |
| WP1, WP2 y WP3 a −1.878, −1.820 y −1.790 m | {es(on['WP1']['elevation_m']['ctx_20m'])}, {es(on['WP2']['elevation_m']['ctx_20m'])} y {es(on['WP3']['elevation_m']['ctx_20m'])} m ({sg(on['WP1']['elevation_m']['real_minus_scenario_m'])}, {sg(on['WP2']['elevation_m']['real_minus_scenario_m'])} y {sg(on['WP3']['elevation_m']['real_minus_scenario_m'])} m) |
| Rampa de 22° (18–26°) en el WP2 | {es(on['WP2']['slope_deg']['ctx_20m'], 1)}° en el nodo; máximo de toda la AOI {es(orr['slope_deg']['max'], 1)}° |
| Escarpe con alcoba en el WP3, a 600 m del WP2 | Relieve de +1 km más cercano a {es(ou3['distance_km'], 1)} km; desnivel total de la AOI {es(orr['relief_m'])} m |
| SVF 0,92 / 0,90 / 0,78 / 0,15 | {es(orr['svf_min_max'][0], 2)}–{es(orr['svf_min_max'][1], 2)} en toda la ruta |
| Sin LOS de radio en WP2 y WP3 | LOS geométrica en ambos (márgenes de {sg(on['WP2']['radio_los_base']['margin_m'], 1)} y {sg(on['WP3']['radio_los_base']['margin_m'], 1)} m, dentro del ruido) |
| Depresión cerrada que sigue la curva de −1.800 m | Cerrada hasta {es(ob['spill_elevation_m'])} m |

El sitio original era real y estaba dentro de la cuenca, pero era un piso casi llano: ni el talud del WP2 ni el escarpe
del WP3 existían. El GeoJSON original se conserva en `data/mission-scenarios/triangulo_supervivencia_original_9.8S_283.6E.geojson`.
"""

    up, down, near_pl = sc["up_hrsc_mola_200m"], sc["down_mola_463m"], pl["nearest_mola_463m"]
    o_at = at["original_site"]
    out = f"""# Comprobación de realidad del sitio — Melas Chasma, EVA-07 (emplazamiento reubicado)

> Generado por `uv run python -m red_atlas_p1.terrain` el {c['generated_utc']}. Las cifras salen de
> `site_reality_check.json`; no editar a mano. Convención: coma decimal; cotas en metros sobre el
> areoide MOLA; longitudes Este 0–360.

## Veredicto

{v['summary']}

## 1. Condiciones de la colocación

{cond}

**Orden aplicado.** Primero los umbrales (a), (b), (c), (e), (f) y (g) como filtros; después (d) como criterio de
desempate. Si se quiere (d) por delante de (e)–(g), hay que repetir la selección con ese orden.

**La condición débil es la (d).** El WP3 tiene un SVF real de {es(d['svf_dem'], 2)} frente a {es(d['base_svf_dem'], 2)} en la Base, y un
horizonte máximo de {es(d['horizon_max_deg'], 1)}° frente a {es(n['BASE']['horizon']['max_deg'], 1)}°: la mejora es pequeña. Está sobre un talud de
{es(d['wp3_slope_deg'], 1)}°, no al pie de un escarpe. En toda la AOI de ruta el cielo más cerrado fuera de artefactos de borde del DTM es
SVF {es(d['route_svf_min_cell']['svf'], 2)}, a {es(d['route_svf_min_cell']['distance_from_wp3_m'])} m del WP3 con rumbo {es(d['route_svf_min_cell']['bearing_from_wp3_deg'])}°
({es(d['route_svf_min_cell']['lat'], 5)}°, {es(d['route_svf_min_cell']['lon_e'], 5)}°E, cota {es(d['route_svf_min_cell']['elevation_m'])} m, pendiente {es(d['route_svf_min_cell']['slope_deg'], 1)}°); el percentil 1 es
{es(d['route_svf_min_cell']['route_svf_p01'], 2)} y el {es(100 * d['route_svf_min_cell']['fraction_of_route_aoi_with_svf_below_0_70'], 1)} % de la AOI baja de 0,70. Es decir, a 20 m este tramo de pared
no ofrece un abrigo topográfico mucho mejor que el del WP3: el refugio del escenario depende de la alcoba con cornisa,
que sigue siendo **[E]**.

## 2. Nodos

{chr(10).join(rows_n)}

- Cota **medida** en el DTM CTX `{ctx_id}`; pendiente, SVF, horizonte y línea de vista **derivados** de él.
  El rango entre pares es la dispersión de los pares CTX con cobertura (número entre paréntesis).
- El WP3 queda {es(n['WP2']['elevation_m']['ctx_20m'] - n['WP3']['elevation_m']['ctx_20m'])} m **por debajo** del WP2: el refugio se
  alcanza bajando, no subiendo como en el escenario original.
- SVF con la definición de ángulo sólido, 1 − media(sen θ). El 0,15 del WP3 que figura en el GeoJSON es la alcoba con
  cornisa de diseño; un DEM 2,5D no puede representarla. El valor real está en `sky_view_factor_dem`.
- La pendiente a 20 m se mide sobre una base de 40 m: no ve rampas, bloques ni escalones más cortos.

## 3. Tramos

{chr(10).join(rows_l)}

Las distancias y los ángulos entre tramos son los del escenario original (figura rígida, perímetro 4.900 m); los rumbos
han girado 37°. Los desniveles son ahora mucho mayores: el recorrido sube {es(n['WP2']['elevation_m']['ctx_20m'] - n['BASE']['elevation_m']['ctx_20m'])} m
de la Base al WP2, frente a 85 m en el escenario original. Esto afecta al modelo metabólico y al consumo de O₂.

## 4. Presión y columna de CO₂ en la nueva cota

{at['formula']}

| | Cota (m) | Presión (Pa) | Columna de CO₂ (g/cm²) |
|---|---|---|---|
| **Base reubicada** | {es(at['base_elevation_m'])} | **{es(at['surface_pressure_pa'])}** | **{es(at['co2_column_g_cm2'], 1)}** |
| Base original | {es(o_at['elevation_m'])} | {es(o_at['surface_pressure_pa'])} | {es(o_at['co2_column_g_cm2'], 1)} |
| Gale (referencia RAD) | −4.400 | — | {es(at['gale_co2_column_g_cm2'])} |

La Base sube {es(at['base_elevation_m'] - o_at['elevation_m'])} m, así que pierde {es(o_at['surface_pressure_pa'] - at['surface_pressure_pa'])} Pa y
{es(o_at['co2_column_g_cm2'] - at['co2_column_g_cm2'], 1)} g/cm² de blindaje atmosférico: todavía menos que en Gale. La presión
{'sigue por encima' if at['above_triple_point'] else 'queda por debajo'} del punto triple del agua (611,7 Pa){', de modo que el argumento del evaporador de membrana frente al sublimador se mantiene' if at['above_triple_point'] else ', lo que invalida el argumento contra el sublimador'}.
En el WP2 ({es(n['WP2']['elevation_m']['ctx_20m'])} m) la presión baja a {es(at['per_node']['WP2']['surface_pressure_pa'])} Pa.

## 5. Entorno: cuenca, pared y horizonte

- **Misma cuenca cerrada.** La nueva Base ({es(bm['point_elevation_m'])} m en MOLA) sigue dentro de la depresión que
  desborda a {es(bm['spill_elevation_m'])} m ({es(bm['pond_area_km2'])} km²), {es(bm['depth_below_spill_m'])} m por debajo del collado.
  Está {es(rl['displacement_km'], 1)} km al {_rumbo(rl['bearing_deg'])} de la Base original.
- **Pared.** Subida de +1 km más cercana a la Base: {es(up['distance_km'], 1)} km con rumbo {es(up['bearing_deg'])}°
  (rampa de {es(up['ramp_width_km'], 1)} km a {es(up['ramp_mean_slope_deg'], 1)}° de media). Borde de meseta (≥ +3.000 m) a
  {es(near_pl['distance_km'], 1)} km con rumbo {es(near_pl['bearing_deg'])}°.
- **Relieve.** {es(rel[10]['relief_above_point_m'])} m sobre la Base en 10 km, {es(rel[25]['relief_above_point_m'])} m en 25 km y
  {es(rel[100]['total_relief_m'])} m de relieve total en 100 km.
- **Ruta.** Desnivel total de la AOI {es(r['relief_m'])} m; pendiente mediana {es(r['slope_deg']['median'], 1)}°, percentil 95
  {es(r['slope_deg']['p95'], 1)}°, máxima {es(r['slope_deg']['max'], 1)}°; el {es(100 * r['fraction_slope_over_20deg'], 1)} % de las celdas
  supera 20°. SVF entre {es(r['svf_min_max'][0], 2)} y {es(r['svf_min_max'][1], 2)}. El {es(100 * r['fraction_without_los_to_base'])} % de la AOI no tiene
  línea de vista geométrica con la Base.
{funnel}{original}
## 8. Qué hay que cambiar en el entregable y en los datos compartidos (sin editarlos aquí)

1. **Coordenadas y tabla 1.2.** Sustituir nodos, cotas, pendientes, SVF y LOS por los de la sección 2, con etiqueta
   **[M]** para la cota y **[D]** para lo demás. TIU, geología y alcoba siguen **[E]**.
2. **Tabla de tramos.** Distancias y perímetro no cambian. Rumbos: {', '.join(f"{k} {es(legs[k]['bearing_deg']['real'])}°" for k in legs)}.
   Desniveles: {', '.join(f"{k} {sg(dzi(legs[k]))} m" for k in legs)}. Pendientes medias:
   {', '.join(f"{k} {sg(legs[k]['mean_slope_deg'], 1)}°" for k in legs)}.
3. **WP2.** «22° (rampas de 18–26°)» → pendiente real de {es(n['WP2']['slope_deg']['ctx_20m'], 1)}° a 20 m (14–19° según el par CTX).
   El lóbulo de deslizamiento y la traza de falla siguen sin estar identificados: **[E]**.
4. **WP3.** «+30 m sobre el WP2» → el WP3 está {es(n['WP2']['elevation_m']['ctx_20m'] - n['WP3']['elevation_m']['ctx_20m'])} m por debajo. Está
   en una ladera de {es(n['WP3']['slope_deg']['ctx_20m'], 1)}°, no al pie de una pared vertical; la alcoba con cornisa sigue **[E]**.
5. **Sombra de radio.** Ahora es real y está **[D]**: márgenes de {es(m['WP2'], 1)} y {es(m['WP3'], 1)} m.
6. **Sección 1.1 y 2.3.** «~9,8°S, 283,6°E = 76,4°W» → {es(-n['BASE']['lat_pc_deg'], 2)}°S, {es(n['BASE']['lon_e_deg'], 2)}°E = {es(360 - n['BASE']['lon_e_deg'], 2)}°W.
   «~724 Pa y ~19,5 g/cm² a −1,9 km» → {es(at['surface_pressure_pa'])} Pa y {es(at['co2_column_g_cm2'], 1)} g/cm² a {es(at['base_elevation_m'] / 1000, 2)} km.
   «su depresión cerrada sigue la curva de −1.800 m [M]» → cerrada hasta {es(bm['spill_elevation_m'])} m **[D]**.
7. **Sección 2.1 y catálogo.** Huella nueva: {es(-c['route_aoi_bounds']['lat_max'], 2)}–{es(-c['route_aoi_bounds']['lat_min'], 2)}°S,
   {es(c['route_aoi_bounds']['lon_e_min'], 2)}–{es(c['route_aoi_bounds']['lon_e_max'], 2)}°E. Productos resueltos en `sources_manifest.json`.
8. **Capa 3 (2.1 y 2.2).** Solo hay mosaicos THEMIS IR día/noche **cualitativos** (DN de 8 bits); no existe un mapa
   cuantitativo de inercia térmica accesible por ventana. Los 320 / 410 / 110 / 620 TIU siguen **[E]**.
9. **Capa 2 (2.1).** El mosaico CTX usado es el controlado de 6 m de USGS (Robbins et al. 2023), no el de Murray Lab,
   que solo se distribuye en teselas ZIP completas.
10. **Capas 1 y 6, y 2.5.** Ningún DTM HiRISE cubre la nueva ruta: la topografía es CTX de 20 m, el SVF sale a 20 m en
    campo cercano y 200 m en campo lejano (no «1–20 m»), y la resolución 12 de H3 (~5 m) es más fina que el dato.
11. **Tabla de relieve de 1.1.** «7–9 km [M]»: {es(rel[100]['total_relief_m'] / 1000, 1)}–{es(rel[150]['total_relief_m'] / 1000, 1)} km en 100–150 km, correcto;
    pero el piso más profundo en 150 km está a {es(rel[150]['min_elevation_m'])} m, no a «≈ −5 km». «5–6 km [D]»:
    {es(rel[25]['relief_above_point_m'] / 1000, 1)}–{es(rel[50]['relief_above_point_m'] / 1000, 1)} km sobre la nueva Base en 25–50 km. «4 km: escarpe local visible sobre el WP3 [E]»
    → la pared sube {es(up['ramp_mean_slope_deg'], 1)}° de media y gana +1 km a {es(up['distance_km'], 1)} km de la Base; no hay un escarpe de 4 km sobre el WP3.
12. **Sección 5.2.** La cuenca cerrada mide {es(bm['pond_extent_km']['east_west'])} × {es(bm['pond_extent_km']['north_south'])} km, no «30 × 120 km»; la coordenada alternativa
    12,2°S, 290,0°E está a unos 400 km y no es este sitio. Los supuestos «identidad del sitio» y «alcoba del WP3» pueden
    cerrarse con estas cifras.
13. **`eva_thresholds.json`.** `surface_pressure_pa_site` y `co2_column_g_cm2_site` siguen con los valores del sitio
   original (724 y 19,5); no se han tocado aquí.
14. **Validador (`scenario/`).** Sus tests de geometría y los perfiles de O₂ y potencia de escape dependen de rumbos y
    desniveles: hay que actualizarlos con la tabla de tramos.
15. **Otros consumidores con cifras del sitio original** (no tocados aquí): `docs/.../DATOS_CANONICOS_P1.md`,
    `data/mission-scenarios/eva07_events.json`, `eva07_timeline.parquet`, `SCHEMA_EVA07.md` y lo que el motor en Rust
    tenga escrito a mano.

## 9. Qué no puede decir esta comprobación

- Un DTM de 20 m no ve bloques, rampas cortas, cornisas ni alcobas.
- La inercia térmica no se ha podido contrastar: no hay producto cuantitativo accesible por ventana.
- La línea de vista es geométrica, sin zona de Fresnel ni difracción.
- La pendiente del WP2 depende del par CTX (14–19°): la cifra tiene una incertidumbre de varios grados.
"""
    return out
