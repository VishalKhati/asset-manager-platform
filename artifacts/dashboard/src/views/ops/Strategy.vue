<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-black">Strategy parameters</h1>
      <span v-if="active" class="text-xs muted">Active: config #{{ active.id }} · {{ active.strategyId }} v{{ active.strategyVersion }} · {{ active.note }}</span>
    </div>
    <div class="card p-4 text-xs muted" style="border-color: var(--gold-dim)">
      Changing parameters after seeing results is tuning on test data. Only change them with a new walk-forward report behind the change, and
      write down why in the note. Every save creates a new version; the engine switches within seconds. Open signals keep their original levels.
    </div>
    <p v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</p>
    <p v-if="saved" class="text-sm" style="color: #6ee7b7">{{ saved }}</p>

    <div v-if="draft" class="grid md:grid-cols-2 gap-4">
      <Section v-for="g in groups" :key="g.title" :title="g.title">
        <div class="grid grid-cols-2 gap-3">
          <ConfigField v-for="k in g.keys" :key="k" v-model="draft[k]" :label="k" type="number" />
        </div>
      </Section>
      <Section title="Sessions and cut-offs">
        <label class="text-xs mb-1 block faint">Sessions (JSON: time zone and local start/end)</label>
        <textarea v-model="sessionsText" rows="5" class="input num text-xs" />
        <div class="grid grid-cols-2 gap-3 mt-3">
          <ConfigField v-model="draft.fridayCutoffUtc" label="fridayCutoffUtc" />
          <ConfigField v-model="draft.fridayExitUtc" label="fridayExitUtc" />
        </div>
      </Section>
    </div>

    <div v-if="auth.isAdmin && draft" class="card p-4 flex flex-wrap items-end gap-3">
      <div class="flex-1 min-w-64"><ConfigField v-model="note" label="Why this change (required)" /></div>
      <button class="btn btn-gold" :disabled="busy || String(note).trim().length < 3" @click="save">Save as new version</button>
      <button class="btn" :disabled="busy" @click="reset">Discard changes</button>
    </div>

    <Section title="History">
      <table class="data-table text-sm">
        <thead><tr><th>#</th><th>Created</th><th>By</th><th>Note</th><th>Changed from defaults</th></tr></thead>
        <tbody>
          <tr v-for="c in configs" :key="c.id">
            <td class="num">{{ c.id }}<span v-if="c.isActive" class="pill ml-2" style="background: var(--gold); color: #1a1200">active</span></td>
            <td class="muted whitespace-nowrap">{{ c.createdAt.slice(0, 16).replace('T', ' ') }}</td>
            <td class="muted">{{ c.createdBy ?? '—' }}</td>
            <td>{{ c.note }}</td>
            <td class="text-xs faint num">{{ diff(c.params) }}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Section from '../../components/Section.vue'
import ConfigField from '../../components/ConfigField.vue'
import { api } from '../../lib/api'
import { useAuthStore } from '../../stores/auth'

interface Config {
  id: number
  strategyId: string
  strategyVersion: number
  params: Record<string, unknown>
  isActive: boolean
  note: string | null
  createdBy: string | null
  createdAt: string
}

const groups = [
  { title: 'Trend (M15)', keys: ['emaFast', 'emaSlow', 'emaTrend'] },
  { title: 'Trigger (M5)', keys: ['stochK', 'stochSmooth', 'stochD', 'stochLow', 'stochHigh', 'pullbackBars'] },
  { title: 'Risk', keys: ['atrPeriod', 'slAtrMult', 'swingBars', 'swingBufferAtr', 'tp1R', 'tp2R', 'tp1Fraction', 'validMin', 'entryToleranceR', 'maxHoldMin'] },
  { title: 'Filters and costs', keys: ['newsBlackoutMin', 'maxSpread', 'maxSpreadAtrFrac', 'atrMinBps', 'atrMaxBps', 'cooldownAfterLossMin', 'commission', 'slippage', 'warmupM5', 'warmupM15'] },
]

const auth = useAuthStore()
const configs = ref<Config[]>([])
const draft = ref<Record<string, unknown> | null>(null)
const sessionsText = ref('')
const note = ref('')
const error = ref('')
const saved = ref('')
const busy = ref(false)
const active = computed(() => configs.value.find((c) => c.isActive) ?? null)
const defaults = computed(() => configs.value[configs.value.length - 1]?.params ?? {})

function reset(): void {
  if (!active.value) return
  draft.value = { ...active.value.params }
  sessionsText.value = JSON.stringify(active.value.params['sessions'], null, 2)
}

function diff(params: Record<string, unknown>): string {
  const base = defaults.value
  const changed = Object.keys(params).filter((k) => JSON.stringify(params[k]) !== JSON.stringify(base[k]))
  return changed.length ? changed.map((k) => `${k}=${JSON.stringify(params[k])}`).join(', ') : '—'
}

async function load(): Promise<void> {
  const res = await api.get<{ configs: Config[] }>('/strategy-configs')
  configs.value = res.configs
  reset()
}

async function save(): Promise<void> {
  if (!draft.value) return
  error.value = ''
  saved.value = ''
  let sessions: unknown
  try {
    sessions = JSON.parse(sessionsText.value)
  } catch {
    error.value = 'Sessions must be valid JSON.'
    return
  }
  const params: Record<string, unknown> = { ...draft.value, sessions }
  for (const g of groups) for (const k of g.keys) params[k] = Number(params[k])
  busy.value = true
  try {
    const res = await api.post<{ config: Config }>('/strategy-configs', { params, note: String(note.value).trim() })
    saved.value = `Saved config #${res.config.id}. The engine will switch to it within a few seconds.`
    note.value = ''
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Save failed.'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>
