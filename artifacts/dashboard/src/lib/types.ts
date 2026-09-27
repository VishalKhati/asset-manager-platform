export interface SignalEvent {
  id: number
  type: string
  t: number
  price: number
}

export interface Signal {
  id: number
  publicNo: string
  symbol: string
  strategy: string
  mode: string
  published: boolean
  direction: 'long' | 'short'
  t: number
  entry: number
  sl: number
  slCurrent: number
  tp1: number
  tp2: number
  risk: number
  atr: number
  spread: number
  validUntil: number
  state: 'pending' | 'active' | 'be' | 'closed' | 'expired'
  fill: number | null
  fillT: number | null
  outcome: string | null
  closedT: number | null
  rNet: number | null
  rGross: number | null
  events: SignalEvent[]
}

export interface Summary {
  trades: number
  expired: number
  wins: number
  losses: number
  winRate: number
  totalR: number
  expectancyR: number
  profitFactor: number | null
  avgWinR: number
  avgLossR: number
  maxDrawdownR: number
  longestLosingStreak: number
  outcomes: Record<string, number>
}

export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  emaFast: number | null
  emaSlow: number | null
  emaTrend: number | null
}

export interface EngineStatus {
  symbol: string
  mode: string
  paused: boolean
  pausedReason: string | null
  pausedBy: string | null
  marketOpen: boolean
  lastBarT: number | null
  lastBarAgeS: number | null
  engineCursorT: number
  engineHeartbeatAgeS: number | null
  engineHealthy: boolean
  feedHealthy: boolean
  feeders: Array<{ id: string; lastSeenAgeS: number | null; terminalConnected: boolean | null; serverUtcOffsetMin: number | null; version: string | null }>
  newsFetchedAgeS: number | null
  outboxPending: number
  outboxFailed: number
  cooldownUntil: number
  openSignal: { publicNo: string; direction: string; state: string } | null
  strategy: { configId: number; id: string; version: number } | null
}
