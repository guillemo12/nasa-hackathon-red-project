# 📐 `src/shared/` — Constantes Físicas Marcianas, Esquemas Comunes y Contratos Zenoh/ROS 2

**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*)  
**Responsable de Especificación:** Persona 3 (Arquitectura e Integración) en coordinación con Persona 1 (Ciencia) y Persona 2 (UX/UI)  
**Modalidad:** Especificación técnica compartida sin código fuente de programación (fuente única de verdad entre `core-engine/`, `base-console/` y `eva-tactical-hud/`).

---

## 1. Constantes Físicas, Geodésicas y Biomecánicas Marcianas

Todos los subsistemas (pipeline Python `GDAL`, motor en Rust `core-engine` nativo/WASM y visualizador `CesiumJS/Three.js`) operan bajo exactamente las mismas constantes oficiales:

| Constante / Parámetro | Símbolo | Valor Oficial en **R.E.D. ATLAS** | Unidades | Fuente / Referencia |
| :--- | :--- | :--- | :--- | :--- |
| **Aceleración Gravitatoria en Marte** | $g_M$ | `3.72076` ($0.3794\, g_E$) | $\text{m/s}^2$ | Estándar IAU / NASA Mars Fact Sheet |
| **Radio Ecuatorial Marciano** | $R_{\text{eq}}$ | `3396.19` | $\text{km}$ | Elipsoide de Referencia **IAU Mars 2000** |
| **Radio Polar Marciano** | $R_{\text{pol}}$ | `3376.20` | $\text{km}$ | Elipsoide de Referencia **IAU Mars 2000** |
| **Radio Medio Volumétrico (Escalado `h3o`)** | $R_{\text{Mars}}$ | `3389.50` (factor $0.5320\times$ Tierra) | $\text{km}$ | Calibración métrica de celdas hexagonales H3 |
| **Datum Vertical de Referencia** | $z_0$ | Equipotencial MOLA ($0\text{ m}$) | $\text{m}$ | *MGS Mars Orbiter Laser Altimeter* |
| **Presión Atmosférica Base (Melas Chasma)** | $P_{\text{atm}}$ | `8.8 – 10.5` (cota $\approx -4.2\text{ km}$) | $\text{mbar}$ | Extrapolación barométrica desde datum ($6.1\text{ mbar}$) |
| **Latencia de Comunicación Tierra-Marte** | $\Delta t_{\text{Earth}}$ | `182 – 1340` ($3.0\text{ – }22.3\text{ min}$) | $\text{s}$ | Distancia orbital mínima/máxima (justifica Edge Offline) |
| **Masa Total Astronauta + Traje EVA** | $m_{\text{total}}$ | `130.0` ($75\text{ kg} + 55\text{ kg}$ traje) | $\text{kg}$ | Modelo biomecánico Pandolf adaptado (`D* Lite`) |
| **Equivalente Energético del Oxígeno** | $k_{O_2}$ | `20920` | $\text{J / L}_{O_2}\text{ (STP)}$ | Conversión de tasa metabólica ($\text{W}$) a consumo $\dot{V}_{O_2}$ |
| **Margen de Seguridad *Walkback Limit*** | $\alpha_{\text{sec}}$ | `0.85` (15% reserva obligatoria) | adimensional | Regla determinista de *Dynamic Goal Switching* |

---

## 2. Esquemas de Datos Compartidos (Base $\leftrightarrow$ Traje $\leftrightarrow$ Frontend)

Para evitar divergencias entre el backend en **Rust**, el pipeline de **Python** y el frontend en **TypeScript / React**, los formatos de intercambio están estandarizados en tres contratos:

| Formato Estándar | Entidad de Datos | Consumidores Principales | Contenido y Restricciones |
| :--- | :--- | :--- | :--- |
| **Cloud-Optimized GeoTIFF (`COG`)** | Rasters continuos de Melas Chasma (`MOLA/HRSC`, `HiRISE`, `THEMIS`, `CRISM`) | `CesiumJS`, `Three.js`, `Python GDAL` | Proyección IAU Mars 2000, pirámides internas (*overviews*) para *streaming* de teselas por rangos HTTP. |
| **Apache Parquet + Struct 64B** | Vector de Estado Tensorial por celda hexagonal `h3o` (`Res 7–14`) | `Rust Core`, `DuckDB Spatial`, `WASM Spyglass` | 12 atributos físicos empaquetados (`u64` `h3_index`, `f32` elevación, pendiente, TIU, $\% \text{H}_2\text{O}$, $\Psi_{\text{SVF}}$, RSSI, coste base) + `padding_crc` contra SEU. |
| **GeoJSON (RFC 7946 adaptado)** | Nodos del *"Triángulo de Supervivencia"* y rutas exportadas (`A*` / `D* Lite`) | `React HUD`, `Tablet de Muñeca`, `ROS 2 rclrs` | Geometrías `Point` / `LineString` con propiedades de coste metabólico acumulado, dosis SPE esperada y tiempo estimado por tramo. |

---

## 3. Contratos de Mensajes y Tópicos sobre Eclipse Zenoh / ROS 2 (`rclrs`)

La comunicación entre la Consola de Base (Nodo 1) y el Traje EVA (Nodo 2), así como la comunicación interna entre procesos del traje, utiliza el bus **ROS 2 (`rclrs`)** puenteado hacia radio UHF mediante **Eclipse Zenoh**:

| Tópico / *Key Expression* Zenoh | Dirección | Frecuencia | Tamaño Máx. | QoS & Comportamiento en Sombra de Radio (`NLOS`) |
| :--- | :--- | :--- | :--- | :--- |
| `redatlas/eva07/mission/bundle_sync` | Base $\to$ Traje | Pre-EVA (1 vez) | $\le 48\text{ MB}$ | *Reliable + SHA-256.* Transfiere sub-malla `h3o`, horizontes `Skyline Matching` y GeoJSON inicial. |
| `redatlas/eva07/trn/pose_state` | Traje interno / $\to$ Base | `50 Hz` (local) / `1 Hz` (UHF) | `96 bytes` | *Best-Effort* en UHF. Pose `Canyon-TRN` (`nalgebra` EKF) + covarianza; en NLOS se graba en *ring-buffer* CRDT. |
| `redatlas/eva07/plss/telemetry` | Traje $\to$ Base | `1 Hz` | `128 bytes` | Biometría ($O_2$, LCVG, batería), tasa $\dot{V}_{O_2}$, dosis RAD y estado del Guardrail. Replay automático al reconectar. |
| `redatlas/eva07/nav/walkback_dual` | `D* Lite` $\to$ HUD / Base | `1 Hz` | `256 bytes` | Valores $T_{\text{vital}}$, $T_{\text{walkback, Base}}$, $T_{\text{walkback, WP3}}$, destino activo $G_{\text{target}}$ y polilínea de escape. |
| `redatlas/eva07/guardrail/single_alert` | Guardrail $\to$ `Candle` & HUD | Por evento (`< 1 ms`) | `192 bytes` | Frame validado determinista para el **Triaje de Fusión de Alerta Única** (causa prioritaria, color AR, slots para voz). |
| `redatlas/mars/weather/canyon_delta` | Base $\to$ Traje | `0.1 Hz` (si LOS) | `512 bytes` | Actualizaciones climáticas macro (`MCS/MEDA`): opacidad $\tau$ y alertas tempranas de tormenta solar SPE. |

---

## 4. Máquina de Estados Compartida (`Safety Guardrail FSM`)

Todos los componentes visuales (Consola 3D de Base, HUD AR del Casco y Tablet de Muñeca) reaccionan de manera unívoca al código de estado emitido por la capa simbólica determinista en Rust:

| Código de Estado | Condición de Activación | Color del Sendero AR (`Three.js`) | Comportamiento del Copiloto IA (`Candle` + `whisper-rs`) |
| :--- | :--- | :--- | :--- |
| `0x01_NOMINAL` | Todas las variables en rango Verde y $T_{\text{walkback, Base}} \le 0.70\, T_{\text{vital}}$. | Cian `#00F0FF` | Escucha pasiva por comando de voz para consultas geológicas/ISRU (`CRISM`/`THEMIS`). |
| `0x02_CAUTION` | 1 variable en Ámbar (ej. $\theta \in [15^\circ, 20^\circ]$ o $I < 180\text{ TIU}$ o NLOS aislado). | Ámbar `#FFB000` | Aviso breve único; icono pasivo de modo autónomo si hay `H4_NLOS`. |
| `0x03_MULTI_HAZARD` | $\ge 2$ amenazas activas simultáneas, pero retorno a Base aún viable ($\le 0.85\, T_{\text{vital}}$). | Ámbar Pulsante | Activa **Triaje de Fusión de Alerta Única** priorizando la amenaza de mayor riesgo vital. |
| `0x04_EVAC_SHELTER` | Se cumple condición de ***Dynamic Goal Switching*** ($G_{\text{target}} \to \text{WP3}$). | Rojo/Ámbar Pulsante `#FF2A2A` | Tacha Base en barra *Walkback Limit Dual* y emite orden única de voz ($\le 8\text{ s}$) hacia el escarpe WP3. |
| `0x05_SHELTER_HOLD` | Astronauta dentro del radio de $15\text{ m}$ del Refugio WP3 ($\Psi_{\text{SVF}} \le 0.20$). | Verde Esmeralda `#00E676` | Confirma blindaje topográfico ($\ge 80\%$ atenuación SPE), reduce consumo CPU a modo espera y monitorea recuperación Zenoh. |
