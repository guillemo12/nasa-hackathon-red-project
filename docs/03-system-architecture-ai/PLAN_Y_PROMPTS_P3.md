# ⚙️ Carril 3: Arquitectura Técnica, Ingeniería de Datos NASA e IA (Persona 3)
**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*) — Equipo **Red Project**  
**Entregable destino:** [`ENTREGABLE_3_ARQUITECTURA_E_IA.md`](./ENTREGABLE_3_ARQUITECTURA_E_IA.md)

---

## ✅ Decisiones Cerradas por el Equipo para Persona 3 (Checkpoints 1 y 2)

* **Nombre del Sistema:** **R.E.D. ATLAS**
* **Escenario:** **Valles Marineris — Melas Chasma** (Ruta *"Triángulo de Supervivencia"*: Base -> WP1 Agua ISRU -> WP2 Talud/Falla peligrosa -> WP3 Escarpe/Oquedad de Refugio).
* **Arquitectura Técnica Seleccionada:** **Arquitectura C (Híbrida Dual Base-Traje)**
  1. **🏢 Nodo 1 — Servidor del Hábitat (*Base Edge Server*):** Ejecuta el Gemelo Digital 3D de Melas Chasma (con la Lupa Espacial *Spyglass* de 3 sectores y el simulador *Chaos Mode*) apoyado en una **Malla Espacial Hexagonal Multicapa (tipo Uber H3 sobre elipsoide IAU Mars 2000)** que fusiona las 6 capas de la NASA.
  2. **🧑‍🚀 Nodo 2 — Unidad de Cómputo del Traje EVA (*Wearable Edge Node 100% Offline*):** Sincroniza antes de salir el subgrafo ligero de la misión. Opera sin depender de la Tierra (latencia 4–22 min) ni de la Base cuando las paredes de 7 km de Melas Chasma cortan la radio.
* **Tres Mecanismos de Ingeniería Estrella Aprobados:**
  1. **Posicionamiento *"Canyon-TRN"* (Sin GPS ni Radio):** Combina Odometría Visual-Inercial (VIO) + LiDAR del casco + **Skyline Matching** (comparación óptica en tiempo real de la silueta 3D de los muros de 7 km de Melas Chasma contra el horizonte sintético del DEM de MOLA/HRSC).
  2. **Algoritmo *D* Lite Metabólico* con *"Dynamic Goal Switching"*:** Calcula en tiempo real el coste metabólico ($O_2$/energía) y la barra *Walkback Limit Dual*. Si una combinación de amenazas hace inviable regresar a la Base, cambia automáticamente el nodo destino hacia el **Refugio Natural WP3 (Escarpe/Oquedad)**.
  3. **Motor Estocástico Multi-Amenaza (Cadenas de Markov / Poisson Espacial) + IA Neuro-Simbólica Local:** Inyecta amenazas correlacionadas con la física del mapa y la hora marciana, mientras una capa determinista de reglas + un modelo ligero local (*Edge SLM*) generan la **Fusión de Alerta Única** por voz manos libres.

---

## 📋 SECUENCIA DE PROMPTS PARA PERSONA 3 (Fase 2 y Fase 3)

Copia y pega estos prompts en orden dentro de tu propio chat de IA y pega los resultados en [`ENTREGABLE_3_ARQUITECTURA_E_IA.md`](./ENTREGABLE_3_ARQUITECTURA_E_IA.md). Cada prompt ya incluye todas las decisiones de tus compañeros (Persona 1 y Persona 2) para que la ingeniería encaje al milímetro.

---

### 🔹 PROMPT 1 (Fase 2A): Arquitectura Híbrida Dual, Pipeline Hexagonal NASA y Posicionamiento "Canyon-TRN"
*(Copia y pega este bloque en tu IA)*

```text
Actúa como Principal Systems Architect de la NASA especializado en Software de Misión Crítica, Sistemas GIS Planetarios y Edge Computing Espacial.
Estamos desarrollando el proyecto "R.E.D. ATLAS" (Reconnaissance, EVA & Dynamic-survival Atlas) del equipo "Red Project" para el reto "Interplanetary Survival Guide: Martian Map" de NASA Space Apps.
Nuestro objetivo es redactar el Documento de Especificación de Arquitectura Técnica e IA con máximo rigor de ingeniería (mediante diagramas Mermaid, flujos de datos, esquemas de protocolos y formulación matemática, sin escribir código de programación).

Nuestro equipo ya ha acordado los siguientes parámetros con los otros dos roles:
- Escenario Científico (Persona 1): Fondo del cañón de Valles Marineris — Melas Chasma (~9.8°S, 283.6°E), recorriendo la ruta "Triángulo de Supervivencia" (Base -> WP1 Sulfatos con Agua ISRU -> WP2 Falla/Talud peligroso >20° -> WP3 Oquedad de Refugio en escarpe vertical).
- Experiencia UX/UI (Persona 2): Ecosistema Dual con Consola 3D en Base (Lupa "Spyglass" de 3 sectores + Simulador "Chaos Mode") y Modo Táctico EVA en Casco AR + Tablet de Muñeca (con Barra "Walkback Limit Dual" y Triaje de "Fusión de Alerta Única" por voz).

Genera la Sección 1 y 2 de nuestro Entregable de Arquitectura Técnica con el máximo nivel de profundidad:

1. ARQUITECTURA DE ALTO NIVEL DEL ECOSISTEMA HÍBRIDO DUAL ("R.E.D. ATLAS"):
   - Diseña un diagrama de bloques completo en sintaxis Mermaid que muestre los dos nodos de cómputo en Marte:
     a) Servidor del Hábitat (Base Edge Server): Ingesta PDS, Motor de Fusión Hexagonal, Renderizador 3D Spyglass y Simulador Monte Carlo / Chaos Mode.
     b) Unidad Edge del Traje EVA (Wearable Compute Node): Almacenamiento local de sub-malla, módulo Canyon-TRN, motor de rutas D* Lite Metabólico y Copiloto IA Neuro-Simbólico.
   - Explica el protocolo de sincronización Pre-EVA, la telemetría diferencial de bajo ancho de banda por enlace UHF/Wi-Fi cuando hay línea de visión (LOS), y la conmutación automática sin fisuras a **Modo 100% Autónomo Offline** cuando los muros de Melas Chasma provocan Sombra de Radio (NLOS).

2. PIPELINE DE INGESTA Y FUSIÓN ESPACIAL EN MALLA HEXAGONAL (H3 MARS 2000):
   - Explica paso a paso (con un diagrama de pipeline en Mermaid) cómo tomamos las 6 fuentes de datos de la NASA definidas por la Persona 1 (MGS MOLA + Mars Express HRSC, MRO HiRISE DTM/Ortho, Mars Odyssey THEMIS IR, MRO CRISM/SHARAD, MRO MCS/MEDA y MSL RAD), resolvemos el problema de sus diferentes resoluciones espaciales (desde 128 m/px hasta 0.25 m/px) y las indexamos en una **Malla Hexagonal Jerárquica (adaptación de Uber H3 sobre el datum IAU Mars 2000)**.
   - Define el esquema exacto del "Vector de Estado Tensorial" que almacena cada celda hexagonal en la base de datos espacial (elevación, gradiente de pendiente, inercia térmica TIU, fracción de hidratación ISRU, factor de visión del cielo / Sky View Factor para blindaje de radiación y visibilidad de radio con la Base) y cómo esto permite que la Lupa "Spyglass" de 3 sectores consulte millones de puntos en <2 milisegundos.

3. SISTEMA DE POSICIONAMIENTO SIN GPS NI RADIO EN CAÑONES PROFUNDOS ("CANYON-TRN"):
   - En Marte no hay GPS, y en el fondo de Melas Chasma se pierde la triangulación de radio con la Base. Especifica técnicamente nuestro subsistema **Canyon-TRN (Terrain Relative Navigation)**: cómo un Filtro de Kalman Extendido (EKF) fusiona la IMU del traje, Odometría Visual-Inercial (VIO) + LiDAR corto alcance y el algoritmo de **Skyline Matching** (que extrae el perfil de cresta de las paredes de 7 km del cañón con la cámara del casco y lo alinea con el horizonte sintético precalculado del DEM de MOLA), logrando precisión submétrica (<0.5 m) en total aislamiento.
```

---

### 🔹 PROMPT 2 (Fase 2B): Motor Estocástico Multi-Amenaza (Markov/Poisson) y Algoritmo D* Lite Metabólico con "Dynamic Goal Switching"
*(Copia y pega este bloque en tu IA después de recibir la respuesta del Prompt 1)*

```text
Excelente. Ahora vamos a desarrollar la Sección 3 de nuestro Entregable de Arquitectura Técnica para "R.E.D. ATLAS": la formulación matemática y algorítmica del **Motor Estocástico de Amenazas Combinadas** y del **Planificador Dinámico de Rutas EVA (D* Lite Metabólico)**.

Necesito que redactes con rigor matemático e ingeniería aeroespacial:

1. MOTOR ESTOCÁSTICO MULTI-AMENAZA BASADO EN CADENAS DE MARKOV Y PROCESOS DE POISSON ESPACIALES:
   - Nuestro sistema permite simular (tanto en el "Chaos Mode" de la Consola de Base como en la simulación de misión en vivo) la aparición aleatoria de **1, 2 o más amenazas simultáneas**:
     * $H_1$: Tormenta de polvo / vientos catabáticos del cañón.
     * $H_2$: Evento de Partículas Solares (SPE - Radiación aguda).
     * $H_3$: Trampa geomorfológica (baja inercia térmica THEMIS <150 TIU + pendiente >20°).
     * $H_4$: Sombra de comunicaciones (corte de enlace NLOS con la Base).
   - Formula matemáticamente la matriz de transición de Markov y las tasas de disparo $\lambda(x, y, t)$ condicionadas por la posición espacial del astronauta en Melas Chasma y la hora solar marciana (explicando por qué las amenazas están correlacionadas físicamente y cómo se inyectan como perturbaciones dinámicas sobre los pesos de la Malla Hexagonal).

2. FORMULACIÓN MATEMÁTICA DEL ALGORITMO "D* LITE METABÓLICO" Y BARRA "WALKBACK LIMIT DUAL":
   - Explica por qué usamos **A* Multicriterio** en el Servidor de la Base para la planificación inicial y **D* Lite (Dynamic A*)** en el procesador del traje EVA para recalcular rutas en <15 ms cuando estallan varias amenazas en vivo.
   - Escribe la ecuación explícita de la **Función de Coste Dinámica $C(u, v, t)$** para transitar entre dos hexágonos adyacentes $u \to v$:
     * Incluye la ecuación biomecánica de gasto metabólico en gravedad marciana ($g = 3.72\text{ m/s}^2$) en función de la masa del astronauta con traje, la pendiente $\theta$ (MOLA/HiRISE) y el coeficiente de hundimiento del suelo derivado de la inercia térmica $I$ (THEMIS).
     * Incluye el término de dosis de radiación acumulada $D_{\text{rad}}(t)$ modulado por el *Sky View Factor* (apantallamiento topográfico de las paredes de Melas Chasma).
     * Incluye la penalización por opacidad de polvo $\tau$ y viento frontal.
   - Formula cómo se calculan en cada segundo los dos umbrales de la **Barra "Walkback Limit Dual"** de la interfaz de la Persona 2:
     * $T_{\text{walkback, Base}}$ vs. $T_{\text{walkback, Shelter (WP3)}}$.
   - Define la condición lógica exacta del **Cambio Automático de Destino ("Dynamic Goal Switching")**: cuando el impacto combinado de amenazas hace que el coste metabólico o el tiempo de exposición a radiación hacia la Base supere el margen vital del traje, el algoritmo conmuta instantáneamente el nodo objetivo $G_{\text{target}}$ de la Base al **Waypoint 3 (Oquedad/Escarpe de Refugio)**. Incluye un diagrama de flujo en Mermaid de esta lógica de decisión.
```

---

### 🔹 PROMPT 3 (Fase 3): Arquitectura del Copiloto IA Neuro-Simbólico Offline y Protocolo de "Fusión de Alerta Única"
*(Copia y pega este bloque en tu IA para cerrar la arquitectura de IA)*

```text
Ahora genera la Sección 4 (Final) del Entregable de la Persona 3 para "R.E.D. ATLAS": la especificación de ingeniería del **Copiloto IA Neuro-Simbólico 100% Offline** ejecutado en el traje EVA y su integración con el HUD AR durante una multiemergencia.

Desarrolla con máximo detalle técnico:

1. ¿POR QUÉ ARQUITECTURA NEURO-SIMBÓLICA EN MARTE? (SEGURIDAD DETERMINISTA + INTELIGENCIA CONTEXTUAL):
   - Explica por qué un LLM puro en un traje espacial sería peligroso (riesgo de alucinación, latencia de inferencia y alto consumo de batería) y por qué no podemos usar la nube terrestre (4 a 22 minutos de retardo de luz).
   - Diseña (con un diagrama de arquitectura en sintaxis Mermaid) nuestro motor híbrido **Neuro-Simbólico en el Borde (Edge AI)**:
     * **Capa Simbólica Determinista (Safety Guardrail & Rule Engine):** Máquina de estados finitos formalmente verificada que monitorea a 50 Hz la biometría del traje, la barra "Walkback Limit Dual", el dosímetro de radiación y el motor D* Lite. Garantiza 0% de alucinaciones en decisiones de vida o muerte.
     * **Capa Neuronal Ligera Local (Quantized Edge SLM + Audio/Vision Encoder):** Modelo compacto cuantizado a 4 bits ejecutado en la NPU de bajo consumo (<5 Watts) del traje espacial para interacción por voz manos libres, asistencia geológica en los Waypoints y síntesis de alertas.

2. ALGORITMO DE TRIAJE COGNITIVO Y "FUSIÓN DE ALERTA ÚNICA" (SINGLE-ALERT FUSION):
   - Conecta directamente con el diseño UX de la Persona 2 y el escenario de la Persona 1: en el minuto T+105 de la EVA en Melas Chasma, coinciden 4 eventos (Sombra de Radio NLOS + Suelo blando de 110 TIU en pendiente de 22° + Alerta de Radiación Solar SPE + Ráfagas de polvo).
   - Explica el pipeline técnico mediante el cual la IA recibe esos 4 vectores de alarma simultáneos, aplica una matriz de prioridad de supervivencia, actualiza el sendero AR en el visor del casco (de cian a rojo/ámbar hacia el Refugio WP3) y sintetiza **una única instrucción de voz de menos de 8 segundos** con entonación calmada.
   - Incluye una tabla técnica de especificaciones de Hardware/Software embebido del nodo del traje EVA (presupuesto de memoria RAM/VRAM, consumo en Watts, latencia de inferencia en ms y tolerancia a radiación espacial SEU).
```
