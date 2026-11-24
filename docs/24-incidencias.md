# 24. Incidencias: consultar, registrar y comparar antes y después

`/neurodanza-incidencias` lleva las incidencias de frontend y backend en una carpeta del proyecto, con una ficha por incidencia y su evidencia. **Consulta, no obliga:** nada se crea, trae ni actualiza sin que el usuario lo pida.

```
graphify/                        opcional: carpeta aparte con los mapas (si trae actualizar.sh, se ofrece correrlo)
incidencias/
├── README.md
├── frontend/                    evidencia: capturas
└── backend/                     evidencia: petición y respuesta
    ├── METODOLOGIA.md · INVENTARIO.md · REGISTRO.md · PLANTILLA.md
    ├── registradas/<ID>.md
    └── capturas/<ID>/{antes,despues}/
```

`incidencias.mjs base` crea lo que falte. Lo que ya existe **no se sobrescribe**: mandan los documentos del proyecto.

## Qué pregunta

Todo junto y una sola vez, al empezar (`incidencias.mjs estado`):

| Tema | Cuándo | Se guarda |
|---|---|---|
| Rama de desarrollo, por repo | Si no la sabe o la guardada ya no existe | Siempre |
| Traer lo nuevo | Si hay commits nuevos, el repo está limpio y en esa rama | Solo «siempre» o «nunca» |
| graphify | Si hay guion que correr, o está instalado y el proyecto no tiene mapa | Solo «siempre» o «nunca» |
| Crear `incidencias/` | Si no existe | No |

Las respuestas quedan en `.neurodanza/incidencias.json` (local). Sin graphify se usa el mapa de impacto propio. El plugin nunca lo instala.

`traer` hace solo avance rápido. Con trabajo sin guardar, en otra rama o con la rama separada no toca nada y dice por qué. Después señala las incidencias abiertas cuyos archivos cambiaron.

## Reglas que hace cumplir

| Regla | Cómo |
|---|---|
| El «antes» no se pisa y el «después» lo exige | `panel.mjs capturas` e `incidencias.mjs evidencia` |
| «Corregida · por verificar» exige el después de cada archivo del antes | `incidencias.mjs cambiar` |
| «Verificada», «Cerrada» y «Descartada» las decide el responsable | La barrera rechaza escribirlas en la ficha o el registro. Por la CLI se pregunta siempre, también en automático. A un subagente se le rechaza |
| Reabrir lo que decidió el responsable | `--reabrir`, que también se pregunta |
| El registro sigue a las fichas | `incidencias.mjs registro --escribir` solo cambia la celda Estado y agrega filas. No baja un estado del responsable: lo informa como conflicto |
| Nunca hace commit | `incidencias.mjs reglas` dice cómo son los de cada repo, para cuando el usuario los pida |

Cada evidencia guarda commit, rama y archivos modificados (`evidencia.json`). Avisa si el después es la misma versión que el antes, o si cambiaron la ruta o la persona.

## Configuración

`incidencias` en [03-configuracion.md](03-configuracion.md#incidencias). Se apaga con `"activo": false`.

## Medido

- Pruebas con repos git reales y Chromium: capturas en 3 resoluciones, completas en una pantalla que carga a los 1,5 s.
- Con los documentos de un proyecto real (registro con 88 incidencias): los existentes quedaron idénticos, y agregar una cambió una sola línea del registro.
- La barrera pasó de 67,4 a 68,8 ms por comando (mediana de 60, intercalada): **+2 %**.

## Límites

- **El estado de una ficha se protege en lo razonable:** un script propio podría escribirlo. El historial de git lo muestra.
- **Lo sensible se oculta por el nombre del campo** (más correos y JWT sueltos): revisa la evidencia antes de subirla. Las capturas no se ocultan: usa datos de prueba.
- **`inventario` compara rutas por texto:** si el inventario agrupa rutas cortas bajo un prefijo, puede dar por citada una que no lo está.
- **graphify no se lee desde el plugin:** lo consulta el agente. No se midió cuánto aporta frente al mapa propio.
- **No levanta la versión anterior:** si la corrección ya está aplicada, no hay antes.
