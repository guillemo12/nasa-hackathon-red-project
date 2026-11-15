"""Validador del escenario EVA-07: implementación de referencia de la física del canónico.

Módulos: ``geometry`` (tramos), ``metabolic`` (potencia y O₂), ``radiation`` (SVF, perfiles
SPE y dosis), ``radio`` (enlace primario en banda S y baliza UHF), ``thresholds`` (intérprete de ``eva_thresholds.json``),
``timeline`` (cronología e integrador minuto a minuto) y ``export`` (Parquet y JSON).
El motor estocástico, el D* Lite y la máquina de estados del traje son de la Persona 3 (Rust);
este paquete produce los ficheros de escenario que ese motor consume y los valida.
"""
