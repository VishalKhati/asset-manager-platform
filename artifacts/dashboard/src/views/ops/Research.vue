<template>
  <div class="space-y-4">
    <h1 class="text-xl font-black">Research reports</h1>
    <p class="text-xs muted">
      Walk-forward reports produced by <code>research/</code> and uploaded with
      <code>node dist/cli.mjs upload-report research/reports/walkforward.json</code>. Read-only on purpose: there is no optimizer here,
      because tuning parameters on the data you then judge them by overfits the strategy.
    </p>
    <div class="card">
      <table class="data-table text-sm">
        <thead><tr><th>#</th><th>Created</th><th>Strategy</th><th>Gate 1</th><th class="text-right">OOS trades</th><th class="text-right">OOS expectancy</th><th>Public</th></tr></thead>
        <tbody>
          <tr v-for="run in runs" :key="run.id" class="cursor-pointer" @click="open(run.id)">
            <td class="num">{{ run.id }}</td>
            <td class="muted">{{ run.createdAt.slice(0, 10) }}</td>
            <td>{{ run.strategyId }} v{{ run.strategyVersion }}</td>
            <td :style="{ color: run.summary.gatePass ? 'var(--green)' : 'var(--red)' }">{{ run.summary.gatePass ? 'pass' : 'fail' }}</td>
            <td class="num text-right">{{ run.summary.oos?.trades ?? '—' }}</td>
            <td class="num text-right">{{ r(run.summary.oos?.expectancyR, 3) }}</td>
            <td class="faint">{{ run.isPublic ? 'yes' : 'no' }}</td>
          </tr>
          <tr v-if="!runs.length"><td colspan="7" class="text-center faint py-8">No reports uploaded yet.</td></tr>
        </tbody>
      </table>
    </div>

    <template v-if="report">
      <Section :title="`Report #${selected} · out-of-sample equity`">
        <EquityChart :points="report.oosEquityR" :height="260" />
      </Section>
      <Section title="Gate 1">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          <div v-for="(ok, name) in report.gate.checks" :key="name" class="card px-3 py-2 flex justify-between">
            <span class="muted">{{ name }}</span><b :style="{ color: ok ? 'var(--green)' : 'var(--red)' }">{{ ok ? 'pass' : 'fail' }}</b>
          </div>
        </div>
      </Section>
      <Section title="Walk-forward windows">
        <table class="data-table text-sm">
          <thead><tr><th>Test window</th><th>Chosen on train</th><th class="text-right">Test trades</th><th class="text-right">Test expectancy</th><th class="text-right">Test PF</th></tr></thead>
          <tbody>
            <tr v-for="w in report.windows" :key="w.test[0]">
              <td class="num muted">{{ w.test[0] }} → {{ w.test[1] }}</td>
              <td class="text-xs">SL {{ w.chosen.slAtrMult }}×ATR · pullback {{ w.chosen.pullbackBars }} · TP1 close {{ Math.round(w.chosen.tp1Fraction * 100) }}%</td>
              <td class="num text-right">{{ w.testStats.trades }}</td>
              <td class="num text-right">{{ r(w.testStats.expectancyR, 3) }}</td>
              <td class="num text-right">{{ Number(w.testStats.profitFactor).toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Section from '../../components/Section.vue'
import EquityChart from '../../components/EquityChart.vue'
import { api } from '../../lib/api'
import { r } from '../../lib/format'

interface RunRow {
  id: number
  strategyId: string
  strategyVersion: number
  isPublic: boolean
  createdAt: string
  summary: { gatePass: boolean; oos?: { trades: number; expectancyR: number } }
}
interface Report {
  oosEquityR: Array<[number, number]>
  gate: { checks: Record<string, boolean> }
  windows: Array<{ test: [string, string]; chosen: { slAtrMult: number; pullbackBars: number; tp1Fraction: number }; testStats: { trades: number; expectancyR: number; profitFactor: number | string } }>
}

const runs = ref<RunRow[]>([])
const report = ref<Report | null>(null)
const selected = ref<number | null>(null)

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
