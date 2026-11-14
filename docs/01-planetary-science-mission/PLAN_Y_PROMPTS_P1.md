# 🧑‍🚀 Carril 1: Ciencia Planetaria, Datos NASA y Escenario de Misión (Persona 1)
**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*) — Equipo **Red Project**  
**Entregable destino:** [`ENTREGABLE_1_CIENCIA_Y_MISION.md`](./ENTREGABLE_1_CIENCIA_Y_MISION.md)

---

## ✅ Decisiones y Stack Tecnológico Cerrados para Persona 1 (Checkpoints 1, 2 y 3)

* **Nombre del Sistema:** **R.E.D. ATLAS**
* **Región Marciana:** **Valles Marineris — Melas Chasma** (~9.8°S, 283.6°E). Cañón de 7–9 km de desnivel con antiguos depósitos lacustres, capas de sulfatos hidratados, taludes de deslizamiento y sombras severas de comunicación.
* **Trazado de la Misión:** **Ruta "Triángulo de Supervivencia" (4–5 km en el fondo de Melas Chasma)**:
  1. **Base (Hábitat):** Terraza aluvial estable en el piso del cañón.
  2. **Waypoint 1 (ISRU / Agua):** Afloramiento de sulfatos polihidratados (extracción de agua in-situ).
  3. **Waypoint 2 (Geología / Peligro):** Borde de falla y talud de deslizamiento con pendiente $>20^\circ$ y regolito fino.
  4. **Waypoint 3 (Refugio Natural):** Oquedad/fractura bajo un escarpe vertical masivo de la pared del cañón que ofrece blindaje topográfico contra radiación solar y tormentas.
* **Stack de Datos y Herramientas que debe mencionar tu IA:**
  * **Preprocesado Científico NASA:** **Python (`GDAL`, `Rasterio`, `PDS4-tools`)** convirtiendo los archivos crudos del PDS de la NASA a **Cloud-Optimized GeoTIFF (COG)** para rasters, **GeoJSON** para los *Waypoints*/rutas y **Apache Parquet** para los atributos tabulares.
  * **Indexación y Motor Core (Persona 3):** **Rust (`h3o` para la Malla Hexagonal H3 IAU Mars 2000)** + **ROS 2 en Rust (`rclrs` / `Eclipse Zenoh`)** en el traje EVA.
  * **Visualización (Persona 2):** **TypeScript + React + CesiumJS / Three.js (WebGL/WebGPU)** para la Lupa Espacial *Spyglass* de 3 sectores.
  * **Diagramas:** Todo diagrama debe generarse en **Mermaid.js** embebido en Markdown.

---

## 📋 SECUENCIA DE PROMPTS PARA PERSONA 1 (Fase 2 y Fase 3)

Copia y pega estos prompts en orden dentro de tu propio chat de IA y pega los resultados en [`ENTREGABLE_1_CIENCIA_Y_MISION.md`](./ENTREGABLE_1_CIENCIA_Y_MISION.md).

---

### 🔹 PROMPT 1 (Fase 2A): Cartografía NASA, Formatos COG/Parquet/GeoJSON y Coordenadas en Melas Chasma
*(Copia y pega este bloque en tu IA)*

```text
Actúa como Especialista Senior en Cartografía Planetaria del JPL de la NASA y Geólogo Experto en Valles Marineris.
Estamos desarrollando el proyecto "R.E.D. ATLAS" (Reconnaissance, EVA & Dynamic-survival Atlas) del equipo "Red Project" para el reto "Interplanetary Survival Guide: Martian Map" de NASA Space Apps.
Nuestro objetivo es diseñar una especificación científica y técnica 100% rigurosa (sin escribir código fuente de programación, pero especificando formatos de datos y parámetros exactos).

Nuestro equipo ha fijado las siguientes decisiones y STACK TECNOLÓGICO UNIFICADO que debes usar en toda tu respuesta:
- Región: Fondo del cañón de Valles Marineris — Melas Chasma (entorno a 9.8°S, 283.6°E).
- Ruta elegida: "Triángulo de Supervivencia" (recorrido EVA de 4 a 5 km en total).
- Stack de Ingeniería de Datos NASA: Preprocesamiento con Python (GDAL, Rasterio, PDS4-tools) convirtiendo los productos PDS de la NASA a rasters Cloud-Optimized GeoTIFF (COG), vectores GeoJSON (para Waypoints y rutas) y tablas columnares Apache Parquet que se indexan en nuestro motor central escrito en Rust (usando el crate `h3o` para una Malla Hexagonal H3 sobre el elipsoide IAU Mars 2000 y DuckDB Spatial).
- Stack UX/UI (Persona 2): Consola 3D de Base en TypeScript + React + CesiumJS + Three.js (con un shader WebGPU para la "Lupa Espacial Spyglass" dividida en 3 sectores: Agua CRISM + Trampas de Arena THEMIS + Pendiente MOLA) y un simulador "Chaos Mode". En EVA: HUD AR minimalista + Tablet de muñeca + Barra "Walkback Limit Dual".
- Stack del Traje EVA (Persona 3): Nodo autónomo en Rust sobre ROS 2 (`rclrs` + protocolo Eclipse Zenoh para radio intermitente), posicionamiento sin GPS "Canyon-TRN" (usando `nalgebra` EKF + Skyline Matching contra las paredes de 7 km de Melas Chasma), algoritmo de rutas D* Lite Metabólico en Rust y Copiloto IA Neuro-Simbólico Offline (`Candle` / ONNX Runtime `ort` + `whisper-rs`).
- Formato de Diagramas: Usa exclusivamente bloques `mermaid` (Mermaid.js) embebidos en Markdown.

Genera la Sección 1 y 2 de nuestro Entregable Científico con el máximo nivel de detalle:

1. COORDENADAS PLANETOCÉNTRICAS REALES (ESQUEMA GEOJSON) Y GEOLOGÍA DEL "TRIÁNGULO DE SUPERVIVENCIA":
   Define con coordenadas exactas realistas en Melas Chasma (Latitud, Longitud, Elevación en metros respecto al datum MOLA, pendiente local e inercia térmica estimada) los 4 nodos de nuestra ruta:
   - Nodo 0 (Base / Hábitat): En una terraza aluvial plana y segura del fondo de Melas Chasma.
   - Waypoint 1 (Objetivo ISRU - Extracción de Agua): A ~1.5 km de la Base, en un depósito estratificado interior (Interior Layered Deposits) rico en sulfatos polihidratados (kieserita/yeso) detectado por CRISM. Explica cuánta agua (% en peso) se puede extraer y cómo se procesaría.
   - Waypoint 2 (Objetivo Científico y Zona de Alto Riesgo): A ~1.2 km del WP1, en el contacto geológico con un lóbulo de deslizamiento (landslide deposit) y falla tectónica, con pendientes de 18°-26° y bancos de polvo fino.
   - Waypoint 3 (Refugio de Emergencia Topográfico): A ~600 m del WP2, una oquedad/alcoba natural en la base de un escarpe vertical masivo de roca basáltica de la pared del cañón que ofrece blindaje contra radiación solar (SPE) y abrigo contra vientos catabáticos.
   Incluye el esquema de propiedades GeoJSON de estos 4 nodos y un diagrama en sintaxis Mermaid.js que represente el mapa conceptual del "Triángulo de Supervivencia" con distancias, cotas de elevación y riesgos entre cada tramo.

2. TABLA MAESTRA DE DATASETS Y CAPAS DE LA NASA PARA "R.E.D. ATLAS":
   Construye una tabla exhaustiva con las 6 capas oficiales de la NASA que se transforman con GDAL/Rasterio a Cloud-Optimized GeoTIFF (COG) y Apache Parquet para alimentar la Malla Hexagonal Rust (`h3o`) y la Lupa Espacial (Spyglass):
   - Capa 1: Topografía, Pendientes y Horizonte (MGS MOLA + MRO HiRISE DTM + Mars Express HRSC).
   - Capa 2: Ortoimagen Óptica de Obstáculos y Rocas (MRO HiRISE a 0.25 m/px y CTX a 6 m/px).
   - Capa 3: Inercia Térmica y Trampas de Regolito (Mars Odyssey THEMIS IR Día/Noche). Explica con valores reales en TIU (Thermal Inertia Units) cómo distinguimos arena suelta donde se hunde la bota (<150 TIU) de roca consolidada (>400 TIU).
   - Capa 4: Mineralogía e ISRU de Agua/Hielo (MRO CRISM espectrometría visible-infrarrojo + Radar SHARAD para subsuelo).
   - Capa 5: Dinámica Atmosférica, Nieblas y Vientos de Cañón (MRO MCS + TGO NOMAD/OMEGA + modelo mesoescalar basado en sensores MEDA).
   - Capa 6: Radiación y Factor de Visión del Cielo / Sky View Factor (MSL RAD extrapolado a la mayor presión atmosférica del fondo de Melas Chasma + cálculo de apantallamiento por los muros de 7 km).
   Para cada capa especifica: Misión/Instrumento, ID del Producto PDS (ej. RDR/EDR/DTM), Resolución espacial, Formato procesado (COG/Parquet), Unidad física y cómo se visualiza en los 3 sectores de nuestra Lupa "Spyglass" en CesiumJS/Three.js.
```

---

### 🔹 PROMPT 2 (Fase 2B): Matriz de Peligros Simultáneos (Markov/Poisson) y Umbrales Físicos de Supervivencia
*(Copia y pega este bloque en tu IA después de recibir la respuesta del Prompt 1)*

```text
Excelente. Ahora vamos a desarrollar la Sección 3 de nuestro Entregable Científico para "R.E.D. ATLAS": el modelo físico de peligros marcianos y cómo interactúan cuando nuestro "Motor Estocástico Multi-Amenaza" (escrito en Rust) dispara varios eventos a la vez en Melas Chasma.

Necesito que generes con rigor de ingeniería aeroespacial y medicina espacial de la NASA (usando tablas Markdown y diagramas Mermaid.js):

1. TABLA DE UMBRALES BIOMÉDICOS, METABÓLICOS Y AMBIENTALES DEL TRAJE EVA (ESQUEMA APACHE PARQUET / RUST STRUCT):
   Crea una tabla detallada con los valores Nominales (Verde), Precaución (Ámbar) y Críticos/Aborto (Rojo) para un astronauta en Melas Chasma que alimentan la máquina de estados determinista en Rust del traje EVA:
   - Pendiente del terreno (°) y su impacto en la tasa metabólica (Watts y consumo de O2 en L/min a gravedad 0.38g).
   - Inercia Térmica del suelo (TIU de THEMIS) y coeficiente de deslizamiento/hundimiento.
   - Opacidad atmosférica de polvo (Tau a 880 nm) y velocidad del viento catabático (m/s) en el cañón.
   - Tasa de dosis de radiación (mSv/h en GCR de fondo vs. pico durante un Evento de Partículas Solares SPE) y tiempo máximo de exposición antes de alcanzar el límite de misión.
   - Nivel de señal de radio UHF/Wi-Fi (protocolo Eclipse Zenoh sobre ROS 2) con la Base (dBm) y pérdida de línea de visión (NLOS) por obstrucción topográfica de los muros de Melas Chasma.
   - Reservas del traje (Presión de O2, agua de sublimación/refrigeración LCVG, batería en Wh y margen del "Walkback Limit Dual").

2. MATRIZ DE SINERGIA DE AMENAZAS COMBINADAS (MULTI-HAZARD COMBINATIONS):
   En R.E.D. ATLAS, los eventos no ocurren aislados: un proceso estocástico espacial (Markov/Poisson en Rust) los dispara según la ubicación en el cañón y la hora solar marciana. Diseña una tabla y análisis detallado de qué ocurre físicamente y operativamente cuando se combinan:
   - COMBO A (Trampa Táctica): "Trampa de Regolito/Pendiente en WP2" + "Sombra de Radio NLOS (Corte de sesión Zenoh con la Base)".
   - COMBO B (Tormenta en el Abismo): "Vientos Catabáticos y Tormenta de Polvo Local" + "Sobreesfuerzo Metabólico (Contracción rápida del Walkback Limit)".
   - COMBO C (Escenario de Crisis Máxima - Triple Amenaza): "Alerta de Erupción Solar (SPE - Radiación aguda)" + "Sombra de Radio NLOS" + "Ráfagas de Polvo en Tarde Marciana".
   Explica para cada combo por qué volver a la Base (a 2.5 km) resulta letal y cómo el blindaje topográfico del Waypoint 3 (Escarpe/Oquedad a 600 m) salva la vida del astronauta.
```

---

### 🔹 PROMPT 3 (Fase 3): Simulación Cronológica Minuto a Minuto del Caso de Uso "Marswalk" en Melas Chasma
*(Copia y pega este bloque en tu IA para generar la narrativa científica final)*

```text
Ahora genera la Sección 4 (Final) del Entregable de la Persona 1: el "Storyboard Científico y Simulación Minuto a Minuto de la Salida EVA-07 en Melas Chasma" usando R.E.D. ATLAS.

Escribe una simulación técnica inmersiva, cronológica (desde T-45 min hasta T+165 min), dividida en 5 actos, donde se vean en acción todas las piezas y tecnologías acordadas por los 3 miembros del equipo:
- ACTO 1 (T-45 min a T-00 min | En la Consola 3D de la Base — React + CesiumJS + Three.js):
  La tripulación inspecciona los rasters COG del "Triángulo de Supervivencia" en Melas Chasma usando el shader de la Lupa Espacial "Spyglass" dividida en 3 sectores (CRISM, THEMIS, MOLA). Ejecutan el botón "Chaos Mode" (motor Monte Carlo en Rust) para pre-validar que el Waypoint 3 (Escarpe/Oquedad) sirve como refugio de contingencia. Se sincroniza la sub-malla hexagonal (`h3o` en formato Apache Parquet + GeoJSON) al nodo ROS 2 del traje EVA mediante Eclipse Zenoh.
- ACTO 2 (T+00 min a T+75 min | Salida EVA y Éxito ISRU en Waypoint 1):
  Navegación con el HUD AR minimalista (sendero cian sobre el suelo marciano) y la barra "Walkback Limit Dual". Llegada al Waypoint 1, confirmación de sulfatos polihidratados (>12% H2O) guiada por los datos de CRISM pre-cargados.
- ACTO 3 (T+75 min a T+105 min | Avance hacia Waypoint 2 y Primera Anomalía):
  Al aproximarse al lóbulo de deslizamiento del WP2, un espolón de roca bloquea la línea de visión con la Base -> Salta "Amenaza 1: Sombra de Radio (NLOS)". El nodo ROS 2 (`rclrs`) del traje pasa automáticamente a modo 100% Offline activando el posicionamiento "Canyon-TRN" en Rust (comparando con LiDAR y cámara la silueta de los muros de 7 km de Melas Chasma contra el DEM de MOLA). Además, el suelo cae a 110 TIU (THEMIS) con pendiente de 22°, disparando el consumo de O2 a 3.2 L/min.
- ACTO 4 (T+105 min a T+140 min | Impacto Multi-Amenaza Aleatoria y Dynamic Goal Switching):
  Con el astronauta sin radio y en terreno difícil, el entorno estocástico dispara simultáneamente una "Alerta de Partículas Solares (SPE)" detectada por el dosímetro local + un frente de "Viento Catabático y Polvo (Tau sube de 0.7 a 2.4)".
  Muestra con números exactos cómo la barra "Walkback Limit Dual" indica que volver a la Base (48 min estimados) supera el tiempo límite de radiación segura (15 min). El motor en Rust D* Lite Metabólico ejecuta "Dynamic Goal Switching" en <10 ms hacia el Waypoint 3 (Refugio en Escarpe a 8 min), el HUD aplica "Triaje de Fusión de Alerta Única" (el sendero en el suelo cambia a rojo/ámbar pulsante hacia la pared del cañón) y el Copiloto IA Neuro-Simbólico (`Candle` + `whisper-rs`) da una única orden clara por voz.
- ACTO 5 (T+140 min a T+165 min | Supervivencia en el Refugio WP3 y Telemetría Final):
  Llegada a la oquedad del escarpe vertical. Demuestra con datos cómo la pared de roca de 4 km de altura bloquea el 85% del flujo de protones solares (Sky View Factor reducido a 0.15) y protege del viento hasta que pasa el pico y el enlace Zenoh se restablece.
Incluye al final un diagrama de secuencia completo en sintaxis Mermaid.js (`sequenceDiagram`) de toda la misión.
```
