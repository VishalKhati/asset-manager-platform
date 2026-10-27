<template>
  <div class="max-w-6xl mx-auto px-4 py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-black" style="color: var(--gold)">XAUUSD signal track record</h1>
        <p class="muted text-sm mt-1">
          Every signal the engine has published, resolved automatically against market data. Losses and expired signals are never removed.
        </p>
      </div>
      <div class="flex items-center gap-2 text-xs">
        <span class="w-2 h-2 rounded-full" :class="summary?.feed.healthy ? 'pulse-dot' : ''" :style="{ background: summary?.feed.healthy ? 'var(--green)' : 'var(--red)' }" />
        <span class="muted">
          {{ summary ? (summary.feed.marketOpen ? (summary.feed.healthy ? 'Live' : 'Feed delayed') : 'Market closed') : 'Loading…' }}
          · {{ summary?.mode === 'live' ? 'Public' : 'Forward test (demo)' }}
          <template v-if="summary?.paused"> · paused</template>
        </span>
        <span class="faint">· stream {{ connected ? 'on' : 'off' }}</span>
      </div>
    </header>

    <p v-if="error" class="card p-4 text-sm" style="color: #fca5a5">{{ error }}</p>

    <section v-if="summary" class="grid grid-cols-2 md:grid-cols-6 gap-3">
      <StatCard label="Trades" :value="String(all!.trades)" small />
      <StatCard label="Win rate" :value="all!.trades ? pct(all!.winRate) : '—'" small />
      <StatCard label="Expectancy" :value="all!.trades ? r(all!.expectancyR, 3) : '—'" :accent="tone(all!.expectancyR)" small />
      <StatCard label="Total" :value="r(all!.totalR, 1)" :accent="tone(all!.totalR)" small />
      <StatCard label="Profit factor" :value="all!.trades ? pf(all!.profitFactor) : '—'" small />
      <StatCard label="Max drawdown" :value="`${all!.maxDrawdownR.toFixed(1)}R`" small />
    </section>

    <div class="grid md:grid-cols-3 gap-4 items-start">
      <Section title="Equity curve (R, after costs)" class="md:col-span-2">
        <EquityChart :points="summary?.equity ?? []" />
        <p class="text-xs faint mt-2">Since {{ summary?.since ? dateTime(summary.since) : '—' }} · last 30 days: {{ summary ? r(summary.stats.last30Days.totalR, 1) : '—' }} over {{ summary?.stats.last30Days.trades ?? 0 }} trades</p>
      </Section>
      <div class="space-y-4">
        <SignalCard v-if="latest" :signal="latest" class="cursor-pointer" @click="open(latest)" />
        <div v-else class="card p-5 text-sm muted">No signal yet.</div>
        <Section title="Rules">
          <dl v-if="summary" class="text-xs space-y-2 muted">
            <div><dt class="faint uppercase tracking-wider">Trend</dt><dd>{{ summary.rules.trend }}</dd></div>
            <div><dt class="faint uppercase tracking-wider">Entry</dt><dd>{{ summary.rules.trigger }}</dd></div>
            <div><dt class="faint uppercase tracking-wider">Risk</dt><dd>{{ summary.rules.risk }}</dd></div>
            <div><dt class="faint uppercase tracking-wider">Filters</dt><dd>{{ summary.rules.filters }}</dd></div>
          </dl>
        </Section>
      </div>
    </div>

    <Section title="All signals">
      <SignalTable :signals="signals" @open="open" />
      <div v-if="more" class="text-center mt-4"><button class="btn" @click="loadMore">Load older</button></div>
    </Section>

    <Section v-if="summary?.byMonth.length" title="By month">
      <div class="flex flex-wrap gap-2">
        <div v-for="m in summary.byMonth" :key="m.month" class="card px-3 py-2 text-xs num">
          <div class="faint">{{ m.month }}</div>
          <div :style="{ color: tone(m.totalR) }">{{ r(m.totalR, 1) }}</div>
          <div class="faint">{{ m.trades }} trades</div>
        </div>
      </div>
    </Section>

    <Section v-if="backtests.length" title="Research record: every strategy tested (hypothetical backtests)">
      <p class="text-xs muted mb-3">
        Each strategy's rules were published before it was tested, then run once on data it had never seen. A strategy is only traded after
        it passes. So far none has.
      </p>
      <table class="data-table text-sm">
        <thead><tr><th>Strategy</th><th>Result out of sample</th><th>Gate</th></tr></thead>
        <tbody>
          <tr v-for="b in backtests" :key="b.id">
            <td>{{ b.strategyId }} v{{ b.strategyVersion }}</td>
            <td class="num">{{ researchHeadline(b.summary.oos) }}</td>
            <td :style="{ color: b.summary.gatePass ? 'var(--green)' : 'var(--red)' }">{{ b.summary.gatePass ? 'passed' : 'not passed' }}</td>
          </tr>
        </tbody>
      </table>
    </Section>

    <footer class="text-xs faint border-t pt-4" style="border-color: var(--border)">
      Educational research project, not financial advice. Trading gold CFDs carries a high risk of loss. Prices are simulated fills at the next
      one-minute open, including spread, commission and slippage. Charts by
      <a href="https://www.tradingview.com/" target="_blank" rel="noopener" class="underline">TradingView Lightweight Charts</a>.
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StatCard from '../components/StatCard.vue'
import Section from '../components/Section.vue'
import EquityChart from '../components/EquityChart.vue'
import SignalCard from '../components/SignalCard.vue'
import SignalTable from '../components/SignalTable.vue'
import { api } from '../lib/api'
import { dateTime, pct, pf, r } from '../lib/format'
import { useSignalStream } from '../lib/stream'
import type { Signal, Summary } from '../lib/types'

interface PublicSummary {
  mode: string
  paused: boolean
  rules: { trend: string; trigger: string; risk: string; filters: string }
  stats: { all: Summary; last30Days: Summary }
  since: number | null
  equity: Array<[number, number]>
  byMonth: Array<{ month: string; trades: number; totalR: number }>
  feed: { healthy: boolean; marketOpen: boolean; lastBarAgeS: number | null }
}
interface Backtest {
  id: number
  strategyId: string
  strategyVersion: number
  summary: { gatePass: boolean; oos?: { trades?: number; expectancyR?: number; sharpe?: number; cagr?: number } }
}

const router = useRouter()
const summary = ref<PublicSummary | null>(null)
const signals = ref<Signal[]>([])
const backtests = ref<Backtest[]>([])
const error = ref('')
const more = ref(false)
const all = computed(() => summary.value?.stats.all)
const latest = computed(() => signals.value[0] ?? null)
const tone = (x: number) => (x > 0 ? 'var(--green)' : x < 0 ? 'var(--red)' : 'var(--text-1)')

async function load(): Promise<void> {
  try {
    const [s, l, b] = await Promise.all([
      api.get<PublicSummary>('/public/summary'),
      api.get<{ signals: Signal[] }>('/public/signals?limit=50'),
      api.get<{ backtests: Backtest[] }>('/public/backtests'),
    ])
    summary.value = s
    signals.value = l.signals
    more.value = l.signals.length === 50
    backtests.value = b.backtests
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load the track record.'
  }
}

async function loadMore(): Promise<void> {
  const last = signals.value[signals.value.length - 1]
  if (!last) return
  const res = await api.get<{ signals: Signal[] }>(`/public/signals?limit=50&before=${last.id}`)
  signals.value.push(...res.signals)
  more.value = res.signals.length === 50
}

function researchHeadline(o?: Backtest['summary']['oos']): string {
  if (!o) return '—'
  if (typeof o.expectancyR === 'number') return `${o.trades ?? 0} trades, ${r(o.expectancyR, 3)} per trade`
  if (typeof o.sharpe === 'number') return `Sharpe ${o.sharpe.toFixed(2)}, ${((o.cagr ?? 0) * 100).toFixed(1)}% a year`
  return '—'
}

function open(s: Signal): void {
  void router.push(`/signals/${s.publicNo}`)
}

const { connected } = useSignalStream('/api/public/stream', (s) => {
  const i = signals.value.findIndex((x) => x.id === s.id)
  if (i >= 0) signals.value[i] = s
  else signals.value.unshift(s)
  if (s.outcome) void load() // refresh stats when a signal resolves
})

onMounted(load)
</script>
