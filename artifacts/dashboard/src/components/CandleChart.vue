<template>
  <div ref="el" class="w-full" :style="{ height: `${height}px` }" />
</template>

<script setup lang="ts">
/**
 * M5 candles with EMA fast/slow and the M15 trend EMA. When a signal is given, its entry,
 * stop and targets are drawn as price lines and its events as markers.
 * Built on TradingView Lightweight Charts (Apache-2.0; attribution logo kept on).
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Bar, Signal } from '../lib/types'

const props = withDefaults(defineProps<{ bars: Bar[]; signal?: Signal | null; height?: number }>(), { signal: null, height: 380 })
const el = ref<HTMLDivElement | null>(null)
let chart: IChartApi | null = null
let candles: ISeriesApi<'Candlestick'> | null = null
let lines: ISeriesApi<'Line'>[] = []
let ro: ResizeObserver | null = null

const ts = (t: number) => t as UTCTimestamp

function render(): void {
  if (!chart || !candles) return
  candles.setData(props.bars.map((b) => ({ time: ts(b.t), open: b.o, high: b.h, low: b.l, close: b.c })))
  const [fast, slow, trend] = lines
  const line = (key: 'emaFast' | 'emaSlow' | 'emaTrend') =>
    props.bars.filter((b) => b[key] !== null).map((b) => ({ time: ts(b.t), value: b[key] as number }))
  fast!.setData(line('emaFast'))
  slow!.setData(line('emaSlow'))
  trend!.setData(line('emaTrend'))

  for (const pl of candles.priceLines()) candles.removePriceLine(pl)
  const s = props.signal
  if (s) {
    const add = (price: number, color: string, title: string, style = LineStyle.Dashed) =>
      candles!.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
    add(s.entry, '#94a3b8', 'Entry', LineStyle.Solid)
    add(s.sl, '#ef4444', 'SL')
    add(s.tp1, '#10b981', 'TP1')
    add(s.tp2, '#10b981', 'TP2')
    const bucket = (t: number) => ts(t - (t % 300))
    const markers: SeriesMarker<Time>[] = [
      {
        time: bucket(s.t - 300),
        position: s.direction === 'long' ? 'belowBar' : 'aboveBar',
        shape: s.direction === 'long' ? 'arrowUp' : 'arrowDown',
        color: s.direction === 'long' ? '#10b981' : '#ef4444',
        text: s.direction === 'long' ? 'BUY' : 'SELL',
      },
    ]
    for (const e of s.events) {
      if (!['tp1', 'tp2', 'sl', 'tp1_be', 'time_exit'].includes(e.type)) continue
      const good = e.type === 'tp1' || e.type === 'tp2'
      markers.push({ time: bucket(e.t), position: 'inBar', shape: 'circle', color: good ? '#10b981' : '#f5c142', text: e.type.toUpperCase() })
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number))
    createSeriesMarkers(candles, markers)
  }
  chart.timeScale().fitContent()
}

onMounted(() => {
  if (!el.value) return
  chart = createChart(el.value, {
    height: props.height,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11, attributionLogo: true },
    grid: { vertLines: { color: '#111c32' }, horzLines: { color: '#111c32' } },
    rightPriceScale: { borderColor: '#1a2540' },
    timeScale: { borderColor: '#1a2540', timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
  })
  candles = chart.addSeries(CandlestickSeries, {
    upColor: '#10b981',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  })
  const opts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
  lines = [
    chart.addSeries(LineSeries, { ...opts, color: '#f5c142' }),
    chart.addSeries(LineSeries, { ...opts, color: '#3b82f6' }),
    chart.addSeries(LineSeries, { ...opts, color: '#a78bfa', lineStyle: LineStyle.Dotted }),
  ]
  ro = new ResizeObserver(() => chart?.applyOptions({ width: el.value?.clientWidth ?? 600 }))
  ro.observe(el.value)
  render()
})

watch(() => [props.bars, props.signal], render, { deep: true })

onBeforeUnmount(() => {
  ro?.disconnect()
  chart?.remove()
  chart = null
})
</script>
