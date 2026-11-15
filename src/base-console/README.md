# 🖥️ `src/base-console/` — Consola Estratégica 3D y Simulador EVA (P2 + P1 + P3)

Aplicación web **React + TypeScript + Vite + TailwindCSS + Three.js** para **R.E.D. ATLAS** (`ATLAS // Melas Chasma SO Ops`), construida sobre los 4 wireframes de `docs/wireframes/` e integrada con los datos canónicos de **P1** (`data/`) y el motor Rust de **P3** (`src/core-engine/`, `src/shared/`).

Las cifras que se ven en pantalla **no están escritas en los componentes**: salen de `data/mission-scenarios/*.json`, de `triangulo_supervivencia.geojson` y de la API Rust. La fuente de cifras es `docs/01-planetary-science-mission/DATOS_CANONICOS_P1.md`.

## Pantallas

1. **Cartografía & Gemelo 3D (`Console3DView.tsx`, `engine/twinScene.ts`):** relieve real de la cuenca suroeste de Melas Chasma (DTM CTX de 20 m agregado a la malla H3 res 12 de P1), malla hexagonal `h3o` res 9 con sus hexágonos reales, ruta del planificador pegada al terreno, cámara orbitable y **Lupa Spyglass** de tres sectores de 120° (norte CRISM, derecha THEMIS, izquierda MOLA + SVF) que dibuja las celdas H3 de cada sector. Rueda: tamaño de la lupa (100–400 px); `Espacio`: rayos X de una capa; doble clic o `Intro`: hasta 3 lupas comparativas; flechas: mover la lupa. Paneles de traje, meteorología, Walkback Dual, Chaos Engine y perfil de ruta.
2. **Planificador & Contingencia (`RoutePlannerView.tsx`, `RouteProfileChart.tsx`):** perfil del camino D\* Lite celda a celda (cota, pendiente, potencia metabólica, O₂ y cobertura de radio), tabla de tiempo, coste y dosis por tramo, exportación del GeoJSON con esos campos y **Chaos Mode**: pasada en vivo del motor Rust frente a la referencia de P1 (`chaos_mode_results.json`: 10.000 pasadas, semilla 42, 96,0 % de misión segura con cambio al refugio frente a 23,8 % solo con la Base), histograma por amenazas simultáneas y certificación que desbloquea la sincronización del traje.
3. **Telemetría EVA (`EvaHudView.tsx`):** cronología de `eva07_events.json` (T−45 a T+165), máquina de estados compartida (`0x01` nominal, `0x02` precaución, `0x03` multiamenaza, `0x04` evacuación a WP3, `0x05` refugio), barra **Walkback Limit Dual**, sendero AR continuo con el color del estado, chevrones pulsantes en la evacuación (rumbo 344°, 595 m, 9,4 min), orden de voz única de menos de 8 s y unidad de muñeca con 4 zonas y dial de 3 posiciones. `/multiemergencia` abre esta misma pantalla en T+105.

## Cómo ejecutarlo

Hacen falta **dos procesos**. La API Rust sirve la malla de P1, el plan de ruta, el Chaos Mode y el estado del guardrail; sin ella la consola sigue funcionando con los datos de P1 en local y lo avisa en una franja ámbar (no hay gemelo 3D con relieve, ni lupa, ni Chaos Mode en vivo, ni sincronización).

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
| `GET /api/terrain` | Malla regular de 30 m con cota, pendiente, SVF, TIU, H₂O y RSSI de la malla H3 res 12. |
| `GET /api/hexgrid` | Las 462 celdas res 9 con los vértices de cada hexágono. |
| `GET /api/spyglass?lat=&lon=&radius_m=` | Consulta de la lupa: celda central y celdas de cada sector de 120°. |
| `GET /api/route-plan` | Plan D\* Lite de cada tramo con su perfil celda a celda. |
| `GET /api/geojson` | GeoJSON de P1 con tiempo, coste metabólico y dosis por tramo, y el SHA-256 del paquete. |
| `GET /api/chaos-mode?seed=&trials=` | Pasada del Chaos Mode (hasta 10.000) sobre el mismo corredor que la referencia. |
| `POST /api/zenoh-sync` | Prepara y verifica (SHA-256) el paquete pre-EVA. El enlace Zenoh está simulado en la demo. |

## Limitaciones conocidas

- La tipografía (Inter y JetBrains Mono) se carga de Google Fonts; sin red se usa la del sistema. Las teselas del mapa del HUD vienen de NASA Mars Trek (`trek.nasa.gov`); sin red queda solo el relieve de P1.
- TIU y agua solo existen en las zonas de escenario [E] de P1 (discos alrededor de los nodos); fuera de ellas la lupa dice «s/d».
- Los colores de estado siguen los documentos de UX y viven en `src/theme.ts`; `src/shared/README.md` §4 da otra paleta (decisión pendiente).
