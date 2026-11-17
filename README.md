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
| **Evals** | `/neurodanza-evals` | Casos con errores sembrados y un control limpio para los revisores, y casos de calibración para el panel. |

## Instalación

En Claude Code:

```
/plugin marketplace add 2k12/neurodanza
/plugin install neurodanza@neurodanza
```

Los hooks quedan activos al instalar el plugin, pero solo actúan en proyectos que tengan `neurodanza.config.json`.

## Primer uso

En la carpeta del proyecto:

```
/neurodanza-init
```

Detecta los repos, los comandos de lint, tipos y pruebas, cómo se levanta la app y los roles. Pregunta solo lo que falta y genera la configuración, el elenco de personas, los casos de evals, la regla ESLint y la sección de `AGENTS.md`. Ver [docs/02-instalacion.md](docs/02-instalacion.md).

## Uso diario

- **`/neurodanza-feature`**: para cada funcionalidad o corrección. Entender (y esperar tu visto bueno) → implementar → verificar → 4 revisores → panel de personas con la app corriendo → cerrar.
- **`/neurodanza-evals`**: después de cambiar agentes, personas, umbrales o skills, y una vez por versión.

## Requisitos

- **Node 20 o superior** y **git** (la retroalimentación lee `git status` y `git show` de cada repo).
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

Hay un ejemplo completo en [`ejemplos/nest-next/`](ejemplos/nest-next/): la configuración de un proyecto real NestJS + Next con tres repos (`backend`, `frontend`, `docs`).

## Decisiones del proyecto

- Solo proyectos JS/TS por ahora.
- La ventana en vivo es solo para Windows (`panel.ventana`: `"windows"` o `"ninguna"`).
- Las fotos de las personas son locales y **no van a git**.
- Nunca coautoría ni firmas de IA en commits, PR o código (lo hacen cumplir las barreras y la regla ESLint).

## Pruebas del plugin

```
npm test
```

(equivale a `node --test tests/*.test.mjs`; el plugin no tiene dependencias).

## Licencia

[MIT](LICENSE) © 2026 2k12
