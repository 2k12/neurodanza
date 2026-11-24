# neurodanza

Plugin de Claude Code que le da a un proyecto JavaScript/TypeScript un ciclo automático de calidad.
Bloquea acciones peligrosas antes de que pasen, corre lint, tipos y pruebas de lo que cambió y no deja terminar si falta algo.
Según el riesgo del cambio, lo revisan hasta 4 agentes que solo ven el diff, y personas simuladas prueban la app real en un navegador y le ponen nota de 1 a 10.
Unos evals con respuesta conocida miden si los revisores, las personas y los fantasmas evalúan bien.

**Se compone de** 5 comandos, 11 agentes, 7 hooks y 22 CLI sin dependencias: [qué trae y qué hace cada comando](docs/26-comandos.md).

> Por ahora solo para proyectos JS/TS. Todo se configura en un archivo, `neurodanza.config.json`, en la raíz del proyecto. En un proyecto sin ese archivo el plugin no hace nada.

## Qué hace, por capas

| Capa | Cuándo corre | Qué hace |
|---|---|---|
| **Barreras** | Antes de cada `Read`, `Grep`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash`, `PowerShell`, `Agent` y `Task` (hook `PreToolUse`) | Bloquea leer o editar `.env`, las firmas de IA en commits y en código, `rm -rf` sobre rutas raíz, editar migraciones ya creadas, las rutas protegidas y los comandos prohibidos del proyecto. |
| **Retroalimentación** | Al editar (hook `PostToolUse`) y al terminar (hook `Stop`) | Lint del archivo recién editado. Al terminar: lint, tipos y pruebas relacionadas de lo cambiado, generadores, y la definición de terminado (versión, bitácora, migraciones, guías, panel aprobado, evals). |
| **Revisores** | Paso 3 de `/neurodanza-feature` | Hasta 4 agentes en paralelo, según el riesgo (`revisor-coherencia`, `revisor-permisos`, `revisor-ui`, `revisor-docs`) que revisan el diff sin ver el razonamiento de quien lo hizo. |
| **Panel de personas** | Paso 3 de `/neurodanza-feature`, en el mismo turno | Una persona (riesgo medio con pantallas) o de 3 a 5 (alto) entran a la app con su propio usuario, navegan con Playwright, conversan en una **ventana en vivo** (solo Windows) y califican. Se aprueba si el promedio supera el umbral (8.99 por defecto). |
| **Modo director** | Cambios grandes, en `/neurodanza-feature` | El agente principal no edita: divide el trabajo en tareas con dueños de archivos y las delega a implementadores, cada uno en su propio worktree y con un contrato. Las barreras hacen cumplir el contrato; el director integra el diff. |
| **Constructos** | Al cerrar cada ciclo | La reflexión anota los problemas que encontraron los jueces a cada agente. Sus lecciones pasan a prueba y solo se aprueban si el problema aparece menos (y, para revisores, si las evals no empeoran). |
| **Velocidad** | Siempre | El hook `Stop` tiene tope (lo que no alcanza y la suite completa corren en segundo plano), los comandos que pueden no terminar exigen timeout, cada subagente tiene tope de tiempo y latido, y un fusible corta los reintentos contra la app o el navegador caídos. Ver [docs/15](docs/15-velocidad.md). |
| **No perder trabajo** | Siempre (subagentes) | Los hooks guardan la pila de cada subagente (qué leyó, editó y corrió); si se corta, el reemplazo retoma sin releer todo, una sola vez. Una tarea que falla por diseño se rebobina a la foto original con memoria de por qué falló. Ver [docs/16](docs/16-no-perder-trabajo.md). |
| **Seguridad práctica** | Con `figuras.activo` | Cada acción se clasifica (◯ leer △ editar □ verificar ◇ externo ✕ destructivo); fuera de la mano del agente, lo externo y destructivo se pregunta al usuario y lo demás se rechaza; tres rechazos dejan al agente en cuarentena. Fantasmas prueban fugas y escaladas contra la app local, sin editar código; deciden con un resumen de la respuesta completa. Ver [docs/17](docs/17-seguridad.md). |
| **Panel con recorridos** | Con pantallas en el cambio | Antes de implementar, cada persona escribe qué espera poder hacer (pasos verificables) y el usuario lo aprueba con el plan; en el panel lo ejecuta primero y califica paso por paso. Los recorridos permanentes guardan sus métricas por versión y marcan regresiones de experiencia (más clics, más tiempo). Ver [docs/18](docs/18-panel-con-recorridos.md). |
| **Menos exploración** | Siempre | Índice del repo por commit (rutas, pantallas, modelos, exportaciones) en cada contrato y mensaje; especialistas de solo lectura que el director consulta antes de delegar, con respuestas en caché; lecciones que se recuerdan al tocar sus archivos. Ver [docs/19](docs/19-menos-exploracion.md). |
| **Proporcionalidad (ODD)** | Siempre | Cada cambio es de riesgo bajo, medio o alto (archivos sensibles, migraciones, repos y líneas): bajo corre lint, tipos y pruebas; medio, un revisor y una persona; alto, el ciclo completo. Los cambios grandes llevan un documento con el pedido textual del usuario y sus specs, y las pruebas se ven en rojo antes de implementar. Ver [docs/20](docs/20-odd-en-neurodanza.md). |
| **CLI de la app** | Cuando el agente prueba la app o verifica | `app.mjs api … --como <persona>` entra con la sesión en caché y responde compacto; `verificar` corre lint, tipos y pruebas en paralelo. Los comandos largos que se repiten se proponen como macros del proyecto. La barrera de comentarios (modo estricto) rechaza al editar los comentarios nuevos que no van. Ver [docs/21](docs/21-cli-de-la-app.md). |
| **Autoajuste** | Una vez al día, en segundo plano | Lee lo que pasó en las sesiones (transcripts, sin hooks nuevos): los rechazos repetidos se vuelven lecciones que se aprueban solo si bajan, los errores repetidos entran a los errores conocidos y los comandos largos a las macros; presupuestos y arreglos son propuestas que aplica el usuario y después se evalúan (mantener o revertir). Ver [docs/22](docs/22-autoajuste.md). |
| **Regresión mecánica** | Antes del panel, si hay recorridos permanentes | El mapa de impacto (imports y layouts) dice qué recorridos permanentes puede tocar el diff, también fuera de sus pantallas; se repiten sin modelo y se comparan con la versión aprobada (métricas y firma de cada pantalla). Solo lo que cambió va a su persona, que lo juzga en la ventana en vivo. Ver [docs/23](docs/23-regresion-mecanica.md). |
| **Incidencias** | `/neurodanza-incidencias` | Consulta la rama de desarrollo y graphify (opcional), registra incidencias de frontend y backend, compara la evidencia de antes y después, y deja «Verificada» solo al responsable. Ver [docs/24](docs/24-incidencias.md). |
| **Mapa en vivo** | Siempre, con el plugin `neurodanza-mapa` | Panel al lado del chat con la fase del ciclo, cada subagente (pasos, última herramienta, tiempo, veredicto) y el plan. Avisa al subagente que se acerca a su presupuesto de pasos o repite la misma llamada. |
| **Errores conocidos** | Al iniciar la sesión y en cada bloqueo | Cada problema de los hooks se guarda con una firma; si vuelve, el mensaje trae cómo se resolvió. |
| **Evals** | `/neurodanza-evals` | Casos con errores sembrados y un control limpio para los revisores, y casos de calibración para el panel y casos de fantasmas con varias corridas. |

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
- **`/neurodanza-incidencias`**: registrar, priorizar y corregir incidencias, con evidencia de antes y después.
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
18. [Panel con recorridos: Tenet, Westworld y guion](docs/18-panel-con-recorridos.md)
19. [Menos exploración: índice, especialistas y operador](docs/19-menos-exploracion.md)
20. [ODD en neurodanza: proporcionalidad, pedido textual y pruebas primero](docs/20-odd-en-neurodanza.md)
21. [La CLI de la app, macros y comentarios](docs/21-cli-de-la-app.md)
22. [Autoajuste: el harness se mide y se ajusta solo](docs/22-autoajuste.md)
23. [Regresión mecánica: primero sin modelo, la persona solo donde algo cambió](docs/23-regresion-mecanica.md)
24. [Incidencias: consultar, registrar y comparar antes y después](docs/24-incidencias.md)
25. [Barreras comprobadas y jueces independientes](docs/25-barreras-y-jueces.md)
26. [Qué trae y qué hace cada comando](docs/26-comandos.md)

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
