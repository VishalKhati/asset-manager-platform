<template>
  <div class="max-w-6xl mx-auto px-4 py-8 space-y-5">
    <router-link :to="backTo" class="text-xs muted hover:underline">← Back</router-link>
    <p v-if="error" class="card p-4 text-sm" style="color: #fca5a5">{{ error }}</p>
    <template v-if="signal">
      <div class="grid md:grid-cols-3 gap-4">
        <Section :title="`Chart · ${signal.symbol} M5`" class="md:col-span-2">
          <CandleChart :bars="bars" :signal="signal" :height="420" />
          <p class="text-xs faint mt-2">Gold: EMA fast · blue: EMA slow · purple dotted: M15 trend EMA. Times in UTC.</p>
        </Section>
        <div class="space-y-4">
          <SignalCard :signal="signal" />
          <Section title="Timeline">
            <ol class="text-sm space-y-2">
              <li v-for="e in signal.events" :key="e.id" class="flex justify-between gap-4">
                <span class="muted">{{ label(e.type) }}</span>
                <span class="num faint text-xs">{{ dateTime(e.t) }}<template v-if="e.type !== 'expired'"> · {{ price(e.price) }}</template></span>
              </li>
            </ol>
          </Section>
          <Section title="Numbers">
            <div class="grid grid-cols-2 gap-y-1 text-xs num">
              <span class="faint">Risk (1R)</span><span class="text-right">{{ signal.risk.toFixed(2) }}</span>
              <span class="faint">ATR(14) M5</span><span class="text-right">{{ signal.atr.toFixed(2) }}</span>
              <span class="faint">Spread</span><span class="text-right">{{ signal.spread.toFixed(2) }}</span>
              <span class="faint">Fill</span><span class="text-right">{{ price(signal.fill) }}</span>
              <span class="faint">Result before costs</span><span class="text-right">{{ r(signal.rGross) }}</span>
              <span class="faint">Result after costs</span><span class="text-right">{{ r(signal.rNet) }}</span>
            </div>
          </Section>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Section from '../components/Section.vue'
import CandleChart from '../components/CandleChart.vue'
import SignalCard from '../components/SignalCard.vue'
import { api } from '../lib/api'
import { dateTime, price, r } from '../lib/format'
import type { Bar, Signal } from '../lib/types'

const route = useRoute()
const signal = ref<Signal | null>(null)
const bars = ref<Bar[]>([])
const error = ref('')
const backTo = computed(() => (route.query['from'] === 'ops' ? '/ops/signals' : '/'))

const LABELS: Record<string, string> = {
  created: 'Signal posted',
  filled: 'Entered',
  tp1: 'TP1 hit, stop moved to entry',
  tp2: 'TP2 hit',
  sl: 'Stopped out',
  tp1_be: 'Closed at entry',
  time_exit: 'Closed on time limit',
  expired: 'Expired before entry',
}
const label = (t: string) => LABELS[t] ?? t

async function load(): Promise<void> {
  const no = encodeURIComponent(String(route.params['no']))
  // Operators can open unposted and shadow signals; the public endpoints only serve published ones.
  const base = route.query['from'] === 'ops' ? `/signals/by-no/${no}` : `/public/signals/${no}`
  try {
    const [s, c] = await Promise.all([api.get<{ signal: Signal }>(base), api.get<{ bars: Bar[] }>(`${base}/chart`)])
    signal.value = s.signal
    bars.value = c.bars
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load this signal.'
  }
}

onMounted(load)
watch(() => route.params['no'], load)
</script>
