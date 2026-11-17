# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## [0.1.0] - 2026-11-18

Primera versión pública.

### Agregado
- **Configuración** por proyecto en `neurodanza.config.json` (`lib/config.mjs`): búsqueda hacia arriba desde la carpeta actual, valores por defecto, validación y globs `repo:glob`. Sin el archivo, el plugin no hace nada.
- **Barreras** (hook `PreToolUse`, `hooks/guardrails.mjs`): secretos `.env`, firmas de IA en commits y código, borrados de rutas raíz, rutas protegidas, migraciones inmutables y comandos prohibidos propios del proyecto (con alcance `bare` o `raw`).
- **Retroalimentación** (`hooks/feedback.mjs`): lint del archivo al editar (`PostToolUse`) y, al terminar (`Stop`), lint, tipos, pruebas relacionadas, generadores y definición de terminado (versión, bitácora, migraciones, pantallas con panel aprobado, guías, evals y docs), con un tope de bloqueos (`retroalimentacion.maxBloqueos`).
- **4 revisores** (`agents/revisor-coherencia`, `revisor-permisos`, `revisor-ui`, `revisor-docs`) que leen las reglas de `reglas.*` y responden un JSON con hallazgos.
- **Panel de personas** (`panel/panel.mjs`, agente `persona-evaluadora`): elegir de `panel.min` a `panel.max` personas según los roles que modifican las rutas cambiadas, crear sus usuarios por HTTP, navegar con Playwright (con acciones `click`, `elegir`+`opcion`, `llenar`+`valor`, `tecla`, `esperar`, `captura`), calificar contra `panel.umbral` (8.99 por defecto) y hasta `panel.maxRondas` rondas.
- **Ventana en vivo** (solo Windows, `panel.ventana: "windows"`): avatares que conversan con `decir`/`oir` y que se cierra sola al `cerrar` la ronda. Ventana de resumen con `ventana`.
- Fotos locales fuera de git recortadas al rostro (`panel/recortar-fotos.mjs` + `fotos.json`), avatares dibujados de respaldo (`panel/avatares.mjs`) y creación de personas para roles sin persona con número (`crear`, p. ej. Ana2).
- **Evals** (`evals/evals.mjs`, `/neurodanza-evals`): detección de errores sembrados, falsos positivos en el control limpio y calibración del panel.
- Regla ESLint `neurodanza/no-junk-comments`: código comentado, TODO sin ticket y atribuciones de IA.
- Skills `/neurodanza-init`, `/neurodanza-feature` y `/neurodanza-evals`.
- Plantillas (`plantillas/`) y ejemplo real de un proyecto NestJS + Next con 3 repos (`ejemplos/nest-next/`).
- Pruebas con `node --test` (`tests/`).
