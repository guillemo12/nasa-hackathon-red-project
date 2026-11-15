# 🦀 `src/core-engine/` — Motor de misión en Rust

Crate `red-atlas-core`: los cálculos de los que salen las cifras de R.E.D. ATLAS. Rust 2021, sin recolector de basura, con dependencias mínimas (`h3o`, `parquet`, `serde`). Usa las constantes del crate [`../shared`](../shared/README.md).

## Módulos

| Fichero | Qué hace |
| :--- | :--- |
| [`src/h3_mars_grid.rs`](src/h3_mars_grid.rs) | Malla hexagonal con índices H3 reales (`h3o`, métricas escaladas a la esfera de Marte) y carga directa de la malla de terreno (`data/nasa-layers/hexgrid_route_res12_hexcell64b.parquet`, 141.313 celdas, ≈120 ms). Consulta medida en release: celda por índice 0,04 µs (p95 0,13 µs) y lupa de 100 m con 3 sectores 63 µs (p95 69 µs). |
| [`src/metabolic_dstar.rs`](src/metabolic_dstar.rs) | Planificador D\* Lite con coste metabólico (pendiente, inercia térmica, deslizamiento) y cambio automático de destino. Replanificación medida de 17 ms (mediana, release, corredor de ±200 m; 154 ms sin corredor). |
| [`src/mission.rs`](src/mission.rs) | Cronología de la EVA-07 y decisión de T+105: retorno a la Base en 48 min sobre 2,15 km frente a refugio WP3 en 9,4 min, con dosis de decisión de 5,30 y 0,89 mSv. |
| [`src/stochastic_hazard.rs`](src/stochastic_hazard.rs) | Motor de amenazas combinadas Markov/Poisson y Chaos Mode: 96,0 % de misión segura con cambio al refugio frente a 23,8 % solo con la Base (10.000 simulaciones, semilla 42). |
| [`src/neuro_symbolic.rs`](src/neuro_symbolic.rs) | Máquina de estados de seguridad de 5 estados, triaje de alerta única y frase de voz generada por plantilla determinista. El modelo de lenguaje local es diseño, no está integrado. |
| [`src/canyon_trn.rs`](src/canyon_trn.rs) | Filtro de Kalman de error de estado para posicionamiento sin GPS (IMU, VIO, LiDAR y *skyline matching*), probado con datos simulados. |
| [`src/reported_points.rs`](src/reported_points.rs) | **`reported_points.rs` (puntos que marca la astronauta):** un PELIGRO es una zona de exclusión de 50 m y de precaución hasta 100 m (coste ×3), constantes en `src/shared` (`REPORTED_HAZARD_*`). `MetabolicDStarPlanner::set_zone_penalties` la aplica a la búsqueda D\* Lite y al suavizado; solo se replanifican los tramos cuya ruta nominal entra en una zona, y si el corredor de ±200 m queda cortado se busca en toda la malla antes de declarar el tramo inalcanzable, con el motivo. Un REFUGIO es candidato en la decisión de T+105 (`t105_decision_with_reports`): gana el refugio que la malla confirma (SVF ≤ 0,20) al que se llega antes; uno a cielo abierto solo si no hay otro alcanzable. Un ISRU es solo de interés. Sin puntos, todo coincide con el plan nominal y con la decisión canónica (`cargo test --release --test reported_points`). |

## Binarios

| Binario | Uso |
| :--- | :--- |
| `api_server` | API HTTP local en `127.0.0.1:3001` para la consola (`/api/health`, `/api/eva07`, `/api/terrain`, `/api/hexgrid`, `/api/spyglass`, `/api/route-plan`, `/api/chaos-mode`, `/api/points`…). |
| `eva07_mission_sim` | Simulación completa de la EVA-07 en terminal, comparada con la cronología de referencia del pipeline. |
| `export_mission_results` | Regenera `data/mission-scenarios/planner_walkback.json` y `chaos_mode_results.json`, que leen el pipeline y la consola. |

```bash
cargo run --release --bin api_server
cargo run --release --bin export_mission_results
cargo test --release
cargo test --release --test terrain_grid -- --ignored --nocapture res12_query_benchmark
```

La especificación completa, incluida la parte que aún es diseño (ROS 2, Zenoh, modelo de lenguaje local), está en [`ARQUITECTURA_E_IA.md`](../../docs/03-system-architecture-ai/ARQUITECTURA_E_IA.md).
