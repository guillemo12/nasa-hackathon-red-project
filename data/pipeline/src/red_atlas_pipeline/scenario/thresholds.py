"""Intérprete de ``eva_thresholds.json`` y clasificador Verde / Ámbar / Rojo.

El JSON guarda los rangos como texto legible («<10», «10-20», «>585 sostenido; pico 1072»,
«-85 a -100», «<-100 o NLOS >60 s»…). Este módulo los convierte en intervalos numéricos
sin modificar el fichero. Reglas de resolución de ambigüedades (documentadas también en
``SCHEMA_EVA07.md``):

1. **Separador de rango.** «a» o guion entre dos números; los números pueden ser negativos
   («-85 a -100»). Los extremos se ordenan, así que «-85 a -100» es [−100, −85].
2. **Fronteras.** «<x» y «>x» son abiertos y «a-b» es cerrado. Si un valor cae en dos clases
   (p. ej. 28,0 kPa está en «28.0-30.5» y en «24.0-28.0»), gana la **peor** (conservador).
3. **Huecos.** Si un valor no cae en ninguna clase (η entre 1,0 y 1,3 o entre 1,6 y 2,1),
   toma la peor de las dos clases vecinas. Si solo hay vecina por un lado (presión del traje
   por encima de 30,5 kPa, que el JSON no clasifica), toma una clase peor que esa vecina.
4. **«sostenido; pico N».** El rojo exige persistencia. Con ``sustained=True`` (por defecto,
   conservador) todo valor por encima del límite es rojo; con ``sustained=False`` un
   transitorio por encima del límite y hasta el pico se clasifica ámbar, y solo es rojo si
   supera el pico. El pico se compara con una tolerancia relativa de 0,5 % porque el JSON lo
   guarda truncado (1.072 W frente a 1.072,9 W de la fórmula; 3,2 frente a 3,203 L/min).
5. **«o NLOS >60 s».** Es una segunda variable. Se interpreta como argumento con nombre
   ``nlos_s`` (segundos sin línea de vista); si se cumple, la clase es rojo.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from red_atlas_pipeline import config

GREEN, AMBER, RED = "VERDE", "AMBAR", "ROJO"
CLASSES = (GREEN, AMBER, RED)
_RANK = {GREEN: 0, AMBER: 1, RED: 2}
_JSON_KEY = {GREEN: "green", AMBER: "amber", RED: "red"}

PEAK_TOLERANCE = 0.005

_NUM = r"-?\d+(?:\.\d+)?"
_RE_LT = re.compile(rf"^<\s*({_NUM})$")
_RE_GT = re.compile(rf"^>\s*({_NUM})$")
_RE_RANGE = re.compile(rf"^({_NUM})\s*(?:a|-)\s*({_NUM})$")
_RE_EXACT = re.compile(rf"^({_NUM})$")
_RE_PEAK = re.compile(rf"^pico\s+({_NUM})$")
_RE_EXTRA = re.compile(rf"^([A-Za-z]+)\s*([<>])\s*({_NUM})\s*([A-Za-z]*)$")


@dataclass(frozen=True)
class Interval:
    lo: float
    hi: float
    lo_closed: bool
    hi_closed: bool

    def contains(self, x: float) -> bool:
        above = x > self.lo or (self.lo_closed and x == self.lo)
        below = x < self.hi or (self.hi_closed and x == self.hi)
        return above and below

    @property
    def mid(self) -> float:
        if math.isinf(self.lo):
            return self.hi - 1.0
        if math.isinf(self.hi):
            return self.lo + 1.0
        return (self.lo + self.hi) / 2.0


@dataclass(frozen=True)
class ExtraCondition:
    """Condición sobre otra variable, p. ej. «NLOS >60 s» → kwarg ``nlos_s`` > 60."""

    kwarg: str
    op: str
    value: float

    def holds(self, x: float) -> bool:
        return x > self.value if self.op == ">" else x < self.value


@dataclass(frozen=True)
class ClassRange:
    text: str
    interval: Interval
    sustained: bool = False
    peak: float | None = None
    extras: tuple[ExtraCondition, ...] = ()


@dataclass(frozen=True)
class ThresholdSpec:
    threshold_id: str
    unit: str
    prov: str
    ranges: dict[str, ClassRange] = field(default_factory=dict)

    @property
    def sense(self) -> str:
        """«creciente» (peor al subir), «decreciente» o «banda» (verde acotado por arriba
        en una variable decreciente: presión del traje)."""
        g, r = self.ranges[GREEN].interval, self.ranges[RED].interval
        if r.mid > g.mid:
            return "creciente"
        finite_green = not (math.isinf(g.lo) or math.isinf(g.hi))
        return "banda" if finite_green else "decreciente"

    @property
    def green_limit(self) -> float:
        g = self.ranges[GREEN].interval
        return g.hi if self.sense == "creciente" else g.lo

    @property
    def red_limit(self) -> float:
        r = self.ranges[RED].interval
        return r.lo if self.sense == "creciente" else r.hi

    @property
    def green_upper_limit(self) -> float | None:
        return self.ranges[GREEN].interval.hi if self.sense == "banda" else None

    @property
    def peak_value(self) -> float | None:
        return self.ranges[RED].peak

    @property
    def persistence_s(self) -> int:
        for e in self.ranges[RED].extras:
            if e.kwarg.endswith("_s"):
                return int(e.value)
        return 0


def parse_range(text: str) -> ClassRange:
    """Convierte el texto de una clase del JSON en un ``ClassRange``."""
    parts = [p.strip() for p in text.split(";")]
    main, notes = parts[0], parts[1:]
    alternatives = [a.strip() for a in re.split(r"\s+o\s+", main)]
    cond = alternatives[0]
    sustained = False
    if cond.endswith("sostenido"):
        sustained = True
        cond = cond[: -len("sostenido")].strip()

    if m := _RE_LT.match(cond):
        interval = Interval(-math.inf, float(m[1]), False, False)
    elif m := _RE_GT.match(cond):
        interval = Interval(float(m[1]), math.inf, False, False)
    elif m := _RE_RANGE.match(cond):
        a, b = sorted((float(m[1]), float(m[2])))
        interval = Interval(a, b, True, True)
    elif m := _RE_EXACT.match(cond):
        v = float(m[1])
        interval = Interval(v, v, True, True)
    else:
        raise ValueError(f"rango no interpretable: {text!r}")

    extras = []
    for alt in alternatives[1:]:
        m = _RE_EXTRA.match(alt)
        if not m:
            raise ValueError(f"condición adicional no interpretable: {alt!r}")
        name, op, value, unit = m.groups()
        kwarg = f"{name.lower()}_{unit.lower()}" if unit else name.lower()
        extras.append(ExtraCondition(kwarg, op, float(value)))

    peak = None
    for note in notes:
        if m := _RE_PEAK.match(note):
            peak = float(m[1])
        else:
            raise ValueError(f"anotación no interpretable: {note!r}")
    return ClassRange(text, interval, sustained, peak, tuple(extras))


def load_specs(data: dict | None = None) -> dict[str, ThresholdSpec]:
    """Lee los umbrales (por defecto, ``eva_thresholds.json``) y los interpreta."""
    data = data if data is not None else config.load_thresholds()
    specs = {}
    for t in data["thresholds"]:
        ranges = {c: parse_range(str(t[_JSON_KEY[c]])) for c in CLASSES}
        specs[t["id"]] = ThresholdSpec(t["id"], t["unit"], t["prov"], ranges)
    return specs


def _worse(a: str, b: str) -> str:
    return a if _RANK[a] >= _RANK[b] else b


def classify_spec(spec: ThresholdSpec, value: float, sustained: bool = True,
                  **extra: float) -> str:
    """Clase de ``value`` para un umbral ya interpretado (ver reglas en el docstring)."""
    for c in CLASSES:
        for e in spec.ranges[c].extras:
            if e.kwarg in extra and e.holds(extra[e.kwarg]):
                return c

    hits = [c for c in CLASSES if spec.ranges[c].interval.contains(value)]
    if hits:
        cls = max(hits, key=_RANK.__getitem__)
    else:
        cls = _gap_class(spec, value)

    red = spec.ranges[RED]
    transient = cls == RED and red.sustained and not sustained
    if transient and (red.peak is None or value <= red.peak * (1.0 + PEAK_TOLERANCE)):
        cls = AMBER
    return cls


def _gap_class(spec: ThresholdSpec, value: float) -> str:
    below = [c for c in CLASSES if spec.ranges[c].interval.hi < value
             or (spec.ranges[c].interval.hi == value and not spec.ranges[c].interval.hi_closed)]
    above = [c for c in CLASSES if spec.ranges[c].interval.lo > value
             or (spec.ranges[c].interval.lo == value and not spec.ranges[c].interval.lo_closed)]
    near_below = max(below, key=lambda c: spec.ranges[c].interval.hi, default=None)
    near_above = min(above, key=lambda c: spec.ranges[c].interval.lo, default=None)
    if near_below and near_above:
        return _worse(near_below, near_above)
    # Solo una vecina: fuera del rango que describe el JSON.
    sense = spec.sense
    if (sense == "creciente" and near_above) or (sense == "decreciente" and near_below):
        return GREEN          # más allá del verde, en el lado seguro (p. ej. η < 1,0)
    only = near_below or near_above
    return CLASSES[min(_RANK[only] + 1, 2)]   # banda rebasada (presión > 30,5 kPa) → ámbar


def classify(threshold_id: str, value: float, sustained: bool = True, **extra: float) -> str:
    """Verde / Ámbar / Rojo de ``value`` para el umbral ``threshold_id`` del JSON."""
    return classify_spec(load_specs()[threshold_id], value, sustained, **extra)


def numeric_table() -> list[dict]:
    """Tabla numérica con el esquema propuesto en 3.3 del documento científico."""
    rows = []
    for spec in load_specs().values():
        rows.append({
            "threshold_id": spec.threshold_id,
            "unit": spec.unit,
            "sense": spec.sense,
            "green_limit": spec.green_limit,
            "red_limit": spec.red_limit,
            "green_upper_limit": spec.green_upper_limit,
            "peak_value": spec.peak_value,
            "persistence_s": spec.persistence_s,
            "provenance": spec.prov,
        })
    return rows
