# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## 0.4.0 · 2026-11-18

### Cambiado
- Ventana en vivo del panel rediseñada como **Role Agents**: lista de personas a la izquierda con scroll (foto, nombre tal cual, cargo, estado y nota; resalta a quien habla) y conversación vertical a la derecha con la foto de cada persona. Al cerrar, la lista se ordena por nota y el pie muestra el veredicto. Oscura y minimalista, con barra de scroll propia.

## 0.3.0 · 2026-11-18

### Agregado
- **Modo director** (`lib/director.mjs`, `docs/13-director.md`): el agente principal dirige y no edita; cada tarea la hace un `implementador` en su propio worktree, creado desde una foto del estado actual (incluye lo que no está en commit) y con los `node_modules` del repo real enlazados. `integrar` revisa que lo cambiado esté dentro del contrato, aplica el diff (con 3 vías si hace falta) y borra el worktree sin tocar las dependencias reales.
- Agente `implementador`: cumple un contrato (objetivo, archivos, condición de terminado, presupuesto de 60 pasos) y responde un JSON.
- Barreras del modo director: el principal no edita ni corre comandos que modifiquen archivos; cada subagente edita solo en su worktree y dentro de su contrato. Rutas protegidas y migraciones inmutables valen también en los worktrees. Lint al editar dentro de los worktrees.
- Configuración `director` (`worktrees`, `enlazar`) y `ciclo.maxPasos.implementador`.
- Mapa 0.2.0: `◆ modo director`, implementadores como nodos de la fase 1 con el nombre de su tarea y su presupuesto.

## 0.2.0 · 2026-11-18

### Agregado
- **Mapa en vivo** (plugin nuevo `neurodanza-mapa`, carpeta `mapa/`): panel con scroll al lado del chat con la fase del ciclo (deducida de lo que hace el agente, con vueltas), cada subagente como nodo (pasos, última herramienta, tiempo, veredicto; clic para ver su conversación), la última verificación del hook `Stop` y el plan. Línea de estado con el resumen. Comando `/neurodanza-mapa`.
- **Presupuesto de pasos por subagente** (`ciclo.maxPasos`: revisores 25, personas 40): el mapa le avisa al subagente al 80 %, al tope y si repite la misma llamada 3 veces.
- **Planificador + ejecutor**: el paso 0 de `/neurodanza-feature` escribe `.neurodanza/plan.md` con pasos y condiciones de terminado; el agente lo marca y lo relee si se pierde.
- **Errores conocidos** (`lib/errores.mjs`, `errores.*`): cada problema de los hooks se guarda con una firma estable y un contador por sesión; si vuelve, el mensaje trae la solución anotada. Hook `SessionStart` que carga los más útiles como contexto. Comandos `listar`, `resolver` y `buscar`.
- `lib/ciclo.mjs revisores`: qué revisores aplican al diff de la rama y por qué (`ciclo.revisores`: `"segun-cambio"` o `"todos"`).

### Cambiado
- **Hook `Stop` más rápido**: lint, tipos y pruebas corren en paralelo (y los repos también), y un repo cuyo cambio no se movió reutiliza el resultado anterior (`retroalimentacion.cache`). Escribe tiempos y resultado en `.neurodanza/estado.json`.
- Los 4 revisores corren con `model: sonnet` y entregan lo que tienen al llegar a su presupuesto.
- Panel de personas: en la ronda siguiente solo se vuelve a evaluar a quien reprobó o usa una ruta que tocó el arreglo.
- `/neurodanza-init` agrega `.neurodanza/*` y `!.neurodanza/errores.json` a `.gitignore` y sugiere instalar el mapa.

## 0.1.2 · 2026-11-18

- El hook Stop ya no bloquea en ciclo: tras `maxBloqueos` intentos con los mismos problemas deja terminar (avisa una vez) hasta que los problemas cambien. Antes reiniciaba el contador y volvía a bloquear sin fin (por ejemplo, esperando un panel que depende de algo externo).

## 0.1.1 · 2026-11-18

- El recordatorio de docs solo cuenta cambios de código (`repos[].codigo`) y acepta los docs ya commiteados en la rama: antes avisaba por un `AGENTS.md` o con los docs ya en un commit.

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
