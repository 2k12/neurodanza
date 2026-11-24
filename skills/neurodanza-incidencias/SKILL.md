---
name: neurodanza-incidencias
description: Flujo de incidencias en un proyecto con neurodanza - consulta la rama de desarrollo de cada repo y si se usa graphify, registra incidencias de frontend y backend con su ficha, guarda la evidencia de antes y después, corrige sin romper y deja el registro al día. Úsalo cuando el usuario pida registrar, revisar, priorizar o corregir incidencias, o ponerse al día antes de trabajar en ellas.
---

# /neurodanza-incidencias

`<inc>` = `node "<carpeta de este skill>/../../lib/incidencias.mjs"` · `<panel>` = `node "<carpeta de este skill>/../../panel/panel.mjs"` (en Git Bash de Windows antepone `MSYS_NO_PATHCONV=1`).

**Consulta, no obligues.** Nada se trae, crea ni actualiza sin el sí del usuario, y solo se pregunta una vez, al empezar. Después trabaja sin interrumpir.

## 1. Empezar
1. `<inc> estado`. Si trae `preguntas`, hazlas **todas juntas** (una sola llamada a `AskUserQuestion`, o un mensaje). Si no trae, sigue sin preguntar.
2. Guarda lo que respondió:
   - Rama: `<inc> guardar --rama <repo>=<rama>` (no se vuelve a preguntar mientras exista).
   - «siempre» o «nunca»: `<inc> guardar --traer …` o `--graphify …`. Un «sí» o «no» vale solo por hoy y no se guarda.
3. Con su sí, o si guardó «siempre»: `<inc> traer --repo <r>`. Si no se puede sin riesgo (trabajo sin guardar, otra rama, ramas separadas) responde por qué: dilo en una línea y **sigue con lo que hay**; no lo fuerces. `revisar` trae las incidencias abiertas cuyos archivos cambiaron: mira si siguen iguales.
4. **graphify es opcional.** Con su sí, corre en segundo plano el comando de `graphify.actualizar`; si no hay guion, usa el de la herramienta como indique el usuario. Nunca lo instales. Si falla o no está, sigue con `<inc> alcance` y dilo.
5. Si no existe la carpeta y el usuario la quiere: `<inc> base` (no sobrescribe nada).

Lee `METODOLOGIA.md` y `PLANTILLA.md` del área: **mandan los del proyecto**, aunque difieran de lo que dice este skill.

## 2. Registrar
- Vistas o rutas sin revisar: `<inc> inventario --area <área>`.
- Antes de registrar: `<inc> alcance --archivos "<repo:ruta>"` (y el mapa de graphify, si hay). Si nace en algo compartido, va **una incidencia raíz**. Si ya está en `yaRegistradas`, agrégale lo nuevo en vez de duplicarla.
- `<inc> nueva --area … --modulo … --titulo "…" --rol … --vista … --perspectiva … --categoria … --severidad … --alcance … --esfuerzo … --archivo …`. Luego completa las secciones de la ficha. Escribe solo lo que observaste; lo que no sabes queda «—».
- Para auditar muchas vistas, reparte por rol o módulo en subagentes de solo lectura que te devuelvan hallazgos. **La ficha la creas tú**, para que los números no choquen.
- Auditar no es corregir.

## 3. Evidencia del antes (sin la corrección aplicada)
- Frontend: `<panel> capturas --id <ID> --momento antes --ruta /ruta [--persona <id>]`.
- Backend: `<inc> evidencia --id <ID> --momento antes --ruta /api/… [--metodo GET] [--usuario <persona>]`. Solo contra la app local. Oculta datos sensibles por el nombre del campo; revisa el archivo igual.
- Si la corrección ya está aplicada, no inventes un antes: dilo en la ficha. No cambies de versión el repo del usuario para conseguirlo.

## 4. Corregir
1. Solo las que pidió el usuario, en una rama de trabajo, nunca en la de desarrollo. `<inc> cambiar --id <ID> --estado "En corrección"`.
2. Corre las pruebas de la ficha (línea base), corrige y corre **las mismas**. Los cambios siguen el ciclo de `/neurodanza-feature` según su riesgo.
3. Un hallazgo nuevo se registra; no se arregla de paso.
4. Evidencia del después, con la misma ruta y la misma persona. Atiende los `avisos`.
5. Completa «Corrección» en la ficha y `<inc> cambiar --id <ID> --estado "Corregida · por verificar"` (se rechaza si falta evidencia).

**Verificada, Cerrada y Descartada las decide el usuario.** No las escribas en la ficha ni en el registro: cuando él lo diga, `<inc> cambiar … --estado Verificada` (la ventana de permisos se lo confirma).

## 5. Entregar
- `<inc> registro` muestra diferencias entre fichas y `REGISTRO.md`; `--escribir` las aplica sin deshacer lo que el responsable ya decidió. Los `conflictos` los resuelve el usuario.
- Entrega la lista con antes y después de cada una, y qué falta verificar.
- **Commit, push y PR solo si el usuario los pide.** Antes, `<inc> reglas --repo <r>`: lee los archivos de `leer` (mandan ellos) y sigue el estilo de los commits recientes, con los IDs en el mensaje. Sin coautoría ni firmas de IA.
