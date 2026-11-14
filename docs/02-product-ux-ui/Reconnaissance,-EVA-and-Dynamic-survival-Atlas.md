# R.E.D. ATLAS (Reconnaissance, EVA & Dynamic-survival Atlas)
## Product & UX/UI Specification — NASA Human Systems Integration Division (HSID)
**Challenge:** Interplanetary Survival Guide: Martian Map (NASA Space Apps)  
**Mission Domain:** Valles Marineris — Melas Chasma Floor Expedition  
**System Architecture:** Hybrid Dual-Tier (Base Server Hex-H3/3D Digital Twin + EVA Edge Node Canyon-TRN)

---

## 1. USER PERSONAS Y RESTRICCIONES ERGONÓMICAS EN MELAS CHASMA

### 1.1 Fichas de User Personas

#### Persona A: Comandante / Especialista GIS de Hábitat
* **Identidad Operativa:** Dr. Aris Thorne (38 años), Comandante Adjunto y Lead GIS / Remote Sensing Specialist.
* **Rol en Misión:** Operador de la Consola 3D de Base de Hábitat (Melas Base Alpha). Responsable del análisis orbital HiRISE/CRISM, planificación de trayectorias EVA, predicción de recarga ISRU y contingencias ambientales en tiempo real.
* **Entorno de Trabajo:**
  * Hábitat presurizado a 1 atm, gravedad parcial (0.38g), iluminación circadiana adaptativa (CCT 4500K a 6500K).
  * Estación multimonitor ultra-wide 4K/8K táctil con trackball de precisión y simulación háptica para gemelo digital 3D.
* **Objetivos Críticos:**
  1. Trazar y validar corredores seguros del "Triángulo de Supervivencia" conectando depósitos de sulfatos hidratados (recurso hídrico ISRU) con zonas de refugio estructural.
  2. Ejecutar simulaciones estocásticas ("Chaos Mode") sometiendo la ruta planificada a tormentas locales de polvo, fallas mecánicas de rover/traje y caídas de satélites repetidores.
  3. Monitorizar la telemetría dual (walkback physiological limits vs. consumibles del PLSS) durante el desarrollo de la EVA.
* **Frustraciones & Puntos de Dolor:**
  * Sobrecarga de capas raster desincronizadas en software GIS clásico que ocultan microtopografía peligrosa (taludes > 20°).
  * Incertidumbre en la ventana de comunicación debido a la sombra electromagnética (NLOS) proyectada por las paredes de 7 km de Melas Chasma.
* **Nivel Cognitivo Requerido:** Nivel de Alerta Situacional SAGAT 3 (Proyección temporal del estado del sistema en los próximos 90 minutos).

---

#### Persona B: Astronauta Geólogo en EVA (Superficie Extrema)
* **Identidad Operativa:** Dra. Elena Rostova (34 años), Especialista de Misión, Geóloga Planetaria y Operadora EVA-1.
* **Rol en Misión:** Trabajo de campo en el lecho de Melas Chasma. Muestreo de sulfatos polihidratados en WP1, cartografía geológica de escarpes y evaluación de cavidades basálticas en WP3.
* **Entorno y Restricciones Físicas:**
  * Presión de traje EVA rígido clase xEMU a 4.3 psi (29.6 kPa) de O₂ puro.
  * Guantes presurizados multicapa con blindaje térmico y micrometeoritos (RMG - Ruggedized Modular Gloves): pérdida del 85% de destreza táctil fina; fatiga muscular severa en antebrazos tras 2 horas de agarre continuo.
  * Iluminación hostil: luz solar difusa atenuada por polvo en suspensión, sombras ultranítidas de alto contraste proyectadas por las paredes verticales de 7.000 m del cañón, y deslumbramiento speculare sobre regolito de hematita.
  * Visibilidad variable: brumas matutinas de cristales de hielo/polvo fino con visibilidad reducida a < 15 m.
  * Aislamiento electromagnético: pérdida instantánea y prolongada de radiofrecuencia LOS (Line-of-Sight) con Base al entrar en fallas o cañones tributarios (NLOS permanente).
* **Objetivos Críticos:**
  1. Desplazamiento seguro y eficiente minimizando la tasa metabólica ($VO_2$) sobre terreno no consolidado.
  2. Confirmación inmediata de límites de no retorno ("Dual Walkback Limit") sin desviar la mirada de la trayectoria física.
  3. Evacuación autónoma hacia el refugio más cercano (WP3) si ocurre un evento de partículas solares (SPE) sin asistencia de Base.
* **Frustraciones & Puntos de Dolor:**
  * "Tunnel vision" (visión de túnel) y fatiga cognitiva bajo alarmas acústicas estridentes repetitivas.
  * Menús jerárquicos o botones virtuales en interfaces táctiles que fallan por la rigidez de los dedos enguantados.
  * Dependencia de enlaces orbitales que se cortan cuando más se necesita asistencia de navegación.

---

### 1.2 Matriz de Restricciones Físicas/Ambientales -> Solución de Diseño UX (R.E.D. ATLAS)

| Restricción Física / Factor Melas Chasma | Impacto Fisiológico y Operativo | Solución de Diseño UX en R.E.D. ATLAS | Mapeo de Componente UI |
| :--- | :--- | :--- | :--- |
| **Guantes EVA presurizados (pérdida del 85% de motricidad fina)** | Imposibilidad de pulsar botones táctiles pequeños (< 25 mm), pellizcar (pinch-to-zoom) o realizar swipes de precisión. | **Cero dependencia de interfaces táctiles directas en el traje.** Interacción por comandos de voz fonéticamente robustos (vocabulario controlado NATO/NASA) + dial rotatorio mecánico de 3 posiciones en antebrazo ("HUD Mode", "Waypoints", "SOS Egress") + confirmación por micro-gestos en barbilla/mandíbula dentro del casco. | *Rotary-Snap Controller (Wrist-Mount) & Helmet Sub-vocal Sensor.* |
| **Paredes de 7 km de Melas Chasma (Corte total de radio NLOS)** | Caída completa de enlace con Base y constelación orbital; pérdida de señal satelital GNSS/PNT. | **Edge Computing Offline 100% autónomo.** Algoritmo "Canyon-TRN" (Terrain Relative Navigation) que compara el horizonte visual captado por las cámaras del casco con el modelo de elevación digital local (Skyline Matching) sin requerir satélites. | *Local Edge TRN Engine + Skyline Alignment Overlay en HUD.* |
| **Fondo de cañón rojizo/ocre + Tormentas de polvo en suspensión** | Ceguera cromática situacional; los tonos rojos, naranjas y amarillos convencionales se camuflan con el regolito. | **Inversión Espectral en HUD Waveguide.** Eliminación total del rojo/amarillo para navegación nominal. Uso exclusivo de Verde Láser / Cian Eléctrico (#00F5D4 / #00FFA3) que poseen contraste óptico superior a 15:1 frente al albedo del regolito oxidado (Fe₂O₃). | *High-Contrast AR Waypoint Pillars & Polylines.* |
| **Pendientes y taludes peligrosos > 20° (Riesgo de deslizamiento/vuelco)** | Aumento exponencial del gasto metabólico ($VO_2$), rotura de articulaciones mecánicas del traje y avalanchas de detritos. | **Capa Isócrona de Micro-Relieve Hexagonal H3.** Delineación visual en HUD de "No-Go Zones" con sombreado de micro-rejilla punteada y cálculo dinámico de costo energético en tiempo real con algoritmo D* Lite Metabólico. | *D* Lite Dynamic Path Corridors con gradiente de pendiente.* |
| **Fatiga mental extrema y sobrecarga sensorial en emergencias** | Parálisis por análisis ante cascadas de alarmas (Audio Alarm Flood). | **Single Critical Alert Triad (Triaje de Alerta Única).** Supresión absoluta de advertencias secundarias. Presentación de una sola instrucción imperativa en el tercio inferior del campo visual con vector direccional 3D y pulso háptico unívoco. | *Emergency Egress HUD Vector & Spatial Audio Tone.* |

---

## 2. SISTEMA DE DISEÑO VISUAL PARA SUPERFICIE MARCIANA

Diseñado bajo la norma NASA STD-3001 (Space Flight Human-System Standard) e ISO 9241-210, optimizado para displays reflectivos transparentes (Waveguide Optical HUDs) y pantallas AMOLED rugerizadas de Base.

### 2.1 Paleta Cromática de Alto Contraste (Optimizada para HUD Waveguide & Melas Subsurface)

```
[ #00F5D4 Electric Cyan ]  -->  Primario Nominal (Ruta y Horizonte TRN)
[ #00FFA3 Bio-Green ]      -->  Métricas de Soporte Vital y Safe Haven (WP3)
[ #FFE600 Solar Amber ]    -->  Precaución / Límite Walkback 80%
[ #FF1744 Hyper Magenta ]  -->  Emergencia Crítica / Radiación SPE / No-Go
[ #0B0E14 Deep Space Navy]-->  Fondo de Contraste Absoluto (Consola Base)
```

| Token de Color | HEX | Longitud de Onda ($\lambda$) | Ratio de Contraste vs Regolito Marciano | Justificación Óptica y Misión |
| :--- | :--- | :--- | :--- | :--- |
| **`--color-hud-cyan`** | `#00F5D4` | 495 nm | **16.8:1** (Máximo en espectro visible) | Color de guiado primario. El ojo humano en adaptación fotópica/mesópica presenta alta sensibilidad en la banda cian-verde. Se proyecta nítido sobre el polvo ocre sin consumir energía excesiva en el proyector micro-LED. |
| **`--color-hud-green`** | `#00FFA3` | 525 nm | **15.2:1** | Indicador de estado nominal de PLSS (oxígeno, agua sublimador, presión de batería) y marcado del refugio de evacuación (WP3). |
| **`--color-alert-amber`** | `#FFE600` | 580 nm | **9.4:1** | Advertencia de cota de seguridad (ej. talud > 18°, divergencia de ruta estimada, 75% de walkback consumido). Alta luminancia diurna. |
| **`--color-hazard-crimson`**| `#FF1744` | 640 nm (Desplazado a Magenta) | **11.1:1** (Filtro anti-ocre) | No es rojo puro marciano; se utiliza un magenta hiper-saturado (`#FF1744`) con tinte azulado frío para no mimetizarse con el suelo ferruginoso. Reservado exclusivamente para SPE Solar Event, fallo de presurización o talud > 20°. |
| **`--color-bg-base-dark`** | `#0B0E14` | N/A | **21:1** vs HUD Cyan | Fondo estricto para monitores de la Base de Hábitat. Minimiza reflejos parásitos en las cúpulas y reduce fatiga ocular del operador en turnos prolongados. |

### 2.2 Jerarquía Tipográfica de Misión Crítica (Anti-Vibración & Visor Optics)
* **Familia Tipográfica:** *NASA JetBrains Mono Extended* o *Chivo Space Mono* (monoespaciada proporcional para evitar "jittering" de números cambiantes durante la marcha).
* **Parámetros de Renderizado:**
  * Grosor mínimo de trazo (stroke weight): 1.8 pt a 1 m de distancia focal aparente.
  * Tracking ampliado (+4%) para evitar que las letras se fusionen por astigmatismo inducido por vibración motora o escalofríos por frío marciano (-60 °C).

| Nivel Jerárquico | Tamaño Relativo / HUD Deg | Peso | Caso de Uso en Traje & Consola |
| :--- | :--- | :--- | :--- |
| **Display 1 (Critical Action)** | 32 px / 1.8° FOV | Black (800) | Instrucciones imperativas breves ("EVACUATE WP3", "TURN 045°"). |
| **Header 1 (HUD Distance & Bearing)** | 22 px / 1.2° FOV | Bold (700) | Distancia a Waypoint, Azimut numérico, Tiempo de Walkback restante. |
| **Telemetry Value (Metabolic Rate)** | 16 px / 0.9° FOV | SemiBold (600) | $VO_2$ (L/min), ppm $CO_2$, Presión Suit (psi), Batería restante. |
| **Subtext / Coordinate Labels** | 12 px / 0.65° FOV | Medium (500) | Coordenadas H3 Hexagonales, elevación relativa (-3.420 m bajo datum). |

### 2.3 Sistema Multimodal Tri-Modal (Voz Manos Libres + Audio 3D + Háptica)
Para garantizar una tasa de error cero ($P_{error} < 10^{-6}$), ninguna información crítica depende de un solo canal sensorial:

1. **Voz Manos Libres (Voice Input & Synthesis):**
   * *Entrada:* Micrófono de gradiente de presión dentro de la cavidad oral del casco con cancelación de ruido del soplador de $O_2$. Gramática finita BNF (Backus-Naur Form): `[SISTEMA] + [COMANDO] + [PARÁMETRO]`. Ej: *"ATLAS, RUTA ALTERNATIVA REFUGIO"*.
   * *Salida:* Confirmación por audio-feedback de baja latencia (< 80 ms) con voz sintética neutralizada en frecuencias medias (1.2 kHz - 3.5 kHz).
2. **Audio Espacial 3D (Binaural Bone-Conduction Earsets):**
   * Dos transductores de conducción ósea integrados en la cofia del astronauta ("Snoopy cap").
   * *Vector de Navegación:* Un pulso de audio sonoro ("sonar ping" a 800 Hz) que se percibe espacialmente situado en el ángulo azimutal exacto del siguiente waypoint (si el waypoint está a 30° a estribor, el sonido se percibe físicamente viniendo de 30° a la derecha).
   * *Proximidad de Peligro:* Tono estereofónico que incrementa su cadencia al acercarse a un borde de talud > 20°.
3. **Háptica en Muñeca y Guanteletes (Vibrotactile ERM & LRA Array):**
   * Conjunto de 4 actuadores hápticos LRA (Linear Resonant Actuator) dispuestos radialmente en la muñeca derecha e izquierda.
   * *Patrón Direccional:* Pulso secuencial direccional (1 -> 2 -> 3) indicando giro requerido sin necesidad de mirar el HUD.
   * *Alerta Crítica:* Ráfaga de vibración pulsada de alta frecuencia (250 Hz, 4G pico) sincronizada con la alerta visual de evacuación inmediata.

---

## 3. ARQUITECTURA DE INFORMACIÓN Y FLUJO DE USUARIO COMPLETO (USER FLOW)

El flujo operativo cubre las tres fases de misión del Triángulo de Supervivencia:
* **Fase 1: Pre-EVA en Consola Base** (Planificación, Exploración Lupa Spyglass, Validación Chaos Mode, Sync a Traje).
* **Fase 2: In-EVA Nominal** (Guiado AR Cian, Recolección ISRU en WP1, Sortie a WP2 con control de talud).
* **Fase 3: Multiemergencia Simultánea & Contingencia** (Pérdida de enlace radial NLOS + Alerta SPE Radiación + Tormenta de polvo -> Dynamic Goal Switching -> Evacuación al Refugio WP3).

### 3.1 Diagrama de Flujo de Usuario (Mermaid)

```mermaid
graph TD
    %% Subgraphs por fases
    subgraph FASE_1_PRE_EVA ["FASE 1: PRE-EVA (CONSOLA BASE HÁBITAT)"]
        A1[Inicio: Consola 3D Gemelo Digital Melas Chasma] --> A2[Exploración con Lupa 'Spyglass':<br/>Capas CRISM Sulfatos + HiRISE DEM 1m]
        A2 --> A3[Trazado del 'Triángulo de Supervivencia':<br/>Base Alpha -> WP1 ISRU -> WP2 Talud -> WP3 Refugio]
        A3 --> A4[Cálculo de Costo Metabólico D* Lite:<br/>Walkback Limit Dual: Oxígeno vs Tasa VO2]
        A4 --> A5{Test de Resiliencia<br/>'Chaos Mode'?}
        A5 -- Fallo: Ruta Insegura --> A3
        A5 -- Validación Exitosa --> A6[Generación de Paquete de Misión Criptográfico Offline]
        A6 --> A7[Sincronización Cable umbilical / RF Corta al Nodo Edge Traje EVA]
    end

    subgraph FASE_2_IN_EVA_NOMINAL ["FASE 2: OPERACIÓN IN-EVA NOMINAL (EDGE TRAJE)"]
        B1[Egreso de Airlock Melas Base] --> B2[Canyon-TRN Activado:<br/>Skyline Matching en Visor HUD]
        B2 --> B3[Guiado AR en Cian Eléctrico #00F5D4:<br/>Polilínea sobre terreno + Audio 3D a WP1]
        B3 --> B4[Arribo a WP1: Depósitos Sulfatos Hidratados ISRU]
        B4 --> B5[Muestreo Geológico & Telemetría en Rango]
        B5 --> B6[Navegación hacia WP2: Falla / Talud Peligroso]
        B6 --> B7[Sensor LIDAR Traje detecta Pendiente > 20°]
        B7 --> B8[HUD proyecta Red Hexagonal Ámbar:<br/>Reajuste de Micro-Ruta para evitar escarpe]
    end

    subgraph FASE_3_MULTI_EMERGENCIA ["FASE 3: MULTIEMERGENCIA SIMULTÁNEA (TOTAL OFFLINE)"]
        C1{DISPARADOR CRÍTICO SIMULTÁNEO:<br/>1. Caída de Radio Base NLOS<br/>2. Alerta SPE Radiación Solar<br/>3. Tormenta de Polvo / Ceguera} --> C2[TRIAJE DE ALERTA ÚNICA:<br/>Supresión de alertas secundarias]
        C2 --> C3[DYNAMIC GOAL SWITCHING:<br/>Cancelación automática de WP2 y retorno a Base]
        C3 --> C4[Algoritmo D* Lite Edge evalúa vectores:<br/>Distancia Base = 4.2 km / Refugio WP3 = 680 m]
        C4 --> C5[Selección Autónoma: VECTOR REFUGIO WP3 (Oquedad en Pared de Cañón)]
        C5 --> C6[HUD Modificado a Modo Evacuación:<br/>Magenta Hiper-saturado #FF1744 + Vector Guiado WP3]
        C6 --> C7[Audio Espacial 3D: Baliza Sonora Pulsada continua 1.2 kHz]
        C7 --> C8[Háptica en Muñeca: Pulsos Direccionales de Egress]
        C8 --> C9[Navegación ciega guiada por Skyline Canyon-TRN]
        C9 --> C10[Ingreso Exitoso a Oquedad WP3:<br/>Blindaje de roca > 5 metros contra Radiación SPE]
        C10 --> C11[Estado Seguro Alcanzado:<br/>Activación de Transmisor de Emergencia VLF omnidireccional]
    end

    %% Conexiones entre fases
    A7 --> B1
    B8 --> C1

    %% Estilos de Nodos
    style A1 fill:#0B0E14,stroke:#00F5D4,stroke-width:2px,color:#fff
    style A5 fill:#1A2332,stroke:#FFE600,stroke-width:2px,color:#FFE600
    style A7 fill:#0B0E14,stroke:#00FFA3,stroke-width:2px,color:#00FFA3
    style B3 fill:#002B28,stroke:#00F5D4,stroke-width:2px,color:#00F5D4
    style B8 fill:#2D2600,stroke:#FFE600,stroke-width:2px,color:#FFE600
    style C1 fill:#3D000B,stroke:#FF1744,stroke-width:3px,color:#FF1744
    style C3 fill:#3D000B,stroke:#FF1744,stroke-width:2px,color:#fff
    style C5 fill:#003822,stroke:#00FFA3,stroke-width:3px,color:#00FFA3
    style C10 fill:#003822,stroke:#00FFA3,stroke-width:3px,color:#00FFA3
```

---

### 3.2 Explicación Paso a Paso del Flujo de Interacción y Toma de Decisiones

#### FASE 1: Pre-EVA en Consola de Base de Hábitat (Planificación & Simulación)
1. **Acceso al Gemelo Digital 3D:** El Especialista GIS (Persona A) inicia la consola en Base Alpha. El sistema renderiza la malla hexagonal Uber H3 (resolución 12, ~3 metros por celda) del sector central de Melas Chasma.
2. **Exploración con Lupa "Spyglass":** Mediante un viewport flotante circular (Spyglass Tool), el operador hace sweep sobre el terreno desértico. La herramienta cruza en tiempo real el modelo de elevación HiRISE con firmas espectrales CRISM, detectando y resaltando depósitos de sulfatos polihidratados (recurso crítico para extracción de agua ISRU) en las coordenadas de WP1.
3. **Trazo del Triángulo de Supervivencia:**
   * **Base Alpha -> WP1 (Sulfatos ISRU):** Punto de extracción mineral (distancia: 2.4 km).
   * **WP1 -> WP2 (Talud Peligroso):** Escarpe estructural con pendiente media de 23° (estudio geológico de estratigrafía).
   * **WP3 (Oquedad de Refugio en pared norte):** Cavidad natural identificada con > 5 metros de roca basáltica superior, capaz de neutralizar protones de alta energía derivados de tormentas solares.
4. **Cálculo de Costo Metabólico y Walkback Limit Dual:** El motor D* Lite evalúa el esfuerzo biológico estimando el consumo de $O_2$, agua de sublimación de PLSS y fatiga física del astronauta. Define la isócrona de "No Retorno", estableciendo que el punto crítico de decisión debe ocurrir antes de superar el 60% del consumible de soporte vital más restrictivo.
5. **Inyección de "Chaos Mode" (Prueba de Estrés):** El Comandante activa la simulación estocástica. El sistema inyecta perturbaciones: viento catabático repentino de 35 m/s, caída de repetidor orbital y degradación del 15% de eficiencia en la celda de combustible del traje. Si el tiempo de evacuación proyectado a refugio supera los límites de supervivencia, el sistema bloquea la aprobación de la ruta hasta optimizarla.
6. **Compilación de Paquete Offline y Sincronización:** Aprobada la ruta, se genera una base de datos local embebida SQLite/FlatBuffers que contiene el DEM local, las polilíneas de ruta y las tablas hash del perfil de crestas (Skyline). Se transfiere al traje mediante acoplamiento físico en el airlock.

#### FASE 2: In-EVA Nominal (Ejecución Edge en Traje Presurizado)
1. **Egreso y Enganche de Canyon-TRN:** La astronauta (Persona B) despresuriza el airlock y desciende al terreno. Al no existir satélites visibles en el cañón, las cámaras perimétricas del casco capturan el perfil de las crestas rocosas de 7 km de altura y lo comparan con la base de datos local (Skyline Matching), logrando un anclaje posicional métrico con error < 0.8 m.
2. **Guiado AR en Cian Eléctrico:** En el visor HUD transparente se proyecta la polilínea en cian brillante (`#00F5D4`), anclada conformalmente sobre el suelo marciano a 5 metros frente al astronauta. Paralelamente, el audio binaural emite pulsos direccionales suaves en el auricular correspondiente a la dirección del sendero.
3. **Muestreo en WP1 (ISRU):** Arribo a la zona de sulfatos. El HUD muestra la ventana de muestreo con temporizador regresivo de consumibles. El astronauta confirma por comando de voz (*"ATLAS, REGISTRAR MUESTRA 01"*) sin emplear las manos.
4. **Acercamiento a WP2 y Detección de Talud Crítico:** En camino hacia WP2, el sensor LiDAR de barrido continuo del traje detecta un aumento súbito de inclinación (> 20°) debido a un colapso reciente de regolito. Inmediatamente, el HUD tiñe las celdas hexagonales del suelo de color Ámbar (`#FFE600`) y emite una alerta háptica en muñeca para inducir un desvío de 45° a la izquierda, bordeando el talud sin comprometer la estabilidad mecánica.

#### FASE 3: Multiemergencia Simultánea & Contingencia Extrema
1. **Desencadenante de Crisis Combinada:**
   * **Evento A:** Las paredes del cañón ocluyen completamente la señal con la Base (Corte total de radio NLOS).
   * **Evento B:** El sensor dosimétrico del traje detecta una lluvia masiva de protones relativistas: Alerta Solar Particle Event (SPE). Dosis letal proyectada en < 28 minutos a cielo abierto.
   * **Evento C:** Se levanta una tormenta repentina de polvo fino que reduce la visibilidad visual física a menos de 4 metros.
2. **Triaje de Alerta Única (Zero Cognitive Overload):** El sistema R.E.D. ATLAS entra en modo supervivencia. Silencia cualquier telemetría secundaria de recolección de muestras. En el HUD se descartan todos los menús y métricas de confort. Aparece una sola señal prioritaria en Magenta Hiper-saturado (`#FF1744`): **"SPE ALERT // EVACUATE TO SHELTER"**.
3. **Dynamic Goal Switching (D* Lite Autónomo Offline):**
   * El procesador Edge del traje descarta instantáneamente la continuación de la misión a WP2.
   * Evalúa los dos puntos de escape posibles: Retorno a Melas Base Alpha (distancia de regreso: 4.2 km por terreno ascendente, tiempo estimado: 64 minutos -> **INVIABLE / DOSIS LETAL**) versus Oquedad de Refugio WP3 (distancia: 680 m, tiempo estimado a marcha forzada: 11 minutos -> **VIABLE / SOBREVIVENCIA 99.4%**).
   * Conmuta de forma automática y autónoma el objetivo global hacia WP3.
4. **Navegación Ciegan Guiada por Sensores:** Con visibilidad exterior casi nula por la tormenta de polvo, el astronauta sigue el túnel virtual AR proyectado en el HUD sobre su retina. El Audio 3D emite una baliza sonora continua a 1.2 kHz centrada en el eje de la cabeza, mientras los actuadores hápticos marcan el ritmo de zancada segura.
5. **Entrada a Cavidad y Neutralización de Amenaza:** El astronauta penetra en la oquedad basáltica de WP3. Los sensores de radiación registran una caída del 98% en el flujo de protones al quedar protegida por 5 metros de techo rocoso. El HUD transmuta a Verde Bio (`#00FFA3`): **"SAFE ENVIRONMENT CONFIRMED"**. El nodo Edge inicia la emisión de pulsos baliza VLF (Very Low Frequency) que atraviesan la roca para notificar a la Base su estado y posición de resguardo.
