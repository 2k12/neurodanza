# 1. Cómo funciona

neurodanza es **un solo plugin** de Claude Code (está en la raíz del repo; el marketplace es `.claude-plugin/marketplace.json`). Trae:

| Pieza | Archivo | Qué es |
|---|---|---|
| Configuración | `lib/config.mjs` | Carga `neurodanza.config.json`, aplica valores por defecto y valida. |
| Hooks | `hooks/hooks.json` | Registra los errores conocidos (`SessionStart`), las barreras (`PreToolUse`), el lint al editar (`PostToolUse`) y la definición de terminado (`Stop`). |
| Barreras | `hooks/guardrails.mjs` | Decide si una herramienta se permite. |
| Retroalimentación | `hooks/feedback.mjs` | Errores conocidos al iniciar, lint al editar y revisión completa al terminar (en paralelo y con caché). |
| Errores conocidos | `lib/errores.mjs` | Catálogo del proyecto: firma, contador y solución de cada problema que marcan los hooks. |
| Director | `lib/director.mjs` y `agents/implementador.md` | Modo director: worktrees por tarea, contratos e integración del diff. |
| Constructos | `lib/constructos.mjs` | Lecciones por agente: reflexión al cerrar, a prueba, aprobadas solo si mejoran. |
| Ciclo | `lib/ciclo.mjs` | Qué revisores aplican al diff y el presupuesto de pasos. |
| Mapa en vivo | `mapa/` (plugin `neurodanza-mapa`) | Panel al lado del chat con la fase, cada subagente y el plan; avisa a los subagentes por presupuesto y bucles. |
| Agentes | `agents/*.md` | 4 revisores y la `persona-evaluadora`. |
| Skills | `skills/*/SKILL.md` | `/neurodanza-init`, `/neurodanza-feature`, `/neurodanza-evals`. |
| Panel | `panel/panel.mjs` y `panel/*.ps1`, `panel/*.vbs` | Elegir personas, crear usuarios, navegar, calificar y las ventanas de Windows. |
| Evals | `evals/evals.mjs` | Arma las instrucciones de evaluación y califica. |
| ESLint | `eslint/no-junk-comments.mjs` | Regla contra comentarios basura y firmas de IA. |

## Regla de oro: sin configuración, nada

Cada hook busca `neurodanza.config.json` subiendo desde la carpeta de trabajo (hasta 8 niveles). Si no lo encuentra, sale sin hacer nada. Si el archivo existe pero es inválido, escribe el error y **no bloquea** (sale con código 0), para que una configuración rota no te deje sin trabajar.

## El ciclo completo

```mermaid
flowchart TD
    A[Pedido del usuario] --> B["/neurodanza-feature<br/>0. Entender y planificar: plan.md y visto bueno"]
    B --> C[1. Implementar en una rama]
    C --> G{"Barreras<br/>PreToolUse"}
    G -- prohibido --> GX[Bloqueo con motivo<br/>el agente corrige la causa] --> C
    G -- permitido --> H["Herramienta se ejecuta"]
    H --> L{"Lint al editar<br/>PostToolUse"}
    L -- error --> C
    L -- ok --> D[2. Verificar: lint, tipos y pruebas]
    D --> R["3. Revisores que aplican, en paralelo<br/>coherencia · permisos · ui · docs"]
    R -- "aprobado: false (máx. 2 vueltas)" --> C
    R -- todos aprueban --> P0["4. Panel de personas<br/>app corriendo · usuarios · elegir 3 a 5"]
    P0 --> V{"panel.ventana"}
    V -- "windows (y Windows)" --> VW["en-vivo: ventana con avatares<br/>las personas usan decir / oir"]
    V -- "ninguna o macOS/Linux" --> VC[Solo chat]
    VW --> N["persona-evaluadora × N<br/>navegar con Playwright y calificar 1 a 10"]
    VC --> N
    N --> S["calificar: promedio > umbral"]
    S --> X["cerrar: la ventana muestra notas y se cierra"]
    X -- no aprobó y quedan rondas --> C
    X -- no aprobó y no quedan rondas --> U[Informar al usuario<br/>y pedir permiso para otra ronda]
    X -- aprobó --> Z{"Stop: definición de terminado<br/>lint · tipos · pruebas · versión · bitácora<br/>migraciones · panel aprobado · guías · evals"}
    Z -- falta algo --> C
    Z -- todo bien --> F["5. Cerrar: bitácora, PR si se pidió, informe"]
    M["neurodanza-mapa<br/>fase · subagentes · presupuesto"] -.observa.-> C
    M -.observa.-> R
    M -.observa.-> N
    K["Errores conocidos<br/>.neurodanza/errores.json"] -.pista.-> C
    Z -.registra.-> K
    E["/neurodanza-evals<br/>al cambiar agentes, personas o umbrales"] -.-> R
    E -.-> N
```

## Qué es automático y qué no

- **Automático (hooks):** barreras, lint al editar y la revisión al terminar. Corren solos en cada sesión de Claude Code dentro de un proyecto configurado.
- **Guiado (skills):** revisores, panel y evals. Los orquesta Claude siguiendo `/neurodanza-feature` y `/neurodanza-evals`. El hook `Stop` sí exige el resultado: no deja terminar un cambio de pantallas sin una evaluación del panel aprobada para la versión actual (ver [05-retroalimentacion.md](05-retroalimentacion.md)).

## Lo que nunca hace

- No hace commit ni push si no se lo pides, y nunca agrega coautoría ni firmas de IA.
- No arranca servicios que solo tú puedes abrir (Docker Desktop, una VPN…): te los pide.
- Las personas no modifican código ni documentación; dejan sus capturas e informes fuera de los repos.
