<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-black">Signals</h1>
      <select v-model="mode" class="input w-auto" @change="load(true)">
        <option value="">All modes</option>
        <option value="live">Live (public)</option>
        <option value="forward">Forward test</option>
        <option value="shadow">Shadow</option>
      </select>
    </div>
    <p class="text-xs muted">
      Includes signals that were never posted: decided while catching up after an outage (more than the late limit after their bar closed) or
      in shadow mode. They still count toward "one open signal" so the live engine matches the backtest.
    </p>
    <p v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</p>
    <div class="card"><SignalTable :signals="signals" show-mode @open="open" /></div>
    <div v-if="more" class="text-center"><button class="btn" @click="load(false)">Load older</button></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import SignalTable from '../../components/SignalTable.vue'
import { api } from '../../lib/api'
import type { Signal } from '../../lib/types'

const router = useRouter()
const signals = ref<Signal[]>([])
const mode = ref('')
const more = ref(false)
const error = ref('')

async function load(reset: boolean): Promise<void> {
  const before = !reset && signals.value.length ? `&before=${signals.value[signals.value.length - 1]!.id}` : ''
  try {
    const res = await api.get<{ signals: Signal[] }>(`/signals?limit=100${mode.value ? `&mode=${mode.value}` : ''}${before}`)
    signals.value = reset ? res.signals : [...signals.value, ...res.signals]
    more.value = res.signals.length === 100
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load signals.'
  }
}

function open(s: Signal): void {
  void router.push({ path: `/signals/${s.publicNo}`, query: { from: 'ops' } })
}

onMounted(() => load(true))
</script>
