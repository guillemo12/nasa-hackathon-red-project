# 🖥️ `src/base-console/` — Consola Estratégica 3D y Simulador EVA (P2 + P1 + P3)

Aplicación web **React + TypeScript + Vite + TailwindCSS + Three.js** para **R.E.D. ATLAS** (`ATLAS // Melas Chasma SW Ops`), construida sobre los 4 wireframes de `docs/wireframes/` e integrada con los datos canónicos de **P1** (`data/`) y los modelos físicos/algorítmicos de **P3** (`src/core-engine/` y `src/shared/`).

## Pantallas Implementadas

1. **Cartografía & Gemelo 3D (`Console3DView.tsx`):** Terreno 3D interactivo en Three.js de la cuenca suroeste de Melas Chasma, capas espectrales (MOLA/CTX 20m, CRISM Sulfatos $\ge 12\%\text{ H}_2\text{O}$, THEMIS Inercia $<150\text{ TIU}$, malla `h3o`), **Lupa Espacial "Spyglass" Tri-Sectorial 120°** (con toggle a *Modo X-Ray 1 Capa*) y sincronización **Eclipse Zenoh**.
2. **Planificador & Contingencia (`RoutePlannerView.tsx`):** Perfil de elevación CTX 20m, demanda metabólica Pandolf-Mars, cobertura de radio **Eclipse Zenoh / Sombra NLOS**, exportación GeoJSON del *Triángulo de Supervivencia* y simulador estocástico **Chaos Mode (Monte Carlo 100x, `XorShift64`)** comparando Retorno a Base (`0.6%`, `48 min`, `6.4 mSv`) vs Refugio WP3 (`99.4%`, `8 min / 600 m`, `SVF 0.15`).
3. **Telemetría EVA — Nominal (`EvaHudView.tsx`):** Selector interactivo de la cronología real **EVA-07** (`data/mission-scenarios/eva07_events.json`), **Barra Walkback Limit Dual**, sendero conformal AR en **Cian Eléctrico (`#00F5D4`)** y **xEMU-04 Cuff Interface** con botones sobredimensionados y dial rotatorio mecánico.
4. **Telemetría EVA — Multiemergencia (`EvaHudView.tsx`):** Activada en `T+105` (o mediante el botón `Multiemergencia`), con **Fusión de Alerta Única**, retorno a Base tachado, chevrones dinámicos ámbar/rojo hacia **WP3** y **Copiloto IA (`Candle` + `whisper-rs`)** con reproducción de voz de 8 segundos.

## Cómo ejecutarlo

```bash
cd src/base-console
npm install
npm run dev
```

Para validar tipos y compilar producción:

```bash
npm run build
```
