# R.E.D. ATLAS — ESPECIFICACIÓN DE INGENIERÍA UX/UI (SECCIÓN 4 - FINAL)
## Modo Táctico EVA: Visor AR de Casco (Waveguide) & Display de Muñeca (Cuff Unit)
**Challenge:** Interplanetary Survival Guide: Martian Map (NASA Space Apps)  
**Usuario Objetivo:** Dra. Elena Rostova (Especialista EVA-1 / Geóloga Planetaria)  
**Normativa de Factores Humanos:** NASA-STD-3001 (Vol. 2) & ISO 9241-210 (Human-Centered Design)  
**Estilo de Diseño:** Aero Precision Control — Minimalista, funcional, alto contraste sin saturación visual.

---

## 1. PANTALLA 3 (MODO EVA - ESTADO NOMINAL): HUD AR MINIMALISTA Y BARRA "WALKBACK LIMIT DUAL"

### 1.1 Wireframe Estructural del Visor Waveguide (Campo Visual FOV 70° x 40°)

```text
+-----------------------------------------------------------------------------------------------------------------------------------+
| [!] CANYON-TRN: LOCK (0.04m) | BEARING: 034° NNE | SOL 142 · MET 04:38 | PLSS: 94% O2 · 5.2h | REFUGIO WP3: +1.8h RESERVA         |
| +-------------------------------------------------------------------------------------------------------------------------------+ |
| | [============ CONSUMIBLES O2/BATT: 94% =============]   [--- MARGEN RETORNO BASE: 2h 44m ---] | [*** ESCAPE WP3: +1.8h ***] | |
| +-------------------------------------------------------------------------------------------------------------------------------+ |
|                                                                                                                                   |
|                                                                                                                                   |
|                                                     [ WP1 · SULFATOS ISRU ]                                                       |
|                                                     | 420 m // AZM 034°   |                                                       |
|                                                     o---------------------'                                                       |
|                                                    /                                                                              |
|                                                   /                                                                               |
|                                                  /  <-- Sendero Conformal AR (Línea Continua Cian #00F5D4)                        |
|                                                 /                                                                                 |
|                                                /                                                                                  |
|                                               /                                                                                   |
|                                              /                                                                                    |
|                                             o                                                                                     |
|                                                                                                                                   |
|                                                                                                                                   |
|                                                                                                                                   |
| [ TELEMETRÍA FISIOLÓGICA ]                                                                              [ CADENCIA Y PENDIENTE ]  |
| FC: 82 BPM | VO2: 1.35 L/m                                                                              PASO: 74 SPM | INCL: 6.2° |
| TRAJE: 29.6 kPa (NOMINAL)                                                                               SUELO: REGOLITO COMPACTO  |
+-----------------------------------------------------------------------------------------------------------------------------------+
```

### 1.2 Anatomía de la Barra Superior "Walkback Limit Dual"
La **Barra de Walkback Dual** resuelve la fragmentación de indicadores críticos mediante una única escala horizontal normalizada:
1. **Segmento A (Consumibles Totales):** Barra de progreso continua que representa el valor limitante de la tríada vital ($O_2$, agua sublimador y batería Li-Ion). En estado nominal muestra un 94% con degradación asintótica.
2. **Marca 1 — Límite de Retorno a Hábitat (Base Alpha):** Línea vertical que indica el Punto de No Retorno (PNR). Se recalcula en tiempo real según el perfil topográfico ascendente de vuelta ($4.2\text{ km}$, $+202\text{ m}$ de desnivel). En estado nominal marca $02\text{h }44\text{m}$.
3. **Marca 2 — Límite de Escape a Refugio WP3 (Oquedad Basáltica):** Zona de margen extendido garantizada por la proximidad del refugio natural ($680\text{ m}$, talud descendente), otorgando $+1.8\text{h}$ de holgura operativa segura.

### 1.3 Wireframe de la Unidad de Muñeca (Cuff Display Unit - 7 pulgadas táctil/mecánica)
Diseñada para operarse con guantes rígidos presurizados RMG (pérdida del 85% de motricidad fina):
```text
+-----------------------------------------------------------------------+
|  CUFF UNIT // XEMU-04             [ ENLACE BASE: NOMINAL ]  MET 04:38 |
+-----------------------------------------------------------------------+
|  +---------------------------------+  +-----------------------------+ |
|  |     [ 1 ] CAPAS HUD CONTEXTUAL  |  |    [ 2 ] REGISTRAR MUESTRA  | |
|  |       (MALLA / PENDIENTES)      |  |         GEOLÓGICA ISRU      | |
|  +---------------------------------+  +-----------------------------+ |
|  +---------------------------------+  +-----------------------------+ |
|  |     [ 3 ] DIAGNÓSTICO TRAJE     |  |    [ 4 ] PROTOCOLO RETORNO  | |
|  |         Y CONSUMIBLES           |  |         ABORTAR A BASE      | |
|  +---------------------------------+  +-----------------------------+ |
|  [ DIAL MECÁNICO ROTATORIO: POSICIÓN 2 DE 3 // RESISTENCIA 14 N·cm ] |
+-----------------------------------------------------------------------+
```

---

## 2. PANTALLA 4 (MODO MULTIEMERGENCIA): FUSIÓN DE ALERTA ÚNICA & EVACUACIÓN A REFUGIO

### 2.1 Wireframe Estructural del HUD en Multiemergencia Simultánea

```text
+-----------------------------------------------------------------------------------------------------------------------------------+
| [!] AUTÓNOMO EDGE // CORTE NLOS | DOSIS SOLAR SPE: +3.8 mSv/min | TIEMPO A TECHO LETAL: 26 MIN | PROTOCOLO 07-ALPHA ACTIVO        |
+-----------------------------------------------------------------------------------------------------------------------------------+
| [ RETORNO BASE: INVIABLE (64 MIN / DOSIS EXCESIVA) ] ===>> [ RUTA ACTIVA: REFUGIO WP3 BASALTO // 680 m // 8 MINUTOS RESTANTES ]  |
+-----------------------------------------------------------------------------------------------------------------------------------+
|                                                                                                                                   |
|                                       / \                                                                                         |
|                                      / ! \  ALERTA FUSIONADA: EVACUAR A REFUGIO WP3                                               |
|                                     '-----' [ SPE CRÍTICO + VIENTO 35 m/s + TALUD 22° ]                                           |
|                                                                                                                                   |
|                                             [ REFUGIO WP3: 680 m ]                                                                |
|                                             | TECHO BASALTO > 5 m |                                                               |
|                                             +---------------------'                                                               |
|                                            ^                                                                                      |
|                                           / \                                                                                     |
|                                          / ^ \   <-- Chevrones Ámbar/Rojo Pulsantes (Escape Dinámico D* Lite)                     |
|                                         / / \ \                                                                                   |
|                                           / \                                                                                     |
|                                          / ^ \                                                                                    |
|                                                                                                                                   |
| [ ACCIÓN INMEDIATA COGNITIVA ]                                                                          [ CADENCIA DE ESCAPE ]    |
| CAMINAR 8 MINUTOS AL REFUGIO NORTE                                                                      OBJETIVO: 88 PASOS/MIN    |
| BLINDAJE DE ROCA CONFIRMADO 99.4%                                                                       RUMBO MAGNET: 285° OESTE  |
+-----------------------------------------------------------------------------------------------------------------------------------+
```

### 2.2 Protocolo de Triaje "Fusión de Alerta Única" (Anti-Pánico)
* **Justificación de Factores Humanos (NASA-STD-3001):** En situaciones de peligro extremo en superficie marciana (visibilidad $<4\text{ m}$, radio cortada, talud inestable y radiación ionizante), presentar 4 notificaciones separadas desencadena parálisis cognitiva y visión de túnel.
* **Mecanismo de Fusión:**
  1. El sistema sintetiza los 4 disparadores en una única directriz táctica unívoca.
  2. La barra Walkback bloquea y tacha el retorno al Hábitat (tiempo requerido $64\text{ min} > 26\text{ min}$ de dosis letal).
  3. El sendero AR sobre el regolito muta de línea continua cian a chevrones pulsantes en contraste ámbar/naranja hacia el rumbo $285^\circ$ (vector más corto y firme).
  4. **Mensaje de Voz Manos Libres Sintetizado (8 segundos):**  
     *"Alerta combinada. Retorno a Base inviable por radiación solar. Siga chevrones rumbo dos-ocho-cinco hacia refugio basáltico. Ocho minutos a paso firme."*

### 2.3 Matriz Comparativa de Comportamiento UI según Nivel de Alerta

| Componente UI | Modo Nominal (Pantalla 3) | Modo Precaución (1 Anomalía) | Modo Supervivencia Crítica (Pantalla 4) |
| :--- | :--- | :--- | :--- |
| **Barra Walkback Dual** | Verde/Cian estático; balance Base vs Refugio visible. | Ámbar en sector afectado; recálculo de margen. | Retorno a Base tachado en carmesí; foco 100% en Refugio WP3. |
| **Sendero Conformal AR** | Línea fina continua cian (`#00F5D4`), anclaje estático. | Borde punteado amarillo sobre áreas con talud $>18^\circ$. | Chevrones gruesos dinámicos ámbar/rojo indicando cadencia de escape. |
| **Iconografía Superior** | `LOS LINK: 100%` / `TRN: NOMINAL`. | `ENLACE DIFRACCIÓN: 72%` (Advertencia). | `AUTÓNOMO EDGE // CORTE NLOS` (Modo soberano sin satélites). |
| **Métricas Traje/Soporte** | Desglose completo (FC, $VO_2$, kPa, autonomía). | Resaltado del parámetro degradado. | Supresión total; únicamente tiempo restante a refugio y rumbo. |
| **Audio y Háptica** | Pings suaves azimutales a 800 Hz cada 10 s. | Alerta por tono doble en proximidad a talud. | Baliza binaural continua a 1.2 kHz y pulso direccional rítmico en muñeca. |
