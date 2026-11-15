# 💻 `src/` — Software de R.E.D. ATLAS

```text
src/
├── shared/            # Crate Rust red-atlas-shared: constantes físicas, umbrales, escenario EVA-07 y struct HexCellState64B
├── core-engine/       # Crate Rust red-atlas-core: malla H3, D* Lite metabólico, Chaos Mode, máquina de estados, Canyon-TRN y API HTTP
├── base-console/      # Consola de Base: React + TypeScript + Vite + Tailwind CSS + Three.js
└── eva-tactical-hud/  # Diseño del HUD del casco (sin código propio; su lógica está en la vista de telemetría de la consola)
```

## Dependencias reales

| Módulo | Lenguaje | Dependencias |
| :--- | :--- | :--- |
| `shared/` | Rust 2021 | `serde`, `serde_json` |
| `core-engine/` | Rust 2021 | `h3o`, `parquet` (zstd), `serde`, `serde_json`; servidor HTTP con la biblioteca estándar |
| `base-console/` | TypeScript | `react`, `three`, `tailwindcss`, `lucide-react`, `vite` |

El pipeline de datos (Python, `rasterio`, `rio-cogeo`, `pyarrow`, `h3`, `duckdb`, `pystac-client`) está en [`data/pipeline/`](../data/pipeline/).

Lo que la arquitectura prevé y aún no está implementado (ROS 2 `rclrs`, Eclipse Zenoh, modelo de lenguaje local con Candle u ONNX Runtime, `whisper-rs`, compilación a WebAssembly, CesiumJS) se describe en [`ARQUITECTURA_E_IA.md`](../docs/03-system-architecture-ai/ARQUITECTURA_E_IA.md) y se marca como diseño en el [README raíz](../README.md).
