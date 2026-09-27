<template>
  <div class="space-y-4">
    <h1 class="text-xl font-black">Why no signal?</h1>
    <p class="text-xs muted">Every M5 close, the first rule that blocked a signal. Kept for 90 days.</p>
    <div class="flex flex-wrap gap-2">
      <button v-for="(n, reason) in counts" :key="reason" class="pill" :style="filter === reason ? 'background:var(--gold);color:#1a1200' : 'background:var(--bg-card-2);color:var(--text-2)'" @click="filter = filter === reason ? '' : String(reason)">
        {{ labels[reason] ?? reason }} · {{ n }}
      </button>
    </div>
    <div class="card overflow-x-auto">
      <table class="data-table text-sm">
        <thead>
          <tr><th>Bar close</th><th>Decision</th><th class="text-right">Close</th><th class="text-right">%K / %D</th><th class="text-right">ATR</th><th class="text-right">Spread</th><th>M15 trend</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in shown" :key="e.t">
            <td class="num muted whitespace-nowrap">{{ dateTime(e.t) }}</td>
            <td :style="{ color: e.reason === 'signal' ? 'var(--gold)' : 'var(--text-1)' }">{{ labels[e.reason] ?? e.reason }}</td>
            <td class="num text-right">{{ price(e.close) }}</td>
            <td class="num text-right faint">{{ fmt(e.diag?.k) }} / {{ fmt(e.diag?.d) }}</td>
            <td class="num text-right faint">{{ fmt(e.diag?.atr) }}</td>
            <td class="num text-right faint">{{ fmt(e.diag?.spread) }}</td>
            <td class="faint">{{ trend(e.diag) }}</td>
          </tr>
          <tr v-if="!shown.length"><td colspan="7" class="text-center faint py-8">Nothing recorded yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../../lib/api'
import { dateTime, price } from '../../lib/format'

type Diag = Record<string, number | null> | null
interface Evaluation {
  t: number
  reason: string
  close: number | null
  diag: Diag
}

const rows = ref<Evaluation[]>([])
const labels = ref<Record<string, string>>({})
const filter = ref('')
const shown = computed(() => (filter.value ? rows.value.filter((r) => r.reason === filter.value) : rows.value))
const counts = computed(() => {
  const out: Record<string, number> = {}
  for (const r of rows.value) out[r.reason] = (out[r.reason] ?? 0) + 1
  return out
})
const fmt = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2))

function trend(d: Diag): string {
  if (!d || d['m15Close'] == null || d['m15EmaTrend'] == null || d['m15EmaFast'] == null || d['m15EmaSlow'] == null) return '—'
  if (d['m15Close']! > d['m15EmaTrend']! && d['m15EmaFast']! > d['m15EmaSlow']!) return 'up'
  if (d['m15Close']! < d['m15EmaTrend']! && d['m15EmaFast']! < d['m15EmaSlow']!) return 'down'
  return 'mixed'
}

onMounted(async () => {
  const res = await api.get<{ evaluations: Evaluation[]; labels: Record<string, string> }>('/engine/evaluations?limit=200')
  rows.value = res.evaluations
  labels.value = res.labels
})
</script>
