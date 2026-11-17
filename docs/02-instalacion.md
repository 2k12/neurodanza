# 2. Instalación y `/neurodanza-init`

## Instalar el plugin

```
/plugin marketplace add 2k12/neurodanza
/plugin install neurodanza@neurodanza
```

Con eso quedan registrados los hooks de `hooks/hooks.json`, los agentes de `agents/` y los skills de `skills/`. Los hooks solo actúan en proyectos con `neurodanza.config.json`.

Requisitos: Node 20+, git. Para el panel, `@playwright/test` en el proyecto y Chromium (`npx playwright install chromium`). Para la ventana en vivo, Windows.

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
