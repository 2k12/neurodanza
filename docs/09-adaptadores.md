# 9. Adaptadores: roles, login y arranque de la app

Lo que cambia de un proyecto a otro (cómo se describen los roles, cómo se entra a la app, cómo se crean usuarios y cómo se levanta) se configura en `roles`, `app` y `panel.usuarios`.

## Roles

El panel necesita saber, **por rol**, qué pantallas ve y cuáles puede modificar. Hay dos adaptadores (`roles.adaptador`).

### `"json"` (por defecto)

Un archivo (`roles.fuente`, p. ej. `.claude/personas/roles.json`) con las rutas de cada rol; `true` = puede modificarla, `false` = solo la ve:

```json
{
  "ADMIN": { "/usuarios": true, "/configuracion": true, "/pedidos": true },
  "VENTAS": { "/pedidos": true, "/clientes": true },
  "LECTURA": { "/pedidos": false, "/clientes": false }
}
```

```json
"roles": { "adaptador": "json", "fuente": ".claude/personas/roles.json" }
```

Si `fuente` no existe (o es `null`, el valor por defecto), ningún rol tiene pantallas y `elegir` devuelve las primeras personas del elenco.

### `"markdown"`

Para proyectos que ya documentan las pantallas por rol. `roles.fuente` es una plantilla de ruta con `{rolDoc}` (el `rolDoc` de la persona; si no tiene, el rol en minúsculas) o `{rol}`:

```json
"roles": { "adaptador": "markdown", "fuente": "docs/roles/{rolDoc}.md" }
```

En cada archivo se leen las filas de tabla con la ruta entre comillas invertidas en la segunda columna y en la tercera si el rol la modifica:

```markdown
| Pantalla | Ruta | Modifica |
|---|---|---|
| Pedidos | `/app/pedidos` | ✅ |
| Facturas | `/app/facturacion` | ❌ |
```

- `✅`, `sí`, `si` y `—` → puede modificar.
- `❌` y `no` → solo ve.

## Login de las personas (`app.login`)

`navegar` entra por la pantalla de login como lo haría una persona:

```json
"login": { "ruta": "/login?empresa=demo", "usuario": "Correo", "clave": "Contraseña", "boton": "ingresar|entrar|iniciar", "espera": "/app" }
```

| Clave | Cómo se usa |
|---|---|
| `ruta` | Se abre `<url><ruta>`. |
| `usuario`, `clave` | Etiquetas **exactas** de los campos (las busca por su `label` accesible). |
| `boton` | Expresión regular, sin distinguir mayúsculas, del nombre del botón de ingresar. |
| `espera` | Texto que debe aparecer en la URL tras ingresar (hasta 20 s). Usa una ruta que solo exista después de entrar, como `/app`. |

## Usuarios de prueba (`panel.usuarios`)

`panel.mjs usuarios` crea por HTTP un usuario por persona. Todo con variables de entorno, sin credenciales en el archivo:

```json
"usuarios": {
  "login": { "url": "/api/v1/auth/login", "cuerpo": { "email": "${ND_ADMIN_EMAIL}", "password": "${ND_ADMIN_PASSWORD}" }, "token": "accessToken" },
  "crear": { "url": "/api/v1/tenant/users", "cuerpo": { "email": "{email}", "fullName": "{nombre}", "password": "{clave}", "role": "{rol}" } },
  "email": "persona.{id}@${ND_DOMINIO:-ejemplo.com}",
  "clave": "${ND_PERSONA_PASSWORD}",
  "propietario": { "rol": "OWNER", "email": "${ND_ADMIN_EMAIL}", "clave": "${ND_ADMIN_PASSWORD}" }
}
```

1. **`login`**: entra como administrador (`POST` a `url` con `cuerpo`, en JSON) y toma el token del campo `token` de la respuesta (por defecto `accessToken`).
2. **`crear`**: por cada persona, `POST` a `url` con `cuerpo` y `Authorization: Bearer <token>`. En `cuerpo` y `url` se reemplazan `{id}`, `{nombre}`, `{rol}`, `{email}` y `{clave}`. `metodo` cambia el método HTTP (por defecto `POST`). Respuesta 2xx = creado; 409 = ya existe; otra = error (se muestra y sigue con la siguiente).
3. **`email`** y **`clave`**: con qué entra cada persona; `email` admite `{id}` y `{rol}`.
4. **`propietario`** (opcional): la persona con ese `rol` no se crea, usa esa cuenta (útil cuando el rol dueño no se puede crear por la API).

Variables de entorno de la plantilla: `ND_ADMIN_EMAIL`, `ND_ADMIN_PASSWORD`, `ND_PERSONA_PASSWORD`. `${VAR:-defecto}` da un valor si la variable no existe.

Si la app no permite crear usuarios por API, créalos a mano con el mismo `email` y `clave`: `navegar` solo necesita que existan.

## Dónde está la app (`app.urls`)

`panel.mjs` prueba cada URL de `app.urls`, en orden, pidiendo la ruta de login (4 s cada una), y usa la primera que responde bien. Si ninguna responde, usa la primera. Para forzar una:

```
NEURODANZA_WEB_URL=http://localhost:3010 node <plugin>/panel/panel.mjs navegar …
```

Las URLs de la API de `panel.usuarios` son relativas a esa misma URL (útil cuando el frontend reenvía `/api` al backend).

## Arrancar la app (`app.levantar`)

```json
"app": { "levantar": "docker compose up -d --build api web" }
```

Lo usa `/neurodanza-feature` antes del panel, para que las personas prueben **el código nuevo**. Si la app depende de algo que solo tú puedes abrir (Docker Desktop, una VPN…), Claude te lo pide; no lo arranca. Puedes reforzarlo con una barrera:

```json
{ "patron": "Docker Desktop\\.exe|start-process\\s+\\S*docker|open\\s+-a\\s+docker", "motivo": "No arranques Docker Desktop: pídele al usuario que lo abra.", "alcance": "raw" }
```

## Playwright

`navegar`, `recortar-fotos.mjs` y `avatares.mjs` usan el `@playwright/test` **del proyecto**: lo buscan en la raíz y en cada repo de `repos`. El plugin no lo instala.
