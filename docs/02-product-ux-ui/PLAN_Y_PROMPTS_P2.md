# 🎨 Carril 2: Producto, UX/UI y Sistema Visual Multicapa (Persona 2)
**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*) — Equipo **Red Project**  
**Entregable destino:** [`ENTREGABLE_2_PRODUCTO_UX_UI.md`](./ENTREGABLE_2_PRODUCTO_UX_UI.md)

---

## ✅ Decisiones y Stack Tecnológico Cerrados para Persona 2 (Checkpoints 1, 2 y 3)

* **Nombre del Sistema:** **R.E.D. ATLAS**
* **Escenario:** **Valles Marineris — Melas Chasma** (Ruta *"Triángulo de Supervivencia"*: Base -> WP1 Agua ISRU -> WP2 Talud/Falla peligrosa -> WP3 Escarpe/Oquedad de Refugio).
* **Stack de Frontend, 3D y Visualización que debe mencionar tu IA:**
  * **Consola 3D de Base y Simulador Web:** **TypeScript + React + CesiumJS (3D Tiles / DEM de Melas Chasma) + Three.js (Custom Shaders en WebGL / WebGPU para la Lupa Espacial *"Spyglass"* de 3 sectores) + TailwindCSS**.
  * **Puente con el Motor Core en Rust:** El frontend consume el motor algorítmico escrito en **Rust** compilado a **WebAssembly (WASM)** (en el navegador/consola) y se comunica con el nodo del traje EVA mediante **ROS 2 (`rclrs`) + Eclipse Zenoh**.
  * **Formatos de Datos Visualizados:** Capas raster en **Cloud-Optimized GeoTIFF (COG)**, rutas/waypoints en **GeoJSON** y atributos de la malla hexagonal (`h3o`) en **Apache Parquet / JSON**.
  * **Diagramas:** Todos los flujos de usuario y arquitecturas de pantallas deben generarse en **Mermaid.js** embebido en Markdown + Wireframes en arte ASCII.

---

## 📋 SECUENCIA DE PROMPTS PARA PERSONA 2 (Fase 2 y Fase 3)

Copia y pega estos prompts en orden dentro de tu propio chat de IA y pega los resultados en [`ENTREGABLE_2_PRODUCTO_UX_UI.md`](./ENTREGABLE_2_PRODUCTO_UX_UI.md).

---

### 🔹 PROMPT 1 (Fase 2A): User Personas, Ergonomía Marciana y Flujo de Usuario Dual
*(Copia y pega este bloque en tu IA)*

```text
Actúa como Principal UX/UI Designer de interfaces de misión crítica en la NASA (Human Systems Integration Division).
Estamos desarrollando el proyecto "R.E.D. ATLAS" (Reconnaissance, EVA & Dynamic-survival Atlas) del equipo "Red Project" para el reto "Interplanetary Survival Guide: Martian Map" de NASA Space Apps.
Nuestro objetivo es diseñar una especificación de producto y UX/UI exhaustiva y profesional (sin escribir código fuente de programación, pero especificando la arquitectura de componentes UI, shaders y flujos).

Nuestro equipo ha fijado las siguientes decisiones y STACK TECNOLÓGICO UNIFICADO que debes reflejar en tu respuesta:
- Escenario (Persona 1): Fondo del cañón de Valles Marineris — Melas Chasma, trazando la ruta "Triángulo de Supervivencia" (Base -> WP1 Sulfatos con Agua ISRU -> WP2 Falla/Talud peligroso >20° -> WP3 Oquedad de Refugio en pared del cañón). Los datos de la NASA se sirven en Cloud-Optimized GeoTIFF (COG), GeoJSON y Apache Parquet.
- Stack Frontend y 3D (Persona 2): TypeScript + React + CesiumJS (para renderizar el terreno 3D de Melas Chasma) + Three.js (usando WebGL/WebGPU custom shaders para la Lupa Espacial "Spyglass" de 3 sectores y el sendero AR) + TailwindCSS + módulos de cálculo en Rust compilados a WebAssembly (WASM).
- Stack de Arquitectura e IA (Persona 3): Núcleo en Rust (`h3o` para Malla Hexagonal H3, `Tokio/Axum`), nodo del traje EVA sobre ROS 2 en Rust (`rclrs` + protocolo Eclipse Zenoh para radio intermitente), posicionamiento sin GPS "Canyon-TRN" (Skyline Matching), algoritmo de rutas D* Lite Metabólico en Rust con "Dynamic Goal Switching" y Copiloto IA Neuro-Simbólico Offline (`Candle` / ONNX Runtime `ort` + `whisper-rs`).
- Formato de Diagramas: Usa exclusivamente bloques `mermaid` (Mermaid.js) embebidos en Markdown.

Genera la Sección 1 y 2 de nuestro Entregable de Producto y UX/UI con el máximo nivel de detalle:

1. USER PERSONAS Y RESTRICCIONES ERGONÓMICAS EN MELAS CHASMA:
   Crea 2 fichas completas de User Personas:
   - Persona A: "Comandante / Especialista GIS de Hábitat" (opera la Consola 3D de Base en React + CesiumJS + Three.js para planificar rutas EVA y localizar recursos ISRU).
   - Persona B: "Astronauta Geólogo en EVA" (camina por el fondo de Melas Chasma con traje presurizado rígido, guantes gruesos que impiden gestos táctiles finos, iluminación cambiante por brumas/polvo del cañón y riesgo de quedarse incomunicado por las paredes de 7 km).
   Incluye una tabla de "Restricciones Físicas del Traje/Entorno -> Solución de Diseño UX y Tecnológica en R.E.D. ATLAS".

2. SISTEMA DE DISEÑO VISUAL (DESIGN SYSTEM EN TAILWINDCSS + WEBGL/AR) PARA SUPERFICIE MARCIANA:
   Especifica la paleta de colores de alto contraste optimizada para no confundirse con el terreno rojizo/ocre de Marte (con códigos HEX, tokens de TailwindCSS y justificación óptica para HUD waveguide AR), jerarquía tipográfica legible bajo vibración, y el sistema multimodal (Voz manos libres procesada con `whisper-rs` + Audio espacial 3D en auriculares del casco + Háptica en muñeca).

3. ARQUITECTURA DE INFORMACIÓN Y FLUJO DE USUARIO COMPLETO (USER FLOW EN MERMAID.JS):
   Genera un diagrama de flujo detallado en sintaxis Mermaid.js y explícalo paso a paso cubriendo el ciclo completo:
   Fase Pre-EVA en Consola Base (Exploración de capas COG con Lupa Spyglass en CesiumJS/Three.js -> Trazado GeoJSON del Triángulo de Supervivencia -> Test en "Chaos Mode" ejecutado en Rust WASM -> Sincronización vía Eclipse Zenoh al Traje) ---> Fase In-EVA Nominal (HUD AR Cian + Walkback Limit Dual hacia WP1 y WP2) ---> Fase de Multiemergencia Simultánea (Corte de radio NLOS + Alerta de Radiación SPE + Polvo -> Dynamic Goal Switching en Rust -> Triaje de Alerta Única hacia Refugio WP3).
```

---

### 🔹 PROMPT 2 (Fase 2B): Especificación y Wireframes de la Consola 3D de Base (React + CesiumJS + Three.js "Spyglass" + "Chaos Mode")
*(Copia y pega este bloque en tu IA después de recibir la respuesta del Prompt 1)*

```text
Excelente. Ahora vamos a desarrollar la Sección 3 de nuestro Entregable de UX/UI para "R.E.D. ATLAS": la especificación funcional, de componentes (React + CesiumJS + Three.js + Rust WASM) y visual de la **Consola Estratégica 3D de Base (Hábitat)**.

Necesito que diseñes con nivel de especificación de ingeniería de producto (incluyendo esquemas visuales detallados en arte ASCII y diagramas de jerarquía de componentes en Mermaid.js):

1. PANTALLA 1 (CONSOLA BASE): EXPLORADOR 3D DE MELAS CHASMA Y LUPA ESPACIAL "SPYGLASS" DE 3 SECTORES:
   - Dibuja un Wireframe ASCII de pantalla completa (aspect ratio 16:9 / Ultrawide de centro de control) mostrando la disposición exacta de paneles.
   - Detalla el diseño interactivo y cómo se renderiza con un **Custom Post-Processing Shader en Three.js / WebGPU sobre CesiumJS** nuestra herramienta insignia: la **Lupa Espacial "Spyglass" Multicapa Dividida**. Explica cómo al posar el círculo sobre el modelo 3D fotorealista de Melas Chasma (capas Cloud-Optimized GeoTIFF de HiRISE + MOLA + celdas hexagonales `h3o`), el usuario puede alternar entre "Modo Rayos X de 1 Capa" o el **"Modo Radar Tri-Sector (120° cada sector)"**:
     * Sector Norte (120°): Capa CRISM/SHARAD (resaltando en azul eléctrico los depósitos de sulfatos polihidratados con agua en el WP1).
     * Sector Derecha (120°): Capa THEMIS de Inercia Térmica (resaltando en magenta/naranja las trampas de polvo suelto <150 TIU en el WP2).
     * Sector Izquierda (120°): Capa MOLA/HiRISE DTM + Sky View Factor (mostrando pendientes >20° y zonas de blindaje contra radiación / sombras de radio en el WP3).

2. PANTALLA 2 (CONSOLA BASE): PLANIFICADOR METABÓLICO DE RUTA Y SIMULADOR "CHAOS MODE" (RUST WASM):
   - Dibuja el Wireframe ASCII del panel inferior/lateral de planificación del "Triángulo de Supervivencia" (exportable en GeoJSON).
   - Explica cómo se visualiza el perfil de elevación, la gráfica predictiva de consumo metabólico de O2/agua/batería y la cobertura de radio Zenoh con la Base.
   - Especifica cómo funciona el botón **"Chaos Mode (Stress-Test Estocástico en Rust WASM)"**: qué ve el planificador en pantalla cuando pulsa este botón y el módulo en Rust simula a velocidad nativa 100 escenarios aleatorios (Markov/Poisson) de tormentas, picos de radiación solar y avalanchas, certificando en verde que el Waypoint 3 (Escarpe/Oquedad) garantiza la supervivencia en el 99.4% de los casos.
   - Incluye un diagrama Mermaid.js del árbol de componentes React (`<BaseConsoleApp>`, `<CesiumMelasGlobe>`, `<ThreeSpyglassShader>`, `<ChaosModeSimulatorWasm>`, etc.).
```

---

### 🔹 PROMPT 3 (Fase 3): Especificación y Wireframes del Modo Táctico EVA (HUD AR, "Walkback Limit Dual" y Triaje Anti-Pánico)
*(Copia y pega este bloque en tu IA para generar la especificación del traje EVA)*

```text
Ahora genera la Sección 4 (Final) del Entregable de la Persona 2 para "R.E.D. ATLAS": la especificación funcional y visual del **Modo Táctico EVA (HUD del Casco en Realidad Aumentada + Tablet de Muñeca)** conectado al nodo local ROS 2 en Rust (`rclrs`) durante la caminata en Melas Chasma.

Desarrolla con máximo rigor visual y ergonómico:

1. PANTALLA 3 (MODO EVA - ESTADO NOMINAL): HUD AR MINIMALISTA Y BARRA "WALKBACK LIMIT DUAL":
   - Dibuja el Wireframe ASCII de la vista a través del visor del casco del astronauta caminando hacia el Waypoint 1/2.
   - Detalla la anatomía exacta de la **Barra Superior "Walkback Limit Dual"** alimentada en tiempo real por el algoritmo D* Lite Metabólico en Rust: cómo representa en una sola línea visual:
     a) El porcentaje actual de consumibles críticos ($O_2$ restante, batería, agua de refrigeración).
     b) La Marca 1 ("Límite de Retorno a Base"): el punto de no retorno calculado según el coste metabólico de volver al Hábitat.
     c) La Marca 2 ("Límite de Escape a Refugio WP3"): el margen adicional de supervivencia gracias a tener la oquedad del escarpe a solo 600 m.
   - Describe cómo se proyecta en el suelo marciano el sendero luminoso AR (renderizado con Three.js/WebGL en color cian en estado nominal) y qué información complementaria queda relegada a la **Tablet de Muñeca** (incluyendo su Wireframe ASCII con botones sobredimensionados para guantes presurizados).

2. PANTALLA 4 (MODO EVA - ESTADO DE MULTIEMERGENCIA SIMULTÁNEA Y TRIAJE DE FUSIÓN DE ALERTA ÚNICA):
   - Escenario: El astronauta está cerca del Waypoint 2, pierde la sesión de radio Eclipse Zenoh con la Base (Sombra de Radio NLOS, activando el icono de modo autónomo "Canyon-TRN Rust Offline"), pisa regolito blando en pendiente de 22° y en ese instante el entorno dispara a la vez **Alerta de Radiación Solar (SPE)** + **Viento Catabático de Polvo**.
   - Dibuja el Wireframe ASCII del HUD en este estado crítico.
   - Explica nuestra innovación UX clave: el **Protocolo de Triaje "Fusión de Alerta Única" (Anti-Pánico)**:
     * Por qué mostrar 4 pop-ups de error mataría al astronauta por bloqueo cognitivo.
     * Cómo el HUD fusiona las amenazas: la barra "Walkback Limit Dual" muestra que la Base queda bloqueada/fuera de tiempo (en gris/rojo tachado) y activa automáticamente el tramo hacia el **Refugio WP3 (Escarpe a 8 min)**; el sendero AR sobre el suelo cambia a chevrones rojo/ámbar pulsantes guiando los pies del astronauta fuera de la trampa de arena hacia la pared del cañón; y el Copiloto IA Neuro-Simbólico (`Candle` + `whisper-rs`) emite por voz manos libres un único mensaje estructurado de 8 segundos (Situación + Acción + Tiempo al refugio).
   - Incluye una tabla comparativa del estado de cada widget UI entre "Modo Nominal", "Modo Precaución (1 amenaza)" y "Modo Supervivencia Crítica (Multiemergencia + Offline)" y un diagrama de estados UI en sintaxis Mermaid.js (`stateDiagram-v2`).
```
