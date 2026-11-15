# `src/base-console/` — Consola de R.E.D. Atlas

Aplicación web **React + TypeScript + Vite + Tailwind CSS + Three.js** para preparar y seguir la salida EVA-07 en la cuenca suroeste de Melas Chasma. Usa los datos de la misión (`data/`) y el motor de cálculo en Rust (`src/core-engine/`, `src/shared/`).

Las cifras que se ven en pantalla **no están escritas en los componentes**: salen de `data/mission-scenarios/*.json`, de `triangulo_supervivencia.geojson` y de la API. La referencia es `docs/01-planetary-science-mission/DATOS_CANONICOS_P1.md`.

El aspecto y el tono siguen [`DESIGN.md`](DESIGN.md): una sola tipografía (IBM Plex Sans), un acento, color solo para estado, lo secundario plegado y lenguaje llano. Las piezas comunes están en `src/components/ui.tsx` y los colores en `src/index.css` y `src/theme.ts`. Parte de los wireframes de `docs/wireframes/`, pero se aparta de ellos a propósito en lo visual (sin barra lateral ni pie, sin rótulos en mayúsculas).

## Pantallas

1. **Cartografía (`Console3DView.tsx`, `SpyglassLens.tsx`, `engine/twinScene.ts`):** el mapa 3D manda. Relieve real (DTM CTX de 20 m, a escala real, sin exagerar) cubierto con la **imagen orbital MRO CTX de 6 m** del sitio (mosaico controlado de USGS, co-registrado con el DTM; ver `data/nasa-layers/ortho_ctx_6m_route.json`), con pendientes, sulfatos, inercia térmica y malla hexagonal como capas activables encima. Si la imagen no carga, el terreno se pinta por cota como antes y la capa lo dice. Malla hexagonal, ruta del planificador pegada al terreno y cámara orbitable. La **lupa** lee el terreno bajo el cursor en tres capas (agua, inercia térmica y relieve) o en una sola; la rueda cambia su tamaño, `Espacio` el modo, doble clic o `Intro` fija hasta tres lupas para comparar y las flechas la mueven. Paneles plegables: capas, triángulo de supervivencia, astronauta, meteorología y enlace, margen de retorno y simulación de imprevistos.
2. **Planificador (`RoutePlannerView.tsx`, `RouteProfileChart.tsx`):** responde a «¿puedo autorizar esta salida?». Veredicto y acciones arriba; después el perfil del camino (cota, pendiente y terreno; potencia, O₂, batería y radio en «Más detalle»), los tramos con tiempo, coste y dosis, los consumibles y la **simulación de imprevistos**: el motor repite la salida con imprevistos al azar en T+105 y se compara con la referencia de la misión (10.000 salidas, semilla 42: 96,0 % a salvo con el refugio WP3 frente a 23,8 % solo con la Base). Simular autoriza el envío de la ruta al traje; también exporta el GeoJSON.
3. **Telemetría EVA (`EvaHudView.tsx`):** «Marcar punto» guarda en el motor puntos ISRU, PELIGRO o REFUGIO; se ven también en Cartografía y en el Planificador (`engine/reportedPoints.ts`, `components/ReportedPointsPanel.tsx`). Un PELIGRO abre una zona de exclusión de 50 m (y de precaución hasta 100 m) y el motor replanifica los tramos que la cruzan; la pantalla dice qué tramo se desvía, cuántos metros y minutos añade y por qué, o que un tramo queda inalcanzable. Un REFUGIO entra como candidato en la redecisión de emergencia de T+105. Un punto ISRU es solo de interés. Cronología de T−45 a T+165, estado, **margen de retorno** a la Base y al refugio WP3, y el mapa con el sendero del visor: cian en marcha, con borde punteado ámbar en taludes de más de 18°, chevrones rojos en la evacuación y verde en el refugio. En la evacuación hay una sola tarjeta con la orden (344° NNO · 595 m · 9,4 min), su voz de menos de 8 s y un botón de confirmación. `/multiemergencia` abre esta pantalla en T+105.

La barra superior lleva la navegación, el estado de la salida, el reloj de misión, «Sistema» (diagnóstico, con los códigos de estado `0x01`…`0x05`) y «Simular emergencia».

## Cómo ejecutarlo

Hacen falta **dos procesos**. La API sirve el terreno, el plan de ruta, la simulación y las reglas de seguridad; sin ella la consola sigue funcionando con los datos guardados de la misión y lo avisa en una franja (no hay mapa 3D con relieve, ni lupa, ni simulación en vivo, ni envío al traje) y se recupera sola cuando vuelve.

```bash
# 1) API Rust en http://127.0.0.1:3001
cd src/core-engine
cargo run --bin api_server
```

```bash
# 2) Consola en http://localhost:5173 (proxy /api → 127.0.0.1:3001)
cd src/base-console
npm install
npm run dev
```

Rutas: `/cartografia-3d`, `/planificador`, `/telemetria-eva`, `/multiemergencia`.

Para validar tipos y compilar producción:

```bash
npm run build
```

`npm run preview` sirve la aplicación compilada con los mismos proxies (`/api` y `/mars-trek`). Un alojamiento estático necesita esos dos proxies y redirigir las cuatro rutas a `index.html`.

## API (`src/core-engine/src/bin/api_server.rs`)

| Ruta | Qué devuelve |
|---|---|
| `GET /api/health` | Estado y recuento de celdas H3 cargadas (res 9 y res 12). |
| `GET /api/eva07?t=<min>` | Estado de la EVA-07 en ese minuto: valores por fase, O₂ y dosis integrados, posición, objetivo, rumbo y estado de `GuardrailFsm::evaluate`. |
| `GET /api/terrain` | Malla regular de 20 m (el paso del DTM CTX) con cota, pendiente, SVF, TIU, H₂O y RSSI de la malla H3 res 12. |
| `GET /api/ortho`, `GET /api/ortho.png` | Procedencia y límites (lon Este 0–360) de la imagen CTX de 6 m, y la imagen. |
| `GET /api/hexgrid` | Las 462 celdas res 9 con los vértices de cada hexágono. |
| `GET /api/spyglass?lat=&lon=&radius_m=` | Consulta de la lupa: celda central y celdas de cada sector de 120°. |
| `GET /api/route-plan` | Plan D\* Lite de cada tramo con su perfil celda a celda; con puntos marcados, cada tramo lleva `deviation` (desviado, sin cambios o inalcanzable, metros y minutos añadidos, causa) y el plan lleva `summary` y `points_version`. |
| `GET /api/points`, `POST /api/points?kind=&lat=&lon=&t=`, `DELETE /api/points[?id=]` | Puntos marcados (estado compartido en la API, en memoria: se pierde al reiniciarla). |
| `GET /api/emergency` | Redecisión de T+105 con WP3 y los refugios marcados como candidatos y los peligros aplicados a las rutas. |
| `GET /api/geojson` | GeoJSON de P1 con tiempo, coste metabólico y dosis por tramo, y el SHA-256 del paquete. |
| `GET /api/chaos-mode?seed=&trials=` | Pasada del Chaos Mode (hasta 10.000) sobre el mismo corredor que la referencia. |
| `POST /api/zenoh-sync` | Prepara y verifica (SHA-256) el paquete pre-EVA. El enlace Zenoh está simulado en la demo. |

## Limitaciones conocidas

- Las tipografías (IBM Plex Sans y JetBrains Mono) van incluidas en la aplicación. Las teselas del mapa de Telemetría EVA vienen de NASA Mars Trek (`trek.nasa.gov`); sin red queda solo el relieve del terreno.
- La inercia térmica y el agua solo existen en discos alrededor de los nodos (valores supuestos del escenario); fuera de ellos la lupa lo dice.
- El envío al traje está simulado: la API prepara el paquete y calcula su SHA-256, pero no hay enlace real.
- Los puntos marcados viven en la memoria de la API: se pierden al reiniciarla. La cronología EVA-07, la orden de voz y la tarjeta de evacuación siguen el escenario canónico (refugio WP3); la redecisión con los puntos marcados se enseña aparte.
- El mapa de Telemetría EVA sigue usando las teselas globales de Mars Trek (Viking 232 m, MOLA 463 m); la imagen CTX de 6 m solo está en Cartografía.
- Los colores de estado siguen los documentos de UX y viven en `src/theme.ts`.
