<template>
  <div class="card p-5 slide-up" :class="open ? 'pulse-gold' : ''">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span class="text-lg font-black" :class="signal.direction === 'long' ? 'glow-buy' : 'glow-sell'" :style="{ color: signal.direction === 'long' ? 'var(--green)' : 'var(--red)' }">
          {{ signal.direction === 'long' ? 'BUY' : 'SELL' }} {{ signal.symbol }}
        </span>
        <span class="num text-xs faint">#{{ signal.publicNo }}</span>
      </div>
      <span class="pill" :style="{ color: outcomeColor(signal), border: '1px solid var(--border)' }">{{ status(signal) }}</span>
    </div>
    <div class="grid grid-cols-2 gap-x-6 gap-y-1 num text-sm">
      <span class="faint">Entry</span><span class="text-right">{{ price(signal.entry) }}</span>
      <span class="faint">Stop</span><span class="text-right" style="color: #fca5a5">{{ price(signal.sl) }}</span>
      <span class="faint">TP1 (1R)</span><span class="text-right" style="color: #6ee7b7">{{ price(signal.tp1) }}</span>
      <span class="faint">TP2 (2R)</span><span class="text-right" style="color: #6ee7b7">{{ price(signal.tp2) }}</span>
    </div>
    <div class="mt-3 text-xs faint">
      {{ dateTime(signal.t) }} · {{ signal.strategy }}
      <template v-if="signal.outcome && signal.outcome !== 'expired'"> · <b :style="{ color: outcomeColor(signal) }">{{ r(signal.rNet) }}</b></template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { dateTime, outcomeColor, price, r, status } from '../lib/format'
import type { Signal } from '../lib/types'

const props = defineProps<{ signal: Signal }>()
const open = computed(() => ['pending', 'active', 'be'].includes(props.signal.state))
</script>
