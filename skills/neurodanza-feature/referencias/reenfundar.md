# Subagentes lentos, trabados o en cuarentena: re-enfundar una sola vez

Cada subagente tiene un tope de tiempo (`ciclo.maxSegundos`: revisores 5 min, personas 3,5 min, implementadores 15 min). Al 80 % recibe un aviso; al 100 % la barrera le rechaza toda herramienta y solo puede entregar su respuesta. Los hooks guardan su pila (qué leyó, editó y corrió) y cada 10 pasos él anota una línea de avance.

**Re-enfundar** cuando un subagente vuelve cortado por tiempo o pasos, aparece **sin latido** en el mapa (o en `.neurodanza/agentes/`) sin un comando largo en curso, entrega con pendientes críticos, o cae en **cuarentena**:
1. `<pilas> reenfundar --agente <agent_id>` genera el mensaje completo: el contrato, lo que ya hizo, qué archivos leyó y siguen iguales (que no relea) y cuáles cambiaron, los comandos que fallaron, lo que falta y el presupuesto **restante**. En el modo director, el reemplazo trabaja en el **mismo worktree**.
2. Lanza un agente nuevo del mismo tipo con ese mensaje y la descripción que sugiere (`<tarea> ↻ 2`).
3. **En cuarentena** (`⛔`, tras `figuras.cuarentena` rechazos): en el mensaje, quita la acción que causó los bloqueos (los motivos están en su registro, `<agentes> ver`) y agrega una advertencia: «tu antecesor fue bloqueado por …; no lo intentes, entrega o pide al director».
4. **Una sola vez por tarea** (`reenfundar` lo hace cumplir). Si el reemplazo también se corta o cae en cuarentena, no relances: informa al usuario con `<pilas> resumen --agente <id>`.

Solo tú (el agente principal) lanzas subagentes: con las figuras activas, la barrera se lo rechaza a cualquier subagente.
