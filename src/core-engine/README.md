# ⚙️ `src/core-engine/` — Motores Geoespaciales, Pathfinding e IA Offline

Núcleo algorítmico de **R.E.D. ATLAS** especificado por la **Persona 3 (Arquitectura e IA)**:
1. **`h3-mars-grid/`:** Indexación espacial sobre malla hexagonal jerárquica adaptada al elipsoide IAU Mars 2000.
2. **`canyon-trn/`:** Posicionamiento autónomo sin GPS ni radio mediante Filtro de Kalman Extendido (IMU + VIO + LiDAR + *Skyline Matching* contra las paredes de 7 km de Melas Chasma).
3. **`metabolic-dstar-lite/`:** Planificador dinámico de rutas EVA con función de coste metabólico ($O_2$, pendiente, inercia térmica, radiación) y **Cambio Automático de Destino (*Dynamic Goal Switching*)**.
4. **`stochastic-hazard-sim/`:** Generador de amenazas combinadas basado en Cadenas de Markov y procesos de Poisson espaciales.
5. **`neuro-symbolic-copilot/`:** Motor de seguridad determinista + modelo ligero cuantizado (*Edge SLM*) para síntesis de alertas por voz en local.
