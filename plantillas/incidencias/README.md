# Incidencias

Registro para encontrar, priorizar y seguir los problemas del proyecto.

```
incidencias/
├── README.md
├── frontend/                  evidencia: capturas
└── backend/                   evidencia: petición y respuesta
    ├── METODOLOGIA.md         roles, lista de revisión, severidad y prioridad
    ├── INVENTARIO.md          vistas o rutas por revisar (sale del código)
    ├── REGISTRO.md            índice: una fila por incidencia
    ├── PLANTILLA.md           cómo se escribe una incidencia
    ├── registradas/<ID>.md    una ficha por incidencia
    └── capturas/<ID>/{antes,despues}/
```

## Ciclo

1. **Detectar** con la lista de METODOLOGIA y registrar con la PLANTILLA.
2. **Agrupar:** si nace en algo compartido, una sola incidencia raíz enlazada a lo que afecta.
3. **Priorizar:** severidad × alcance × esfuerzo.
4. **Evidencia del antes**, con la versión sin corregir.
5. **Corregir** en una rama de trabajo, sin arreglar «de paso» otras cosas: lo nuevo se registra aparte.
6. **Evidencia del después**, con la misma ruta y el mismo usuario, y las mismas pruebas.
7. **Verificar:** lo hace el responsable, nunca quien corrigió.

## Estados

`Abierta` → `En corrección` → `Corregida · por verificar` → `Verificada` → `Cerrada`

También `Abierta · <motivo>` (p. ej. `Abierta · requiere backend`), `Resuelta por otro cambio` y `Descartada`.
`Verificada`, `Cerrada` y `Descartada` las pone **solo el responsable**.
