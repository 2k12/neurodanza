// neurodanza-mapa · mapa en vivo del ciclo de /neurodanza-feature.
// Un panel al lado del chat (con scroll) que muestra en qué fase está el ciclo, qué hace cada
// subagente (pasos, última herramienta, tiempo, veredicto) y el plan. Además vigila el presupuesto
// de pasos de cada subagente y le avisa cuando se acerca al tope o repite la misma llamada.
// Solo observa: no cambia lo que hacen las herramientas. Ver docs/11-mapa-y-ciclo.md.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agente, Ciclo, Fase } from '../types'

type Dollar = EngineInterface
const PANE = 'neurodanza-mapa'
const TITULO = 'neurodanza'
export const FASES = ['Entender', 'Implementar', 'Verificar', 'Revisores', 'Panel de personas', 'Cerrar']

const ciclo = atom({ plugin: 'neurodanza-mapa', key: 'ciclo' } as const, nuevoCiclo('', 0, false), { shape: 'ciclo-1' })

// ───────────────────────── lógica pura (probada en register.test.tsx) ─────────────────────────

export function nuevoCiclo(titulo: string, ahora: number, activo = true): Ciclo {
  const fases: Fase[] = FASES.map((nombre, n) => ({ n, nombre, estado: 'pendiente', vueltas: 0 }))
  return { activo, titulo, inicio: ahora, fase: -1, esperando: false, fases, agentes: [], log: [] }
}

/** Mueve el ciclo a la fase `n`: las anteriores quedan hechas; volver atrás suma una vuelta. */
export function irAFase(c: Ciclo, n: number, ahora: number): Ciclo {
  if (n === c.fase) return c.esperando ? { ...c, esperando: false } : c
  const atras = n < c.fase
  const fases = c.fases.map((f): Fase => {
    if (f.n === n) return { ...f, estado: 'activa', inicio: atras || !f.inicio ? ahora : f.inicio, fin: undefined, vueltas: f.vueltas + (atras || f.estado === 'hecha' ? 1 : 0) }
    if (f.n < n) return f.estado === 'hecha' ? f : { ...f, estado: 'hecha', inicio: f.inicio ?? ahora, fin: ahora }
    return atras && f.estado !== 'pendiente' ? { ...f, estado: 'pendiente' } : f
  })
  return { ...c, fase: n, esperando: false, fases }
}

type Llamada = { tool: string; [campo: string]: unknown }

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const base = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
const corto = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const VERIFICAR = /\b(lint|eslint|tsc|typecheck|type-check|vitest|jest|playwright test|node --test|(pnpm|npm|yarn|bun)( run)? (test|check|verify))\b/i

/**
 * Fase que sugiere una llamada del agente principal, o null si no dice nada. Las ediciones del
 * plan (`.neurodanza/`) y de la bitácora al cerrar no mueven el ciclo.
 */
export function faseDe(e: Llamada, actual: number): number | null {
  const t = e.tool
  if (t === 'Skill' && /neurodanza-feature/.test(str(e.skill))) return 0
  if (t === 'Agent' || t === 'Task') {
    const tipo = str(e.subagent_type)
    if (/revisor-|fantasma/.test(tipo)) return 3
    // En el paso 0 las personas escriben su recorrido futuro (Tenet): siguen en la fase de planificar.
    if (/persona-evaluadora/.test(tipo)) return actual < 1 ? 0 : 4
    // Los especialistas responden antes de delegar: fase de implementar.
    if (/especialista-/.test(tipo)) return 1
    if (/implementador/.test(tipo)) return actual >= 2 && actual !== 5 ? 1 : actual < 1 ? 1 : null
    return null
  }
  if (t === 'Edit' || t === 'Write' || t === 'MultiEdit' || t === 'NotebookEdit') {
    const p = str(e.file_path) || str(e.notebook_path)
    if (/[\\/]\.neurodanza[\\/]/.test(p) || actual === 5) return null
    return actual < 1 || actual >= 2 ? 1 : null
  }
  if (t === 'Bash' || t === 'PowerShell') {
    const cmd = str(e.command)
    if (/ciclo\.mjs["']?\s+revisores/.test(cmd)) return 3
    if (/panel\.mjs/.test(cmd)) return 4
    if (/\bgit\s+commit\b|\bgh\s+pr\s+create\b/.test(cmd)) return 5
    if (VERIFICAR.test(cmd)) return actual <= 2 ? 2 : null
  }
  return null
}

/** Texto corto de lo que hace una llamada. */
export function etiqueta(e: Llamada): string {
  const t = e.tool
  if (t === 'Bash' || t === 'PowerShell') return `${t === 'Bash' ? '$' : '>'} ${corto(str(e.command).replace(/\s+/g, ' '), 44)}`
  if (e.file_path || e.notebook_path) return `${t} ${base(str(e.file_path) || str(e.notebook_path))}`
  if (e.pattern) return `${t} ${corto(str(e.pattern), 36)}`
  if (t === 'Agent' || t === 'Task') return `Agent ${str(e.subagent_type) || 'general'}`
  if (t === 'Skill') return `Skill ${str(e.skill)}`
  return t
}

/** Huella de una llamada para detectar bucles (misma herramienta con la misma entrada). */
export function huella(e: Llamada): string {
  const { tool, command, file_path, pattern, path, url, query, skill } = e
  return JSON.stringify([tool, command, file_path, pattern, path, url, query, skill])
}

export type Presupuesto = { revisor: number; persona: number; implementador: number; otro: number }
export const PRESUPUESTO: Presupuesto = { revisor: 25, persona: 20, implementador: 60, otro: 40 }

/** Presupuesto de los fantasmas (`fantasmas.maxPasos`, `fantasmas.maxSegundos`). */
export const fantasmaTope = { pasos: 15, seg: 180 }
export const especialistaTope = { pasos: 8, seg: 120 }

export type Tiempos = { revisor: number; persona: number; implementador: number; otro: number }
export const TIEMPOS: Tiempos = { revisor: 300, persona: 210, implementador: 900, otro: 420 }

/** Tope de tiempo (s) de un subagente según su tipo (`ciclo.maxSegundos`). */
export const maxSegundos = (tipo: string, t: Tiempos) => (/fantasma/.test(tipo) ? fantasmaTope.seg : /especialista-/.test(tipo) ? especialistaTope.seg : /revisor-/.test(tipo) ? t.revisor : /persona-evaluadora/.test(tipo) ? t.persona : /implementador/.test(tipo) ? t.implementador : t.otro)

/** ¿Un subagente que sigue corriendo pasó `latidoMs` sin dar un paso? */
export const sinLatido = (a: Agente, ahora: number, latidoMs: number) => a.estado === 'corriendo' && ahora - (a.ultimoPaso ?? a.inicio) > latidoMs

/** Muertes por tarea (`.neurodanza/muertes.json`, del rebobinado del modo director). */
export function muertesPorTarea(m: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of Array.isArray(m) ? m : []) {
    const t = (x as { tarea?: string })?.tarea
    if (t) out[t] = (out[t] ?? 0) + 1
  }
  return out
}

/**
 * Marcas de un nodo: continuación (↻ n, del re-enfundado), muertes (✝ n), cuarentena (⛔) y, en las personas,
 * regresiones de experiencia de su recorrido (⚠ n, de `.neurodanza/regresiones.json`).
 */
export function marcas(a: Agente, muertes: Record<string, number>, cuarentena: Record<string, boolean>, regresiones: Record<string, string[]> = {}): string {
  const out: string[] = []
  const tarea = Object.keys(muertes).find((t) => a.desc.includes(t))
  if (tarea) out.push(`✝ ${muertes[tarea]}`)
  if (cuarentena[a.id]) out.push('⛔ cuarentena')
  if (/persona-evaluadora/.test(a.tipo)) {
    const p = Object.keys(regresiones).find((id) => new RegExp(`\\b${id.replace(/[^\w-]/g, '')}\\b`, 'i').test(a.desc))
    const n = p ? (regresiones[p]?.length ?? 0) : 0
    if (n) out.push(`⚠ ${n} ${n > 1 ? 'regresiones' : 'regresión'}`)
  }
  return out.length ? ` ${out.join(' ')}` : ''
}

/** Consultas al hotel de especialistas (`.neurodanza/hotel/consultas.json`): «🏨 datos ✔ (caché) · 🏨 permisos ▶». */
export function hotelDe(h: unknown): string {
  const cs = (h as { consultas?: { especialista: string; estado: string }[] } | null)?.consultas ?? []
  return cs.map((c) => `🏨 ${c.especialista} ${c.estado === 'en caché' ? '✔ (caché)' : c.estado === 'respondido' ? '✔' : '▶'}`).join(' · ')
}

/** Capas fundidas del fusible (`.neurodanza/fusible.json`): no se reintentan y dejan el panel pendiente. */
export function fundidasDe(f: unknown): { capa: string; motivo: string }[] {
  const capas = (f as { capas?: Record<string, { fundida?: boolean; motivo?: string }> } | null)?.capas ?? {}
  return Object.entries(capas)
    .filter(([, c]) => c?.fundida)
    .map(([capa, c]) => ({ capa, motivo: String(c.motivo ?? '') }))
}

export const maxPasos = (tipo: string, p: Presupuesto) => (/fantasma/.test(tipo) ? fantasmaTope.pasos : /especialista-/.test(tipo) ? especialistaTope.pasos : /revisor-/.test(tipo) ? p.revisor : /persona-evaluadora/.test(tipo) ? p.persona : /implementador/.test(tipo) ? p.implementador : p.otro)

/** Aviso que toca mandarle a un subagente tras un paso, o null. Cada aviso se manda una vez. */
export function avisoPara(a: Agente): { clave: string; texto: string } | null {
  if (a.repetidas >= 3 && !a.avisos.includes('bucle'))
    return { clave: 'bucle', texto: `neurodanza: repetiste la misma llamada ${a.repetidas} veces seguidas (${a.ultima}). No va a dar otro resultado: cambia de enfoque o entrega lo que tienes.` }
  if (a.pasos >= a.max && !a.avisos.includes('tope'))
    return { clave: 'tope', texto: `neurodanza: llegaste al presupuesto de ${a.max} pasos. Entrega YA tu respuesta con lo que tienes, en el formato pedido, y marca lo que no alcanzaste a revisar.` }
  if (a.pasos >= Math.ceil(a.max * 0.8) && a.pasos < a.max && !a.avisos.includes('aviso'))
    return { clave: 'aviso', texto: `neurodanza: llevas ${a.pasos} de ${a.max} pasos. Cierra: verifica solo lo que falte para decidir y entrega tu respuesta.` }
  return null
}

/** Veredicto que se lee en la respuesta de un subagente (revisor: aprobado; persona: nota). */
export function veredictoDe(texto: string): string | undefined {
  const fantasma = texto.match(/"confirmado"\s*:\s*(true|false)/)
  if (fantasma) {
    const g = texto.match(/"gravedad"\s*:\s*"(alta|media|baja)"/)
    return fantasma[1] === 'true' ? `✔ ${g?.[1] ?? 'confirmado'}` : 'sin hallazgo'
  }
  if (/confirmado \((alta|media|baja)\)/.test(texto)) return `✔ ${texto.match(/confirmado \((alta|media|baja)\)/)?.[1]}`
  if (/no confirmado/.test(texto)) return 'sin hallazgo'
  const nota = texto.match(/"nota"\s*:\s*(\d+(?:\.\d+)?)/)
  if (nota) return `nota ${nota[1]}`
  const ap = texto.match(/"aprobado"\s*:\s*(true|false)/)
  if (ap) {
    const n = (texto.match(/"(?:gravedad|severidad)"\s*:\s*"(alta|media)"/g) ?? []).length
    return ap[1] === 'true' ? '✔ aprobado' : `✖ ${n || 'con'} hallazgo${n === 1 ? '' : 's'}`
  }
  return undefined
}

export const reloj = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Pasos del plan (`- [x] …` / `- [ ] …`) del archivo del ciclo. */
export function pasosDelPlan(md: string): { hecho: boolean; texto: string }[] {
  return [...md.matchAll(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/gm)].map((m) => ({ hecho: m[1] !== ' ', texto: (m[2] ?? '').trim() }))
}

// ───────────────────────── el mod ─────────────────────────

type Estado = { at?: string; fase?: string; problemas?: number; ms?: number; pasos?: { repo: string; paso: string; ok: boolean; ms: number; cache?: boolean }[] }

// Lo que se lee del proyecto (se vuelve a leer en cada inicio o recarga del mod).
let raiz = ''
let planRel = '.neurodanza/plan.md'
let presupuesto: Presupuesto = PRESUPUESTO
let tiempos: Tiempos = TIEMPOS
let latidoMs = 90_000
let tick: { cancel: () => void } | undefined
const archivos: { plan: string; estado: Estado | null; director: boolean; fundidas: { capa: string; motivo: string }[]; muertes: Record<string, number>; cuarentena: Record<string, boolean>; regresiones: Record<string, string[]>; hotel: string; leido: number } = { plan: '', estado: null, director: false, fundidas: [], muertes: {}, cuarentena: {}, regresiones: {}, hotel: '', leido: 0 }

const ahora = () => Date.now()

async function buscarProyecto($: Dollar) {
  let dir = (await $.session.cwd()).replace(/\\/g, '/')
  for (let i = 0; i < 8 && dir; i++) {
    const f = `${dir}/neurodanza.config.json`
    if (await $.fs.exists(f)) {
      raiz = dir
      try {
        const cfg = JSON.parse(String(await $.fs.read(f)))
        if (cfg?.ciclo?.plan) planRel = cfg.ciclo.plan
        if (cfg?.ciclo?.maxPasos) presupuesto = { ...PRESUPUESTO, ...cfg.ciclo.maxPasos }
        if (cfg?.ciclo?.maxSegundos) tiempos = { ...TIEMPOS, ...cfg.ciclo.maxSegundos }
        if (cfg?.ciclo?.latidoSeg) latidoMs = Number(cfg.ciclo.latidoSeg) * 1000
        if (cfg?.fantasmas?.maxPasos) fantasmaTope.pasos = Number(cfg.fantasmas.maxPasos)
        if (cfg?.fantasmas?.maxSegundos) fantasmaTope.seg = Number(cfg.fantasmas.maxSegundos)
        if (cfg?.hotel?.maxPasos) especialistaTope.pasos = Number(cfg.hotel.maxPasos)
        if (cfg?.hotel?.maxSegundos) especialistaTope.seg = Number(cfg.hotel.maxSegundos)
      } catch {
        /* config inválida: el hook de neurodanza ya avisa */
      }
      return
    }
    const up = dir.replace(/\/[^/]*$/, '')
    if (up === dir) break
    dir = up
  }
}

async function leerArchivos($: Dollar) {
  if (!raiz || ahora() - archivos.leido < 1500) return
  archivos.leido = ahora()
  try {
    archivos.plan = String(await $.fs.read(`${raiz}/${planRel}`))
  } catch {
    archivos.plan = ''
  }
  try {
    archivos.estado = JSON.parse(String(await $.fs.read(`${raiz}/.neurodanza/estado.json`)))
  } catch {
    archivos.estado = null
  }
  try {
    archivos.director = JSON.parse(String(await $.fs.read(`${raiz}/.neurodanza/director/modo.json`)))?.activo === true
  } catch {
    archivos.director = false
  }
  try {
    const f = JSON.parse(String(await $.fs.read(`${raiz}/.neurodanza/fusible.json`)))
    archivos.fundidas = fundidasDe(f)
  } catch {
    archivos.fundidas = []
  }
  try {
    archivos.muertes = muertesPorTarea(JSON.parse(String(await $.fs.read(`${raiz}/.neurodanza/muertes.json`))))
  } catch {
    archivos.muertes = {}
  }
  try {
    archivos.regresiones = JSON.parse(String(await $.fs.read(`${raiz}/.neurodanza/regresiones.json`))) ?? {}
  } catch {
    archivos.regresiones = {}
  }
  try {
    archivos.hotel = hotelDe(JSON.parse(String(await $.fs.read(`${raiz}/.neurodanza/hotel/consultas.json`))))
  } catch {
    archivos.hotel = ''
  }
  // Cuarentena: solo de los subagentes que siguen corriendo (pocos archivos).
  const corriendo = (await read($, ciclo)).agentes.filter((a) => a.estado === 'corriendo')
  const cuarentena: Record<string, boolean> = {}
  for (const a of corriendo) {
    try {
      const r = JSON.parse(String(await $.fs.read(`${raiz}/.neurodanza/agentes/${a.id.replace(/[^\w.-]/g, '_')}.json`)))
      if (r?.cuarentena) cuarentena[a.id] = true
    } catch {
      /* sin registro */
    }
  }
  archivos.cuarentena = cuarentena
}

function arrancarReloj($: Dollar) {
  if (tick) return
  tick = $.clock.every(1000, () => {
    void (async () => {
      const c = await read($, ciclo)
      if (!c.activo) return
      // El estado real de cada subagente (los de fondo no avisan al terminar por la herramienta).
      if (c.agentes.some((a) => a.estado === 'corriendo')) {
        const lista = await $.agent.list()
        await update($, ciclo, (x) => ({
          ...x,
          agentes: x.agentes.map((a): Agente => {
            const info = lista.find((i) => i.id === a.id)
            if (a.estado !== 'corriendo' || !info) return a
            if (info.status === 'completed') return { ...a, estado: 'hecho', fin: a.fin ?? ahora() }
            if (info.status === 'failed') return { ...a, estado: 'fallo', fin: a.fin ?? ahora() }
            if (info.status === 'killed') return { ...a, estado: 'detenido', fin: a.fin ?? ahora() }
            return a
          }),
        }))
      }
      await leerArchivos($)
      $.ui.invalidate('ui.render')
      estadoEnLinea($, await read($, ciclo))
    })()
  })
}

function estadoEnLinea($: Dollar, c: Ciclo) {
  if (!c.activo || c.fase < 0) return $.ui.status(undefined)
  const corriendo = c.agentes.filter((a) => a.estado === 'corriendo' && a.fase === c.fase)
  const enFase = c.agentes.filter((a) => a.fase === c.fase)
  const agentes = enFase.length ? ` · ${enFase.length - corriendo.length}/${enFase.length} agentes` : ''
  $.ui.status(`nd ${c.fase} ${FASES[c.fase]}${agentes}${c.esperando ? ' · esperándote' : ''} · ${reloj(ahora() - c.inicio)}`)
}

async function abrir($: Dollar) {
  await $.ui.open({ id: PANE, title: TITULO })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'neurodanza-mapa', description: 'Abre el mapa en vivo del ciclo de neurodanza (fases y subagentes)' })
    await buscarProyecto($)
    const c = await read($, ciclo)
    if (c.activo) {
      arrancarReloj($)
      void abrir($)
    }
    return next(e)
  })

  on('command.run', { command: 'neurodanza-mapa' }, async ($) => {
    const c = await read($, ciclo)
    if (!c.activo) await update($, ciclo, () => ({ ...nuevoCiclo('sin ciclo todavía', ahora()), activo: true }))
    arrancarReloj($)
    await abrir($)
    return { text: 'Mapa de neurodanza abierto.' }
  })

  // Un subagente nuevo: nodo en la fase actual (o en la que su tipo indica).
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (!('agentId' in r) || !r.agentId) return r
    const id = r.agentId
    await update($, ciclo, (c) => {
      if (!c.activo && !/^neurodanza:/.test(e.subagentType)) return c
      const tipo = e.subagentType.replace(/^neurodanza:/, '')
      const fase = /revisor-|fantasma/.test(tipo) ? 3 : /persona-evaluadora/.test(tipo) ? 4 : /implementador/.test(tipo) ? 1 : Math.max(c.fase, 0)
      const base = c.activo ? c : nuevoCiclo('ciclo de neurodanza', ahora())
      const agente: Agente = {
        id,
        toolUseId: e.tool_use_id,
        tipo,
        desc: e.description,
        fase,
        padre: e.parentAgentId,
        estado: 'corriendo',
        pasos: 0,
        max: maxPasos(tipo, presupuesto),
        ultima: 'arrancando',
        inicio: ahora(),
        maxSeg: maxSegundos(tipo, tiempos),
        ultimoPaso: ahora(),
        huella: '',
        repetidas: 0,
        avisos: [],
      }
      const conFase = fase > base.fase || (fase === 1 && base.fase >= 2 && base.fase !== 5) ? irAFase(base, fase, ahora()) : base
      return { ...conFase, agentes: [...conFase.agentes, agente].slice(-60) }
    })
    arrancarReloj($)
    void abrir($)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const llamada = e as unknown as Llamada
    const t = ahora()
    let aviso: { agentId: string; texto: string } | null = null

    if (e.agentId) {
      // Un paso de un subagente: contar, detectar bucles y vigilar el presupuesto.
      await update($, ciclo, (c) => {
        const i = c.agentes.findIndex((a) => a.id === e.agentId)
        if (i < 0) return c
        const a = c.agentes[i]
        if (!a) return c
        const h = huella(llamada)
        const nuevo: Agente = { ...a, pasos: a.pasos + 1, ultima: etiqueta(llamada), huella: h, repetidas: h === a.huella ? a.repetidas + 1 : 1, ultimoPaso: t }
        const av = avisoPara(nuevo)
        if (av) {
          nuevo.avisos = [...nuevo.avisos, av.clave]
          aviso = { agentId: a.id, texto: av.texto }
        }
        const agentes = [...c.agentes]
        agentes[i] = nuevo
        return { ...c, agentes }
      })
      const a = aviso as { agentId: string; texto: string } | null
      if (a) void $.session.append({ agentId: a.agentId, message: { type: 'user', content: [{ type: 'text', text: a.texto }] } }).catch(() => undefined)
    } else {
      // Un paso del agente principal: la fase que sugiere y el registro.
      await update($, ciclo, (c) => {
        const f = faseDe(llamada, c.fase)
        if (f === 0) return irAFase({ ...nuevoCiclo(corto(str(e.tool === 'Skill' ? (llamada.args as string) : '') || 'nueva funcionalidad', 70), t), activo: true }, 0, t)
        if (!c.activo) return c
        const conFase = f === null ? c : irAFase(c, f, t)
        return { ...conFase, esperando: false, log: [...conFase.log, `${reloj(t - c.inicio)} ${etiqueta(llamada)}`].slice(-40) }
      })
      const c = await read($, ciclo)
      if (c.activo) {
        arrancarReloj($)
        if (c.fase === 0) void abrir($)
      }
    }

    const ran = await next(e)

    // Al volver un Agent en primer plano: veredicto y fin del nodo.
    if (e.tool === 'Agent') {
      const texto = (ran.text ?? '') + (ran.result === undefined ? '' : JSON.stringify(ran.result))
      const lista = await $.agent.list().catch(() => [])
      await update($, ciclo, (c) => ({
        ...c,
        agentes: c.agentes.map((a): Agente => {
          if (a.toolUseId !== e.tool_use_id) return a
          const info = lista.find((i) => i.id === a.id)
          const sigue = info && (info.status === 'running' || info.status === 'pending' || info.status === 'waiting')
          const veredicto = veredictoDe(texto) ?? a.veredicto
          if (sigue) return { ...a, veredicto }
          return { ...a, estado: ran.isError ? 'fallo' : 'hecho', fin: a.fin ?? ahora(), veredicto }
        }),
      }))
    }
    return ran
  })

  // Fin del turno principal: el ciclo queda esperando al usuario (p. ej. el visto bueno del paso 0).
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!(e as { agentId?: string }).agentId) {
      await update($, ciclo, (c) => (c.activo ? { ...c, esperando: true } : c))
      estadoEnLinea($, await read($, ciclo))
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, ciclo)
    await leerArchivos($)
    const t = ahora()
    const ancho = Math.max(30, (e.props as { bodyColumns?: number }).bodyColumns ?? 60)
    const plan = pasosDelPlan(archivos.plan)
    const estado = archivos.estado

    const marca = (f: Fase) => (f.estado === 'hecha' ? '●' : f.estado === 'activa' ? '◐' : '○')
    const colorFase = (f: Fase) => (f.estado === 'hecha' ? 'success' : f.estado === 'activa' ? 'claude' : 'inactive')
    const colorAgente = (a: Agente) => (/fantasma/.test(a.tipo) && a.veredicto?.startsWith('✔') ? 'error' : a.estado === 'hecho' ? (a.veredicto?.startsWith('✖') ? 'warning' : 'success') : a.estado === 'corriendo' ? 'claude' : 'error')
    const iconoAgente = (a: Agente) => (a.estado === 'hecho' ? '✔' : a.estado === 'corriendo' ? '▶' : '✖')
    const alerta = (a: Agente) => {
      if (a.estado !== 'corriendo') return ''
      const usado = (t - a.inicio) / 1000
      if (a.maxSeg && usado >= a.maxSeg) return ' ⚠ sin tiempo'
      if (sinLatido(a, t, latidoMs)) return ' ⚠ sin latido'
      if (a.repetidas >= 3) return ' ⚠ bucle'
      if (a.pasos >= a.max) return ' ⚠ tope'
      if (a.pasos >= Math.ceil(a.max * 0.8) || (a.maxSeg && usado >= a.maxSeg * 0.8)) return ' ⚠ cerca del tope'
      return ''
    }

    if (!c.activo) {
      return (
        <Box flexDirection="column">
          <Text bold>neurodanza · mapa del ciclo</Text>
          <Text dimColor>Sin ciclo activo. Se abre solo al correr /neurodanza-feature o al lanzar un revisor o una persona.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {corto(c.titulo, ancho - 10)} <Text dimColor>⏱ {reloj(t - c.inicio)}</Text>
        </Text>
        {archivos.director && <Text color="claude">◆ modo director: el agente principal dirige; los implementadores trabajan en worktrees</Text>}
        {archivos.fundidas.map((f) => (
          <Text color="error" wrap="wrap">
            ⚡ no se pudo verificar: {f.capa} ({corto(f.motivo, Math.max(20, ancho - 30))}) · no se reintenta{f.capa === 'app' || f.capa === 'chromium' ? ' · panel pendiente' : ''}
          </Text>
        ))}
        {c.esperando && <Text color="warning">⏸ esperando tu respuesta</Text>}
        <Text dimColor> </Text>
        {c.fases.map((f) => {
          const agentes = c.agentes.filter((a) => a.fase === f.n)
          const dura = f.inicio ? reloj((f.fin ?? t) - f.inicio) : ''
          const info = f.n === 1 && archivos.hotel ? archivos.hotel : f.n === 2 && estado?.pasos?.length ? estado.pasos.map((p) => `${p.repo} ${p.paso} ${p.ok ? '✔' : '✖'}${p.cache ? '(caché)' : ` ${reloj(p.ms)}`}`).join(' · ') : ''
          return (
            <Box flexDirection="column">
              <Text color={colorFase(f)} bold={f.estado === 'activa'}>
                {marca(f)} {f.n} {f.nombre}
                <Text dimColor>
                  {dura ? `  ${dura}` : ''}
                  {f.vueltas > 0 ? `  vuelta ${f.vueltas + 1}` : ''}
                </Text>
              </Text>
              {info !== '' && (
                <Text dimColor wrap="wrap">
                  {'   '}
                  {info}
                </Text>
              )}
              {agentes.map((a, i) => (
                <Button key={`nd-agente-${a.id}`} plain dimColor={a.estado !== 'corriendo' || (/fantasma/.test(a.tipo) && !a.veredicto?.startsWith('✔'))} onPress={() => void $.ui.view({ agentId: a.id })}>
                  <Text color={colorAgente(a)}>
                    {'   '}
                    {i === agentes.length - 1 ? '└─' : '├─'} {iconoAgente(a)} {/fantasma/.test(a.tipo) ? `👻 ${corto(a.desc || 'fantasma', 20)}` : /especialista-/.test(a.tipo) ? `🏨 ${a.tipo.replace(/^.*especialista-/, '')}` : a.tipo === 'implementador' || a.desc.includes('↻') ? corto(a.desc || a.tipo, 24) : corto(a.tipo.replace(/^revisor-/, ''), 18)}
                  </Text>
                  <Text dimColor>
                    {' '}
                    {a.estado === 'corriendo' ? corto(a.ultima, Math.max(12, ancho - 52)) : a.veredicto ?? a.estado} · {a.pasos}/{a.max} pasos · {reloj((a.fin ?? t) - a.inicio)}{a.maxSeg ? `/${reloj(a.maxSeg * 1000)}` : ''}
                  </Text>
                  <Text color="warning">{alerta(a)}</Text>
                  <Text color="error">{marcas(a, archivos.muertes, archivos.cuarentena, archivos.regresiones)}</Text>
                </Button>
              ))}
            </Box>
          )
        })}
        {plan.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              Plan <Text dimColor>({plan.filter((p) => p.hecho).length}/{plan.length})</Text>
            </Text>
            {plan.map((p) => (
              <Text color={p.hecho ? 'success' : undefined} dimColor={p.hecho} wrap="wrap">
                {p.hecho ? ' ✔ ' : ' ○ '}
                {p.texto}
              </Text>
            ))}
          </Box>
        )}
        {c.log.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Agente principal</Text>
            {c.log.slice(-12).map((l) => (
              <Text dimColor wrap="truncate-end">
                {' '}
                {l}
              </Text>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Button key="nd-reiniciar" plain dimColor label="reiniciar mapa" onPress={() => void update($, ciclo, () => ({ ...nuevoCiclo('sin ciclo todavía', ahora()), activo: true }))} />
        </Box>
        <Text dimColor>Enter o clic en un subagente: ver su conversación.</Text>
      </Box>
    )
  })
}
