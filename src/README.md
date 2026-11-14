# 💻 `src/` — Arquitectura Modular del Sistema R.E.D. ATLAS

Este directorio contiene la estructura modular de software que refleja nuestra **Arquitectura C (Híbrida Dual Base-Traje)**:

```text
src/
├── base-console/       # 🖥️ Nodo 1 (Servidor del Hábitat): Visor 3D de Melas Chasma, Lupa "Spyglass" de 3 sectores y Simulador "Chaos Mode"
├── eva-tactical-hud/   # 🥽 Nodo 2 (Edge del Traje EVA): HUD AR minimalista, Barra "Walkback Limit Dual", Tablet de Muñeca y Triaje de Alerta Única
├── core-engine/        # ⚙️ Motores Compartidos: Malla Hexagonal H3 Mars 2000, Pathfinding D* Lite Metabólico, Canyon-TRN y Copiloto IA Neuro-Simbólico
└── shared/             # 📐 Constantes físicas marcianas (0.38g), esquemas de datos PDS y utilidades comunes
```

### Relación con los 3 Carriles de Diseño
* **Persona 1 (Ciencia):** Define los umbrales y constantes en `src/shared/` y `data/`.
* **Persona 2 (UX/UI):** Especifica los componentes e interfaces de `src/base-console/` y `src/eva-tactical-hud/`.
* **Persona 3 (Arquitectura e IA):** Especifica los algoritmos y subsistemas de `src/core-engine/`.
