# 📙 Producto, UX/UI y sistema visual
**Proyecto:** **R.E.D. ATLAS** (*Reconnaissance, EVA & Dynamic-survival Atlas*)
**Equipo:** Red Project — NASA Space Apps Challenge 2026
**Área:** Producto y UX

Este documento reúne la especificación de producto y de interfaz. Son documentos de **diseño**: describen la experiencia completa prevista para la Base y para el traje. Lo que está construido es la consola web de [`src/base-console/`](../../src/base-console/README.md), que sigue este diseño con algunas diferencias deliberadas:

- Usa React + Three.js en lugar de CesiumJS.
- El motor corre como API local en Rust, no compilado a WebAssembly.
- El HUD del casco se reproduce dentro de la consola, en la vista «Telemetría EVA».

Las cifras de la misión que aparecen en estos documentos siguen [`DATOS_CANONICOS.md`](../01-planetary-science-mission/DATOS_CANONICOS.md): refugio WP3 en 9,4 min, retorno a la Base en 48 min sobre 2,15 km, Chaos Mode 96,0 % frente a 23,8 % y replanificación en 17 ms. Los valores que aparecen dentro de los wireframes ASCII son ilustrativos.

| Documento | Contenido |
| :--- | :--- |
| [`product-vision.md`](product-vision.md) | Usuarios (comandante de Base y astronauta geólogo), restricciones ergonómicas en Melas Chasma, sistema visual de alto contraste, interacción multimodal y flujo de usuario de la consola a la multiemergencia |
| [`strategic-3d-console.md`](strategic-3d-console.md) | Consola 3D de Base: explorador de Melas Chasma, lupa Spyglass de tres sectores, planificador metabólico de ruta y simulador Chaos Mode |
| [`helmet-vision.md`](helmet-vision.md) | Modo táctico EVA: HUD de casco, barra Walkback Limit Dual, unidad de muñeca y protocolo de alerta única en multiemergencia |
| [`../wireframes/`](../wireframes/) | Wireframes de las pantallas principales |
| [`../../src/base-console/DESIGN.md`](../../src/base-console/DESIGN.md) | Reglas visuales y de lenguaje de la consola implementada |
