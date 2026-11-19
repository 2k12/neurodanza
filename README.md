# neurodanza

Plugin de Claude Code que le da a un proyecto JavaScript/TypeScript un ciclo automático de calidad.
Bloquea acciones peligrosas antes de que pasen, corre lint, tipos y pruebas de lo que cambió y no deja terminar si falta algo.
Cada cambio pasa por 4 agentes revisores que solo ven el diff.
Después, de 3 a 5 personas simuladas prueban la app real en un navegador y le ponen nota de 1 a 10.
Unos evals con respuesta conocida miden si los revisores y las personas evalúan bien.

> Por ahora solo para proyectos JS/TS. Todo se configura en un archivo, `neurodanza.config.json`, en la raíz del proyecto. En un proyecto sin ese archivo el plugin no hace nada.

## Qué hace, por capas

| Capa | Cuándo corre | Qué hace |
|---|---|---|
| **Barreras** | Antes de cada `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash` y `PowerShell` (hook `PreToolUse`) | Bloquea leer o editar `.env`, las firmas de IA en commits y en código, `rm -rf` sobre rutas raíz, editar migraciones ya creadas, las rutas protegidas y los comandos prohibidos del proyecto. |
| **Retroalimentación** | Al editar (hook `PostToolUse`) y al terminar (hook `Stop`) | Lint del archivo recién editado. Al terminar: lint, tipos y pruebas relacionadas de lo cambiado, generadores, y la definición de terminado (versión, bitácora, migraciones, guías, panel aprobado, evals). |
| **Revisores** | Paso 3 de `/neurodanza-feature` | 4 agentes en paralelo (`revisor-coherencia`, `revisor-permisos`, `revisor-ui`, `revisor-docs`) que revisan el diff sin ver el razonamiento de quien lo hizo. |
| **Panel de personas** | Paso 4 de `/neurodanza-feature` | De 3 a 5 personas (una por rol afectado) entran a la app con su propio usuario, navegan con Playwright, conversan en una **ventana en vivo** (solo Windows) y califican. Se aprueba si el promedio supera el umbral (8.99 por defecto). |
| **Modo director** | Cambios grandes, en `/neurodanza-feature` | El agente principal no edita: divide el trabajo en tareas con dueños de archivos y las delega a implementadores, cada uno en su propio worktree y con un contrato. Las barreras hacen cumplir el contrato; el director integra el diff. |
| **Constructos** | Al cerrar cada ciclo | La reflexión anota los problemas que encontraron los jueces a cada agente. Sus lecciones pasan a prueba y solo se aprueban si el problema aparece menos (y, para revisores, si las evals no empeoran). |
| **Velocidad** | Siempre | El hook `Stop` tiene tope (lo que no alcanza y la suite completa corren en segundo plano), los comandos que pueden no terminar exigen timeout, cada subagente tiene tope de tiempo y latido, y un fusible corta los reintentos contra la app o el navegador caídos. Ver [docs/15](docs/15-velocidad.md). |
| **No perder trabajo** | Siempre (subagentes) | Los hooks guardan la pila de cada subagente (qué leyó, editó y corrió); si se corta, el reemplazo retoma sin releer todo, una sola vez. Una tarea que falla por diseño se rebobina a la foto original con memoria de por qué falló. Ver [docs/16](docs/16-no-perder-trabajo.md). |
| **Seguridad práctica** | Con `figuras.activo` | Cada acción se clasifica (◯ leer △ editar □ verificar ◇ externo ✕ destructivo); fuera de la mano del agente, lo externo y destructivo se pregunta al usuario y lo demás se rechaza; tres rechazos dejan al agente en cuarentena. Fantasmas prueban fugas y escaladas contra la app local, sin editar nada. Ver [docs/17](docs/17-seguridad.md). |
| **Mapa en vivo** | Siempre, con el plugin `neurodanza-mapa` | Panel al lado del chat con la fase del ciclo, cada subagente (pasos, última herramienta, tiempo, veredicto) y el plan. Avisa al subagente que se acerca a su presupuesto de pasos o repite la misma llamada. |
| **Errores conocidos** | Al iniciar la sesión y en cada bloqueo | Cada problema de los hooks se guarda con una firma; si vuelve, el mensaje trae cómo se resolvió. |
| **Evals** | `/neurodanza-evals` | Casos con errores sembrados y un control limpio para los revisores, y casos de calibración para el panel. |

## Instalación

En Claude Code:

```
/plugin marketplace add 2k12/neurodanza
/plugin install neurodanza@neurodanza
/plugin install neurodanza-mapa@neurodanza   # opcional: mapa en vivo del ciclo
```

Los hooks quedan activos al instalar el plugin, pero solo actúan en proyectos que tengan `neurodanza.config.json`.

## Primer uso

En la carpeta del proyecto:

```
/neurodanza-init
```

Detecta los repos, los comandos de lint, tipos y pruebas, cómo se levanta la app y los roles. Pregunta solo lo que falta y genera la configuración, el elenco de personas, los casos de evals, la regla ESLint y la sección de `AGENTS.md`. Ver [docs/02-instalacion.md](docs/02-instalacion.md).

## Uso diario

- **`/neurodanza-feature`**: para cada funcionalidad o corrección. Entender y planificar (y esperar tu visto bueno) → implementar → verificar → revisores que aplican → panel de personas con la app corriendo → cerrar.
- **`/neurodanza-mapa`**: abre el mapa en vivo (se abre solo al empezar un ciclo).
- **`/neurodanza-evals`**: después de cambiar agentes, personas, umbrales o skills, y una vez por versión.

## Requisitos

- **Node 22 o superior** y **git** (la retroalimentación lee `git status` y `git show` de cada repo).
- **Para el panel de personas:** `@playwright/test` instalado en el proyecto (en la raíz o en alguno de los repos configurados) y Chromium (`npx playwright install chromium`).
- **Para la ventana en vivo:** Windows (WPF con PowerShell). En macOS y Linux el panel funciona igual, pero los resultados se ven solo en el chat.

## Documentación

1. [Cómo funciona](docs/01-como-funciona.md)
2. [Instalación y `/neurodanza-init`](docs/02-instalacion.md)
3. [Configuración (`neurodanza.config.json`)](docs/03-configuracion.md)
4. [Barreras](docs/04-barreras.md)
5. [Retroalimentación y definición de terminado](docs/05-retroalimentacion.md)
6. [Revisores](docs/06-revisores.md)
7. [Panel de personas](docs/07-panel-personas.md)
8. [Evals](docs/08-evals.md)
9. [Adaptadores: roles, login y arranque de la app](docs/09-adaptadores.md)
10. [Problemas comunes](docs/10-problemas-comunes.md)
11. [Mapa en vivo y ciclo planificador + ejecutor](docs/11-mapa-y-ciclo.md)
12. [Errores conocidos](docs/12-errores-conocidos.md)
13. [Modo director](docs/13-director.md)
14. [Constructos: agentes que aprenden, con freno](docs/14-constructos.md)
15. [Velocidad: que el harness nunca se quede colgado](docs/15-velocidad.md) · [banco de pruebas](bench/README.md)
16. [No perder trabajo: pilas, re-enfundar y rebobinar](docs/16-no-perder-trabajo.md)
17. [Seguridad práctica: figuras, cuarentena y fantasmas](docs/17-seguridad.md)

Hay un ejemplo completo en [`ejemplos/nest-next/`](ejemplos/nest-next/): la configuración de un proyecto real NestJS + Next con tres repos (`backend`, `frontend`, `docs`).

## Decisiones del proyecto

- Solo proyectos JS/TS por ahora.
- La ventana en vivo es solo para Windows (`panel.ventana`: `"windows"` o `"ninguna"`).
- Las fotos de las personas son locales y **no van a git**.
- Nunca coautoría ni firmas de IA en commits, PR o código (lo hacen cumplir las barreras y la regla ESLint).

## Pruebas del plugin

```
npm test                      # plugin principal
claude plugin test mapa       # mapa en vivo
```

(equivale a `node --test tests/*.test.mjs`; el plugin no tiene dependencias).

## Licencia

[MIT](LICENSE) © 2026 2k12
