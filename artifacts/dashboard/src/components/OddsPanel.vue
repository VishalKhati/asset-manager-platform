<template>
  <Section title="Odds before taking it (Time Machine)">
    <p v-if="loading" class="text-xs faint">Replaying the next 4 hours 10,000 times…</p>
    <p v-else-if="!odds" class="text-xs faint">Not enough price history before this signal yet.</p>
    <template v-else>
      <div class="space-y-1.5 text-xs">
        <div v-for="row in rows" :key="row.key" class="flex items-center gap-2">
          <span class="w-28 muted">{{ row.label }}</span>
          <div class="flex-1 h-2 rounded" style="background: var(--bg-card-2)">
            <div class="h-2 rounded" :style="{ width: `${row.value * 100}%`, background: row.color }" />
          </div>
          <span class="num w-10 text-right">{{ Math.round(row.value * 100) }}%</span>
        </div>
      </div>
      <p class="text-xs mt-3 num">Average {{ r(odds.simExpectedR) }} per trade before costs · TP1 touched before the stop {{ Math.round(odds.simTp1BeforeStop * 100) }}%</p>
      <p class="text-xs mt-1 muted">
        Same trade at the same time on {{ odds.analog.days }} real past days: TP2 {{ odds.analog.tp2 }}, TP1 then entry {{ odds.analog.tp1_be }}, stop
        {{ odds.analog.sl }}, time limit {{ odds.analog.time }}<template v-if="odds.analogExpectedR !== null"> ({{ r(odds.analogExpectedR) }} average)</template>.
      </p>
      <p class="text-xs faint mt-2">
        {{ odds.paths.toLocaleString() }} replays of the next {{ odds.steps * 5 / 60 }} hours, each 5-minute candle drawn from the same time of day in the last
        {{ odds.sessions }} sessions (seed {{ odds.seed }}). This measures risk, not edge: it cannot tell whether the setup works.
      </p>
    </template>
  </Section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Section from './Section.vue'
import { api } from '../lib/api'
import { r } from '../lib/format'

interface Odds {
  paths: number
  steps: number
  seed: number
  sessions: number
  simulated: { sl: number; tp1_be: number; tp2: number; time: number }
  simTp1BeforeStop: number
  simExpectedR: number
  analog: { sl: number; tp1_be: number; tp2: number; time: number; days: number }
  analogExpectedR: number | null
}

const props = defineProps<{ path: string }>()
const odds = ref<Odds | null>(null)
const loading = ref(true)
const rows = computed(() => {
  const s = odds.value?.simulated
  if (!s) return []
  return [
    { key: 'tp2', label: 'TP2 first', value: s.tp2, color: 'var(--green)' },
    { key: 'tp1_be', label: 'TP1, then entry', value: s.tp1_be, color: '#6ee7b7' },
    { key: 'time', label: 'Time limit', value: s.time, color: 'var(--text-3)' },
    { key: 'sl', label: 'Stop first', value: s.sl, color: 'var(--red)' },
  ]
})

async function load(): Promise<void> {
  loading.value = true
  try {
    odds.value = (await api.get<{ odds: Odds | null }>(props.path)).odds
  } catch {
    odds.value = null
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.path, load)
</script>
