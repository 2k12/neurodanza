---
name: neurodanza-init
description: Prepara un proyecto JS/TS para neurodanza - detecta repos, comandos de lint/tipos/pruebas, cómo se levanta la app y los roles; pregunta lo mínimo y genera neurodanza.config.json, el elenco de personas, los casos base de evals, la regla ESLint y las secciones de AGENTS.md. Úsalo una vez por proyecto, o para revisar la configuración.
---

# /neurodanza-init: preparar un proyecto

Plantillas: `<carpeta de este skill>/../../plantillas/`. Ejemplo real y completo: `<carpeta de este skill>/../../ejemplos/nest-next/`.

## 1. Detectar (sin preguntar)
- **Repos:** la carpeta actual si es un repo git, o sus subcarpetas con `.git` (monorepo de varios repos).
- **Por repo** (`package.json`): gestor (pnpm/yarn/npm por el lockfile), `scripts.lint`, `scripts.typecheck` (o `tsc --noEmit`), runner de pruebas (vitest → `npx vitest related --run {archivos}`; jest → `npx jest --bail --findRelatedTests {archivos}`), ESLint presente, `@playwright/test` presente.
- **App:** `docker-compose.yml` / `compose.yaml` o `scripts.dev`; puertos expuestos → `app.urls`.
- **Roles:** busca una matriz de permisos (`permissions.ts`, `roles.ts`, `ROLE_*`, enums `Role`/`UserRole` en Prisma) y mapas de pantallas por rol en docs (`docs/roles/*.md` con tabla ruta/✅).
- **Docs:** carpeta `docs/`, bitácora/changelog, guías de usuario.

## 2. Preguntar solo lo que falte (una pregunta por tema, con opción recomendada)
- Login de la app de prueba: ruta, etiquetas de los campos usuario/clave, texto del botón, a dónde redirige.
- Cómo crear usuarios de prueba por rol (endpoint de API) o si se crean a mano.
- Reglas propias del proyecto (librería de iconos, idioma, rutas que no se tocan, comandos prohibidos).
- Umbral del panel (por defecto 8.99), cantidad de personas (3 a 5) y ventana (`"windows"` o `"ninguna"`).

## 3. Generar
1. `neurodanza.config.json` en la raíz del proyecto, desde `plantillas/neurodanza.config.json`, con todo lo detectado y respondido. Valida cargándolo: `node -e "import('<plugin>/lib/config.mjs').then(m=>m.loadConfig())"`.
2. Roles: si hay `docs/roles/*.md` con tabla, `roles.adaptador: "markdown"`; si no, genera `.claude/personas/roles.json` (`{ "ROL": { "/ruta": true } }`, `true` = puede modificar) y usa `"json"`.
3. Elenco `.claude/personas/personas.json` desde `plantillas/personas.json`: **una persona por rol**, con nombre, cargo, perfil y lo que valora según el dominio del proyecto. Si el usuario da una carpeta de fotos, cada persona se llama como su foto; las extra llevan número (Ana2). Cajas de recorte en `.claude/personas/fotos.json`; agrega `.claude/personas/fotos/` a `.gitignore`; corre `panel/recortar-fotos.mjs --origen <carpeta>` y `panel/avatares.mjs`.
4. Evals: copia `plantillas/casos-base.json` a `.claude/evals/casos.json`, adapta las rutas de los diffs al proyecto y elige las personas de calibración (`persona-buena` con un rol que modifica una pantalla común; `persona-rota` con una tarea que su rol no puede hacer).
5. ESLint: copia `eslint/no-junk-comments.mjs` a `eslint-rules/` de cada repo con ESLint y regístrala (`plugins: { neurodanza }`, `"neurodanza/no-junk-comments": "error"`).
6. AGENTS.md (o CLAUDE.md) de cada repo: agrega `plantillas/AGENTS-neurodanza.md`.
7. `.gitignore` de la raíz: agrega `.neurodanza/*` y `!.neurodanza/errores.json` (el plan y el estado del ciclo son locales; el catálogo de errores conocidos se versiona para todo el equipo).
8. Modo director: propone agregar la carpeta de worktrees (`director.worktrees`, por defecto `../.neurodanza-wt`) a `permissions.additionalDirectories` de `.claude/settings.json`, para que los implementadores editen ahí sin pedir permiso archivo por archivo.
9. Comprueba: los hooks del plugin ya están activos (vienen con el plugin); corre `<panel> elegir --rutas <una ruta>` y `<panel> usuarios`.

## 4. Informar
Resumen corto: qué detectó, qué preguntó, archivos creados y el siguiente paso (`/neurodanza-feature` en el próximo cambio; `/neurodanza-evals` para medir a los evaluadores). Si no está instalado, sugiere el mapa en vivo: `/plugin install neurodanza-mapa@neurodanza`.
