# ⚙️ Carril 3: Arquitectura Técnica en Rust, Ingeniería de Datos NASA e IA (Persona 3)
**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*) — Equipo **Red Project**  
**Entregable destino:** [`ENTREGABLE_3_ARQUITECTURA_E_IA.md`](./ENTREGABLE_3_ARQUITECTURA_E_IA.md)

---

## ✅ Decisiones y Stack Tecnológico Cerrados para Persona 3 (Checkpoints 1, 2 y 3)

* **Nombre del Sistema:** **R.E.D. ATLAS**
* **Escenario:** **Valles Marineris — Melas Chasma** (Ruta *"Triángulo de Supervivencia"*: Base -> WP1 Agua ISRU -> WP2 Talud/Falla peligrosa -> WP3 Escarpe/Oquedad de Refugio).
* **Stack de Ingeniería Aeroespacial "Rust-First" Acordado por el Equipo:**
  1. **🦀 Núcleo Algorítmico y Servidor Base (`core-engine` en Rust):**
     * **Lenguaje:** **Rust** (*memory-safe*, sin *Garbage Collector*, determinista para misiones críticas de la NASA y compilable tanto a nativo como a **WebAssembly (WASM)** para la consola web).
     * **Malla Hexagonal Marciana:** Crate **`h3o`** (implementación en Rust puro de Uber H3 adaptada al elipsoide IAU Mars 2000) + almacenamiento columnar **Apache Parquet / DuckDB Spatial**.
     * **Servidor de Hábitat:** **`Tokio` + `Axum`** sirviendo las capas **Cloud-Optimized GeoTIFF (COG)** y **GeoJSON** al frontend **TypeScript + React + CesiumJS + Three.js**.
     * **Ingesta Científica Previa:** Pipeline en **Python (`GDAL`, `Rasterio`, `PDS4-tools`)** que convierte los datos crudos PDS de la NASA a COG y Parquet.
  2. **🥽 Nodo Edge del Traje EVA (`eva-node` en ROS 2 + Rust):**
     * **Middleware Robótico Espacial:** **ROS 2 con bindings nativos en Rust (`rclrs`)** + **Eclipse Zenoh** (protocolo pub/sub escrito 100% en Rust ideal para enlaces de radio intermitentes con pérdidas de línea de visión en cañones; enlace primario en banda S a 2,4 GHz y baliza UHF de baja tasa).
     * **Posicionamiento sin GPS *"Canyon-TRN"*:** Escrito en Rust usando **`nalgebra`** (Filtro de Kalman Extendido IMU + VIO + LiDAR) y visión artificial en Rust para **Skyline Matching** contra las paredes de 7 km de Melas Chasma.
     * **Copiloto IA Neuro-Simbólico 100% Offline en Rust:** Máquina de estados determinista en Rust (*Zero-Panic Safety Guardrail*) + inferencia local cuantizada a 4 bits con **Hugging Face `Candle` / ONNX Runtime (`ort`)** + reconocimiento de voz manos libres con **`whisper-rs`**.
  3. **📐 Diagramas:** Todos los diagramas de bloques, pipelines y máquinas de estados se escriben en **Mermaid.js** embebido en Markdown.

---

## 📋 SECUENCIA DE PROMPTS PARA PERSONA 3 (Fase 2 y Fase 3)

Copia y pega estos prompts en orden dentro de tu propio chat de IA y pega los resultados en [`ENTREGABLE_3_ARQUITECTURA_E_IA.md`](./ENTREGABLE_3_ARQUITECTURA_E_IA.md).

---

### 🔹 PROMPT 1 (Fase 2A): Arquitectura Híbrida Dual en Rust + ROS 2/Zenoh, Pipeline Hexagonal `h3o` y "Canyon-TRN"
*(Copia y pega este bloque en tu IA)*

```text
Actúa como Principal Systems Architect de la NASA especializado en Software de Vuelo en Rust, Robótica Espacial con ROS 2, Sistemas GIS Planetarios y Edge Computing.
Estamos desarrollando el proyecto "R.E.D. ATLAS" (Reconnaissance, EVA & Dynamic-survival Atlas) del equipo "Red Project" para el reto "Interplanetary Survival Guide: Martian Map" de NASA Space Apps.
Nuestro objetivo es redactar el Documento de Especificación de Arquitectura Técnica e IA con máximo rigor de ingeniería (mediante diagramas Mermaid.js, flujos de datos, estructuras de tipos conceptuales y formulación matemática, sin escribir bloques largos de código de implementación).

Nuestro equipo ha fijado el siguiente STACK TECNOLÓGICO UNIFICADO que debes detallar en toda tu respuesta:
- Escenario Científico (Persona 1): Fondo del cañón de Valles Marineris — Melas Chasma (~9.9°S, 283.4°E), recorriendo la ruta "Triángulo de Supervivencia" (Base -> WP1 Sulfatos con Agua ISRU -> WP2 Falla/Talud peligroso >20° -> WP3 Oquedad de Refugio en escarpe vertical).
- Stack Frontend y UX/UI (Persona 2): Ecosistema Dual con Consola 3D en Base construida en TypeScript + React + CesiumJS + Three.js (WebGL/WebGPU shader para la Lupa "Spyglass" de 3 sectores + Simulador "Chaos Mode" ejecutado vía Rust WebAssembly WASM) y Modo Táctico EVA en Casco AR + Tablet de Muñeca (con Barra "Walkback Limit Dual" y Triaje de "Fusión de Alerta Única" por voz).
- Stack Core, Robótica e IA (Persona 3 - ¡Nuestro eje central es RUST!):
  * Preprocesamiento de datos PDS de la NASA: Python (`GDAL`, `Rasterio`, `PDS4-tools`) exportando a Cloud-Optimized GeoTIFF (COG), GeoJSON y Apache Parquet.
  * Servidor Base y Motor Core: Rust (`Tokio`, `Axum`, crate `h3o` para la Malla Hexagonal H3 sobre IAU Mars 2000, `DuckDB Spatial`).
  * Nodo Edge del Traje EVA: ROS 2 con cliente nativo en Rust (`rclrs`) y middleware de comunicaciones espaciales **Eclipse Zenoh** (escrito en Rust, con soporte nativo para reconexión tras Sombra de Radio NLOS).
  * Navegación y Motores en Rust: `nalgebra` (Filtro de Kalman Extendido para Canyon-TRN Skyline Matching), motor D* Lite Metabólico y Markov/Poisson en Rust seguro (compartido entre el traje nativo y la consola web mediante WASM).
  * IA Neuro-Simbólica Offline en Rust: Guardrail determinista en Rust + inferencia local con **Hugging Face `Candle` / ONNX Runtime (`ort`)** + voz manos libres con **`whisper-rs`**.
- Formato de Diagramas: Usa exclusivamente bloques `mermaid` (Mermaid.js) embebidos en Markdown.

Genera la Sección 1 y 2 de nuestro Entregable de Arquitectura Técnica con el máximo nivel de profundidad:

1. ARQUITECTURA DE ALTO NIVEL DEL ECOSISTEMA HÍBRIDO DUAL ("R.E.D. ATLAS" RUST-FIRST):
   - Justifica técnicamente ante un jurado de la NASA por qué elegir **Rust** como lenguaje central del motor geoespacial y del traje EVA es decisivo para la supervivencia en Marte (seguridad de memoria garantizada en tiempo de compilación, ausencia de pausas de Garbage Collector en alertas críticas, concurrencia sin data-races y compilación dual a ARM/RISC-V embebido en el traje y a WebAssembly en la Consola 3D).
   - Diseña un diagrama de arquitectura de bloques completo en sintaxis Mermaid.js que muestre los dos nodos en Marte:
     a) Servidor del Hábitat (Base Edge Server): Pipeline Python GDAL -> Motor Rust (`Axum` + `h3o` + `DuckDB` + `Parquet/COG`) -> Frontend React + CesiumJS + Three.js + Rust WASM.
     b) Unidad Edge del Traje EVA (Wearable Compute Node): Nodos ROS 2 en Rust (`rclrs`), router Eclipse Zenoh, caché local Parquet/`h3o`, módulo `Canyon-TRN` (`nalgebra`), planificador `D* Lite Metabólico` y Copiloto IA (`Candle`/`ort` + `whisper-rs`).
   - Explica el protocolo de sincronización Pre-EVA, la telemetría diferencial sobre **Eclipse Zenoh** cuando hay línea de visión (LOS), y la conmutación en <5 ms a **Modo 100% Autónomo Offline** cuando los muros de 7 km de Melas Chasma provocan Sombra de Radio (NLOS).

2. PIPELINE DE INGESTA Y FUSIÓN ESPACIAL EN MALLA HEXAGONAL (`h3o` + APACHE PARQUET + COG):
   - Explica paso a paso (con un diagrama de pipeline en Mermaid.js) cómo tomamos las 6 fuentes de datos de la NASA definidas por la Persona 1 (MGS MOLA + Mars Express HRSC, MRO HiRISE DTM/Ortho, Mars Odyssey THEMIS IR, MRO CRISM/SHARAD, MRO MCS/MEDA y MSL RAD), las procesamos con Python (`GDAL`/`Rasterio`) hacia Cloud-Optimized GeoTIFF (COG) y Apache Parquet, y las indexamos en Rust mediante el crate **`h3o`** en una **Malla Hexagonal Jerárquica (adaptada al elipsoide IAU Mars 2000)**.
   - Define el esquema de datos exacto del "Vector de Estado Tensorial" de cada celda hexagonal (elevación, gradiente de pendiente, inercia térmica TIU, fracción de hidratación ISRU, *Sky View Factor* para blindaje de radiación y visibilidad de radio Zenoh) y cómo permite que el shader de la Lupa "Spyglass" de 3 sectores consulte la malla en <2 milisegundos (medido en el motor Rust, release: Lupa de 100 m y 3 sectores en 63 µs de mediana / 69 µs p95).

3. SISTEMA DE POSICIONAMIENTO SIN GPS NI RADIO EN CAÑONES PROFUNDOS ("CANYON-TRN" EN RUST):
   - Especifica técnicamente nuestro subsistema **Canyon-TRN** ejecutado como nodo ROS 2 en Rust (`rclrs`): cómo un Filtro de Kalman Extendido implementado con **`nalgebra`** fusiona la IMU del traje, Odometría Visual-Inercial (VIO) + LiDAR corto alcance y el algoritmo de **Skyline Matching** (que extrae el perfil de cresta de las paredes de 7 km de Melas Chasma con la cámara del casco y lo alinea con el horizonte sintético precalculado del DEM de MOLA), logrando precisión submétrica (<0.5 m) en total aislamiento. Incluye un diagrama Mermaid.js del flujo de fusión de sensores.
```

---

### 🔹 PROMPT 2 (Fase 2B): Motor Estocástico Multi-Amenaza (Markov/Poisson) y Algoritmo D* Lite Metabólico en Rust
*(Copia y pega este bloque en tu IA después de recibir la respuesta del Prompt 1)*

```text
Excelente. Ahora vamos a desarrollar la Sección 3 de nuestro Entregable de Arquitectura Técnica para "R.E.D. ATLAS": la formulación matemática y algorítmica del **Motor Estocástico de Amenazas Combinadas** y del **Planificador Dinámico de Rutas EVA (D* Lite Metabólico)** implementados en Rust (y compilados a WASM para el simulador "Chaos Mode" de la Consola de Base).

Necesito que redactes con rigor matemático e ingeniería aeroespacial (usando fórmulas LaTeX y diagramas Mermaid.js):

1. MOTOR ESTOCÁSTICO MULTI-AMENAZA BASADO EN CADENAS DE MARKOV Y PROCESOS DE POISSON ESPACIALES:
   - Nuestro crate en Rust permite simular (tanto en el "Chaos Mode" WASM de la Consola de Base en React como en el traje EVA) la aparición aleatoria de **1, 2 o más amenazas simultáneas**:
     * $H_1$: Tormenta de polvo / vientos catabáticos del cañón.
     * $H_2$: Evento de Partículas Solares (SPE - Radiación aguda).
     * $H_3$: Trampa geomorfológica (baja inercia térmica THEMIS <150 TIU + pendiente >20°).
     * $H_4$: Sombra de comunicaciones (corte de sesión Eclipse Zenoh NLOS con la Base).
   - Formula matemáticamente la matriz de transición de Markov y las tasas de disparo $\lambda(x, y, t)$ condicionadas por la celda hexagonal `h3o` en Melas Chasma y la hora solar marciana (explicando por qué las amenazas están correlacionadas físicamente y cómo actualizan de forma *thread-safe* en Rust los pesos de la malla).

2. FORMULACIÓN MATEMÁTICA DEL ALGORITMO "D* LITE METABÓLICO" Y BARRA "WALKBACK LIMIT DUAL":
   - Explica por qué ejecutamos **A* Multicriterio** en el Servidor de la Base (Rust nativo) para la planificación inicial y **D* Lite (Dynamic A*)** en el nodo ROS 2 del traje EVA para recalcular rutas (medido en el motor: 17 ms en un corredor de ±200 m sobre la malla real) con búferes pre-asignados (*zero-allocation hot loop* en Rust) cuando estallan varias amenazas en vivo.
   - Escribe la ecuación explícita de la **Función de Coste Dinámica $C(u, v, t)$** para transitar entre dos hexágonos `h3o` adyacentes $u \to v$:
     * Incluye la ecuación biomecánica de gasto metabólico en gravedad marciana ($g = 3.72\text{ m/s}^2$) en función de la masa del astronauta con traje, la pendiente $\theta$ (MOLA/HiRISE) y el coeficiente de hundimiento del suelo derivado de la inercia térmica $I$ (THEMIS).
     * Incluye el término de dosis de radiación acumulada $D_{\text{rad}}(t)$ modulado por el *Sky View Factor* (apantallamiento topográfico de las paredes de Melas Chasma).
     * Incluye la penalización por opacidad de polvo $\tau$ y viento frontal.
   - Formula cómo se calculan en cada ciclo los dos umbrales de la **Barra "Walkback Limit Dual"** que se envían al HUD de la Persona 2:
     * $T_{\text{walkback, Base}}$ vs. $T_{\text{walkback, Shelter (WP3)}}$.
   - Define la condición lógica exacta del **Cambio Automático de Destino ("Dynamic Goal Switching")**: cuando el impacto combinado de amenazas hace que el coste metabólico o el tiempo de exposición a radiación hacia la Base supere el margen vital del traje, el algoritmo conmuta instantáneamente el nodo objetivo $G_{\text{target}}$ de la Base al **Waypoint 3 (Oquedad/Escarpe de Refugio)** y exporta la nueva ruta en formato GeoJSON/AR. Incluye un diagrama de flujo en sintaxis Mermaid.js de esta lógica de decisión.
```

---

### 🔹 PROMPT 3 (Fase 3): Copiloto IA Neuro-Simbólico Offline en Rust (`Candle` / `ort` + `whisper-rs`) y "Fusión de Alerta Única"
*(Copia y pega este bloque en tu IA para cerrar la arquitectura de IA)*

```text
Ahora genera la Sección 4 (Final) del Entregable de la Persona 3 para "R.E.D. ATLAS": la especificación de ingeniería del **Copiloto IA Neuro-Simbólico 100% Offline** ejecutado en Rust dentro del traje EVA y su integración con el HUD AR durante una multiemergencia.

Desarrolla con máximo detalle técnico:

1. ¿POR QUÉ ARQUITECTURA NEURO-SIMBÓLICA EN RUST PARA MARTE? (SEGURIDAD DETERMINISTA + EDGE AI):
   - Explica por qué un LLM puro en Python sería inviable en un traje espacial (riesgo de alucinación, alto consumo de RAM/batería y latencia del intérprete) y por qué no podemos usar la nube terrestre (4 a 22 minutos de retardo de luz).
   - Diseña (con un diagrama de arquitectura en sintaxis Mermaid.js) nuestro motor híbrido **Neuro-Simbólico en el Borde escrito en Rust**:
     * **Capa Simbólica Determinista (Rust Safety Guardrail & FSM):** Máquina de estados finitos en Rust con sistema de tipos estricto (*zero-panic*, verificada en compilación) que monitorea a 100 Hz sobre ROS 2 (`rclrs`) la biometría del traje, la barra "Walkback Limit Dual", el dosímetro de radiación y la salida del motor D* Lite. Garantiza 0% de alucinaciones en decisiones de supervivencia.
     * **Capa Neuronal Ligera Local (Hugging Face `Candle` / ONNX Runtime `ort` en Rust + `whisper-rs`):** Modelo compacto cuantizado a 4 bits (GGUF/ONNX) ejecutado en la NPU de bajo consumo (<5 Watts) del traje espacial junto con **`whisper-rs`** para transcripción de voz manos libres offline y síntesis de voz táctica.

2. ALGORITMO DE TRIAJE COGNITIVO Y "FUSIÓN DE ALERTA ÚNICA" (SINGLE-ALERT FUSION):
   - Conecta directamente con el diseño UX de la Persona 2 y el escenario de la Persona 1: en el minuto T+105 de la EVA en Melas Chasma, coinciden 4 eventos (Corte de radio Zenoh NLOS + Suelo blando de 110 TIU en pendiente de 22° + Alerta de Radiación Solar SPE + Ráfagas de polvo).
   - Explica el pipeline técnico en Rust mediante el cual la capa simbólica recibe esos 4 vectores de alarma simultáneos, aplica una matriz de prioridad de supervivencia, actualiza el estado del sendero AR en el visor del casco (de cian a rojo/ámbar hacia el Refugio WP3) y pasa un *prompt estructurado de contexto* al motor `Candle` para sintetizar **una única instrucción de voz de menos de 8 segundos** con entonación calmada.
   - Incluye una tabla técnica de especificaciones de Hardware/Software embebido del nodo del traje EVA (presupuesto de memoria RAM/VRAM en MB gracias a Rust, consumo en Watts, latencia de inferencia en ms y tolerancia a radiación espacial SEU).
```
