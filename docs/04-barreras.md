# 4. Barreras

Las barreras son el hook `PreToolUse` (`hooks/guardrails.mjs`). Corren **antes** de cada llamada a `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash` y `PowerShell`. Si la acción está prohibida, el hook sale con código 2 y escribe el motivo; Claude Code bloquea la herramienta y le muestra el motivo al agente:

```
Barrera (neurodanza): `prisma migrate reset` borra la base de datos. Pídeselo al usuario si de verdad hace falta.
```

Lo correcto es corregir la causa, no buscar otra forma de saltarse la barrera. Cada barrera se configura en `barreras` (ver [03-configuracion.md](03-configuracion.md#barreras)).

## Qué se bloquea

| Barrera | Clave | Herramientas | Qué bloquea |
|---|---|---|---|
| Secretos | `secretos` | `Read`, edición | Leer o editar un archivo llamado `.env` o `.env.<algo>`, salvo los de `secretosPermitidos` (`.env.example`, `.env.test`, `.env.sample`). |
| Secretos en la terminal | `secretos` | `Bash`, `PowerShell` | `cat`, `type`, `Get-Content`, `less`, `more`, `head` o `tail` sobre `.env`, `.env.local`, `.env.production` o `.env.development`. |
| Rutas protegidas | `rutasProtegidas` | edición | Editar un archivo que coincide con alguno de los globs. Muestra el `motivo` si lo diste. |
| Migraciones inmutables | `migracionesInmutables` | edición | Editar una migración que **ya existe** (puede estar aplicada). Crear una nueva sí se permite. |
| Firmas de IA en código | `firmasIA` | edición | Escribir la línea de coautoría de git (`Co-Authored-By` seguida de dos puntos), la firma «Generated with» + Claude o el emoji de robot seguido de «Generated». No aplica a los archivos de `exentos`. |
| Comentarios | `comentarios` | edición de JS/TS | Comentarios **nuevos** que no van según el modo (`"basura"` o `"estricto"`; ver [Comentarios](#comentarios)). Apagada por defecto. No aplica a los archivos de `exentos`. |
| Firmas de IA en commits | `firmasIA` | `Bash`, `PowerShell` | Un `git commit` cuyo mensaje lleva esas mismas firmas. |
| Borrados de raíz | `borradosRaiz` | `Bash`, `PowerShell` | `rm -rf` (o `-fr`) sobre `/`, `~`, `/c/` o `C:\`, y `Remove-Item … -Recurse` sobre una ruta raíz. `rm -rf dist` sí se permite. |
| Comandos prohibidos | `comandosProhibidos` | `Bash`, `PowerShell` | Cualquier comando que coincida con `patron` (expresión regular, sin distinguir mayúsculas). |

Las rutas de `rutasProtegidas`, `migracionesInmutables` y `exentos` se comparan contra la ruta **relativa a la raíz del proyecto** (donde está `neurodanza.config.json`).

## Comandos: `bare` y `raw`

Antes de comparar un comando con las reglas, se le quita lo que **no se ejecuta**:

- **`raw`**: se quitan solo los cuerpos de heredoc (`cat > a.md <<'EOF' … EOF`).
- **`bare`** (por defecto): además se quita todo lo que va entre comillas (mensajes de commit, `echo "…"`).

Así, escribir la frase «prisma migrate reset» en un documento o en un `echo` no se bloquea, pero ejecutarla sí. Usa `"alcance": "raw"` cuando lo prohibido pueda ir entre comillas, como una ruta con espacios:

```json
{ "patron": "Docker Desktop\\.exe|start-process\\s+\\S*docker|open\\s+-a\\s+docker", "motivo": "No arranques Docker Desktop: pídele al usuario que lo abra.", "alcance": "raw" }
```

La regla de secretos en la terminal es `raw` (se bloquea aunque la ruta vaya entre comillas); la de borrados de raíz es `bare`.

## Ejemplo

```json
"barreras": {
  "rutasProtegidas": [{ "glob": "backend/src/modules/einvoice/legacy-*", "motivo": "Módulo congelado: no se tocan sus archivos." }],
  "migracionesInmutables": "backend/prisma/migrations/*/migration.sql",
  "comandosProhibidos": [
    { "patron": "prisma\\s+migrate\\s+reset", "motivo": "`prisma migrate reset` borra la base de datos. Pídeselo al usuario si de verdad hace falta." },
    { "patron": "--accept-data-loss", "motivo": "`--accept-data-loss` puede borrar datos. Crea una migración en su lugar." }
  ],
  "exentos": ["**/guardrails*.{mjs,ts}", "**/no-junk-comments*"]
}
```

`exentos` existe porque los archivos que **definen** la regla contra firmas de IA (como `guardrails.mjs` o `no-junk-comments.mjs`) tienen que contener esos textos.

## Apagar una barrera

Las barreras del plugin se apagan con `false`:

```json
"barreras": { "borradosRaiz": false }
```

## Comandos que pueden no terminar

Servidores, modos watch y suites completas sin `timeout` (o sin `run_in_background`) se rechazan con la forma exacta de correrlos (`barreras.timeoutComandos`). Y cada subagente tiene un tope de tiempo: al 100 % la barrera le rechaza toda herramienta nueva. Ver [15-velocidad.md](15-velocidad.md).

## Modo director

Con el modo director activo (`lib/director.mjs activar`), las barreras distinguen al agente principal de los subagentes: el principal no edita ni corre comandos que modifiquen archivos (delega), y cada implementador edita solo en su worktree y dentro de los archivos de su contrato. Las rutas protegidas y las migraciones inmutables se aplican también dentro de los worktrees. Ver [13-director.md](13-director.md).

## Comentarios

Con `barreras.comentarios`, la barrera rechaza al **editar** (`Edit`, `Write`, `MultiEdit` en `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`) los comentarios **nuevos** que no van. Así el agente no los escribe: no hace falta una ronda de lint para borrarlos. Los que ya estaban en el archivo no cuentan (se comparan con el texto de antes), así que la barrera no obliga a limpiar código ajeno.

| Modo | Rechaza |
|---|---|
| `"basura"` | Código comentado y `TODO`/`FIXME`/`XXX`/`HACK` sin ticket. |
| `"estricto"` | Todo comentario, salvo: directivas (`eslint-…`, `@ts-…`, `prettier-ignore`, `#region`, `/// <reference>`…), JSDoc **con etiquetas de API** (`@param`, `@returns`, `@throws`, `@deprecated`, `@example`, `@see`, `@type`…) de algo **exportado**, y `// POR QUÉ: …` (la decisión que el código no puede decir: un requisito legal, un error de una librería, un límite de la API). |

El análisis salta textos, plantillas (con `${…}`) y expresiones regulares: `"http://x"`, `` `a // b` `` o `/\/\//` no son comentarios. El mensaje dice qué comentario, en qué línea y por qué:

```
neurodanza: comentarios que no van (barreras.comentarios: estricto): línea 1: «//Calcula el total del pedido» (comentario explicativo). Quítalos: el código se explica con buenos nombres. Solo van directivas (eslint, @ts-…), JSDoc de lo exportado y `// POR QUÉ: …` para una decisión que el código no puede decir.
```

**Medido** sobre los 1123 archivos TypeScript de un proyecto real (NestJS + Next), tomando cada archivo como si fuera nuevo: el modo estricto rechaza el **99,1 %** de los comentarios del backend (2283 de 2303) y el **99,5 %** del frontend (1811 de 1820); el análisis tarda en total 0,7 s por repo, 14 ms el archivo más lento. Lo que queda son directivas y JSDoc con etiquetas. Con JSDoc en prosa de lo exportado permitido rechazaba el 74,1 % y el 55,4 %: por eso el estricto pide etiquetas.

## La regla ESLint `neurodanza/no-junk-comments`

Complementa las barreras dentro del código. `/neurodanza-init` la copia a `eslint-rules/` de cada repo con ESLint y la registra (`plugins: { neurodanza }`, `"neurodanza/no-junk-comments": "error"`). Marca en los comentarios:

- **Código comentado** (imports, declaraciones, llamadas, JSX…): «Código comentado: bórralo (git guarda la historia).» Los JSDoc (`/** … */`) no se revisan, para que puedan llevar ejemplos.
- **`TODO`, `FIXME`, `XXX`, `HACK` sin ticket**: se acepta `TODO(#123): …`.
- **Atribuciones de IA** en inglés o español (coautoría, «generado por/con» Claude, ChatGPT, Copilot o IA).

Las directivas (`eslint-disable`, `@ts-expect-error`, `prettier-ignore`, `#region`…) se ignoran.

Con `"neurodanza/no-junk-comments": ["error", { "modo": "estricto" }]` aplica el criterio de la barrera en modo estricto, también a los comentarios que ya estaban (sirve para limpiar un repo a propósito; la barrera solo mira los nuevos). `/neurodanza-init` la registra así cuando el proyecto usa `barreras.comentarios: "estricto"`.
