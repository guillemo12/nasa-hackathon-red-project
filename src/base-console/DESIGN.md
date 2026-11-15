# Diseño de la consola R.E.D. Atlas

Quien usa esta consola está preparando o siguiendo una salida a la superficie. Tiene que poder
decidir sin leer dos veces. La pantalla enseña primero lo que decide algo y deja lo demás a un clic.

## Principios

1. **Una cosa manda en cada pantalla.** Cartografía: el mapa. Planificador: el perfil de la ruta y
   su veredicto. Telemetría EVA: dónde está la astronauta y cuánto margen le queda.
2. **Plegar, no borrar.** Todo lo que pedían los wireframes sigue existiendo, pero lo secundario
   vive detrás de un panel plegado o de «Más detalle».
3. **El color es estado.** Lo normal va en tinta. Solo se colorea lo que está en ámbar o en rojo,
   y siempre con texto al lado. Verde no se usa para decir «bien»: decirlo es no colorear.
4. **Se habla como hablaría una persona del equipo.** Frases cortas, mayúsculas solo donde tocan,
   sin jerga de implementación.

## Color (tokens de `src/index.css`; nunca un hex suelto)

| Uso | Clase / token |
|---|---|
| Fondo de página, hundido, panel, elevado | `bg-ground`, `bg-sunken`, `bg-panel`, `bg-raised` |
| Líneas | `border-line` (paneles y divisores), `border-line-strong` (controles) |
| Texto principal, secundario, terciario | `text-ink`, `text-ink-2`, `text-ink-3` |
| Acento único: acción principal y selección | `bg-accent text-accent-ink`, `border-accent` |
| Ruta trazada en el mapa y en el perfil | `route` (cian de los documentos de UX) |
| Estado: bien / precaución / peligro | `ok`, `warn`, `danger` (+ `danger-ink` para texto, `danger-strong` para el fondo del botón de peligro, `*-bg` para tintes) |

- En JS, SVG y Three.js los colores salen de `src/theme.ts` (`PALETTE`, `AR_PATH`, `LEVEL_COLOR`).
- El cian es de la ruta, no de la interfaz. El acento arena es de la interfaz, no de los datos.
- Nada de degradados, brillos (`shadow-[0_0_…]`), vidrio ni bordes de color de más de 1 px. La única sombra es `shadow-pop`, para lo que flota (desplegables y avisos).
- El sendero del visor: cian en marcha (nominal y precaución), borde punteado ámbar en taludes de más de 18°, chevrones rojos en evacuación y verde en el refugio (`helmet-vision.md`).

## Tipografía

- Una familia: IBM Plex Sans, incluida en la aplicación (`@fontsource`), sin depender de la red. Cifras con `tabular-nums`. Monoespaciada (`.num`) solo para la
  telemetría numérica del visor del traje y para códigos.
- Tamaños: 12 px (`t-label`), 14 px (`text-sm`, texto y controles), 16 px (`t-value`, datos),
  20 px (título de pantalla), 28 px (la cifra clave de una pantalla). Ninguno más.
- Pesos: 400, 500 y 600. Nada de 700 u 800.
- Mayúsculas solo en siglas (EVA, WP3, SPE, O₂). Nunca frases enteras en mayúsculas ni
  `uppercase` ni `tracking-widest`.

## Forma

- Radio: `rounded-md` en controles, `rounded-lg` en paneles. Nada de píldoras salvo el punto de estado.
- Un panel es una superficie; dentro no hay cajas con borde: filas, divisores finos y espacio.
- Espaciado en pasos de 4 px; grupos apretados (8), separación entre grupos generosa (16–24).
- Objetivos táctiles de 32 px o más; texto de 12 px o más; foco visible (ya viene de `index.css`).
- Movimiento: solo el que informa (pulso en evacuación, chevrones de huida). 150–250 ms.

## Piezas (`src/components/ui.tsx`)

`Panel` (plegable con `defaultOpen`), `Stat`, `Row`, `Button` (`primary` una vez por pantalla,
`secondary`, `quiet`, `danger`), `Segmented`, `Disclosure`, `Notice`, `StatusDot`.

## Palabras

| En vez de | Decir |
|---|---|
| API Rust, motor Rust, backend | el motor de cálculo |
| P1, datos de P1 | los datos de la misión |
| D* Lite, planificador D* Lite | el planificador |
| malla H3 res 12 (141.313 celdas) | terreno a 20 m |
| [E], [D], «de escenario» | (se quita; si importa, «valor supuesto») |
| NLOS | sombra de radio |
| Walkback Limit Dual | Margen de retorno |
| Chaos Mode / Chaos Engine | Simulación de imprevistos |
| Tri-Sector / X-Ray | Tres capas / Una capa |
| SYNC BLOQUEADA: CERTIFICA ANTES | Simula la ruta antes de enviarla al traje |
| 0x04 · EVACUAR A REFUGIO WP3 | Evacuar al refugio WP3 (el código solo en «Sistema») |

Los botones dicen lo que hacen («Enviar ruta al traje», «Simular 100 salidas»). Los errores dicen
qué ha pasado y qué hacer.
