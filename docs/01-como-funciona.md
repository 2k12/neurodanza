# 1. Cómo funciona

neurodanza es **un solo plugin** de Claude Code (está en la raíz del repo; el marketplace es `.claude-plugin/marketplace.json`). Trae:

| Pieza | Archivo | Qué es |
|---|---|---|
| Configuración | `lib/config.mjs` | Carga `neurodanza.config.json`, aplica valores por defecto y valida. |
| Hooks | `hooks/hooks.json` | Registra los errores conocidos y la autoconfiguración (`SessionStart`), las barreras y el tiempo por subagente (`PreToolUse`), el lint al editar (`PostToolUse`), la definición de terminado (`Stop`), el fin de cada subagente (`SubagentStop`) y el cierre de la ronda del panel (`SessionEnd`). |
| Barreras | `hooks/guardrails.mjs` | Decide si una herramienta se permite. |
| Retroalimentación | `hooks/feedback.mjs` | Errores conocidos al iniciar, lint al editar y revisión completa al terminar (en paralelo y con caché). |
| Errores conocidos | `lib/errores.mjs` | Catálogo del proyecto: firma, contador y solución de cada problema que marcan los hooks. |
| Director | `lib/director.mjs` y `agents/implementador.md` | Modo director: worktrees por tarea, contratos e integración del diff. |
| Constructos | `lib/constructos.mjs` | Lecciones por agente: reflexión al cerrar, a prueba, aprobadas solo si mejoran. |
| Velocidad | `lib/procesos.mjs`, `lib/firma.mjs`, `lib/fondo.mjs`, `lib/agentes.mjs`, `lib/fusible.mjs` | Comandos con tope que matan su árbol, firma del cambio, suite completa en segundo plano, tiempo y latido por subagente, fusible por capa externa. Ver [15-velocidad.md](15-velocidad.md). |
| No perder trabajo | `lib/pilas.mjs`, `hooks/pilas.mjs`, `director.mjs decidir`/`rebobinar` | Pila de cada subagente, re-enfundar guiado y rebobinar con memoria. Ver [16-no-perder-trabajo.md](16-no-perder-trabajo.md). |
| Seguridad | `lib/figuras.mjs`, `lib/fantasmas.mjs`, `agents/fantasma.md` | Figuras y manos, segunda llave (`ask`), cuarentena y fantasmas en modo propuesta. Ver [17-seguridad.md](17-seguridad.md). |
| Panel con recorridos | `lib/recorridos.mjs`, `panel.mjs navegar --recorrido` / `comparar` | Recorridos acordados antes de implementar, memoria por versión y regresiones de experiencia. Ver [18-panel-con-recorridos.md](18-panel-con-recorridos.md). |
| Menos exploración | `lib/indice.mjs`, `lib/hotel.mjs`, `lib/operador.mjs`, `agents/especialista-*.md` | Índice pre-cocido por commit, especialistas antes de delegar y lecciones que se recuerdan al tocar sus archivos. Ver [19-menos-exploracion.md](19-menos-exploracion.md). |
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
    A[Pedido del usuario] --> B["/neurodanza-feature<br/>0. Entender y planificar: plan.md"]
    B --> RC["Recorridos acordados (Tenet)<br/>cada persona escribe qué espera poder hacer"]
    RC --> VB{"Visto bueno del usuario<br/>plan + recorridos (congelados con hash)"}
    VB --> HO["Especialistas antes de delegar<br/>datos · a11y · permisos · rendimiento<br/>(respuestas en caché)"]
    HO --> C["1. Implementar<br/>contrato: recorridos + índice + lo que ya sabemos"]
    IX["Índice pre-cocido por commit<br/>.neurodanza/indice/"] -.resumen enfocado.-> C
    IX -.contexto.-> HO
    OP["Operador: lección con activadores<br/>se recuerda una vez al tocar su archivo"] -.aviso.-> G
    C --> G{"Barreras<br/>PreToolUse"}
    G -- prohibido --> GX[Bloqueo con motivo<br/>el agente corrige la causa] --> C
    G -- permitido --> H["Herramienta se ejecuta"]
    H --> L{"Lint al editar<br/>PostToolUse"}
    L -- error --> C
    L -- ok --> D["2. Verificar: lint, tipos y pruebas relacionadas<br/>(la suite completa corre en el fondo)"]
    D --> AP{"App levantada una vez<br/>panel.mjs app"}
    AP -- "2 fallos: capa fundida" --> PP["Panel PENDIENTE<br/>decide el usuario"]
    AP -- responde --> T3["3. Mismo turno, en paralelo"]
    PP --> T3
    T3 --> R["Revisores que aplican<br/>coherencia · permisos · ui · docs"]
    T3 --> N["persona-evaluadora × N, a la vez<br/>primero su recorrido (una llamada),<br/>después exploración corta en pantallas del diff"]
    N --> WW["Memoria por recorrido (Westworld)<br/>regresiones: más clics, más tiempo,<br/>pasos que dejan de cumplir"]
    R --> J{"Juntar"}
    N --> J
    J -- "revisor reprobó (alto):<br/>la ronda no aprueba" --> C
    J -- "panel ≤ umbral (quedan rondas)" --> C
    J -- "no quedan rondas" --> U[Informar al usuario<br/>y pedir permiso para otra ronda]
    J -- "todo aprobado o panel pendiente" --> Z{"Stop: definición de terminado<br/>lint · tipos · pruebas (con tope) · fallas del fondo<br/>versión · bitácora · migraciones · panel · guías · evals"}
    Z -- falta algo --> C
    Z -- todo bien --> FE["fondo.mjs esperar:<br/>suite completa ok para este cambio"]
    FE --> F["5. Cerrar: bitácora, reflexión, PR si se pidió, informe"]
    K2["Corte por tiempo y latido<br/>.neurodanza/agentes/"] -.vigila.-> R
    K2 -.vigila.-> N
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
