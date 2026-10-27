<template>
  <div ref="el" class="w-full" :style="{ height: `${height}px` }" />
</template>

<script setup lang="ts">
/**
 * M5 candles with EMA fast/slow and the M15 trend EMA. When a signal is given, its entry,
 * stop and targets are drawn as price lines and its events as markers. `history` adds an
 * entry arrow and result for each other signal on screen; `live` moves the newest candle
 * with every price update.
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
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Bar, Quote, Signal } from '../lib/types'

const props = withDefaults(defineProps<{ bars: Bar[]; signal?: Signal | null; history?: Signal[]; live?: Quote | null; height?: number }>(), {
  signal: null,
  history: () => [],
  live: null,
  height: 380,
})
const el = ref<HTMLDivElement | null>(null)
let chart: IChartApi | null = null
let candles: ISeriesApi<'Candlestick'> | null = null
let markers: ISeriesMarkersPluginApi<Time> | null = null
let lines: ISeriesApi<'Line'>[] = []
let ro: ResizeObserver | null = null
let fitted = false
/** The newest candle as moved by live prices. */
let liveBar: { t: number; o: number; h: number; l: number; c: number } | null = null

const ts = (t: number) => t as UTCTimestamp
const bucket = (t: number) => t - (t % 300)
const GREEN = '#10b981'
const RED = '#ef4444'
const GOLD = '#f5c142'

function resultText(s: Signal): string {
  if (s.state === 'expired') return 'expired'
  if (s.state !== 'closed') return s.state === 'pending' ? 'waiting' : 'open'
  const r = s.rNet ?? 0
  return `${(s.outcome ?? '').toUpperCase()} ${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}R`
}

function buildMarkers(): SeriesMarker<Time>[] {
  const first = props.bars[0]?.t ?? Infinity
  const out: SeriesMarker<Time>[] = []
  const s = props.signal
  for (const h of props.history) {
    if (h.id === s?.id || h.t < first) continue
    const long = h.direction === 'long'
    out.push({
      time: ts(bucket(h.t - 300)),
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: long ? GREEN : RED,
      text: `${h.publicNo.replace(/^XAU-0*/, '#')} ${long ? 'BUY' : 'SELL'}`,
    })
    if (h.state === 'closed' && h.closedT) {
      const good = (h.rNet ?? 0) > 0
      out.push({ time: ts(bucket(h.closedT)), position: 'inBar', shape: 'circle', color: good ? GREEN : GOLD, text: resultText(h) })
    }
  }
  if (s) {
    out.push({
      time: ts(bucket(s.t - 300)),
      position: s.direction === 'long' ? 'belowBar' : 'aboveBar',
      shape: s.direction === 'long' ? 'arrowUp' : 'arrowDown',
      color: s.direction === 'long' ? GREEN : RED,
      text: s.direction === 'long' ? 'BUY' : 'SELL',
    })
    for (const e of s.events) {
      if (!['tp1', 'tp2', 'sl', 'tp1_be', 'time_exit'].includes(e.type)) continue
      const good = e.type === 'tp1' || e.type === 'tp2'
      out.push({ time: ts(bucket(e.t)), position: 'inBar', shape: 'circle', color: good ? GREEN : GOLD, text: e.type.toUpperCase() })
    }
  }
  return out.sort((a, b) => (a.time as number) - (b.time as number))
}

/** Move the newest candle to the live price (mid of bid and ask). */
function applyLive(): void {
  const q = props.live
  if (!candles || !q) return
  const last = props.bars[props.bars.length - 1]
  const price = (q.bid + q.ask) / 2
  const t = bucket(q.t)
  if (last && t < last.t) return // clock behind the chart; never rewrite history
  if (liveBar && liveBar.t === t) {
    liveBar.h = Math.max(liveBar.h, price)
    liveBar.l = Math.min(liveBar.l, price)
    liveBar.c = price
  } else if (last && last.t === t) {
    liveBar = { t, o: last.o, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price }
  } else {
    const open = liveBar?.c ?? last?.c ?? price
    liveBar = { t, o: open, h: Math.max(open, price), l: Math.min(open, price), c: price }
  }
  candles.update({ time: ts(liveBar.t), open: liveBar.o, high: liveBar.h, low: liveBar.l, close: liveBar.c })
}

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
    add(s.sl, RED, 'SL')
    add(s.tp1, GREEN, 'TP1')
    add(s.tp2, GREEN, 'TP2')
  }
  if (markers) markers.setMarkers(buildMarkers())
  else markers = createSeriesMarkers(candles, buildMarkers())

  // Fresh bars from the server replace the live candle; keep any newer live movement on top.
  const last = props.bars[props.bars.length - 1]
  if (liveBar && last && liveBar.t <= last.t) liveBar = null
  applyLive()
  // Fit once, so periodic reloads do not reset the user's zoom.
  if (!fitted && props.bars.length) {
    chart.timeScale().fitContent()
    fitted = true
  }
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

watch(() => [props.bars, props.signal, props.history], render, { deep: true })
watch(() => props.live, applyLive)

onBeforeUnmount(() => {
  ro?.disconnect()
  chart?.remove()
  chart = null
  markers = null
})
</script>
