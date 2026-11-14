# 💻 `src/` — Arquitectura Modular del Sistema R.E.D. ATLAS (Rust + TypeScript/CesiumJS)

Este directorio contiene la estructura modular de software que refleja nuestra **Arquitectura C (Híbrida Dual Base-Traje)** con núcleo en **Rust**:

```text
src/
├── base-console/       # 🖥️ Nodo 1 (TypeScript + React + CesiumJS + Three.js + TailwindCSS + Rust WASM)
├── eva-tactical-hud/   # 🥽 Nodo 2 (HUD AR + Tablet de Muñeca conectada a ROS 2 / Eclipse Zenoh)
├── core-engine/        # 🦀 Motores en Rust: h3o Mars Grid, Canyon-TRN (nalgebra), D* Lite Metabólico y Candle/ORT AI
└── shared/             # 📐 Constantes físicas marcianas (0.38g), esquemas COG/GeoJSON/Parquet y tipos comunes
```

### Stack Tecnológico por Módulo
* **`core-engine/` (Rust 🦀):** `h3o`, `tokio`, `axum`, `nalgebra`, `rclrs` (ROS 2 Rust), `zenoh`, `candle-core` / `ort` (ONNX Runtime), `whisper-rs`, `wasm-bindgen`.
* **`base-console/` & `eva-tactical-hud/` (Web 3D / AR 🖥️):** `TypeScript`, `React`, `CesiumJS`, `Three.js` (WebGL/WebGPU Shaders), `TailwindCSS`.
* **`data/` (Ingesta Científica NASA 🛰️):** `Python` (`GDAL`, `Rasterio`, `PDS4-tools`) $\to$ `Cloud-Optimized GeoTIFF (COG)`, `Apache Parquet`, `GeoJSON`.
