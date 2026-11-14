# R.E.D. ATLAS — ESPECIFICACIÓN DE INGENIERÍA UX/UI (SECCIÓN 3)
## Consola Estratégica 3D de Base de Hábitat (Melas Base Alpha)
**Challenge:** Interplanetary Survival Guide: Martian Map (NASA Space Apps)  
**Sistema:** Consola Táctica de Hábitat y Gemelo Digital 3D (Aris Thorne - SAGAT 3)  
**Normativa Aplicada:** NASA-STD-3001 (Human Integration Design) & ISO 9241-210

---

## 1. PANTALLA 1: EXPLORADOR 3D DE MELAS CHASMA Y LUPA ESPACIAL "SPYGLASS" TRI-SECTORIAL

### 1.1 Wireframe Estructural de Pantalla Completa (Ultrawide 32:9 / 4K Habitat Console)

```text
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| [NASA HSID // MELAS ALPHA]   R.E.D. ATLAS TACTICAL CONSOLE v4.2   [SOL 142 · MET 04:38:12]   [BANDWIDTH: 144.2 Mbps]   [ENCRYPT: AES-256 GCM]  [ARIS THORNE]  |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| [A] PANEL GIS ORBITAL (IZQ.)  | [B] VIEWPORT GEMELO DIGITAL 3D PRINCIPAL (CENTRAL EXPANSIVO)                                   | [C] MONITOR TELEMETRÍA PRE-EVA |
| +---------------------------+ | +--------------------------------------------------------------------------------------------+ | +----------------------------+ |
| | CAPAS RASTER MULTIESPECTRAL| | |  AZM: 148.2°  ELEV: 34.1°  SUN CCT: 5200K  SCALE: 1:25,000 [H3 RES-12]  RMS: 0.04m          | | | ESTADO XEMU-04 (ELENA)     | |
| | [x] HiRISE DEM 1m (Active)| | |                                                                                            | | | • Primario O2: 6.8h (94%)  | |
| | [x] CRISM Polihidratados  | | |                   [Pared Norte Melas Chasma: -3.420m a +3.580m]                            | | | • Sublimador H2O: 88% (4.2L| |
| | [x] THEMIS Inercia Térm.  | | |                                                                                            | | | • PLSS Li-Ion: 82% (1.4kWh)| |
| | [x] MOLA Sky View Factor  | | |                                       /\ (Cresta 7 km)                                     | | | • Presión Traje: 4.3 psi   | |
| | [x] Malla Hexagonal H3    | | |                                      /  \                                                  | | +----------------------------+ |
| +---------------------------+ | |                                     /    \                                                 | | [D] ISÓCRONA WALKBACK DUAL   | |
| | METEOROLOGÍA & ORBITAL    | | |                   +----------------(  WP3  )-----------------+                             | | +----------------------------+ |
| | • Viento: 14.2 m/s NW     | | |                   |   Oquedad Basáltica Refugio SPE          |                             | | | Consumo Límite: 62% [NOM]  | |
| | • Opacidad Tau: 0.42      | | |                   |   [Overburden >5.2m // Prot. 99.4%]      |                             | | | [=======>        ] 1.8h Mgn| |
| | • Próx. Pase MRO: 44 min  | | |                   +------------------------------------------+                             | | | Retorno PNR: 02:44 MET     | |
| | • NLOS Canyon: BLOQUEADO  | | |                                        /                                                   | | +----------------------------+ |
| +---------------------------+ | |                                       / (Vector Escape 680m)                               | | [E] SINCRONIZACIÓN SUIT      | |
| | SELECTOR MODO LUPA        | | |                       +------------(  WP2  )-------------+                                 | | +----------------------------+ |
| | ( ) Modo X-Ray 1 Capa     | | |                       | Escarpe Falla Peligrosa          |                                 | | | Paquete SQLite / FlatBuff  | |
| | (*) Lupa Tri-Sector 120°  | | |                       | Talud 23.4° // Peligro Slip >20° |                                 | | | Checksum: 0x9F4A [LOCK]    | |
| |   - Radio Lupa: [ 180 px ]| | |                       +----------------------------------+                                 | | | [ PUSH A AIRLOCK DOCK ]    | |
| |   - Opacidad:   [  85 %  ]| | |                                       /                                                    | | +----------------------------+ |
| |                           | | |                                      /                                                     | | [F] PANEL CHAOS ENGINE       | |
| +---------------------------+ | |                  [ === LUPA SPYGLASS TRI-SECTOR 120° === ]                                 | | +----------------------------+ |
|                               | |                 /             Sector Norte:              \                                 | | | TEST ESTOCÁSTICO POISSON   | |
|                               | |                |            CRISM H2O Sulfatos            |                                | | | 100 Corridas Monte Carlo   | |
|                               | |                |          [14.8 L/m3 // #00F5D4]          |                                | | | SPE Flux Spike: 1.4e3 p/cm2| |
|                               | |               /--------------------------------------------\                               | | | Catabatic Wind: 35 m/s     | |
|                               | |              / Sector Izquierdo:     |  Sector Derecho:     \                              | | | Comms Loss: NLOS 100%      | |
|                               | |             |  HiRISE Slope >20°     |   THEMIS Dust Trap    |                             | | |                            | |
|                               | |             |  Shadow & SVF Blindaje |   <150 TIU Regolito   |                             | | | [ EJECUTAR CHAOS MODE ]    | |
|                               | |              \     [#FF1744]         |       [#FF9100]      /                              | | +----------------------------+ |
|                               | |               \--------------------------------------------/                               |                                  |
|                               | |                                      \                                                     |                                  |
|                               | |                      +------------(  WP1  )-------------+                                  |                                  |
|                               | |                      | Depósito Sulfato Polihidratado   |                                  |                                  |
|                               | |                      | Recurso Hídrico ISRU // 2.4 km   |                                  |                                  |
|                               | |                      +----------------------------------+                                  |                                  |
|                               | |                                     /                                                      |                                  |
|                               | |                       (Ruta D* Lite / Cian #00F5D4)                                        |                                  |
|                               | |                                   /                                                        |                                  |
|                               | |                      +--------( BASE ALPHA )--------+                                      |                                  |
|                               | |                      | Origen Hábitat (-3.418m)     |                                      |                                  |
|                               | |                      +------------------------------+                                      |                                  |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| [G] PERFIL LONGITUDINAL DE ELEVACIÓN, CURVA METABÓLICA D* LITE Y MATRIZ DE RIESGO DE PROPAGACIÓN ESTOCÁSTICA (DESPLEGABLE INFERIOR)                     |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
```

---

### 1.2 Diseño Detallado de la Herramienta Insignia: Lupa Espacial "Spyglass" Tri-Sectorial

La **Lupa Spyglass Tri-Sectorial** resuelve el mayor cuello de botella en cartografía planetaria: la sobrecarga cognitiva provocada por conmutar manualmente decenas de capas GIS superpuestas (overplotting). Al posar el cursor o apuntador háptico sobre el terreno 3D, el operador despliega un viewport analítico circular de 360° dividido en **tres cuñas angulares de 120°** que fusionan datos multiespectrales en tiempo real mediante *hardware-accelerated multi-pass shaders*.

```
                      SECTOR NORTE (0° a 120°)
                     CRISM / SHARAD (Agua & ISRU)
                           .---''''---.
                        .-'     |      '-.
                      .'        |         '.
                     /    CRISM | SHARAD    \
                    |   SULFATOS| POLIHID.   |
                    |   14.8 L/m³ Agua Rec.  |
                    |    (Cian Eléctrico)    |
                    |-----------+------------|
                     \   MOLA   |   THEMIS  /
                      \  HiRISE |  INERCIA /
                       '. SVF   |  TÉRMICA'
                         '-.    |     .-'
                            '---....-'
              SECTOR IZQUIERDO          SECTOR DERECHO
              (240° a 360°)             (120° a 240°)
           MOLA/HiRISE DEM + SVF        THEMIS Inercia Térmica
           Pendientes Críticas &        Trampas de Polvo Fino <150 TIU
           Blindaje Radiación           (Magenta / Ámbar Peligro)
```

#### Especificación Técnica de los Tres Sectores:

1. **Sector Norte (Azimut 0° a 120°) — Sensor CRISM / SHARAD (Recurso Hídrico ISRU):**
   * **Propósito:** Detección de depósitos minerales de sulfatos hidratados (Kieserita, Yeso) e interfaces dieléctricas de hielo subsuperficial.
   * **Representación Visual:** Gradiente espectral en **Azul Cian Eléctrico (`#00F5D4` a `#0077B6`)**. Las zonas con concentraciones de agua estructural $> 12\text{ L/m}^3$ emiten una retícula pulsante de micro-puntos cian con etiqueta HUD flotante: `ISRU: HYDRATED SULFATES // 14.8 L/m³`.
   * **Aplicación en WP1:** Identificación exacta del afloramiento mineral donde la astronauta Elena Rostova debe extraer muestras geológicas para soporte vital.

2. **Sector Derecho (Azimut 120° a 240°) — Sensor THEMIS (Inercia Térmica y Riesgo Mecánico):**
   * **Propósito:** Detección de regolito no consolidado, depósitos eólicos de polvo ultrafino y trampas de rodadura.
   * **Representación Visual:** Escala cromática termográfica inversa. Zonas con inercia térmica baja ($< 150\text{ J}\cdot\text{m}^{-2}\cdot\text{K}^{-1}\cdot\text{s}^{-1/2}$) se representan en **Naranja Quemado / Ámbar (`#FF9100`)** y **Magenta de Alerta (`#FF1744`)**.
   * **Aplicación en WP2:** Revela un manto de polvo suelto sobre el escarpe del talud de $23.4^\circ$, advirtiendo de alto riesgo de deslizamiento por licuefacción mecánica de regolito si la astronauta camina sobre él.

3. **Sector Izquierdo (Azimut 240° a 360°) — Sensor MOLA/HiRISE DTM + Sky View Factor (Topografía y Blindaje SPE):**
   * **Propósito:** Análisis micro-topográfico de escarpes y cálculo del *Sky View Factor* (SVF, fracción visible de la bóveda celeste) para protección radiológica pasiva.
   * **Representación Visual:** Las pendientes $> 20^\circ$ se marcan con sombreado de rayas de advertencia (*hazard stripes*). Las zonas con SVF $< 0.15$ (oquedades y covachas con $> 5\text{ m}$ de roca basáltica en el techo que ocluyen el 85% del cielo) se renderizan en **Verde Esmeralda de Refugio (`#00FFA3`)**.
   * **Aplicación en WP3:** Confirma que la oquedad basáltica de la pared norte neutraliza el flujo de radiación SPE en un $99.4\%$.

#### Micro-Interacciones de la Lupa Spyglass:
* **Foco Variable:** Giro de la rueda del trackball/mouse expande el radio de la lente de $100\text{ px}$ a $400\text{ px}$ sobre el terreno.
* **Toggle de Modo:** Presionando `[SPACE]` o el gatillo háptico, la lupa colapsa instantáneamente de 3 sectores a "Modo Rayos X Unificado" de la capa actualmente seleccionada.
* **Freeze Frame & Pinning:** Doble clic fija la lente en las coordenadas marcianas seleccionadas, permitiendo abrir hasta 3 lupas comparativas simultáneas entre WP1, WP2 y WP3.

---

## 2. PANTALLA 2: PLANIFICADOR METABÓLICO DE RUTA Y SIMULADOR "CHAOS MODE"

### 2.1 Wireframe del Panel Longitudinal y Planificador Metabólico (Sección Inferior de la Consola)

```text
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| TRAYECTORIA: BASE ALPHA -> WP1 (2.4 km) -> WP2 (1.8 km) -> WP3 (0.68 km) | LONGITUD TOTAL: 4.88 km | TIEMPO ESTIMADO: 3h 14m | RETORNO CRÍTICO: 02h 44m   |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| (A) PERFIL DE ELEVACIÓN Y TALUD [EJE Y: COTA -3.420m A -3.210m // EJE X: DISTANCIA 0 a 5.0 km]                                                           |
| Elev.                                                                                                                                                     |
| -3.200m |                                                          (WP2) Escarpe 23.4° [SLIP RISK]                                                        |
|         |                                                            /\                                                                                   |
| -3.300m |                                 (WP1) Depósito Sulfatos   /  \                (WP3) Oquedad Refugio (-3.340m)                                   |
|         |                                       _..---''           /    \               +-----------------+                                               |
| -3.400m |  [Base Alpha]                   _..-''                  /      \______________| >5m Basalto     |                                               |
|         |  o----------------------------''                       /                      +-----------------+                                               |
|         +--+----------------------------------+------------------+-------------------------------+----------------------------------------------------+   |
|         0.0 km                                2.4 km             4.2 km                          4.88 km                                              Dist|
| Pendiente:  1.2°                              4.8°               23.4° [NO-GO >20°]              3.1°                                                     |
| Terreno:    Regolito Compacto                 Sulfato Masivo     Polvo Suelto <150 TIU           Lecho Basáltico                                          |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| (B) TELEMETRÍA PREDICTIVA MULTICANAL D* LITE [CURVAS CONSUMIBLES VS DISTANCIA / TIEMPO]                                                                  |
| 100% |~~~ O2 RESTANTE (PLSS-1): Margen Seguro a Término = 36% ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\                        |
|  80% |=== AGUA SUBLIMADOR REFRIGERACIÓN: Margen = 24% ===========================================\                              \                       |
|  60% |--- BATERÍA LI-ION TRAJE: Margen = 42% -----------------------------------------------------\                              \                      |
|  40% |                                                                        [PUNTO DE NO RETORNO (PNR)]                          \ [Límite Seguro 20%]  |
|  20% |.................................................................................|.......................................... \                     |
|   0% +---------------------------------------------------------------------------------+---------------------------------------------+--------------------+
| Tasa VO2:  0.34 L/min (Reposo)                1.25 L/min (Marcha)      1.82 L/min (Pico Talud)    1.10 L/min (Marcha)          MET: 03h 14m               |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| (C) COBERTURA DE ENLACE DE RADIO BASE // SOMBRA NLOS (7 KM PARED DE CAÑÓN)                                                                               |
| RF LOS: [#################### 100% LOS #####################] [############# 72% LOS ############] [    0% CORTE TOTAL NLOS (PARED CAÑÓN)  ]            |
| Estado: BASE LINK ESTABLE                                     DIFRACCIÓN DE BORDE                  OFFLINE TRN ACTIVO (EDGE CANYON-TRN EN TRAJE)          |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
| (D) MONITOR DE CERTIFICACIÓN ESTOCÁSTICA: "CHAOS MODE" (POISSON / MONTE CARLO N=100 SCENARIOS)                                                           |
|                                                                                                                                                           |
| [ !!! INICIAR STRESS-TEST CHAOS MODE !!! ]  ==> ESTADO: CERTIFICACIÓN COMPLETADA (100/100 SEMILLAS)                                                      |
|                                                                                                                                                           |
| • P(Supervivencia por Retorno a Base):  0.6 % [FALLO CATASTRÓFICO POR DOSIS SPE EXCESIVA EN CAMINO ASCENDENTE (64 MINUTOS A CIELO ABIERTO)]             |
| • P(Supervivencia por Egress a Refugio WP3): 99.4 % [CERTIFICADO NASA STD-3001 // TIEMPO MARCHA FORZADA: 11 MINUTOS // DOSIS RESIDUAL < 0.08 mSv]        |
|                                                                                                                                                           |
| DISTRIBUCIÓN DE PROBABILIDAD DE SUPERVIVENCIA EN REFUGIO WP3:                                                                                             |
|                                                   +----+                                                                                                  |
|                                                   |    |                                                                                                  |
|                                                   |    |                                                                                                  |
|                                              +----+    |                                                                                                  |
|                                              |    |    |  +----+   [Media u = 99.4% // Sigma o = 0.28%]                                                   |
|                                         +----+    |    |  |    |                                                                                          |
|                                    +----+    |    |    |  |    |   RESULTADO: RUTA AUTORIZADA PARA DESPLIEGUE                                             |
|        ----+----+----+----+----+----+----+----+----+----+----+----+                                                                                       |
|       94%  95%  96%  97%  98%  99% 99.4% 100% Supervivencia                                                                                               |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------+
```

---

### 2.2 Arquitectura del Simulador Estocástico "Chaos Mode"

El botón **"Chaos Mode"** ejecuta un motor de simulación estocástica basado en Procesos de Poisson no homogéneos y Cadenas de Markov de 100 iteraciones concurrentes. Modela los tres riesgos fatales combinados de Melas Chasma:

1. **Inyección de Tormenta de Polvo Catabática:** Caída de visibilidad a $< 3.8\text{ m}$ y aumento del coeficiente de fricción por regolito aerotransportado.
2. **Evento de Partículas Solares (SPE Spike):** Dosis ionizante masiva a $1.420\text{ protones/cm}^2/\text{s}$ con techo letal de $100\text{ mSv}$ alcanzable en $26\text{ minutos}$ a cielo abierto.
3. **Pérdida de Enlace RF (NLOS Absoluto):** Caída a cero de enlaces satelitales por oclusión contra las paredes de 7 km del cañón.

```mermaid
flowchart TD
    Init[Operador Pulsa 'Chaos Mode'] --> Spawn[Generación de 100 Escenarios Estocásticos Monte Carlo]
    
    subgraph INYECCION_PERTURBACIONES ["Inyección de Perturbaciones (Poisson / Markov)"]
        P1[Viento Catabático > 35 m/s]
        P2[Pico Radiación SPE > 1.420 p/cm²/s]
        P3[Corte Total de Radio NLOS]
        P4[Talud > 20° con Falla Mecánica Traje]
    end
    
    Spawn --> P1
    Spawn --> P2
    Spawn --> P3
    Spawn --> P4
    
    P1 & P2 & P3 & P4 --> SimEngine[Motor Cinemático & Metabólico D* Lite]
    
    subgraph EVALUACION_VECTORES ["Evaluación Comparativa de Vectores de Egress"]
        V_Base[Vector Retorno a Base: 4.2 km asc.<br/>Tiempo: 64 min<br/>Dosis Recibida: 240 mSv<br/><b>P(Sobrevivir) = 0.6% [LETAL]</b>]
        V_WP3[Vector Egress a Refugio WP3: 680 m<br/>Tiempo: 11 min marcha forzada<br/>Blindaje Basalto: > 5 m<br/><b>P(Sobrevivir) = 99.4% [SEGURO]</b>]
    end
    
    SimEngine --> V_Base
    SimEngine --> V_WP3
    
    V_Base --> Compare{¿Ruta Cumple Requisitos NASA-STD-3001?}
    V_WP3 --> Compare
    
    Compare -- No hacia Base --> BlockBase[Bloqueo de Retorno Directo en Emergencia]
    Compare -- Sí hacia WP3 --> Certify[Certificación Verde: Refugio WP3 Blindado]
    
    Certify --> LockCrypt[Generación de Hash Criptográfico AES-256]
    LockCrypt --> PushSuit[Habilitación de Botón 'PUSH TELEMETRÍA A AIRLOCK']
    
    style Init fill:#191c22,stroke:#00f5d4,stroke-width:2px,color:#fff
    style Spawn fill:#10131a,stroke:#00f5d4,stroke-width:1px,color:#00f5d4
    style INYECCION_PERTURBACIONES fill:#191c22,stroke:#ff9100,stroke-width:1px,color:#ff9100
    style V_Base fill:#3d000b,stroke:#ff1744,stroke-width:2px,color:#fff
    style V_WP3 fill:#003822,stroke:#00ffa3,stroke-width:2px,color:#fff
    style Certify fill:#003822,stroke:#00ffa3,stroke-width:2px,color:#00ffa3
    style PushSuit fill:#00f5d4,stroke:#00f5d4,stroke-width:2px,color:#0b0e14
```

#### Respuesta de Interfaz tras pulsar "Chaos Mode":
1. **Feedback Visual Inmediato:** El gemelo 3D proyecta una simulación cinemática acelerada en color ámbar durante 1.2 segundos mostrando 100 trazas dispersas de partículas de escape.
2. **Visualización de la Bifurcación:** El vector de retorno a Base Alpha se pinta instantáneamente en **Rojo Carmesí (`#FF1744`) con etiqueta parpadeante `ABORTED // LETHAL DOSE TIME: 26 MIN`**, demostrando empíricamente que intentar regresar al hábitat durante un SPE mataría a la astronauta por exposición a radiación ionizante antes de llegar a la esclusa.
3. **Validación Triunfal de WP3:** El vector de desvío hacia la cavidad basáltica WP3 brilla en **Verde Bio-Seguro (`#00FFA3`)** con la certificación `SURVIVAL: 99.4% [PROTECTED] // SPE DOSE AT CAVITY < 0.08 mSv`.
4. **Desbloqueo Criptográfico:** Se genera el hash SHA-256 del plan de contingencia offline y el botón interactivo principal pasa de ámbar a **Cian Brillante (`#00F5D4`)**: `[ PUSH A TRAJE EVA // LISTO PARA DESCONEXIÓN DE UMBILICAL ]`.
