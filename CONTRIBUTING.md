# Cómo contribuir

## Estructura y responsables por área

| Área | Documentación | Código y datos |
| :--- | :--- | :--- |
| Ciencia planetaria y datos | [`docs/01-planetary-science-mission/`](docs/01-planetary-science-mission/) | [`data/pipeline/`](data/pipeline/), [`data/nasa-layers/`](data/nasa-layers/), [`data/mission-scenarios/`](data/mission-scenarios/) |
| Producto y UX | [`docs/02-product-ux-ui/`](docs/02-product-ux-ui/) | [`src/base-console/`](src/base-console/), [`src/eva-tactical-hud/`](src/eva-tactical-hud/) |
| Arquitectura e IA | [`docs/03-system-architecture-ai/`](docs/03-system-architecture-ai/) | [`src/core-engine/`](src/core-engine/), [`src/shared/`](src/shared/) |
| Entrega y pitch | [`docs/04-pitch-and-submission/`](docs/04-pitch-and-submission/) | [`assets/`](assets/) |

## Reglas de los datos

- **El motor Rust sobre el terreno real es la fuente de verdad.** Las cifras de decisión (Walkback, T_vital, Chaos Mode) se regeneran con `cargo run --release --bin export_mission_results` en `src/core-engine` y los documentos citan lo que exporta.
- **Cada cifra lleva su procedencia:** [M] medida o publicada, [D] derivada por cálculo, [E] supuesto del escenario de diseño. No se inventan datos ni identificadores de producto.
- Un cambio de cifra se hace en [`DATOS_CANONICOS.md`](docs/01-planetary-science-mission/DATOS_CANONICOS.md) y en los JSON de `data/mission-scenarios/`, y después se regeneran las salidas del pipeline.

## Antes de subir cambios

```bash
cargo test --manifest-path src/shared/Cargo.toml
```

```bash
cargo test --release --manifest-path src/core-engine/Cargo.toml
```

```bash
cd data/pipeline && uv run pytest
```

```bash
npm --prefix src/base-console run build
```

## Convenciones

- Mensajes de commit con [Conventional Commits](https://www.conventionalcommits.org/): `feat(core-engine): …`, `fix(pipeline): …`, `docs: …`.
- Documentación en español con ortografía completa; identificadores de código en inglés.
- Diagramas en Mermaid embebido en Markdown.
