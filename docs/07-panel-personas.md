# 7. Panel de personas

Personas simuladas, una por rol, prueban cada cambio **con la app corriendo**, en un navegador real (Playwright), con su propio usuario. Cada una le pone una nota de 1 a 10 y el cambio se aprueba si **el promedio supera `panel.umbral`** (8.99 por defecto). En Windows, la ronda se ve en una **ventana en vivo** donde los avatares cuentan lo que prueban y lo que encuentran.

Herramienta: `panel/panel.mjs`. Agente: `persona-evaluadora`. Lo orquesta el paso 4 de `/neurodanza-feature`.

```
node <plugin>/panel/panel.mjs <comando> [opciones]
```

Se corre desde cualquier carpeta del proyecto (busca `neurodanza.config.json` hacia arriba). En Git Bash de Windows antepone `MSYS_NO_PATHCONV=1` (ver [10-problemas-comunes.md](10-problemas-comunes.md)).

| Comando | Para qué |
|---|---|
| `elegir --rutas <r1,r2> [--n N]` | Qué personas prueban esas rutas. |
| `usuarios` | Crea los usuarios de prueba de las personas. |
| `crear --rol <ROL> [--rolDoc x] [--cargo "…"]` | Persona nueva para un rol que no tiene. |
| `navegar --persona <id> --rutas <r1,r2> --salida <carpeta> [--acciones <archivo.json>] [--dispositivo tablet\|celular]` | La persona entra y recorre las pantallas. |
| `en-vivo --ronda <carpeta> --personas a,b,c --titulo "…" --cambio "…"` | Empieza la ronda y abre la ventana en vivo. |
| `decir --ronda <carpeta> --persona <id> --texto "…" [--estado "…"]` | Una persona habla en la ventana. |
| `oir --ronda <carpeta>` | Lo que han dicho todas. |
| `calificar --resultado <json>` | Promedio y aprobación. |
| `cerrar --ronda <carpeta> --resultado <json>` | Muestra notas y veredicto en la ventana y la cierra. |
| `ventana --resultado <json> [--segundos N]` | Ventana de resumen, sin ronda en vivo. |

## El elenco

Archivo `panel.elenco` (por defecto `.claude/personas/personas.json`), **una persona por rol**:

```json
{
  "personas": [
    {
      "id": "ana",
      "nombre": "Ana",
      "foto": "ana",
      "rol": "ADMIN",
      "rolDoc": "administrador",
      "cargo": "Administradora del sistema",
      "perfil": "Configura usuarios y datos maestros. Detallista: busca inconsistencias, mensajes de error poco claros y permisos mal puestos.",
      "valora": ["consistencia", "mensajes de error claros", "control de permisos"],
      "color": "#0ea5e9"
    }
  ]
}
```

| Campo | Qué es |
|---|---|
| `id` | Identificador; también define el usuario (`{id}` en `panel.usuarios.email`). |
| `nombre`, `cargo`, `perfil`, `valora` | Quién es y qué le importa. La persona habla y juzga desde ahí: su experiencia, su paciencia, su dispositivo. |
| `foto` | Nombre de su foto (sin extensión). Sin `foto`, se usa el `id` sin el número final. |
| `rol` | Rol en la app (el que se usa al crear el usuario y al elegir). |
| `rolDoc` | Nombre del documento de roles, para el adaptador `markdown` (`{rolDoc}`). |
| `color` | Color de su tarjeta y de sus mensajes en la ventana. |

## Fotos y recorte

Las fotos son **locales y no van a git**. En el repo solo quedan las cajas de recorte.

1. Pon las fotos originales en una carpeta cualquiera, cada una con el nombre de la persona: `ana.jpg`, `bruno.webp`… (se aceptan `.jpg`, `.jpeg`, `.png`, `.webp`).
2. Define la caja de cada una (rostro y cuello) en `fotos.json`, **junto al elenco**: `[x, y, lado]` en píxeles de la imagen original.
   ```json
   { "recortes": { "ana": [120, 40, 380] } }
   ```
3. Recorta:
   ```
   node <plugin>/panel/recortar-fotos.mjs --origen <carpeta>
   ```
   Deja `<panel.fotos>/<nombre>.png` de 256 × 256. Sin caja, hace un recorte cuadrado centrado arriba (y te lo avisa). Necesita `@playwright/test`.
4. Asegúrate de que la carpeta de fotos esté en `.gitignore` (`/neurodanza-init` agrega `.claude/personas/fotos/`).

### Avatares dibujados de respaldo

Si una persona no tiene foto, la ventana usa un avatar dibujado:

```
node <plugin>/panel/avatares.mjs
```

Genera `avatars/<id>.svg` y `avatars/<id>.png` (256 px) junto al elenco. Los rasgos (piel, cabello, peinado, lentes, accesorio) salen del `id`, así que siempre son los mismos. Sin `@playwright/test` solo genera los SVG, y la ventana de Windows necesita los PNG.

La imagen de cada persona se busca así: `<panel.fotos>/<foto>.png` y, si no existe, `avatars/<id>.png`.

## Crear una persona para un rol sin persona

```
node <plugin>/panel/panel.mjs crear --rol AUDITOR --cargo "Auditora externa"
```

Toma la foto **menos usada** (de las de `panel.fotos`; si no hay, de las del elenco) y, si ya está en uso, le agrega un número: la segunda persona con la foto `bruno.webp` se llama **Ana2**. Le pone un perfil genérico para ese rol, que conviene editar. Después, `usuarios` para crear su cuenta.

## Cuántas y cuáles: `elegir`

```
node <plugin>/panel/panel.mjs elegir --rutas /pedidos,/pedidos/[id]
```

Usa el mapa de roles (ver [09-adaptadores.md](09-adaptadores.md)), que dice por rol qué pantallas ve y cuáles puede modificar.

- **Cantidad:** una persona por cada rol que puede **modificar** algo de lo cambiado, acotada entre `panel.min` (3) y `panel.max` (5). `--n N` fija la cantidad.
- **Orden:** por puntaje. Por cada ruta, la pantalla más específica que la cubre (`/pedidos` cubre `/pedidos/123`) da 2 puntos si el rol la modifica y 1 si solo la ve; el total se divide por la raíz de cuántas pantallas ve el rol (así un rol especializado pesa más que uno que lo ve todo). Si faltan personas para llegar al mínimo, se completa con las demás en el orden del elenco.
- `panel.ignorarRutas`: pantallas que no cuentan (p. ej. el inicio `/app`, que todos ven).

Responde la lista con `id`, `nombre`, `rol` y `cargo`.

## Usuarios: `usuarios`

Entra como administrador por HTTP y crea un usuario por persona con su rol (detalles en [09-adaptadores.md](09-adaptadores.md#usuarios-de-prueba)):

```
+ Ana (ADMIN) creado
= Bruno (VENTAS) ya existe
= Carla usa la cuenta del propietario
```

Un `409` cuenta como «ya existe».

## Navegar: `navegar`

```
node <plugin>/panel/panel.mjs navegar --persona ana --rutas /usuarios,/configuracion --salida <scratchpad>/ana --dispositivo tablet
```

1. Abre Chromium sin ventana, con el idioma `app.idioma` (`es-EC` por defecto) y el tamaño del dispositivo: escritorio 1440 × 900, `tablet` 1024 × 768, `celular` 390 × 844.
2. Entra con el usuario de la persona por la pantalla de login (`app.login`).
3. Por cada ruta: la abre, espera a que la red quede quieta, toma una captura de página completa y anota título, botones, campos y texto visible.
4. Ejecuta las acciones de esa ruta, si las hay.
5. Registra como problemas los errores de consola (menos los de `app.ignorarConsola`) y las respuestas HTTP 5xx.

Deja en `--salida` las capturas (`01-usuarios.png`, …) y `informe.json`. La persona mira las capturas (son imágenes) y lee el informe.

### Acciones

`--acciones` es la ruta a un archivo JSON con los pasos por pantalla:

```json
[
  {
    "ruta": "/pedidos",
    "pasos": [
      { "click": "Nuevo pedido" },
      { "elegir": "Cliente", "opcion": "Cliente de prueba" },
      { "llenar": "Cantidad", "valor": "12" },
      { "tecla": "Enter" },
      { "esperar": 800 },
      { "click": "Guardar", "exacto": true, "captura": "guardado" }
    ]
  }
]
```

| Paso | Qué hace |
|---|---|
| `click` | Clic en el botón, enlace o pestaña con ese nombre (dentro de `<main>` si existe). |
| `elegir` + `opcion` | Abre la lista desplegable (`combobox`) cuyo nombre coincide con `elegir` y elige la opción `opcion`. |
| `llenar` + `valor` | Escribe `valor` en el campo con esa etiqueta. |
| `tecla` | Pulsa una tecla (`Enter`, `Escape`, `Control+K`…). |
| `esperar` | Espera esos milisegundos. |
| `captura` | Además de lo anterior (o solo), toma una captura `<pantalla>-<nombre>.png`. |
| `exacto` | Con `click` y `opcion`: el nombre debe coincidir exacto. |

Cada paso tiene 5 s; si falla, queda en el informe con `ok: false` y el error, y la persona baja la nota.

### Recorrido sistemático

Para que dos evaluaciones del mismo cambio coincidan, cada persona prueba en cada pantalla, en este orden: los encabezados de columna que se pueden ordenar, cada filtro (abrirlo y elegir una opción), la búsqueda, el botón principal y los atajos que la pantalla anuncie. Anota en sus hallazgos qué probó, aunque funcione.

## Ventana en vivo (solo Windows)

Con `"panel.ventana": "windows"` y en Windows, la ronda se ve en la ventana **Role Agents** (compacta, 760 px de ancho, sin consola), siempre encima: a la izquierda la lista de personas con scroll (foto, nombre, cargo, estado y nota; resalta a quien está hablando) y a la derecha la conversación, con la foto y el nombre de cada una junto a lo que dice. Al cerrar la ronda, la lista se ordena por nota (la mejor en morado, verde sobre el umbral, amarillo debajo) y el pie muestra el veredicto.

```
node <plugin>/panel/panel.mjs en-vivo --ronda <scratchpad>/panel-1.4.0-r1 --personas ana,bruno,carla --titulo "Panel de personas · v1.4.0 · ronda 1" --cambio "Ahora puedes duplicar un embarque desde su detalle."
```

Cada persona habla con frases cortas, en primera persona y como su personaje:

```
node <plugin>/panel/panel.mjs decir --ronda <carpeta> --persona ana --estado "Probando" --texto "Voy a revisar que solo yo pueda cambiar los permisos."
node <plugin>/panel/panel.mjs oir --ronda <carpeta>
```

- Estados concretos (qué hace o qué encontró, no cómo se siente). `decir` rechaza cualquier otro.

  | Mientras prueba | Color |
  |---|---|
  | `Ingresando`, `Probando`, `Verificando` | gris |
  | `Con observación` | amarillo |
  | `Con error`, `Bloqueado` | rojo |

  | Estado final | Nota |
  |---|---|
  | `Sin observaciones` | 10 |
  | `Observaciones menores` | 9 |
  | `Funciona con dificultad` | 7–8 |
  | `Requiere ayuda` | 5–6 |
  | `No funciona` | ≤ 4 |

  Al cerrar la ronda, el estado final de cada persona sale de su nota (`cerrar` y `ventana` lo calculan), así nunca se contradicen.
- Entre 4 y 10 mensajes por persona: al empezar, tras cada pantalla o hallazgo importante, y al final con su nota. Nada de rutas técnicas ni JSON.
- Con `oir` pueden leer a las demás y responderles por su nombre, pero la nota es de cada una.

Al final, `cerrar` muestra en la ventana la nota y el estado final de cada persona y el veredicto (`Aprobado` o `No aprobado · promedio 8,70 / 10 · umbral 8,99`), y la ventana **se cierra sola a los 12 s**.

**La ventana no queda abierta aunque se olvide `cerrar`:** `calificar` cierra la ronda activa con las notas; una ronda nueva (`en-vivo`) cierra la anterior si seguía abierta; el hook `Stop` cierra la que quede abierta al terminar el turno; y sin mensajes en 20 minutos se cierra sola.

Cómo funciona: la ronda es un archivo `ronda.jsonl` en la carpeta `--ronda`. `en-vivo` lo crea con el evento de inicio y abre `panel/live-window.ps1` (WPF) por medio de `panel/launch-hidden.vbs`, para que no aparezca una consola. `decir` y `cerrar` agregan líneas; la ventana las lee cada 0,7 s. Los errores de la ventana quedan en `ronda.jsonl.log`.

`ventana --resultado <json>` abre en cambio una ventana de **resumen** (tarjetas con nota y la frase de cada persona) que se cierra a los 9 s (`--segundos`) o con un clic.

**En macOS y Linux, o con `"ventana": "ninguna"`**, todo funciona igual (`decir`, `oir` y `cerrar` escriben la ronda), pero no se abre ninguna ventana: el resultado se ve en el chat.

## Nota, aprobación y rondas

Cada persona responde solo un JSON:

```json
{ "persona": "ana", "nota": 9.2, "estado": "Observaciones menores", "resumen": "una frase en primera persona", "hallazgos": ["…"], "sugerencias": ["…"] }
```

Escala: 10 = lo usaría hoy sin pedir ayuda; 9 = muy bien, detalles menores; 7–8 = funciona pero cuesta o confunde algo; 5–6 = hay que pedir ayuda o algo no sale; 4 o menos = no funciona, se pierden datos o se ve algo que no se debería. Un HTTP 5xx, un paso que falla, un texto técnico o en otro idioma, o una acción visible que el rol no puede usar bajan la nota. Si se anunció un arreglo y no aparece en pantalla, también.

Las respuestas se guardan en `<panel.evaluaciones>/v<versión>-<tema>.json`:

```json
{ "version": "1.4.0", "cambio": "…", "rutas": ["…"], "ronda": 1, "evaluaciones": [ … ] }
```

y se califica:

```
node <plugin>/panel/panel.mjs calificar --resultado docs/evaluaciones/v1.4.0-embarques.json
```

`calificar` agrega al archivo `promedio` (con dos decimales), `aprobado`, `motivo`, `umbral` y `fecha`. **Aprueba solo si están todas las notas y el promedio es mayor que el umbral**: con 8.99, notas 9 · 9 · 8.97 (promedio 8.99) no aprueban. Si no aprueba, sale con código 1.

Después se cierra la ronda en la ventana (`cerrar`), haya aprobado o no.

- **Si no aprobó:** se corrige con los hallazgos y sugerencias, se vuelve a verificar, se levanta la app de nuevo y se evalúa con **las mismas personas** (`ronda` + 1; las rondas anteriores se conservan en `"historial"`). Hasta `panel.maxRondas` (3); si no llega, se te informa y se te pregunta si autorizas otra ronda.
- **Si aprobó:** el cambio cuenta como realizado. El hook `Stop` comprueba que exista esa evaluación aprobada para la versión actual cuando cambiaron pantallas (ver [05-retroalimentacion.md](05-retroalimentacion.md)).

Las personas no modifican código ni documentación, no dejan archivos dentro de los repos y no arrancan servicios.
