<template>
  <div class="tradingview-widget-container w-full" :style="{ height: `${height}px` }">
    <div ref="el" class="tradingview-widget-container__widget" style="height: 100%; width: 100%" />
  </div>
</template>

<script setup lang="ts">
/**
 * TradingView's free embeddable Advanced Chart (view only). It shows TradingView's own data
 * for `symbol`; nothing from this app is drawn on it. Needs script-src
 * https://s3.tradingview.com and frame-src https://www.tradingview-widget.com in the CSP.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ symbol?: string; interval?: string; height?: number }>(), {
  symbol: 'OANDA:XAUUSD',
  interval: '5',
  height: 420,
})
const el = ref<HTMLDivElement | null>(null)

onMounted(() => {
  if (!el.value) return
  const script = document.createElement('script')
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
  script.async = true
  script.type = 'text/javascript'
  script.innerHTML = JSON.stringify({
    autosize: true,
    symbol: props.symbol,
    interval: props.interval,
    timezone: 'Etc/UTC',
    theme: 'dark',
    style: '1',
    locale: 'en',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    hide_side_toolbar: false,
    allow_symbol_change: false,
    save_image: false,
    calendar: false,
    studies: ['STD;EMA'],
    support_host: 'https://www.tradingview.com',
  })
  el.value.appendChild(script)
})

onBeforeUnmount(() => {
  if (el.value) el.value.innerHTML = ''
})
</script>
