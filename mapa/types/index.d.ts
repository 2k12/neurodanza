export type EstadoFase = 'pendiente' | 'activa' | 'hecha'

export type Fase = {
  n: number
  nombre: string
  estado: EstadoFase
  inicio?: number
  fin?: number
  /** Veces que el ciclo volvió a esta fase (vuelta tras un revisor o una persona que reprobó). */
  vueltas: number
}

export type EstadoAgente = 'corriendo' | 'hecho' | 'fallo' | 'detenido'

export type Agente = {
  id: string
  toolUseId: string
  tipo: string
  desc: string
  fase: number
  padre?: string
  estado: EstadoAgente
  pasos: number
  max: number
  ultima: string
  inicio: number
  fin?: number
  /** Huella de la última llamada y cuántas veces seguidas se repitió. */
  huella: string
  repetidas: number
  /** Avisos ya enviados al subagente: 'aviso' (80 %), 'tope' (100 %), 'bucle'. */
  avisos: string[]
  veredicto?: string
  /** Tope de tiempo del agente (s) y hora de su último paso: para mostrar tiempo usado / total y el latido. */
  maxSeg?: number
  ultimoPaso?: number
}

export type Ciclo = {
  activo: boolean
  titulo: string
  inicio: number
  fase: number
  esperando: boolean
  fases: Fase[]
  agentes: Agente[]
  /** Últimas acciones del agente principal, para saber en qué está. */
  log: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'neurodanza-mapa': { ciclo: Shaped<Ciclo> }
  }
}
