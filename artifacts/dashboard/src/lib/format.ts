import type { Signal } from './types'

export const price = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2))

export function r(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}R`
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`
export const pf = (x: number | null) => (x === null ? '∞' : x.toFixed(2))

export function dateTime(t: number | null | undefined): string {
  if (!t) return '—'
  return new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function age(s: number | null | undefined): string {
  if (s === null || s === undefined) return 'never'
  if (s < 90) return `${Math.max(0, Math.round(s))}s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} days ago`
}

const OUTCOME: Record<string, string> = {
  tp2: 'TP2 hit',
  tp1_be: 'TP1, then entry',
  sl: 'Stopped',
  time_exit: 'Time limit',
  expired: 'Expired',
}

export function status(s: Signal): string {
  if (s.state === 'pending') return 'Waiting for entry'
  if (s.state === 'active') return 'Open'
  if (s.state === 'be') return 'TP1 hit, stop at entry'
  return OUTCOME[s.outcome ?? ''] ?? s.state
}

export function outcomeColor(s: Signal): string {
  if (s.state === 'pending' || s.state === 'active' || s.state === 'be') return 'var(--gold)'
  if (s.outcome === 'expired') return 'var(--text-3)'
  return (s.rNet ?? 0) > 0 ? 'var(--green)' : (s.rNet ?? 0) < 0 ? 'var(--red)' : 'var(--text-2)'
}
