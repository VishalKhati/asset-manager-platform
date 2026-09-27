<template>
  <div>
    <div ref="el" class="w-full" :style="{ height: `${height}px` }" />
    <p v-if="!points.length" class="text-xs faint text-center -mt-24 mb-20">No closed trades yet.</p>
  </div>
</template>

<script setup lang="ts">
/** Cumulative R, green above zero and red below. Input: [unix seconds, cumulative R] pairs. */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BaselineSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'

const props = withDefaults(defineProps<{ points: Array<[number, number]>; height?: number }>(), { height: 220 })
const el = ref<HTMLDivElement | null>(null)
let chart: IChartApi | null = null
let series: ISeriesApi<'Baseline'> | null = null
let ro: ResizeObserver | null = null

function render(): void {
  if (!series || !chart) return
  // Lightweight Charts needs strictly increasing times: keep the last value per second.
  const byTime = new Map<number, number>()
  for (const [t, v] of props.points) byTime.set(t, v)
  series.setData([...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })))
  chart.timeScale().fitContent()
}

onMounted(() => {
  if (!el.value) return
  chart = createChart(el.value, {
    height: props.height,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { color: '#111c32' } },
    rightPriceScale: { borderColor: '#1a2540' },
    timeScale: { borderColor: '#1a2540' },
    handleScroll: false,
    handleScale: false,
  })
  series = chart.addSeries(BaselineSeries, {
    baseValue: { type: 'price', price: 0 },
    topLineColor: '#10b981',
    topFillColor1: 'rgba(16,185,129,0.25)',
    topFillColor2: 'rgba(16,185,129,0.02)',
    bottomLineColor: '#ef4444',
    bottomFillColor1: 'rgba(239,68,68,0.02)',
    bottomFillColor2: 'rgba(239,68,68,0.25)',
    lineWidth: 2,
    priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}R` },
  })
  ro = new ResizeObserver(() => chart?.applyOptions({ width: el.value?.clientWidth ?? 600 }))
  ro.observe(el.value)
  render()
})

watch(() => props.points, render, { deep: true })
onBeforeUnmount(() => {
  ro?.disconnect()
  chart?.remove()
})
</script>
