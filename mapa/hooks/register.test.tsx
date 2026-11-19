import { expect, test } from 'claude-code/testing'

import { avisoPara, etiqueta, faseDe, fundidasDe, irAFase, marcas, maxPasos, maxSegundos, muertesPorTarea, nuevoCiclo, pasosDelPlan, PRESUPUESTO, sinLatido, TIEMPOS, veredictoDe } from './register'
import type { Agente } from '../types'

const PANE = {
  plugin: 'neurodanza-mapa',
  component: 'Pane',
  requestId: 'neurodanza-mapa',
  props: { title: 'neurodanza', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('fases: cada llamada del agente principal mueve el ciclo a su fase', () => {
  expect(faseDe({ tool: 'Skill', skill: 'neurodanza:neurodanza-feature' }, -1)).toBe(0)
  expect(faseDe({ tool: 'Write', file_path: 'C:/p/.neurodanza/plan.md' }, 0)).toBe(null)
  expect(faseDe({ tool: 'Edit', file_path: 'src/a.ts' }, 0)).toBe(1)
  expect(faseDe({ tool: 'Bash', command: 'pnpm lint && pnpm test' }, 1)).toBe(2)
  expect(faseDe({ tool: 'Agent', subagent_type: 'neurodanza:revisor-ui' }, 2)).toBe(3)
  expect(faseDe({ tool: 'Edit', file_path: 'src/a.ts' }, 3)).toBe(1)
  expect(faseDe({ tool: 'Bash', command: 'MSYS_NO_PATHCONV=1 node /x/panel/panel.mjs elegir' }, 3)).toBe(4)
  expect(faseDe({ tool: 'Bash', command: 'git commit -m "feat: x"' }, 4)).toBe(5)
  expect(faseDe({ tool: 'Edit', file_path: 'docs/bitacora.md' }, 5)).toBe(null)
  expect(faseDe({ tool: 'Agent', subagent_type: 'neurodanza:implementador' }, 0)).toBe(1)
  expect(faseDe({ tool: 'Agent', subagent_type: 'neurodanza:implementador' }, 3)).toBe(1)
  expect(maxPasos('implementador', PRESUPUESTO)).toBe(60)
})

test('fases: volver atrás suma una vuelta y deja pendientes las de adelante', () => {
  let c = irAFase(nuevoCiclo('x', 0), 0, 0)
  c = irAFase(c, 3, 10)
  expect(c.fases.map((f) => f.estado)).toEqual(['hecha', 'hecha', 'hecha', 'activa', 'pendiente', 'pendiente'])
  c = irAFase(c, 1, 20)
  expect(c.fases[1]?.estado).toBe('activa')
  expect(c.fases[1]?.vueltas).toBe(1)
  expect(c.fases[3]?.estado).toBe('pendiente')
})

test('presupuesto: aviso al 80 %, tope al 100 % y bucle a la tercera repetición, una vez cada uno', () => {
  const a: Agente = { id: 'a', toolUseId: 't', tipo: 'revisor-ui', desc: '', fase: 3, estado: 'corriendo', pasos: 20, max: 25, ultima: 'Grep x', inicio: 0, huella: '', repetidas: 1, avisos: [] }
  expect(avisoPara(a)?.clave).toBe('aviso')
  expect(avisoPara({ ...a, avisos: ['aviso'] })).toBe(null)
  expect(avisoPara({ ...a, pasos: 25, avisos: ['aviso'] })?.clave).toBe('tope')
  expect(avisoPara({ ...a, pasos: 3, repetidas: 3 })?.clave).toBe('bucle')
})

test('veredictos, etiquetas y plan', () => {
  expect(veredictoDe('{"aprobado": true, "hallazgos": []}')).toBe('✔ aprobado')
  expect(veredictoDe('{"aprobado": false, "hallazgos": [{"gravedad": "alta"}, {"gravedad": "media"}, {"gravedad": "baja"}]}')).toBe('✖ 2 hallazgos')
  expect(veredictoDe('{"nota": 9.5}')).toBe('nota 9.5')
  expect(etiqueta({ tool: 'Read', file_path: 'C:\\p\\src\\pedidos.ts' })).toBe('Read pedidos.ts')
  expect(pasosDelPlan('# Plan\n- [x] uno\n- [ ] dos\n')).toEqual([{ hecho: true, texto: 'uno' }, { hecho: false, texto: 'dos' }])
})

test('el mapa dibuja la fase y el subagente que corre, en cada superficie', async ($, on) => {
  on('command.register', () => ({ value: { command: 'neurodanza-mapa' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ag1' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Skill', skill: 'neurodanza:neurodanza-feature', args: 'filtro por fecha' })
  await $.agent.spawn({ subagentType: 'neurodanza:revisor-ui', description: 'revisar ui', prompt: 'x' } as unknown as Parameters<typeof $.agent.spawn>[0])
  await $.tool.call({ tool: 'Grep', pattern: 'lucide', agentId: 'ag1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Revisores/ }))?.text).toContain('3 Revisores')
    expect((await ui.find({ type: 'Text', text: /revisor-ui|ui/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Grep lucide/ }))?.text).toContain('1/25 pasos')
    await ui.unmount()
  }
})

test('tiempo, latido y fusible en el mapa', () => {

  expect(maxSegundos('revisor-ui', TIEMPOS)).toBe(300)
  expect(maxSegundos('implementador', TIEMPOS)).toBe(900)
  const a = { id: 'a', toolUseId: 't', tipo: 'revisor-ui', desc: '', fase: 3, estado: 'corriendo' as const, pasos: 2, max: 25, ultima: '', inicio: 0, huella: '', repetidas: 0, avisos: [], ultimoPaso: 1000 }
  expect(sinLatido(a, 50_000, 90_000)).toBe(false)
  expect(sinLatido(a, 100_000, 90_000)).toBe(true)
  expect(sinLatido({ ...a, estado: 'hecho' as const }, 100_000, 90_000)).toBe(false)
  expect(fundidasDe({ capas: { app: { fundida: true, motivo: 'no arranca' }, bd: { fundida: false } } })).toEqual([{ capa: 'app', motivo: 'no arranca' }])
  expect(fundidasDe(null)).toEqual([])
})

test('reemplazos, muertes, cuarentena y fantasmas en el mapa', () => {
  expect(muertesPorTarea([{ tarea: 'pedidos-api' }, { tarea: 'pedidos-api' }, { tarea: 'otra' }])).toEqual({ 'pedidos-api': 2, otra: 1 })
  const a = { id: 'i2', toolUseId: 't', tipo: 'implementador', desc: 'pedidos-api ↻ 2', fase: 1, estado: 'corriendo' as const, pasos: 2, max: 60, ultima: '', inicio: 0, huella: '', repetidas: 0, avisos: [] }
  expect(marcas(a, { 'pedidos-api': 1 }, {})).toBe(' ✝ 1')
  expect(marcas(a, {}, { i2: true })).toBe(' ⛔ cuarentena')
  expect(veredictoDe('{"id":"h1","confirmado":true,"gravedad":"alta"}')).toBe('✔ alta')
  expect(veredictoDe('resultado guardado · h2 · no confirmado')).toBe('sin hallazgo')
  expect(faseDe({ tool: 'Agent', subagent_type: 'neurodanza:fantasma' }, 2)).toBe(3)
  expect(maxPasos('fantasma', PRESUPUESTO)).toBe(15)
})
