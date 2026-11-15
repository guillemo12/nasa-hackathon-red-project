# 🥽 `src/eva-tactical-hud/` — HUD táctico del traje (diseño)

Módulo previsto para el nodo del traje: HUD de realidad aumentada en el casco y tablet de muñeca. **Todavía no tiene código propio.**

La lógica que tendría el HUD ya funciona en la consola de Base, en la vista **Telemetría EVA** ([`src/base-console/src/components/EvaHudView.tsx`](../base-console/src/components/EvaHudView.tsx)):

- Barra **Walkback Limit Dual**: margen de retorno a la Base frente al refugio WP3.
- **Triaje de alerta única**: una sola orden con rumbo, distancia y tiempo, y una frase de voz de menos de 8 s.
- Sendero con código de color: cian en marcha, ámbar en taludes y rojo en la evacuación.
- Puntos marcados por la astronauta (peligro, refugio, ISRU).

El diseño de las pantallas está en [`docs/02-product-ux-ui/helmet-vision.md`](../../docs/02-product-ux-ui/helmet-vision.md) y en los wireframes de [`docs/wireframes/`](../../docs/wireframes/).
