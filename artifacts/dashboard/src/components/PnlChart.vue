<template>
  <div class="relative w-full" style="height:180px">
    <canvas ref="chartEl" style="width:100%;height:100%"></canvas>
    <div v-if="!props.data.length"
      class="absolute inset-0 flex flex-col items-center justify-center gap-2">
      <span class="text-2xl opacity-20">$</span>
      <span class="text-xs" style="color:var(--text-3)">No closed trades in this period</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  Chart,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from 'chart.js'

Chart.register(
  BarElement, BarController,
  LineElement, LineController, PointElement,
  LinearScale, CategoryScale,
  Tooltip, Legend,
)

export interface DailyPnl {
  day:         string
  pnl:         number
  trades:      number
  wins:        number
  losses:      number
  grossProfit: number
  grossLoss:   number
}

const props = defineProps<{ data: DailyPnl[] }>()

const chartEl = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

function buildChart() {
  if (!chartEl.value) return

  const labels  = props.data.map(d => {
    const dt = new Date(d.day + 'T00:00:00Z')
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  })

  const pnls     = props.data.map(d => d.pnl)
  const barColors = pnls.map(v => v >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.7)')
  const borderColors = pnls.map(v => v >= 0 ? '#10b981' : '#ef4444')

  // Cumulative P&L line
  let running = 0
  const cumulative = pnls.map(v => parseFloat((running += v).toFixed(2)))

  const chartData = {
    labels,
    datasets: [
      {
        type:            'bar' as const,
        label:           'Daily P&L',
        data:            pnls,
        backgroundColor: barColors,
        borderColor:     borderColors,
        borderWidth:     1,
        borderRadius:    4,
        yAxisID:         'y',
      },
      {
        type:         'line' as const,
        label:        'Cumulative',
        data:         cumulative,
        borderColor:  '#3b82f6',
        borderWidth:  1.5,
        fill:         false,
        tension:      0.3,
        pointRadius:  2,
        pointHoverRadius: 4,
        yAxisID:      'y2',
      },
    ],
  }

  const ctx = chartEl.value.getContext('2d')!

  if (chart) {
    chart.data = chartData
    chart.update('none')
    return
  }

  chart = new Chart(ctx, {
    type: 'bar',
    data: chartData,
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0c1120',
          borderColor:     '#1a2540',
          borderWidth:     1,
          titleColor:      '#94a3b8',
          bodyColor:       '#f1f5f9',
          padding:         10,
          callbacks: {
            title: (items) => items[0]?.label ?? '',
            label: (item) => {
              const y = item.parsed.y ?? 0
              if (item.datasetIndex === 0) {
                const d = props.data[item.dataIndex]!
                const sign = y >= 0 ? '+' : ''
                return [
                  ` Daily P&L: ${sign}$${y.toFixed(2)}`,
                  ` Trades: ${d.trades} (${d.wins}W / ${d.losses}L)`,
                ]
              }
              const sign = y >= 0 ? '+' : ''
              return ` Cumulative: ${sign}$${y.toFixed(2)}`
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { color: '#111c32', drawTicks: false },
          border: { color: '#1a2540' },
          ticks: {
            color:         '#334155',
            font:          { size: 10, family: 'JetBrains Mono, monospace' },
            maxTicksLimit: 10,
            maxRotation:   0,
          },
        },
        y: {
          position: 'left',
          grid:     { color: '#111c32', drawTicks: false },
          border:   { color: '#1a2540' },
          ticks: {
            color:         '#475569',
            font:          { size: 10, family: 'JetBrains Mono, monospace' },
            maxTicksLimit: 5,
            callback:      (v) => `$${(v as number).toFixed(0)}`,
          },
        },
        y2: {
          position: 'right',
          grid:     { display: false },
          border:   { display: false },
          ticks: {
            color:         '#1d4ed8',
            font:          { size: 9, family: 'JetBrains Mono, monospace' },
            maxTicksLimit: 5,
            callback:      (v) => `$${(v as number).toFixed(0)}`,
          },
        },
      },
    },
  })
}

onMounted(() => buildChart())
watch(() => props.data, () => buildChart(), { deep: false })
onBeforeUnmount(() => { chart?.destroy(); chart = null })
</script>
