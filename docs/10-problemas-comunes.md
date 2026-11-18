# 10. Problemas comunes

## Git Bash convierte las rutas (`/app` → `C:/Program Files/Git/app`)

En Git Bash de Windows, un argumento que empieza con `/` se convierte en una ruta de Windows antes de llegar a Node. `--rutas /app/pedidos` llega como `C:/Program Files/Git/app/pedidos` y la persona abre una pantalla que no existe.

Antepón `MSYS_NO_PATHCONV=1`:

```
MSYS_NO_PATHCONV=1 node <plugin>/panel/panel.mjs navegar --persona ana --rutas /app/pedidos --salida <carpeta>
```

En PowerShell o cmd no hace falta.

## Tildes rotas en la ventana (PowerShell 5)

Windows PowerShell 5.1 lee los `.ps1` sin BOM como ANSI, y los textos con tildes («Contraseña», «Revisión») salen mal. Por eso `panel/live-window.ps1` y `panel/window.ps1` se guardan **en UTF-8 con BOM**. Si los editas, conserva el BOM (en VS Code: «Save with Encoding» → «UTF-8 with BOM»).

Los datos de la ronda (`ronda.jsonl`) se leen siempre como UTF-8, así que lo que dicen las personas no tiene este problema.

## La ventana en vivo no aparece

Revisa en orden:

1. **Sistema:** solo existe en Windows. En macOS y Linux `en-vivo` responde `ronda iniciada (sin ventana)` y el resultado se ve en el chat.
2. **Configuración:** `panel.ventana` debe ser `"windows"`. Con `"ninguna"` no se abre.
3. **Salida de `en-vivo`:** debe decir `ventana en vivo abierta · <ruta>/ronda.jsonl`.
4. **Detrás de otra ventana:** se abre siempre encima y centrada, pero algunas aplicaciones a pantalla completa la tapan; búscala en la barra de tareas («Panel de personas · neurodanza (en vivo)»).
5. **Errores de la ventana:** quedan en `ronda.jsonl.log`, en la carpeta de la ronda.
6. **Prueba a mano** (con consola visible, para ver el error):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -STA -File <plugin>\panel\live-window.ps1 -State <carpeta>\ronda.jsonl
   ```
   Si `wscript.exe` está bloqueado por una política del equipo, la ventana no puede lanzarse oculta.
7. **Sin fotos en las tarjetas:** la ventana muestra la imagen solo si existe `<panel.fotos>/<foto>.png` o `avatars/<id>.png`. Corre `recortar-fotos.mjs` o `avatares.mjs` (los PNG de avatares necesitan Playwright).

Recuerda que se cierra sola 12 s después de `cerrar`, o tras 45 minutos sin mensajes.

## Playwright no instalado

```
No encontré @playwright/test en el proyecto: instálalo (pnpm add -D @playwright/test) y corre `npx playwright install chromium`.
```

El panel usa el Playwright del proyecto (raíz o algún repo de `repos`). Instálalo en uno de ellos y descarga Chromium:

```
pnpm add -D @playwright/test
npx playwright install chromium
```

Sin Playwright, `avatares.mjs` solo genera los SVG y `recortar-fotos.mjs` no corre.

## Puertos: las personas abren la app equivocada o ninguna

- `panel.mjs` usa la primera URL de `app.urls` cuya ruta de login responde. Si ninguna responde, usa la primera igual, y el login falla.
- Comprueba que la app esté levantada **con el código nuevo** (`app.levantar`) y en qué puerto.
- Si tienes otra app en el mismo puerto (otro proyecto con `pnpm dev` en `:3000`), pon primero el puerto correcto en `app.urls` o fuerza la URL:
  ```
  NEURODANZA_WEB_URL=http://localhost:3010 node <plugin>/panel/panel.mjs navegar …
  ```
- Si el login no avanza: revisa que `app.login.usuario` y `app.login.clave` sean las etiquetas exactas de los campos y que `app.login.espera` sea una parte de la URL que solo aparece después de entrar.

## `usuarios` falla

- `login del administrador: 401 …`: faltan o están mal `ND_ADMIN_EMAIL` / `ND_ADMIN_PASSWORD` (o las variables que uses), o el campo del token no se llama como `panel.usuarios.login.token`.
- `Falta panel.usuarios en neurodanza.config.json`: configura `panel.usuarios` (ver [09-adaptadores.md](09-adaptadores.md#usuarios-de-prueba)).

## El hook `Stop` no me deja terminar

Lee la lista: `✖` son problemas que hay que corregir; `•` son avisos que puedes ignorar si no aplican (se muestran una sola vez). Tras `retroalimentacion.maxBloqueos` bloqueos seguidos (3 por defecto) te deja terminar y te pide revisar a mano.

«panel de personas: cambiaste pantallas y no hay una evaluación aprobada…»: falta un JSON en `panel.evaluaciones` con la **versión actual** en `version`, `aprobado: true` y `promedio` mayor que el umbral. Si subiste la versión después de la evaluación, el resultado ya no cuenta.

## El mapa en vivo no aparece

- ¿Está instalado? `/plugin install neurodanza-mapa@neurodanza` y reinicia la sesión.
- Se abre solo al empezar un ciclo (`/neurodanza-feature`) o al lanzar un revisor o una persona. Para abrirlo a mano: `/neurodanza-mapa`.
- En una terminal de menos de unas 110 columnas no cabe al lado del chat: se ve encima del prompt, y la línea de estado resume la fase (`nd 3 Revisores · …`).
- Si una fase no cambia cuando debería, el mapa no reconoció la señal (ver la tabla en [11-mapa-y-ciclo.md](11-mapa-y-ciclo.md)); el ciclo sigue igual. «reiniciar mapa» lo deja en blanco.

## El hook `Stop` repite un resultado viejo

Con `retroalimentacion.cache` (por defecto `true`), un repo cuyo cambio no se movió reutiliza el resultado anterior. Si cambiaste algo **fuera** del repo que afecta sus pruebas (una variable de entorno, otro repo enlazado), apaga la caché un momento con `"cache": false` o borra `neurodanza-cache-*.json` de la carpeta temporal del sistema.

## Los hooks no hacen nada

- No hay `neurodanza.config.json` en la carpeta de trabajo ni en las de arriba (hasta 8 niveles).
- El archivo tiene un error: los hooks escriben `neurodanza: <archivo>: …` y no bloquean. Valídalo con `node -e "import('<plugin>/lib/config.mjs').then(m=>m.loadConfig())"`.
- El repo no tiene `.git` o sus archivos no coinciden con `codigo`.

## PR apilados que no llegan a `main`

Si encadenas PR (el segundo apunta a la rama del primero), al fusionar el segundo sus cambios entran en la rama del primero, **no en `main`**. Y si el primero ya se fusionó, el segundo queda apuntando a una rama que ya no avanza. Antes de fusionar, cambia la rama base del último PR a `main`:

```
gh pr edit <número> --base main
```

`/neurodanza-feature` abre los PR hacia la rama principal y sin merge, y solo si lo pediste.
