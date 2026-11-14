"""Cronología de EVA-07 como datos y su integrador minuto a minuto (T−45 a T+165).

Convenios:

- El tiempo ``t`` va en minutos terrestres desde la salida (T+0 = 14:45 LMST).
- Cada fase cubre el intervalo semiabierto ``[t0, t1)``. La fila del minuto ``t`` describe el
  **instante** ``t``: los acumulados (O₂, dosis) integran el intervalo ``[t−1, t]`` con la
  fase que contiene ``t−1``; las variables instantáneas (potencia, amenazas, SVF) son las de
  la fase que contiene ``t`` (la última fila, T+165, toma la última fase).
- Potencias: las fases de marcha salen del modelo metabólico del canónico con la pendiente
  media real de cada tramo (GeoJSON reubicado, DTM CTX 20 m), la velocidad media que imponen
  los hitos y el η del tramo; ISRU y reposo son potencias de escenario. Ningún parámetro está
  ajustado al O₂: los porcentajes de O₂ son una salida. Ver ``power_source``.
- Dosis SPE: tasa local = tasa externa del perfil × factor de exposición de la fase
  (1,0 en marcha, convenio «cielo abierto»; SVF 0,15 bajo la cornisa de WP3).
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import cache

from red_atlas_p1 import config
from red_atlas_p1.scenario import constants as K
from red_atlas_p1.scenario import metabolic as met
from red_atlas_p1.scenario import radiation as rad
from red_atlas_p1.scenario import radio
from red_atlas_p1.scenario import thresholds as thr
from red_atlas_p1.scenario.geometry import interpolate_latlon, leg_geometry, node_coords

THREATS = ("polvo", "spe", "trampa_regolito", "sombra_radio")

# Intervalos [inicio, fin) de cada amenaza, en minutos T. Fin 166 = activa hasta el final.
THREAT_WINDOWS: dict[str, tuple[int, int]] = {
    "sombra_radio": (92, 158),      # NLOS tras el espolón; Zenoh vuelve en T+158 (repetidor)
    "trampa_regolito": (98, 106),   # 110 TIU, 22°; se sale del banco blando en el 1.er min de escape
    "spe": (105, 166),              # alerta en T+105; evento en curso hasta el final de la serie
    "polvo": (105, 166),            # frente catabático τ 0,7 → 2,4; el canónico no da fin
}

TAU_BEFORE, TAU_AFTER = 0.7, 2.4


def _w(v, slope=0.0, eta=1.0, slip=0.0) -> float:
    return met.metabolic_power_w(v, slope, eta, slip)


def _slope(leg: str) -> float:
    return leg_geometry(leg).slope_deg


def leg_speed_m_s(leg: str, minutes: float) -> float:
    """Velocidad media [D] de un tramo: distancia declarada / tiempo de la cronología."""
    return float(config.scenario_legs()[leg]["distance_m"]) / (minutes * 60.0)


def leg_eta(leg: str) -> float:
    """η del tramo [D]: el de la inercia térmica media de sus dos nodos (regla en constants)."""
    props = config.scenario_legs()[leg]
    n = config.scenario_nodes()
    tiu = (float(n[props["from"]]["thermal_inertia_tiu"])
           + float(n[props["to"]]["thermal_inertia_tiu"])) / 2.0
    return met.eta_from_tiu(tiu)


def sustained_red_w() -> float:
    """Umbral rojo sostenido de potencia metabólica (585 W), leído de ``eva_thresholds.json``."""
    return thr.load_specs()["metabolic_rate_w"].red_limit


L1_MINUTES, L2_MINUTES, L3_MINUTES = 28, 23, 8     # T+0–28, T+75–98, T+105–113


def post_peak_speed_m_s() -> float:
    """Velocidad tras el pico en la rampa del WP2 [D]: el traje regula el ritmo para no pasar
    del rojo sostenido (585 W) con los parámetros del WP2 (22°, η 2,1, s 0,30): ≈0,268 m/s."""
    return met.speed_for_power_m_s(sustained_red_w(), K.WP2_SLOPE_DEG,
                                   met.eta_from_tiu(K.WP2_TIU), K.WP2_SLIP)


def wp3_real_slope_deg() -> float:
    """Pendiente real del talud del WP3 a 20 m (DTM CTX) [D]."""
    return float(config.scenario_nodes()["WP3"]["slope_local_deg"])


def wp2_real_slope_deg() -> float:
    """Pendiente real del WP2 a 20 m (DTM CTX) [D]; la rampa local de escenario es de 22° [E]."""
    return float(config.scenario_nodes()["WP2"]["slope_local_deg"])


POWER_SOURCES = {
    "modelo": "modelo del canónico con los parámetros que publica el propio canónico",
    "modelo_tramo_real": "modelo con la pendiente media real del tramo (GeoJSON, DTM CTX 20 m), "
                         "la velocidad media de la cronología y el η del tramo",
    "modelo_ritmo_regulado": "modelo con la velocidad que lleva la potencia al rojo sostenido (585 W)",
    "modelo_parametro_escenario": "modelo con un parámetro de escenario declarado (velocidad)",
    "escenario": "potencia de escenario del canónico (sin modelo de marcha)",
    "sin_consumo": "sin consumo de O₂ primario (astronauta en la Base)",
}


@dataclass(frozen=True)
class Phase:
    phase_id: str
    t0: int
    t1: int
    act: int
    description: str
    location: str            # nodo, o «A→B» si es marcha
    goal: str                # destino activo del planificador
    power_w: float
    power_source: str        # ver POWER_SOURCES
    svf_geo: float           # SVF del nodo de referencia (GeoJSON)
    dose_factor: float       # factor de exposición aplicado a la tasa externa


@cache
def phases() -> tuple[Phase, ...]:
    n = config.scenario_nodes()
    legs = config.scenario_legs()
    svf = {k: float(v["sky_view_factor"]) for k, v in n.items()}
    eta_bank = met.eta_from_tiu(K.WP2_TIU)
    wp2_peak = _w(K.WP2_SPEED_M_S, K.WP2_SLOPE_DEG, eta_bank, K.WP2_SLIP)
    post_peak = _w(post_peak_speed_m_s(), K.WP2_SLOPE_DEG, eta_bank, K.WP2_SLIP)
    v1, v2, v3 = (leg_speed_m_s("L1", L1_MINUTES), leg_speed_m_s("L2", L2_MINUTES),
                  leg_speed_m_s("L3", L3_MINUTES))
    l1 = _w(v1, _slope("L1"), leg_eta("L1"))
    l2 = _w(v2, _slope("L2"), leg_eta("L2"))
    exit_bank = _w(v3, _slope("L3"), eta_bank, K.WP2_SLIP)
    escape = wp3_power_w()
    entry = _w(K.CORNICE_ENTRY_SPEED_M_S, wp3_real_slope_deg(), met.eta_from_tiu(
        float(n["WP3"]["thermal_inertia_tiu"])))
    open_ = K.OPEN_SKY_DOSE_FACTOR
    wp3 = svf["WP3"]
    b3 = round(float(legs["L3"]["bearing_deg"]))
    return (
        Phase("A1_consola", -45, 0, 1, "Consola de Base: Spyglass, Chaos Mode y sincronización",
              "BASE", "WP1", 0.0, "sin_consumo", svf["BASE"], open_),
        Phase("A2_marcha_L1", 0, 28, 2,
              f"Marcha Base→WP1 ({v1:.2f} m/s, pendiente media {_slope('L1'):+.1f}°, η {leg_eta('L1')})"
              .replace(".", ","),
              "BASE→WP1", "WP1", l1, "modelo_tramo_real", svf["BASE"], open_),
        Phase("A2_isru_wp1", 28, 75, 2, "Muestreo ISRU en WP1", "WP1", "WP1",
              K.ISRU_POWER_W, "escenario", svf["WP1"], open_),
        Phase("A3_marcha_L2", 75, 92, 3, "Aproximación al lóbulo de WP2 con línea de vista",
              "WP1→WP2", "WP2", l2, "modelo_tramo_real", svf["WP1"], open_),
        Phase("A3_marcha_L2_nlos", 92, 98, 3, "Aproximación a WP2 sin línea de vista",
              "WP1→WP2", "WP2", l2, "modelo_tramo_real", svf["WP2"], open_),
        Phase("A3_rampa_pico", 98, 101, 3, "Rampa local de 22° en 110 TIU: pico de 3,2 L/min",
              "WP2", "WP2", wp2_peak, "modelo", svf["WP2"], open_),
        Phase("A3_rampa_lenta", 101, 105, 3, "Progresión lenta por la rampa, ritmo regulado a 585 W",
              "WP2", "WP2", post_peak, "modelo_ritmo_regulado", svf["WP2"], open_),
        Phase("A4_dgs_salida", 105, 106, 4,
              "Alerta SPE y polvo; Dynamic Goal Switching; salida del banco blando (η 2,1)",
              "WP2→WP3", "WP3", exit_bank, "modelo_tramo_real", svf["WP2"], open_),
        Phase("A4_escape_L3", 106, 113, 4,
              f"Marcha de escape a WP3, cuesta abajo (1,25 m/s, rumbo {b3}°)",
              "WP2→WP3", "WP3", escape, "modelo_tramo_real", svf["WP2"], open_),
        Phase("A4_entrada_cornisa", 113, 114, 4,
              "Llegada a WP3 y trepada corta bajo la cornisa por el talud real",
              "WP3", "WP3", entry, "modelo_parametro_escenario", wp3, wp3),
        Phase("A4_refugio", 114, 125, 4, "Refugio activo, subida hacia el pico SPE",
              "WP3", "WP3", K.REST_POWER_W, "escenario", wp3, wp3),
        Phase("A4_refugio_pico", 125, 140, 4, "Refugio activo durante el pico SPE",
              "WP3", "WP3", K.REST_POWER_W, "escenario", wp3, wp3),
        Phase("A5_permanencia", 140, 158, 5, "Remite el pico; permanencia protegida",
              "WP3", "WP3", K.REST_POWER_W, "escenario", wp3, wp3),
        Phase("A5_zenoh", 158, 165, 5, "Enlace Zenoh restablecido por repetidor; telemetría final",
              "WP3", "WP3", K.REST_POWER_W, "escenario", wp3, wp3),
    )


def sustained_red_runs() -> list[tuple[int, int]]:
    """Tramos [t0, t1) seguidos con potencia > rojo sostenido; insostenible si dura más de
    ``SUSTAINED_RED_MAX_MIN``, salvo el pico canónico del WP2 (transitorio documentado)."""
    runs, start = [], None
    for p in phases():
        hot = p.power_w > sustained_red_w() + 1e-9
        if hot and start is None:
            start = p.t0
        if not hot and start is not None:
            runs.append((start, p.t0))
            start = None
    if start is not None:
        runs.append((start, phases()[-1].t1))
    return runs


# Desplazamientos: (t0, t1, origen, destino). Fuera de ellos el astronauta está quieto.
TRACKS: tuple[tuple[int, int, str, str], ...] = (
    (0, 28, "BASE", "WP1"),
    (75, 98, "WP1", "WP2"),
    (105, 113, "WP2", "WP3"),
)


def phase_threats(p: Phase) -> list[str]:
    """Amenazas activas en algún minuto de la fase ``[t0, t1)``."""
    return [n for n in THREATS
            if THREAT_WINDOWS[n][0] < p.t1 and THREAT_WINDOWS[n][1] > p.t0]


def phase_threat_states(p: Phase) -> dict[str, str]:
    """Estado de cada amenaza en la fase: «activa», «inactiva» o «se_activa»/«se_desactiva»
    si cambia dentro de ella."""
    out = {}
    for n in THREATS:
        a, b = threat_active(n, p.t0), threat_active(n, p.t1 - 1)
        out[n] = ("activa" if a else "inactiva") if a == b else ("se_activa" if b else "se_desactiva")
    return out


def phase_at(t: float) -> Phase:
    ph = phases()
    for p in ph:
        if p.t0 <= t < p.t1:
            return p
    if t == ph[-1].t1:
        return ph[-1]
    raise ValueError(f"minuto fuera de la cronología: {t}")


def position_at(t: float) -> tuple[str, str, float]:
    """(nodo anterior, nodo siguiente, fracción recorrida 0–1) en el instante ``t``."""
    last = "BASE"
    for t0, t1, a, b in TRACKS:
        if t < t0:
            return last, last, 0.0
        if t <= t1:
            return a, b, (t - t0) / (t1 - t0)
        last = b
    return last, last, 0.0


def latlon_at(t: float) -> tuple[float, float]:
    a, b, f = position_at(t)
    la1, lo1, _ = node_coords(a)
    la2, lo2, _ = node_coords(b)
    return interpolate_latlon(la1, lo1, la2, lo2, f)


@cache
def node_route_distances() -> dict[str, tuple[float, float]]:
    """Distancia de ruta (m) desde cada nodo a (Base, WP3).

    Base: 0 / 1.600 (L4 al revés). WP1: 1.500 (L1 al revés) / recta WP1–WP3 (no hay tramo
    planificado). WP2: 2.500 (ruta segura D* Lite) / 600 (L3). WP3: 1.600 (L4) / 0.
    Entre nodos se interpola linealmente con la fracción recorrida: es una aproximación de
    validación; la distancia real la calcula el D* Lite de la Persona 3.
    """
    legs = config.scenario_legs()
    n = config.scenario_nodes()
    wp1_wp3 = config.haversine_m(n["WP1"]["lat_pc_deg"], n["WP1"]["lon_e_deg"],
                                 n["WP3"]["lat_pc_deg"], n["WP3"]["lon_e_deg"])
    return {
        "BASE": (0.0, float(legs["L4"]["distance_m"])),
        "WP1": (float(legs["L1"]["distance_m"]), wp1_wp3),
        "WP2": (K.SAFE_RETURN_WP2_BASE_M, float(legs["L3"]["distance_m"])),
        "WP3": (float(legs["L4"]["distance_m"]), 0.0),
    }


def route_distances_at(t: float) -> tuple[float, float]:
    a, b, f = position_at(t)
    d = node_route_distances()
    return (d[a][0] + (d[b][0] - d[a][0]) * f, d[a][1] + (d[b][1] - d[a][1]) * f)


def base_return_speed_m_min() -> float:
    return K.SAFE_RETURN_WP2_BASE_M / K.SAFE_RETURN_TIME_MIN     # 52,1 m/min (0,868 m/s)


def wp3_speed_m_min() -> float:
    return K.ESCAPE_SPEED_M_S * 60.0                              # 75 m/min


def base_return_power_w() -> float:
    """Potencia de la vuelta a la Base: 0,868 m/s, η 1,3, en bajada (sin término de pendiente)."""
    return met.metabolic_power_w(base_return_speed_m_min() / 60.0, 0.0, K.RETURN_ETA)


def wp3_power_w() -> float:
    """Potencia de la marcha WP2→WP3 fuera del banco blando: 1,25 m/s, η del tramo L3."""
    return met.metabolic_power_w(K.ESCAPE_SPEED_M_S, _slope("L3"), leg_eta("L3"))


def threat_active(name: str, t: float) -> bool:
    t0, t1 = THREAT_WINDOWS[name]
    return t0 <= t < t1


def lmst(t: int) -> str:
    """Hora solar local (LMST) del minuto terrestre ``t``; 1 min marciano = 1,0275 min."""
    total = 14 * 60 + 45 + t / 1.0275
    return f"{int(total // 60) % 24:02d}:{int(total % 60):02d}"


def _projected_dose(profile_name: str | None, t: float, minutes: float) -> float:
    """Dosis SPE proyectada (mSv) para una marcha de ``minutes`` desde ``t`` en ruta (factor 1,0).

    ``None`` = proyección del traje: si la alerta SPE está activa, envolvente de 8 mSv/h
    constante durante todo el trayecto (regla del canónico); si no, 0 (el traje no predice).
    Con un nombre de perfil se integra ese perfil hacia delante (proyección «oráculo»).
    """
    if minutes <= 0:
        return 0.0
    if profile_name is None:
        if not threat_active("spe", t):
            return 0.0
        return rad.dose_msv(K.SPE_PEAK_MSV_H * K.OPEN_SKY_DOSE_FACTOR, minutes)
    return rad.integrate_dose_msv(rad.profile(profile_name), t, t + minutes,
                                  K.OPEN_SKY_DOSE_FACTOR)


def walkback(t: float, o2_remaining_g: float, dose_acc_msv: float) -> dict:
    """Los dos lados del Walkback Limit Dual en el instante ``t``.

    Para cada destino: distancia (m), tiempo (min), dosis SPE proyectada (envolvente y
    rampa calibrada, mSv), O₂ necesario (g) y margen (min) = mín(margen de O₂, margen de
    radiación). Viable si dosis acumulada + proyectada (envolvente) ≤ 2 mSv y el O₂ basta;
    la Base exige además margen ≥ 10 min (regla del diagrama 3.6, que no se aplica a WP3).
    """
    d_base, d_wp3 = route_distances_at(t)
    out = {}
    for dest, dist, speed, power in (
        ("base", d_base, base_return_speed_m_min(), base_return_power_w()),
        ("wp3", d_wp3, wp3_speed_m_min(), wp3_power_w()),
    ):
        minutes = dist / speed
        rate_g = met.o2_g_min(power)
        need = rate_g * minutes
        dose_env = _projected_dose(None, t, minutes)
        dose_cal = _projected_dose(K.NOMINAL_PROFILE, t, minutes)
        o2_margin = (o2_remaining_g - need) / rate_g
        if threat_active("spe", t):
            window = rad.time_to_budget_min(K.SPE_PEAK_MSV_H * K.OPEN_SKY_DOSE_FACTOR,
                                            K.SPE_BUDGET_MSV, dose_acc_msv)
            margin = min(o2_margin, window - minutes)
        else:
            margin = o2_margin
        viable = (dose_acc_msv + dose_env <= K.SPE_BUDGET_MSV + 1e-9) and need <= o2_remaining_g
        if dest == "base":
            viable = viable and margin >= K.WALKBACK_MARGIN_MIN_REQUIRED
        out.update({
            f"{dest}_route_m": dist,
            f"{dest}_time_min": minutes,
            f"{dest}_dose_proj_env_msv": dose_env,
            f"{dest}_dose_proj_ramp_msv": dose_cal,
            f"{dest}_o2_need_g": need,
            f"{dest}_margin_min": margin,
            f"{dest}_viable": bool(viable),
        })
    if out["base_viable"]:
        out["viable_destination"] = "BASE"
    elif out["wp3_viable"]:
        out["viable_destination"] = "WP3"
    else:
        out["viable_destination"] = "NINGUNO"
    return out


def integrate(t_start: int = K.T_START, t_end: int = K.T_END) -> list[dict]:
    """Serie minuto a minuto de la EVA-07 (una fila por minuto entero, ambos extremos)."""
    base_lat, base_lon, _ = node_coords("BASE")
    profiles = {name: rad.profile(name) for name in K.SPE_PROFILES}
    o2_used = 0.0
    dose = {name: 0.0 for name in K.SPE_PROFILES}
    gcr = 0.0
    rows = []
    for t in range(t_start, t_end + 1):
        if t > t_start:
            prev = phase_at(t - 1)
            o2_used += met.o2_g_min(prev.power_w)
            for name, fn in profiles.items():
                dose[name] += rad.integrate_dose_msv(fn, t - 1, t, prev.dose_factor)
            if t > 0:
                gcr += rad.dose_msv(K.GCR_DOSE_RATE_MSV_H, 1.0)
        ph = phase_at(t)
        o2_rem = K.O2_USABLE_G - o2_used
        lat, lon = latlon_at(t)
        d_base_los = config.haversine_m(base_lat, base_lon, lat, lon)
        nlos = threat_active("sombra_radio", t)
        rssi = radio.received_dbm(d_base_los, los=not nlos)
        nlos_s = (t - THREAT_WINDOWS["sombra_radio"][0]) * 60.0 if nlos else 0.0
        ext = {name: fn(t) for name, fn in profiles.items()}
        local_rate = ext[K.NOMINAL_PROFILE] * ph.dose_factor
        threats = {name: threat_active(name, t) for name in THREATS}
        o2_pct = 100.0 * o2_rem / K.O2_USABLE_G
        wb = walkback(t, o2_rem, dose[K.NOMINAL_PROFILE])
        a, b, f = position_at(t)
        row = {
            "t_min": t,
            "lmst": lmst(t),
            "act": ph.act,
            "phase_id": ph.phase_id,
            "location": ph.location,
            "goal": ph.goal,
            "from_node": a,
            "to_node": b,
            "track_fraction": f,
            "lat_pc_deg": lat,
            "lon_e_deg": lon,
            "metabolic_power_w": ph.power_w,
            "power_source": ph.power_source,
            "o2_l_min": met.o2_l_min(ph.power_w),
            "o2_g_min": met.o2_g_min(ph.power_w),
            "o2_used_g": o2_used,
            "o2_remaining_g": o2_rem,
            "o2_remaining_pct": o2_pct,
            "svf_geo": ph.svf_geo,
            "dose_factor": ph.dose_factor,
            "spe_ext_rate_env_msv_h": ext["envolvente"],
            "spe_ext_rate_linear_msv_h": ext["rampa_lineal"],
            "spe_ext_rate_cal_msv_h": ext["rampa_calibrada"],
            "spe_local_rate_msv_h": local_rate,
            "dose_spe_msv": dose[K.NOMINAL_PROFILE],
            "dose_spe_env_msv": dose["envolvente"],
            "dose_spe_linear_msv": dose["rampa_lineal"],
            "dose_gcr_msv": gcr,
            "dust_tau": TAU_AFTER if threats["polvo"] else TAU_BEFORE,
            "radio_distance_m": d_base_los,
            "radio_los": not nlos,
            "radio_nlos_s": nlos_s,
            "radio_rssi_dbm": rssi,
            "radio_class": radio.classify_link(rssi, nlos_s=nlos_s),
            **{f"threat_{name}": threats[name] for name in THREATS},
            "n_threats": sum(threats.values()),
            **wb,
            "class_metabolic": thr.classify("metabolic_rate_w", ph.power_w),
            "class_dose_rate": thr.classify("dose_rate_msv_h", local_rate),
            "class_dose_budget": thr.classify("eva_spe_dose_budget_msv", dose[K.NOMINAL_PROFILE]),
            "class_o2": thr.classify("o2_primary_pct", o2_pct),
            "class_walkback": thr.classify(
                "walkback_margin_min",
                wb["base_margin_min"] if wb["viable_destination"] == "BASE" else wb["wp3_margin_min"],
            ),
        }
        rows.append(row)
    return rows


def row_at(rows: list[dict], t: int) -> dict:
    return next(r for r in rows if r["t_min"] == t)
