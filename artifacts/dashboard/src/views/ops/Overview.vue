<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-black">Overview</h1>
      <div class="flex items-center gap-2">
        <span class="text-xs faint">stream {{ connected ? 'connected' : 'reconnecting' }}</span>
        <template v-if="auth.isAdmin && status">
          <button v-if="!status.paused" class="btn btn-danger" :disabled="busy" @click="pause">Pause signals</button>
          <button v-else class="btn btn-gold" :disabled="busy" @click="resume">Resume signals</button>
        </template>
      </div>
    </div>
    <p v-if="error" class="card p-3 text-sm" style="color: #fca5a5">{{ error }}</p>

    <section v-if="status" class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="card p-4">
        <div class="text-xs faint uppercase tracking-wider mb-1">Price feed</div>
        <div class="font-bold" :style="{ color: status.feedHealthy ? 'var(--green)' : 'var(--red)' }">
          {{ status.feedHealthy ? 'Healthy' : 'Silent' }}
        </div>
        <div class="text-xs muted">Last bar {{ age(status.lastBarAgeS) }}{{ status.marketOpen ? '' : ' · market closed' }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs faint uppercase tracking-wider mb-1">Engine</div>
        <div class="font-bold" :style="{ color: status.paused ? 'var(--gold)' : status.engineHealthy ? 'var(--green)' : 'var(--red)' }">
          {{ status.paused ? 'Paused' : status.engineHealthy ? 'Running' : 'Behind' }}
        </div>
        <div class="text-xs muted">
          {{ status.paused ? `${status.pausedReason ?? ''} (${status.pausedBy ?? ''})` : `heartbeat ${age(status.engineHeartbeatAgeS)}` }}
        </div>
      </div>
      <div class="card p-4">
        <div class="text-xs faint uppercase tracking-wider mb-1">Telegram queue</div>
        <div class="font-bold" :style="{ color: status.outboxFailed ? 'var(--red)' : 'var(--text-1)' }">
          {{ status.outboxPending }} pending · {{ status.outboxFailed }} failed
        </div>
        <div class="text-xs muted">mode: {{ status.mode }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs faint uppercase tracking-wider mb-1">News calendar</div>
        <div class="font-bold" :style="{ color: (status.newsFetchedAgeS ?? 1e9) < 36 * 3600 ? 'var(--text-1)' : 'var(--red)' }">
          {{ age(status.newsFetchedAgeS) }}
        </div>
        <div class="text-xs muted">
          cooldown {{ status.cooldownUntil * 1000 > Date.now() ? `until ${dateTime(status.cooldownUntil)}` : 'none' }}
        </div>
      </div>
    </section>

    <div class="grid md:grid-cols-3 gap-4">
      <Section title="Live chart (M5, last 48 hours)" class="md:col-span-2">
        <CandleChart :bars="bars" :signal="openSignal" :height="360" />
        <p v-if="!bars.length" class="text-xs faint text-center">No bars in the last 48 hours. The market is closed or the feed has not started.</p>
      </Section>
      <div class="space-y-4">
        <SignalCard v-if="latest" :signal="latest" />
        <div v-else class="card p-5 text-sm muted">No signals yet.</div>
        <Section title="Feeders">
          <div v-for="f in status?.feeders ?? []" :key="f.id" class="text-xs space-y-0.5 mb-2">
            <div class="font-semibold">{{ f.id }} <span class="faint">{{ f.version }}</span></div>
            <div class="muted">
              seen {{ age(f.lastSeenAgeS) }} · terminal {{ f.terminalConnected ? 'connected' : 'disconnected' }} · UTC{{ f.serverUtcOffsetMin === null ? ' ?' : fmtOffset(f.serverUtcOffsetMin) }}
            </div>
          </div>
          <p v-if="!status?.feeders.length" class="text-xs faint">No feeder has connected yet. See feeder/README.md.</p>
        </Section>
      </div>
    </div>

    <Section title="Results by mode">
      <table class="data-table text-sm">
        <thead>
          <tr><th>Mode</th><th class="text-right">Trades</th><th class="text-right">Win rate</th><th class="text-right">Expectancy</th><th class="text-right">Total</th><th class="text-right">PF</th><th class="text-right">Max DD</th><th class="text-right">Expired</th></tr>
        </thead>
        <tbody>
          <tr v-for="(s, mode) in stats" :key="mode">
            <td class="capitalize">{{ mode }}</td>
            <td class="num text-right">{{ s.summary.trades }}</td>
            <td class="num text-right">{{ s.summary.trades ? pct(s.summary.winRate) : '—' }}</td>
            <td class="num text-right">{{ s.summary.trades ? r(s.summary.expectancyR, 3) : '—' }}</td>
            <td class="num text-right">{{ r(s.summary.totalR, 1) }}</td>
            <td class="num text-right">{{ s.summary.trades ? pf(s.summary.profitFactor) : '—' }}</td>
            <td class="num text-right">{{ s.summary.maxDrawdownR.toFixed(1) }}R</td>
            <td class="num text-right">{{ s.summary.expired }}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Section from '../../components/Section.vue'
import CandleChart from '../../components/CandleChart.vue'
import SignalCard from '../../components/SignalCard.vue'
import { api } from '../../lib/api'
import { age, dateTime, pct, pf, r } from '../../lib/format'
import { useSignalStream } from '../../lib/stream'
import type { Bar, EngineStatus, Signal, Summary } from '../../lib/types'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const status = ref<EngineStatus | null>(null)
const bars = ref<Bar[]>([])
const signals = ref<Signal[]>([])
const stats = ref<Record<string, { summary: Summary }>>({})
const error = ref('')
const busy = ref(false)
const latest = computed(() => signals.value[0] ?? null)
const openSignal = computed(() => (latest.value && ['pending', 'active', 'be'].includes(latest.value.state) ? latest.value : null))
const fmtOffset = (m: number) => `${m >= 0 ? '+' : '−'}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? `:${String(Math.abs(m) % 60).padStart(2, '0')}` : ''}`

async function load(): Promise<void> {
  try {
    const [s, c, l, st] = await Promise.all([
      api.get<{ status: EngineStatus }>('/engine/status'),
      api.get<{ bars: Bar[] }>('/public/chart?hours=48'),
      api.get<{ signals: Signal[] }>('/signals?limit=5'),
      api.get<{ stats: Record<string, { summary: Summary }> }>('/signals/stats'),
    ])
    status.value = s.status
    bars.value = c.bars
    signals.value = l.signals
    stats.value = st.stats
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load status.'
  }
}

async function pause(): Promise<void> {
  const reason = window.prompt('Reason for pausing (shown in /health):', 'manual pause')
  if (reason === null) return
  busy.value = true
  try {
    await api.post('/engine/pause', { reason })
    await load()
  } finally {
    busy.value = false
  }
}

async function resume(): Promise<void> {
  busy.value = true
  try {
    await api.post('/engine/resume')
    await load()
  } finally {
    busy.value = false
  }
}

const { connected } = useSignalStream('/api/stream', () => void load())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(load, 30_000) // status and chart; signals arrive over the stream
})
onBeforeUnmount(() => clearInterval(timer))
</script>
