# 19. Menos exploración: índice, especialistas y operador

Cada subagente empezaba de cero: buscaba con `Glob` y `Grep`, leía archivos para decidir si eran suyos y volvía a descubrir convenciones que el proyecto ya tenía. Tres piezas, sin modelo extra salvo los especialistas:

| Pieza | Qué evita | Dónde |
|---|---|---|
| **Índice pre-cocido** | Explorar el repo para ubicar los archivos de una tarea | `lib/indice.mjs` |
| **Especialistas** | Que cada implementador redescubra cómo se hacen las migraciones, los permisos o los formularios | `lib/hotel.mjs`, `agents/especialista-*.md` |
| **Operador** | Olvidar una lección aprendida justo cuando hace falta | `lib/operador.mjs`, la barrera |

## 1. Índice pre-cocido por commit

`lib/indice.mjs` genera **sin modelo** (expresiones regulares y lectura de archivos, sin dependencias) un índice por repo:

- árbol de carpetas relevantes (ignora `node_modules`, `dist`, `.next`, `build`, `coverage`…);
- por archivo JS/TS: exportaciones (funciones, clases, tipos, constantes), imports internos resueltos, tamaño y tipo por convención (controlador, servicio, DTO, modelo, pantalla, componente, prueba, migración…);
- rutas de la API: NestJS (`@Controller` + `@Get`/`@Post`/…), Express (`router.get('/x')`, `app.post(…)`) y Next (`app/**/route.ts`, `pages/api/**`);
- pantallas: `app/**/page.tsx` (sin grupos `(…)`) y `pages/**` de Next;
- modelos (Prisma `model X`, TypeORM `@Entity`) y migraciones;
- las pruebas de cada módulo (por nombre y por lo que importan).

Se cachea por **hash del commit + firma de los cambios sin commit** en `.neurodanza/indice/<repo>-<firma>.json`: si nada cambió, no se regenera (y queda solo el último índice de cada repo).

```
node <plugin>/lib/indice.mjs generar [--repo <r>]
node <plugin>/lib/indice.mjs resumen --repo <r> [--foco <glob, ruta o texto>] [--max 60]
node <plugin>/lib/indice.mjs buscar --que <texto> [--repo <r>]
```

`resumen --foco` da el texto corto para un prompt: «Los archivos de esta tarea probablemente son…», con sus pruebas, sus rutas de API, sus pantallas y quién los importa. El foco puede ser un glob (`backend:src/pedidos/**`), una ruta (`/pedidos`) o un texto (`pedidos`).

**Quién lo recibe:**
- el implementador, en su contrato: `director.mjs preparar` agrega «Lo que dice el índice del proyecto» enfocado en los globs de la tarea;
- los revisores, enfocado en los archivos del diff;
- las personas, con las pantallas que tocó el diff;
- los especialistas, enfocado en su área.

**Velocidad:** el banco lo mide en frío y en caché sobre el proyecto de prueba, un repo mediano (~300 archivos) y uno de ~3000 (ver `exploracion_implementador` en [`bench/README.md`](../bench/README.md#parte-3-y-tabla-final)). La prueba `tests/indice.test.mjs` exige menos de 5 s para 3000 archivos.

## 2. Especialistas consultados por el director antes de delegar

Cuatro agentes de **solo lectura** (`Read`, `Glob`, `Grep`), modelo `sonnet`, presupuesto de 8 pasos y 120 s (`hotel.maxPasos`, `hotel.maxSegundos`):

| Especialista | Aplica si la tarea toca | Pregunta, por ejemplo |
|---|---|---|
| `especialista-datos` | modelos, migraciones, ORM (`prisma/`, `*.entity.ts`, `migrations/`) | ¿Cómo se crean y nombran las migraciones aquí? |
| `especialista-a11y` | pantallas y componentes (`*.tsx`, `app/`, `components/`) | ¿Qué componentes de formulario reutiliza el proyecto y cómo etiquetan campos? |
| `especialista-permisos` | guards, roles, controladores, middleware | ¿Cómo se protege un endpoint por rol y dónde vive la matriz? |
| `especialista-rendimiento` | servicios, repositorios, listados | ¿Cómo se paginan los listados y qué límites usan? |

Responden en JSON: `{ "especialista", "respuestas": [{ "pregunta", "respuesta", "archivos": [], "confianza" }] }`.

```
node <plugin>/lib/hotel.mjs preguntas --archivos "<repo:glob,…>"   qué especialistas aplican, preguntas pendientes y contexto
node <plugin>/lib/hotel.mjs guardar --respuesta <json>               cachea la respuesta
node <plugin>/lib/hotel.mjs seccion --archivos "<repo:glob,…>"       «Lo que ya sabemos de este proyecto»
```

**Flujo (modo director):** antes de `preparar` cada tarea, el director corre `hotel.mjs preguntas` con los mismos globs, lanza **en paralelo** los especialistas con preguntas pendientes y guarda sus respuestas. `preparar` agrega al contrato la sección «Lo que ya sabemos de este proyecto».

- **Contexto pre-cocido:** cada especialista recibe el resumen del índice enfocado en su área, cacheado por firma: no explora desde cero.
- **Caché de respuestas:** por **firma del contenido de los archivos de su área + la pregunta** (`.neurodanza/hotel/respuestas/`). Una pregunta repetida en un ciclo posterior no vuelve a lanzar al especialista si su área no cambió, aunque haya commits en otras partes. Cambiar un modelo sí invalida las respuestas de datos.
- **Solo el director consulta** (los subagentes no pueden lanzar subagentes). Si un implementador necesita algo que no está en su contrato, lo pide en su campo `pendiente` y el director decide.
- **Mapa:** las consultas del ciclo aparecen en la fase de implementar (`🏨 datos ✔ (caché) · 🏨 permisos ▶`) y cada especialista como nodo `🏨 <área>`.

## 3. Operador: la lección justo cuando hace falta

Las lecciones de los constructos ([14-constructos.md](14-constructos.md)) aceptan un campo opcional **`activadores`**:

```json
{ "constructo": "implementador-frontend", "etiqueta": "ui:aria-label-icono", "leccion": "Todo botón de solo icono lleva aria-label.",
  "activadores": { "archivos": ["**/*.tsx"], "texto": ["<button"] } }
```

- `archivos`: globs; `texto`: patrones (literal o `/expresión/`). Con los dos, deben coincidir ambos.
- **La reflexión los propone**; si no trae, se **sugieren** desde los archivos que nombra el `detalle` del problema (por extensión) y quedan marcados como sugeridos. Se ven en `aprendido/<constructo>.md` del PR, al final de la línea de la lección («· activa con: archivos … ; texto …»), y se corrigen ahí.
- **Cuando un subagente lee o edita** un archivo que coincide con una lección **aprobada o a prueba** de su constructo, recibe como contexto, **una sola vez por lección y por agente**: «Recuerda (lección aprendida en este proyecto): …». El constructo es el de su tarea del director (implementadores) o su tipo (`revisor-ui`…).
- **Sin modelo extra:** coincidencia de reglas. Las lecciones activas se compilan al guardar los constructos en `.neurodanza/operador/activas.json`; la barrera solo lee ese archivo. La prueba exige menos de 5 ms por evento con 30 lecciones activas.
- **Cuenta:** cada recuerdo queda registrado; el juicio de la lección lo menciona («se recordó 3 veces al tocar sus archivos») para distinguir «se aplicó porque se recordó».
- Las lecciones **sin activadores** siguen como siempre: entran en el contrato o el mensaje.

**Dónde corre:** en la barrera (`PreToolUse`), no en el mapa ni en el `PostToolUse` de las pilas. El hook de pilas es asíncrono desde la 0.8 (su salida nunca llega al agente) y la barrera ya devuelve contexto junto al resultado de la herramienta; así funciona con o sin el mapa instalado.

## Medido

Ver la tabla final en [`bench/README.md`](../bench/README.md#parte-3-y-tabla-final).

## Límites

- **El índice es estático:** no entiende rutas armadas en tiempo de ejecución, alias de `tsconfig` que no sean `@/` o `~/`, ni decoradores propios. Lo que no reconoce queda como «código».
- **Los especialistas cuestan tokens:** cada uno es un subagente (8 pasos como máximo). La caché evita repetirlos, pero la primera consulta de cada área se paga.
- **Una respuesta en caché puede quedar vieja** si cambia una convención fuera de los archivos de su área (por ejemplo, un script de migraciones en `package.json`). Borrar `.neurodanza/hotel/` fuerza a preguntar de nuevo.
- **El operador recuerda; no obliga.** Que el subagente reciba la lección no garantiza que la aplique: eso lo siguen midiendo los jueces y el juicio de la lección.
