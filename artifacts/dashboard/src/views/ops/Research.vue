<template>
  <div class="space-y-4">
    <h1 class="text-xl font-black">Research reports</h1>
    <p class="text-xs muted">
      Every strategy is written down and pushed to GitHub before it is tested, then run once. Reports are uploaded with
      <code>node dist/cli.mjs upload-report research/reports/&lt;file&gt;.json</code>. This page is read-only on purpose: tuning
      parameters on the data you then judge them by overfits the strategy.
    </p>
    <div class="card">
      <table class="data-table text-sm">
        <thead><tr><th>#</th><th>Strategy</th><th>Gate 1</th><th>Key out-of-sample result</th><th>Uploaded</th><th>Public</th></tr></thead>
        <tbody>
          <tr v-for="run in runs" :key="run.id" class="cursor-pointer" :class="selected === run.id ? 'bg-[var(--bg-hover)]' : ''" @click="open(run.id)">
            <td class="num">{{ run.id }}</td>
            <td>{{ run.strategyId }} v{{ run.strategyVersion }}</td>
            <td :style="{ color: run.summary.gatePass ? 'var(--green)' : 'var(--red)' }">{{ run.summary.gatePass ? 'pass' : 'fail' }}</td>
            <td class="num">{{ headline(run.summary.oos) }}</td>
            <td class="muted">{{ run.createdAt.slice(0, 10) }}</td>
            <td class="faint">{{ run.isPublic ? 'yes' : 'no' }}</td>
          </tr>
          <tr v-if="!runs.length"><td colspan="6" class="text-center faint py-8">No reports uploaded yet.</td></tr>
        </tbody>
      </table>
    </div>

    <template v-if="report">
      <Section :title="`Report #${selected} · ${report.strategy.id} · out-of-sample ${curve.unit === '%' ? 'growth' : 'equity'}`">
        <EquityChart :points="curve.points" :unit="curve.unit" :height="260" />
        <p v-if="curve.unit === '%'" class="text-xs faint mt-2">Strategy growth in %, after trading costs and CFD overnight financing.</p>
      </Section>
      <Section title="Gate 1">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          <div v-for="(ok, name) in report.gate.checks" :key="name" class="card px-3 py-2 flex justify-between gap-2">
            <span class="muted">{{ name }}</span><b :style="{ color: ok ? 'var(--green)' : 'var(--red)' }">{{ ok ? 'pass' : 'fail' }}</b>
          </div>
        </div>
      </Section>
      <Section title="Walk-forward windows (parameters chosen on the train window only)">
        <table class="data-table text-sm">
          <thead><tr><th>Test period</th><th>Chosen parameters</th><th class="text-right">Test result</th></tr></thead>
          <tbody>
            <tr v-for="(w, i) in report.windows" :key="i">
              <td class="num muted">{{ period(w) }}</td>
              <td class="text-xs num">{{ params(w.chosen) }}</td>
              <td class="num text-right">{{ headline(testStats(w)) }}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Section from '../../components/Section.vue'
import EquityChart from '../../components/EquityChart.vue'
import { api } from '../../lib/api'
import { r } from '../../lib/format'

type Stats = Record<string, unknown> & { trades?: number; expectancyR?: number; sharpe?: number; cagr?: number }
interface RunRow {
  id: number
  strategyId: string
  strategyVersion: number
  isPublic: boolean
  createdAt: string
  summary: { gatePass: boolean; oos?: Stats }
}
interface Window {
  test?: [string | number, string | number] | Stats
  testYears?: [number, number]
  chosen: Record<string, unknown>
  testStats?: Stats
}
interface Report {
  strategy: { id: string }
  oosEquityR?: Array<[number, number]>
  equity?: Array<[string, number, number]>
  gate: { checks: Record<string, boolean> }
  windows: Window[]
}

const runs = ref<RunRow[]>([])
const report = ref<Report | null>(null)
const selected = ref<number | null>(null)

/** One-line summary that works for R-based (intraday) and return-based (daily) reports. */
function headline(s?: Stats): string {
  if (!s) return '—'
  if (typeof s.expectancyR === 'number') return `${s.trades ?? 0} trades · ${r(s.expectancyR, 3)}/trade`
  if (typeof s.sharpe === 'number') return `Sharpe ${s.sharpe.toFixed(2)} · ${((s.cagr ?? 0) * 100).toFixed(1)}%/yr`
  return '—'
}

function testStats(w: Window): Stats | undefined {
  if (w.testStats) return w.testStats
  return w.test && !Array.isArray(w.test) ? w.test : undefined
}

function period(w: Window): string {
  const t = w.testYears ?? (Array.isArray(w.test) ? w.test : null)
  return t ? `${t[0]} → ${t[1]}` : '—'
}

function params(c: Record<string, unknown>): string {
  return Object.entries(c)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
}

const curve = computed<{ points: Array<[number, number]>; unit: 'R' | '%' }>(() => {
  const rep = report.value
  if (!rep) return { points: [], unit: 'R' }
  if (rep.oosEquityR) return { points: rep.oosEquityR, unit: 'R' }
  const pts = (rep.equity ?? []).map(([d, s]) => [Date.parse(d) / 1000, (s - 1) * 100] as [number, number])
  return { points: pts, unit: '%' }
})

async function open(id: number): Promise<void> {
  const res = await api.get<{ run: { report: Report } }>(`/backtest-runs/${id}`)
  report.value = res.run.report
  selected.value = id
}

onMounted(async () => {
  runs.value = (await api.get<{ runs: RunRow[] }>('/backtest-runs')).runs
  if (runs.value[0]) await open(runs.value[0].id)
})
</script>
