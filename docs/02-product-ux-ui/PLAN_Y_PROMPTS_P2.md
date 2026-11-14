# 🎨 Carril 2: Producto, UX/UI y Sistema Visual Multicapa (Persona 2)
**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*) — Equipo **Red Project**  
**Entregable destino:** [`ENTREGABLE_2_PRODUCTO_UX_UI.md`](./ENTREGABLE_2_PRODUCTO_UX_UI.md)

---

## ✅ Decisiones Cerradas por el Equipo para Persona 2 (Checkpoints 1 y 2)

* **Nombre del Sistema:** **R.E.D. ATLAS**
* **Escenario:** **Valles Marineris — Melas Chasma** (Ruta *"Triángulo de Supervivencia"*: Base -> WP1 Agua ISRU -> WP2 Talud/Falla peligrosa -> WP3 Escarpe/Oquedad de Refugio).
* **Arquitectura de Experiencia:** **Ecosistema Dual Sincronizado**
  1. **🖥️ Modo 1 — Consola Estratégica 3D de Base (Hábitat):**
     * **Lupa Espacial (*"Spyglass"*) Dividida en 3 Sectores:** Círculo interactivo tipo radar sobre el terreno 3D de Melas Chasma que permite ver 1 capa completa o dividir el círculo en 3 tercios simultáneos (*Sector 1: Agua/Minerales CRISM* + *Sector 2: Trampas de Arena THEMIS* + *Sector 3: Pendiente/Rocas MOLA/HiRISE*).
     * **Simulador *"Chaos Mode"* en Pre-EVA:** Botón de prueba de estrés que inyecta combinaciones aleatorias de 1, 2 o 3 peligros sobre la ruta planificada antes de que el astronauta salga del hábitat, verificando que siempre haya un refugio alcanzable.
  2. **🥽 Modo 2 — Interfaz Táctica EVA (Casco AR + Tablet de Muñeca):**
     * **HUD del Casco Minimalista con "Triaje de Fusión de Alerta Única":** Para evitar el pánico cuando saltan 2 o 3 emergencias a la vez (ej. Sombra de Radio + Radiación Solar SPE + Tormenta de Polvo), el HUD **no** apila ventanas caóticas: cambia directamente el color del sendero AR proyectado en el suelo (de cian nominal a ámbar/rojo pulsante hacia el refugio WP3) y el Copiloto IA emite **una única instrucción por voz manos libres**.
     * **Barra Superior *"Walkback Limit Dual"*:** Muestra dos umbrales dinámicos sobre la barra de oxígeno/energía: 1) *Límite de Retorno Seguro a la Base* y 2) *Límite de Escape de Emergencia al Refugio Natural más cercano (WP3)*.
     * **Tablet de Muñeca:** Mapa topográfico 2D/3D multicapa completo para inspección detallada cuando el astronauta levanta el brazo.

---

## 📋 SECUENCIA DE PROMPTS PARA PERSONA 2 (Fase 2 y Fase 3)

Copia y pega estos prompts en orden dentro de tu propio chat de IA y pega los resultados en [`ENTREGABLE_2_PRODUCTO_UX_UI.md`](./ENTREGABLE_2_PRODUCTO_UX_UI.md). Cada prompt ya contiene todas las decisiones de tus compañeros (Persona 1 y Persona 3) para garantizar coherencia absoluta.

---

### 🔹 PROMPT 1 (Fase 2A): User Personas, Ergonomía Marciana y Flujo de Usuario Dual
*(Copia y pega este bloque en tu IA)*

```text
Actúa como Principal UX/UI Designer de interfaces de misión crítica en la NASA (Human Systems Integration Division).
Estamos desarrollando el proyecto "R.E.D. ATLAS" (Reconnaissance, EVA & Dynamic-survival Atlas) del equipo "Red Project" para el reto "Interplanetary Survival Guide: Martian Map" de NASA Space Apps.
Nuestro objetivo es diseñar una especificación de producto y UX/UI exhaustiva y profesional (sin código de programación).

Nuestro equipo ya ha cerrado las siguientes decisiones que debes integrar:
- Escenario (Persona 1): Fondo del cañón de Valles Marineris — Melas Chasma, trazando la ruta "Triángulo de Supervivencia" (Base -> WP1 Sulfatos con Agua ISRU -> WP2 Falla/Talud peligroso >20° -> WP3 Oquedad de Refugio en pared del cañón).
- Arquitectura (Persona 3): Arquitectura Híbrida Dual con Servidor en Base (Gemelo 3D + Malla Hexagonal H3) y Nodo Edge en el Traje EVA (100% Offline para cuando se pierde la radio en el cañón, usando posicionamiento "Canyon-TRN" por Skyline Matching y algoritmo de rutas D* Lite Metabólico con "Dynamic Goal Switching").

Genera la Sección 1 y 2 de nuestro Entregable de Producto y UX/UI con el máximo nivel de detalle:

1. USER PERSONAS Y RESTRICCIONES ERGONÓMICAS EN MELAS CHASMA:
   Crea 2 fichas completas de User Personas:
   - Persona A: "Comandante / Especialista GIS de Hábitat" (opera la Consola 3D de Base para planificar rutas EVA y localizar recursos ISRU).
   - Persona B: "Astronauta Geólogo en EVA" (camina por el fondo de Melas Chasma con traje presurizado rígido, guantes gruesos que impiden gestos táctiles finos, iluminación cambiante por brumas/polvo del cañón y riesgo de quedarse incomunicado por las paredes de 7 km).
   Incluye una tabla de "Restricciones Físicas del Traje/Entorno -> Solución de Diseño UX en R.E.D. ATLAS".

2. SISTEMA DE DISEÑO VISUAL (DESIGN SYSTEM) PARA SUPERFICIE MARCIANA:
   Especifica la paleta de colores de alto contraste optimizada para no confundirse con el terreno rojizo/ocre de Marte (con códigos HEX y justificación óptica para HUD waveguide AR), jerarquía tipográfica legible bajo vibración, y el sistema multimodal (Voz manos libres + Audio espacial 3D en auriculares del casco + Háptica en muñeca).

3. ARQUITECTURA DE INFORMACIÓN Y FLUJO DE USUARIO COMPLETO (USER FLOW):
   Genera un diagrama de flujo detallado en sintaxis Mermaid y explícalo paso a paso cubriendo el ciclo completo:
   Fase Pre-EVA en Consola Base (Exploración con Lupa Spyglass -> Trazado del Triángulo de Supervivencia -> Test en "Chaos Mode" -> Sincronización al Traje) ---> Fase In-EVA Nominal (HUD AR Cian + Walkback Limit Dual hacia WP1 y WP2) ---> Fase de Multiemergencia Simultánea (Corte de radio NLOS + Alerta de Radiación SPE + Polvo -> Dynamic Goal Switching -> Triaje de Alerta Única hacia Refugio WP3).
```

---

### 🔹 PROMPT 2 (Fase 2B): Especificación y Wireframes de la Consola 3D de Base ("Spyglass" + "Chaos Mode")
*(Copia y pega este bloque en tu IA después de recibir la respuesta del Prompt 1)*

```text
Excelente. Ahora vamos a desarrollar la Sección 3 de nuestro Entregable de UX/UI para "R.E.D. ATLAS": la especificación funcional y visual detallada de la **Consola Estratégica 3D de Base (Hábitat)**.

Necesito que diseñes con nivel de especificación de ingeniería de producto (incluyendo esquemas visuales detallados en arte ASCII / bloques estructurados y diagramas Mermaid):

1. PANTALLA 1 (CONSOLA BASE): EXPLORADOR 3D DE MELAS CHASMA Y LUPA ESPACIAL "SPYGLASS" DE 3 SECTORES:
   - Dibuja un Wireframe ASCII de pantalla completa (aspect ratio 16:9 / Ultrawide de centro de control) mostrando la disposición exacta de paneles.
   - Detalla el diseño interactivo de nuestra herramienta insignia: la **Lupa Espacial "Spyglass" Multicapa Dividida**. Explica cómo al posar el círculo sobre el modelo 3D fotorealista de Melas Chasma (HiRISE + MOLA), el usuario puede alternar entre "Modo Rayos X de 1 Capa" o el **"Modo Radar Tri-Sector (120° cada sector)"**:
     * Sector Norte (120°): Capa CRISM/SHARAD (resaltando en azul eléctrico los depósitos de sulfatos polihidratados con agua en el WP1).
     * Sector Derecha (120°): Capa THEMIS de Inercia Térmica (resaltando en magenta/naranja las trampas de polvo suelto <150 TIU en el WP2).
     * Sector Izquierda (120°): Capa MOLA/HiRISE DTM + Sky View Factor (mostrando pendientes >20° y zonas de blindaje contra radiación / sombras de radio en el WP3).

2. PANTALLA 2 (CONSOLA BASE): PLANIFICADOR METABÓLICO DE RUTA Y SIMULADOR "CHAOS MODE":
   - Dibuja el Wireframe ASCII o esquema detallado del panel inferior/lateral de planificación del "Triángulo de Supervivencia".
   - Explica cómo se visualiza el perfil de elevación, la gráfica predictiva de consumo metabólico de O2/agua/batería y la cobertura de radio con la Base.
   - Especifica cómo funciona el botón **"Chaos Mode (Stress-Test Estocástico)"**: qué ve el planificador en pantalla cuando pulsa este botón y el sistema simula 100 escenarios aleatorios (Markov/Poisson) de tormentas, picos de radiación solar y avalanchas, certificando en verde que el Waypoint 3 (Escarpe/Oquedad) garantiza la supervivencia en el 99.4% de los casos.
```

---

### 🔹 PROMPT 3 (Fase 3): Especificación y Wireframes del Modo Táctico EVA (HUD AR, "Walkback Limit Dual" y Triaje Anti-Pánico)
*(Copia y pega este bloque en tu IA para generar la especificación del traje EVA)*

```text
Ahora genera la Sección 4 (Final) del Entregable de la Persona 2 para "R.E.D. ATLAS": la especificación funcional y visual del **Modo Táctico EVA (HUD del Casco en Realidad Aumentada + Tablet de Muñeca)** durante la caminata en Melas Chasma.

Desarrolla con máximo rigor visual y ergonómico:

1. PANTALLA 3 (MODO EVA - ESTADO NOMINAL): HUD AR MINIMALISTA Y BARRA "WALKBACK LIMIT DUAL":
   - Dibuja el Wireframe ASCII de la vista a través del visor del casco del astronauta caminando hacia el Waypoint 1/2.
   - Detalla la anatomía exacta de la **Barra Superior "Walkback Limit Dual"**: cómo representa en una sola línea visual:
     a) El porcentaje actual de consumibles críticos ($O_2$ restante, batería, agua de refrigeración).
     b) La Marca 1 ("Límite de Retorno a Base"): el punto de no retorno calculado en tiempo real según el coste metabólico de volver al Hábitat.
     c) La Marca 2 ("Límite de Escape a Refugio WP3"): el margen adicional de supervivencia gracias a tener la oquedad del escarpe a solo 600 m.
   - Describe cómo se proyecta en el suelo marciano el sendero luminoso AR (color cian en estado nominal) y qué información complementaria queda relegada a la **Tablet de Muñeca** (incluyendo su Wireframe ASCII con botones sobredimensionados para guantes presurizados).

2. PANTALLA 4 (MODO EVA - ESTADO DE MULTIEMERGENCIA SIMULTÁNEA Y TRIAJE DE FUSIÓN DE ALERTA ÚNICA):
   - Escenario: El astronauta está cerca del Waypoint 2, pierde señal de radio con la Base (Sombra de Radio NLOS, activando el icono de modo autónomo "Canyon-TRN Offline"), pisa regolito blando en pendiente de 22° y en ese instante el entorno dispara a la vez **Alerta de Radiación Solar (SPE)** + **Viento Catabático de Polvo**.
   - Dibuja el Wireframe ASCII del HUD en este estado crítico.
   - Explica nuestra innovación UX clave: el **Protocolo de Triaje "Fusión de Alerta Única" (Anti-Pánico)**:
     * Por qué mostrar 4 pop-ups de error mataría al astronauta por bloqueo cognitivo.
     * Cómo el HUD fusiona las amenazas: la barra "Walkback Limit Dual" muestra que la Base queda bloqueada/fuera de tiempo (en gris/rojo tachado) y activa automáticamente el tramo hacia el **Refugio WP3 (Escarpe a 8 min)**; el sendero AR sobre el suelo cambia a chevrones rojo/ámbar pulsantes guiando los pies del astronauta fuera de la trampa de arena hacia la pared del cañón; y el Copiloto IA emite por voz manos libres un único mensaje estructurado de 8 segundos (Situación + Acción + Tiempo al refugio).
   - Incluye una tabla comparativa del estado de cada widget UI entre "Modo Nominal", "Modo Precaución (1 amenaza)" y "Modo Supervivencia Crítica (Multiemergencia + Offline)".
```
