# 🏆 FASE 4 (Conjunta): Entrega Oficial NASA Space Apps, Pitch Deck/Vídeo y Defensa ante el Jurado
**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*) — Equipo **Red Project**

Una vez que **Persona 1**, **Persona 2** y **Persona 3** hayan ejecutado los prompts de sus respectivas carpetas, usen estos **3 Prompts de Cierre** y peguen los resultados en:
* [`SPACE_APPS_SUBMISSION.md`](./SPACE_APPS_SUBMISSION.md) (Salida del Prompt Cierre 1)
* [`PITCH_AND_QA_DEFENSE.md`](./PITCH_AND_QA_DEFENSE.md) (Salidas de los Prompts Cierre 2 y 3)

---

## 📋 PROMPT CIERRE 1 — Respuestas Oficiales para la Página de Entrega de NASA Space Apps

```text
Actúa como Mentor Oficial y Juez Global del NASA Space Apps Challenge.
Nuestro equipo "Red Project" participa en el reto "Interplanetary Survival Guide: Martian Map" con el proyecto **R.E.D. ATLAS (Reconnaissance, EVA & Dynamic-survival Atlas)**.

Aquí tienes el resumen técnico y el STACK TECNOLÓGICO UNIFICADO de nuestra solución diseñada por nuestros 3 especialistas:
1. Escenario Científico y Datos NASA (Persona 1): Fondo del cañón de Valles Marineris — Melas Chasma (~9.9°S, 283.4°E). Trazamos la ruta "Triángulo de Supervivencia" (Base -> WP1 Depósito de Sulfatos con Agua ISRU -> WP2 Talud/Falla peligrosa con pendiente >20° y regolito blando -> WP3 Oquedad en escarpe vertical para refugio contra radiación y tormentas). Procesamos con Python (GDAL/Rasterio/PDS4-tools) 6 capas reales de la NASA hacia Cloud-Optimized GeoTIFF (COG), GeoJSON y Apache Parquet: MGS MOLA/HRSC, MRO HiRISE, Mars Odyssey THEMIS IR, MRO CRISM/SHARAD, MRO MCS/MEDA y MSL RAD.
2. Experiencia de Producto y UX/UI (Persona 2): "Ecosistema Dual Sincronizado" construido en **TypeScript + React + CesiumJS + Three.js (WebGL/WebGPU Shaders) + TailwindCSS + Rust WebAssembly (WASM)**:
   - Consola Estratégica 3D en el Hábitat con una Lupa Espacial ("Spyglass") renderizada mediante un shader circular dividido en 3 sectores tipo radar (Agua CRISM + Arena THEMIS + Pendiente MOLA) y un simulador "Chaos Mode" en Rust WASM que somete la ruta a estrés pre-EVA.
   - Modo Táctico EVA en el traje espacial con HUD AR minimalista en el casco, Mapa completo en Tablet de Muñeca, Barra superior dinámica de "Walkback Limit Dual" (límite de retorno a Base vs. escape a Refugio) y protocolo de "Triaje de Fusión de Alerta Única" (el sendero AR cambia de color hacia el refugio + 1 orden por voz manos libres para evitar el pánico ante emergencias múltiples).
3. Arquitectura Técnica en Rust e IA Offline (Persona 3): "Arquitectura C (Híbrida Dual)" con núcleo de misión crítica escrito en **Rust** (*memory-safe*, determinista, sin Garbage Collector):
   - Servidor en Base: **Rust (`Tokio`, `Axum`, crate `h3o` para Malla Hexagonal H3 IAU Mars 2000 y `DuckDB Spatial`)**.
   - Nodo Edge en el Traje EVA (100% Offline): **ROS 2 con cliente nativo en Rust (`rclrs`) + protocolo espacial Eclipse Zenoh** (reconexión automática tras sombras de radio por las paredes de 7 km de Melas Chasma). Incluye posicionamiento sin GPS **"Canyon-TRN"** en Rust (`nalgebra` EKF + VIO + LiDAR + *Skyline Matching* contra los muros de MOLA), algoritmo de rutas **"D* Lite Metabólico"** en Rust con *Dynamic Goal Switching* (cambio automático de destino a refugio), **"Motor Estocástico Multi-Amenaza"** (Markov/Poisson espacial) y **"Copiloto IA Neuro-Simbólico Offline"** ejecutado en Rust con **Hugging Face `Candle` / ONNX Runtime (`ort`) + `whisper-rs`**.

Redacta (en inglés y en español, listos para copiar y pegar en la web oficial de NASA Space Apps) todos los campos obligatorios del formulario del proyecto:
1. High-Level Project Summary (máximo 150 palabras, ultra impactante).
2. Detailed Project Description (Qué problema resuelve, por qué Melas Chasma, cómo funciona el Ecosistema Dual y por qué salva la vida de los futuros astronautas).
3. How It Works & Technical Implementation (Destacando el stack Rust + ROS 2/Zenoh + React/CesiumJS/Three.js + Malla Hexagonal `h3o` + Canyon-TRN + Simulador Estocástico Multi-Amenaza).
4. NASA & Space Agency Data Used (Lista detallada de las misiones e instrumentos exactos de la NASA utilizados, sus formatos COG/Parquet/GeoJSON y qué aporta cada uno).
5. Use of Artificial Intelligence Disclosure (Declaración transparente y profesional de cómo se usa la IA tanto en la arquitectura Neuro-Simbólica en Rust del traje como en nuestra metodología de diseño asistido por IA).
```

---

## 📋 PROMPT CIERRE 2 — Estructura Diapositiva por Diapositiva del Pitch Deck + Guion de Vídeo (Repartido para los 3 Miembros)

```text
Actúa como Director de Comunicación Aeroespacial y Coach de Pitch para ganadores globales del NASA Space Apps Challenge.
Nuestro equipo de 3 personas ("Red Project") va a presentar **R.E.D. ATLAS (Reconnaissance, EVA & Dynamic-survival Atlas)** para el reto "Interplanetary Survival Guide: Martian Map".
Los 3 integrantes son:
- Persona 1: Especialista en Ciencia Planetaria, Datos NASA (COG/Parquet/GeoJSON) y Escenario en Valles Marineris (Melas Chasma).
- Persona 2: Especialista en Producto, UX/UI (Ecosistema Dual en React + CesiumJS + Three.js: Consola 3D con Lupa "Spyglass" de 3 sectores + HUD AR con "Walkback Limit Dual" y Triaje de Alerta Única).
- Persona 3: Especialista en Arquitectura Técnica en Rust e IA (Motor en Rust con `h3o`, ROS 2 `rclrs` + Eclipse Zenoh, Posicionamiento sin GPS "Canyon-TRN" por Skyline Matching, Motor Estocástico Multi-Amenaza Markov/Poisson, Algoritmo D* Lite Metabólico con Dynamic Goal Switching y Copiloto IA Neuro-Simbólico Offline con `Candle`/`ort` + `whisper-rs`).

Genera dos entregables listos para producir nuestra presentación:
1. ESTRUCTURA DEL PITCH DECK (10 DIAPOSITIVAS DE ALTO IMPACTO):
   Para cada diapositiva indica: Título, Qué elemento visual/diagrama Mermaid.js de nuestros entregables poner en pantalla, Puntos clave (máximo 3 bullets) y Quién de los 3 la presenta.
2. GUION CRONOMETRADO EN DOS VERSIONES (VÍDEO CORTO DE 30 SEGUNDOS + PRESENTACIÓN COMPLETA DE 3 MINUTOS / 180 SEGUNDOS):
   - Reparte el tiempo equitativamente entre Persona 1, Persona 2 y Persona 3.
   - Escribe el texto exacto que dice cada uno (con marcas de tiempo [00:00 - 00:30], tono dramático/profesional estilo misión de la NASA y qué se muestra visualmente mientras habla).
   - Incluye en el clímax del guion la demostración del "Caso de Uso en Melas Chasma": cuando el astronauta pierde la radio Zenoh tras un muro del cañón y el motor estocástico dispara a la vez Radiación Solar (SPE) + Tormenta de Polvo, mostrando cómo el motor en Rust de R.E.D. ATLAS le salva la vida desviándolo en 17 ms al refugio natural en el escarpe.
```

---

## 📋 PROMPT CIERRE 3 — Guía de Defensa ante el Jurado (Q&A de Ciencia, UX/UI y Arquitectura en Rust)

```text
Actúa como un panel exigente de Jueces de la NASA (compuesto por un Científico Planetario del JPL, un Ingeniero de Trajes Espaciales EVA de Johnson Space Center y un Arquitecto de Software de Vuelo en Rust/IA Aeroespacial).
Acabamos de presentar nuestro proyecto **R.E.D. ATLAS** (del equipo "Red Project") ambientado en **Valles Marineris (Melas Chasma)** para el reto "Interplanetary Survival Guide: Martian Map".

Genera una "Guía de Defensa Imbatible ante el Jurado" con las **12 preguntas más difíciles y técnicas** que nos pueden hacer los jueces (4 para la Persona 1 de Ciencia/Datos NASA, 4 para la Persona 2 de UX/UI/Factores Humanos en React/CesiumJS/HUD AR, y 4 para la Persona 3 de Arquitectura en Rust/ROS 2/Algoritmos/IA), junto con la **Respuesta Magistral** para cada una, incluyendo datos numéricos reales:
- Ejemplos de dudas de Ciencia (P1): "¿Por qué aterrizar o hacer una EVA en Melas Chasma si las paredes dificultan las comunicaciones?", "¿Cómo distinguen con THEMIS si una pendiente de 20° es roca firme o arena movediza marciana?", "¿Cómo protege exactamente una pared del cañón contra un Evento de Partículas Solares (SPE)?".
- Ejemplos de dudas de UX/UI (P2): "¿No marea o distrae al astronauta proyectar capas de la NASA en el casco AR?", "¿Qué pasa si el astronauta entra en pánico cuando saltan 3 alertas a la vez?", "¿Cómo renderizan en el navegador la Lupa Spyglass de 3 sectores sin perder FPS en CesiumJS/Three.js?".
- Ejemplos de dudas de Arquitectura e IA (P3): "¿Por qué eligieron Rust, ROS 2 `rclrs` y Eclipse Zenoh para el traje EVA en lugar de Python o C++ tradicional?", "¿Cómo se posiciona el traje en el fondo del cañón con Canyon-TRN si en Marte no hay GPS y además pierden la radio con la Base?", "¿Cómo evitan con Rust + Candle que la IA alucine una ruta mortal o agote la batería del traje?".
```
