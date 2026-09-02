import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '../composables/useApi'

export type SupportedSymbol = 'XAUUSD' | 'BTCUSD'

export interface SignalResult {
  signal: 'BUY' | 'SELL' | null
  confidence: number
  mode: string
  agreeing: string[]
  reason: string
  timestamp: string
  price?: number
}

export interface Trade {
  id: string
  symbol?: string
  direction: 'BUY' | 'SELL'
  entry: number
  sl: number
  tp: number
  lots: number
  slPips: number
  tpPips: number
  confidence: number
  strategies: string[]
  openedAt: string
  closedAt?: string
  pnl?: number
  status: 'open' | 'closed' | 'cancelled'
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  ts: string
}

export interface Candle {
  time:   number
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

export interface DailyPnl {
  day:         string
  pnl:         number
  trades:      number
  wins:        number
  losses:      number
  grossProfit: number
  grossLoss:   number
}

export const useBotStore = defineStore('bot', () => {
  // ─── Symbol ────────────────────────────────────────────────────────────────
  const activeSymbol = ref<SupportedSymbol>('XAUUSD')

  const symbolLabel = computed(() => activeSymbol.value)

  const symbolIcon = computed(() =>
    activeSymbol.value === 'BTCUSD' ? '₿' : '⚡'
  )

  const symbolColor = computed(() =>
    activeSymbol.value === 'BTCUSD' ? 'var(--blue)' : 'var(--gold)'
  )

  const priceDecimals = computed(() =>
    activeSymbol.value === 'BTCUSD' ? 0 : 2
  )

  /** Append ?symbol= to any API path */
  function symQ(path: string): string {
    const sep = path.includes('?') ? '&' : '?'
    return `${path}${sep}symbol=${activeSymbol.value}`
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  const running     = ref(false)
  const mode        = ref<'signal' | 'live' | 'backtest'>('signal')
  const price       = ref<number | null>(null)
  const lastSignal  = ref<SignalResult | null>(null)
  const trades      = ref<Trade[]>([])
  const logs        = ref<LogEntry[]>([])
  const tradesToday = ref(0)
  const maxTradesPerDay = ref(3)
  const error       = ref<string | null>(null)
  const loading     = ref(false)
  const mas         = ref<Record<string, number | null>>({})
  const strategies  = ref<Record<string, { enabled: boolean; weight?: number }>>({})
  const candles     = ref<Candle[]>([])
  const dailyPnl    = ref<DailyPnl[]>([])

  // ─── Computed ──────────────────────────────────────────────────────────────
  const winRate = computed(() => {
    const closed = trades.value.filter(t => t.status === 'closed')
    if (!closed.length) return 0
    const wins = closed.filter(t => (t.pnl ?? 0) > 0).length
    return Math.round((wins / closed.length) * 100)
  })

  const totalPnl = computed(() =>
    trades.value.reduce((s, t) => s + (t.pnl ?? 0), 0)
  )

  // ─── Actions ───────────────────────────────────────────────────────────────
  function setSymbol(sym: SupportedSymbol) {
    if (sym === activeSymbol.value) return
    activeSymbol.value = sym
    // Reset stale data so old symbol's data doesn't flash
    price.value      = null
    lastSignal.value = null
    candles.value    = []
    mas.value        = {}
    trades.value     = []
    logs.value       = []
    dailyPnl.value   = []
    // Re-fetch everything for the new symbol
    void Promise.all([fetchStatus(), fetchConfig(), fetchSignal(), fetchHistory(), fetchDailyPnl()])
  }

  async function fetchStatus() {
    try {
      const data = await api.get<{
        running: boolean; mode: string; tradesToday: number;
        lastSignal: SignalResult | null
      }>(symQ('/status'))
      running.value     = data.running
      mode.value        = data.mode as typeof mode.value
      tradesToday.value = data.tradesToday
      if (data.lastSignal) lastSignal.value = data.lastSignal
    } catch (e) {
      error.value = String(e)
    }
  }

  async function fetchSignal() {
    try {
      loading.value = true
      const data = await api.get<{
        signal: SignalResult; price: number;
        mas: Record<string, number | null>;
        candles: Candle[]
      }>(symQ('/signal'))
      lastSignal.value = data.signal
      price.value      = data.price
      mas.value        = data.mas
      if (data.candles?.length) candles.value = data.candles
      error.value      = null
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  async function fetchHistory() {
    try {
      const data = await api.get<{ trades: Trade[] }>(symQ('/history?limit=50'))
      trades.value = data.trades
    } catch (e) {
      error.value = String(e)
    }
  }

  async function fetchDailyPnl(days = 30) {
    try {
      const data = await api.get<{ data: DailyPnl[] }>(symQ(`/pnl-daily?days=${days}`))
      dailyPnl.value = data.data
    } catch { /* silent */ }
  }

  async function fetchLogs() {
    try {
      const data = await api.get<{ logs: LogEntry[] }>(symQ('/log?limit=100'))
      logs.value = data.logs
    } catch (e) {
      error.value = String(e)
    }
  }

  async function fetchConfig() {
    try {
      const data = await api.get<{
        config: {
          strategies: typeof strategies.value
          mode: string
          risk: { maxTradesPerDay: number }
        }
      }>(symQ('/config'))
      strategies.value     = data.config.strategies as typeof strategies.value
      mode.value           = data.config.mode as typeof mode.value
      maxTradesPerDay.value = data.config.risk?.maxTradesPerDay ?? 3
    } catch (e) {
      error.value = String(e)
    }
  }

  async function startBot() {
    try {
      await api.post(symQ('/start'))
      running.value = true
    } catch (e) { error.value = String(e) }
  }

  async function stopBot() {
    try {
      await api.post(symQ('/stop'))
      running.value = false
    } catch (e) { error.value = String(e) }
  }

  async function updateConfig(patch: unknown) {
    try {
      await api.put(symQ('/config'), patch)
      await fetchConfig()
    } catch (e) { error.value = String(e) }
  }

  return {
    activeSymbol, symbolLabel, symbolIcon, symbolColor, priceDecimals,
    running, mode, price, lastSignal, trades, logs,
    tradesToday, maxTradesPerDay, error, loading, mas, strategies, candles, dailyPnl,
    winRate, totalPnl,
    setSymbol, symQ,
    fetchStatus, fetchSignal, fetchHistory, fetchLogs,
    fetchConfig, fetchDailyPnl, startBot, stopBot, updateConfig,
  }
})
