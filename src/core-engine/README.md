# 🦀 `src/core-engine/` — Motores Geoespaciales, Pathfinding e IA Offline en Rust

Núcleo algorítmico de misión crítica de **R.E.D. ATLAS** especificado por la **Persona 3 (Arquitectura e IA)** e implementado en **Rust** (*memory-safe*, determinista, sin *Garbage Collector*):

1. **`h3-mars-grid/` (Crate `h3o` + `Arrow/Parquet` + `DuckDB`):** Indexación espacial sobre malla hexagonal jerárquica adaptada al elipsoide IAU Mars 2000.
2. **`canyon-trn/` (Crate `nalgebra` + `rclrs` ROS 2):** Posicionamiento autónomo sin GPS ni radio mediante Filtro de Kalman Extendido (IMU + VIO + LiDAR + *Skyline Matching* contra las paredes de 7 km de Melas Chasma).
3. **`metabolic-dstar-lite/` (Rust Native & `wasm-bindgen`):** Planificador dinámico de rutas EVA con función de coste metabólico ($O_2$, pendiente, inercia térmica, radiación) y **Cambio Automático de Destino (*Dynamic Goal Switching*)** en $<5\text{ ms}$.
4. **`stochastic-hazard-sim/` (Rust Markov/Poisson Engine):** Generador de amenazas combinadas compilable a WebAssembly para el *"Chaos Mode"* de la Consola de Base.
5. **`neuro-symbolic-copilot/` (`Candle` / `ort` + `whisper-rs` + `zenoh`):** Máquina de estados determinista en Rust + inferencia local cuantizada a 4 bits + transcripción/síntesis de voz 100% offline.
