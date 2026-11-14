# 🤝 Guía de Trabajo en Paralelo y Flujo en Git — Equipo Red Project

Para que los 3 integrantes del equipo trabajen a máxima velocidad durante el hackathon **sin conflictos de *merge***, cada miembro tiene asignados sus propios directorios de trabajo:

---

## 👥 Asignación de Directorios por Rol

| Miembro | Rol Principal | Directorio de Documentación | Directorios de Código / Datos / Assets |
| :--- | :--- | :--- | :--- |
| **🧑‍🚀 Persona 1** | Ciencia Planetaria, Datasets NASA y Escenario Marswalk | [`docs/01-planetary-science-mission/`](./docs/01-planetary-science-mission/) | [`data/nasa-layers/`](./data/nasa-layers/), [`data/mission-scenarios/`](./data/mission-scenarios/) |
| **🎨 Persona 2** | Producto, UX/UI y Sistema Visual Multicapa | [`docs/02-product-ux-ui/`](./docs/02-product-ux-ui/) | [`src/base-console/`](./src/base-console/), [`src/eva-tactical-hud/`](./src/eva-tactical-hud/), [`assets/mockups/`](./assets/mockups/) |
| **⚙️ Persona 3** | Arquitectura Técnica, Motores GIS e IA Offline | [`docs/03-system-architecture-ai/`](./docs/03-system-architecture-ai/) | [`src/core-engine/`](./src/core-engine/), [`src/shared/`](./src/shared/), [`assets/diagrams/`](./assets/diagrams/) |
| **🏆 Los 3 (Fase 4)** | Cierre, Pitch Deck, Vídeo y Formulario NASA | [`docs/04-pitch-and-submission/`](./docs/04-pitch-and-submission/) | [`assets/pitch/`](./assets/pitch/) |

---

## 🔄 Comandos Rápidos de Sincronización en Git

1. **Antes de empezar a editar tu entregable:**
   ```bash
   git pull origin main
   ```
2. **Al pegar los resultados de tu IA en tu archivo de entregable:**
   ```bash
   git add .
   git commit -m "docs(p1/p2/p3): completar entregable con especificaciones de IA"
   git push origin main
   ```
