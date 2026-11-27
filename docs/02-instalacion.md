# 2. Instalación y `/neurodanza-init`

## Instalar el plugin

```
/plugin marketplace add 2k12/neurodanza
/plugin install neurodanza@neurodanza
```

Con eso quedan registrados los hooks de `hooks/hooks.json`, los agentes de `agents/` y los skills de `skills/`. Los hooks solo actúan en proyectos con `neurodanza.config.json`.

Requisitos: Node 22+, git. Para el panel, `@playwright/test` en el proyecto y Chromium (`npx playwright install chromium`). Para la ventana en vivo, Windows.

## Actualizar un proyecto que ya tiene neurodanza

La config se combina con los valores por defecto, así que **no hace falta tocar `neurodanza.config.json`** para recibir lo nuevo. Tampoco hace falta correr `/neurodanza-init` otra vez.

1. Actualiza el plugin: `/plugin marketplace update neurodanza` y después actualiza `neurodanza` desde `/plugin`. Si no aparece la opción, desinstálalo y vuelve a instalarlo.
2. Abre una sesión nueva: los hooks se cargan al empezar.
3. Revisa la versión de Claude Code (`claude --version`): la barrera que no deja pasar una acción cuando el hook falla requiere 2.1.295 o posterior.

### Qué llega solo con la 1.9.0

| Qué | Qué cambia para ti |
|---|---|
| Campo de cliente en el código | Un cambio que toca `tenantId`, `empresaId`, `companyId`, `storeId`, `tenant_id`… ya no es riesgo bajo: entra el revisor de permisos. |
| Barrera que falla | Si el hook de barreras se cae o se pasa del tiempo, la acción **no** corre (antes corría). |
| Forks como jueces | Un fork al que se le pide juzgar un cambio, un plan o un pedido se bloquea aunque no se llame «revisor». Investigar con un fork sigue permitido. |
| Crítico del pedido | En un cambio medio o alto, `/neurodanza-feature` corre el crítico antes de planificar y pone sus objeciones en el plan. Unos 0,02 USD por pedido. |
| Panel | Una persona sin nota cuenta como nota que falta, no como 0. |

### Qué se prende a mano

Solo si lo quieres. Agrega a `neurodanza.config.json` lo que uses:

```json
{
  "ciclo": {
    "revisionEnStop": { "activo": true },
    "portero": { "activo": true },
    "critico": { "activo": false }
  },
  "noche": { "activo": true, "lote": 3, "topeTurnoUSD": 10 }
}
```

| Clave | Para qué | Guía |
|---|---|---|
| `ciclo.revisionEnStop.activo` | El `Stop` corre él mismo los revisores que pide el riesgo y bloquea con lo que encuentren, sin depender de que el agente los lance. | [29](29-revision-en-stop.md) |
| `ciclo.portero.activo` | Un modelo barato decide si un cambio medio lleva revisor. | [28](28-portero.md) |
| `ciclo.critico.activo: false` | Apaga el crítico (viene prendido). | [30](30-critico-y-turno-de-noche.md) |
| `noche.activo` | Turno de noche: corrige incidencias en ramas locales mientras no estás. Necesita fichas en `incidencias/` (`/neurodanza-incidencias`). | [30](30-critico-y-turno-de-noche.md) |

Para el turno de noche, después de prenderlo:

```
node <plugin>/lib/noche.mjs planear                   # qué incidencias tomaría
node <plugin>/lib/noche.mjs correr --lote 1           # una prueba con una sola, mirando
node <plugin>/lib/noche.mjs resumen                   # qué quedó
node <plugin>/lib/noche.mjs programar --hora 02:00    # muestra la tarea; con --crear la crea (Windows)
```

## Preparar un proyecto: `/neurodanza-init`

Se corre **una vez por proyecto** (o para revisar la configuración). Usa las plantillas de `plantillas/` y toma como modelo el ejemplo real de `ejemplos/nest-next/` (un proyecto NestJS + Next con tres repos: backend, frontend, docs).

### Paso 1. Detectar (sin preguntar)

- **Repos:** la carpeta actual si es un repo git, o sus subcarpetas con `.git` (varios repos en una carpeta).
- **Por repo** (`package.json`): gestor (pnpm, yarn o npm, por el lockfile), `scripts.lint`, `scripts.typecheck` (o `tsc --noEmit`), runner de pruebas (vitest → `npx vitest related --run {archivos}`; jest → `npx jest --bail --findRelatedTests {archivos}`), si hay ESLint y si hay `@playwright/test`.
- **App:** `docker-compose.yml` / `compose.yaml` o `scripts.dev`; los puertos expuestos van a `app.urls`.
- **Roles:** una matriz de permisos (`permissions.ts`, `roles.ts`, `ROLE_*`, enums `Role`/`UserRole` en Prisma) y mapas de pantallas por rol en docs (`docs/roles/*.md` con tabla ruta/✅).
- **Docs:** carpeta `docs/`, bitácora o changelog, guías de usuario.

### Paso 2. Preguntar solo lo que falte

Una pregunta por tema, con una opción recomendada:

- Login de la app: ruta, etiquetas de los campos usuario y clave, texto del botón y a dónde redirige.
- Cómo crear usuarios de prueba por rol (endpoint de la API) o si se crean a mano.
- Reglas propias (librería de iconos, idioma, rutas que no se tocan, comandos prohibidos).
- Umbral del panel (8.99 por defecto), cantidad de personas (3 a 5) y ventana (`"windows"` o `"ninguna"`).

### Paso 3. Generar

| # | Qué | Dónde |
|---|---|---|
| 1 | Configuración del proyecto, desde `plantillas/neurodanza.config.json` | `neurodanza.config.json` (raíz del proyecto) |
| 2 | Mapa de roles, si no hay `docs/roles/*.md` con tabla (adaptador `"json"`) | `.claude/personas/roles.json` |
| 3 | Elenco: una persona por rol, desde `plantillas/personas.json` | `.claude/personas/personas.json` |
| 3 | Cajas de recorte de las fotos (desde `plantillas/fotos.json`) | `.claude/personas/fotos.json` |
| 3 | Fotos recortadas (fuera de git: se agrega `.claude/personas/fotos/` a `.gitignore`) | `.claude/personas/fotos/*.png` |
| 3 | Avatares dibujados de respaldo | `.claude/personas/avatars/<id>.svg` y `.png` |
| 4 | Casos de evals, desde `plantillas/casos-base.json`, con rutas y personas del proyecto | `.claude/evals/casos.json` |
| 5 | Regla ESLint, copiada de `eslint/no-junk-comments.mjs` en cada repo con ESLint | `eslint-rules/no-junk-comments.mjs` |
| 6 | Sección «Ciclo de calidad (neurodanza)», de `plantillas/AGENTS-neurodanza.md` | `AGENTS.md` (o `CLAUDE.md`) de cada repo |

Detalles:

- La configuración se valida cargándola:
  ```
  node -e "import('<plugin>/lib/config.mjs').then(m=>m.loadConfig())"
  ```
- La regla ESLint se registra en `eslint.config.mjs` con `plugins: { neurodanza }` y `"neurodanza/no-junk-comments": "error"`.
- Si das una carpeta de fotos, cada persona se llama como su foto; las que sobran reutilizan una foto con número (Ana2). Se recortan con:
  ```
  node <plugin>/panel/recortar-fotos.mjs --origen <carpeta>
  node <plugin>/panel/avatares.mjs
  ```
- En los casos de evals se eligen las personas de calibración: `persona-buena` con un rol que modifica una pantalla común y `persona-rota` con una tarea que su rol **no** puede hacer.

### Paso 4. Comprobar e informar

```
node <plugin>/panel/panel.mjs elegir --rutas <una ruta>
node <plugin>/panel/panel.mjs usuarios
```

Al final da un resumen corto: qué detectó, qué preguntó, qué archivos creó y el siguiente paso (`/neurodanza-feature` en el próximo cambio; `/neurodanza-evals` para medir a los evaluadores).

> Las rutas `.claude/...` son las de la plantilla. En un proyecto de varios repos pueden vivir dentro de uno de ellos; en el ejemplo `ejemplos/nest-next/` el elenco está en `frontend/.claude/personas/personas.json` y los casos en `frontend/.claude/evals/casos.json`. Lo que manda es `panel.elenco`, `panel.fotos` y `evals.casos`.
