<template>
  <div class="relative w-full" style="height:220px">
    <canvas ref="chartEl" style="width:100%;height:100%"></canvas>
    <div v-if="!props.candles.length"
      class="absolute inset-0 flex items-center justify-center text-sm"
      style="color:var(--text-3)">
      Waiting for price data…
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  Chart,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  LineController,
} from 'chart.js'

Chart.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, LineController)

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

const props = defineProps<{
  candles:     Candle[]
  mas:         Record<string, number | null>
  signalDir?:  'BUY' | 'SELL' | null
  signalIdx?:  number
}>()

const chartEl = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

function sma(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const slice = closes.slice(i - period + 1, i + 1)
    return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(2))
  })
}

function buildChart() {
  if (!chartEl.value || !props.candles.length) return

  const closes = props.candles.map(c => c.close)
  const labels  = props.candles.map(c => {
    const d = new Date(c.time * 1000)
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
  })

  const ma25  = sma(closes, 25)
  const ma50  = sma(closes, 50)
  const ma100 = sma(closes, 100)

  const isBuy  = props.signalDir === 'BUY'
  const isSell = props.signalDir === 'SELL'
  const lineColor = isBuy ? '#10b981' : isSell ? '#ef4444' : '#3b82f6'
  const fillColor = isBuy
    ? 'rgba(16,185,129,0.07)'
    : isSell
    ? 'rgba(239,68,68,0.07)'
    : 'rgba(59,130,246,0.07)'

  // Signal dot on last candle
  const signalDots = closes.map((v, i) =>
    i === closes.length - 1 && props.signalDir ? v : null
  )

  const data = {
    labels,
    datasets: [
      {
        label:           'Price',
        data:            closes,
        borderColor:     lineColor,
        backgroundColor: fillColor,
        borderWidth:     1.5,
        fill:            true,
        tension:         0.2,
        pointRadius:     0,
        pointHoverRadius: 3,
      },
      {
        label:       'MA25',
        data:        ma25,
        borderColor: '#f5c142',
        borderWidth: 1,
        fill:        false,
        tension:     0.3,
        pointRadius: 0,
        spanGaps:    true,
      },
      {
        label:       'MA50',
        data:        ma50,
        borderColor: '#3b82f6',
        borderWidth: 1,
        fill:        false,
        tension:     0.3,
        pointRadius: 0,
        spanGaps:    true,
      },
      {
        label:       'MA100',
        data:        ma100,
        borderColor: '#a855f7',
        borderWidth: 1,
        fill:        false,
        tension:     0.3,
        pointRadius: 0,
        spanGaps:    true,
      },
      {
        label:            'Signal',
        data:             signalDots,
        borderColor:      lineColor,
        backgroundColor:  lineColor,
        borderWidth:      2,
        pointRadius:      7,
        pointStyle:       isBuy ? 'triangle' : isSell ? 'rectRot' : 'circle',
        showLine:         false,
        spanGaps:         false,
      },
    ],
  }

  const ctx = chartEl.value.getContext('2d')!

  if (chart) {
    chart.data = data
    chart.update('none')
    return
  }

  chart = new Chart(ctx, {
    type: 'line',
    data,
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0c1120',
          borderColor:      '#1a2540',
          borderWidth:      1,
          titleColor:       '#94a3b8',
          bodyColor:        '#f1f5f9',
          padding:          10,
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.label === 'Signal') return null as unknown as string
              const v = ctx.parsed.y
              if (v == null) return null as unknown as string
              return `${ctx.dataset.label}: $${v.toFixed(2)}`
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { color: '#111c32', drawTicks: false },
          border: { color: '#1a2540' },
          ticks: {
            color:        '#334155',
            font:         { size: 10, family: 'JetBrains Mono, monospace' },
            maxTicksLimit: 8,
            maxRotation:  0,
          },
        },
        y: {
          position: 'right',
          grid:     { color: '#111c32', drawTicks: false },
          border:   { color: '#1a2540' },
          ticks: {
            color:        '#475569',
            font:         { size: 10, family: 'JetBrains Mono, monospace' },
            maxTicksLimit: 5,
            callback:     (v) => `$${(v as number).toFixed(0)}`,
          },
        },
      },
    },
  })
}

onMounted(() => buildChart())

watch(() => props.candles, () => buildChart(), { deep: false })
watch(() => props.signalDir, () => buildChart())

onBeforeUnmount(() => { chart?.destroy(); chart = null })
</script>
