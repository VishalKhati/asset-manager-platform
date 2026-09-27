<template>
  <div class="space-y-4">
    <h1 class="text-xl font-black">Price alerts</h1>
    <p class="text-xs muted">Checked by the engine against every one-minute bar's high and low, so a quick spike is not missed. Alerts go to the admins on Telegram.</p>
    <p v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</p>
    <form class="card p-4 grid md:grid-cols-5 gap-3 items-end" @submit.prevent="create">
      <div>
        <label class="text-xs mb-1 block" style="color: #64748b">When price is</label>
        <select v-model="form.condition" class="input"><option value="above">above</option><option value="below">below</option></select>
      </div>
      <ConfigField v-model="form.targetPrice" label="Price" type="number" />
      <div class="md:col-span-2"><ConfigField v-model="form.label" label="Label (optional)" /></div>
      <button class="btn btn-gold justify-center" :disabled="!(Number(form.targetPrice) > 0)">Add alert</button>
    </form>
    <div class="card">
      <table class="data-table text-sm">
        <thead><tr><th>Condition</th><th>Label</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="a in alerts" :key="a.id">
            <td class="num">{{ a.symbol }} {{ a.condition }} {{ Number(a.targetPrice).toFixed(2) }}</td>
            <td class="muted">{{ a.label ?? '' }}</td>
            <td :style="{ color: a.active ? 'var(--gold)' : 'var(--text-3)' }">{{ a.active ? 'armed' : `triggered ${a.triggeredAt?.slice(0, 16).replace('T', ' ') ?? ''}` }}</td>
            <td class="text-right space-x-2 whitespace-nowrap">
              <button v-if="!a.active" class="btn" @click="rearm(a.id)">Re-arm</button>
              <button class="btn btn-danger" @click="remove(a.id)">Delete</button>
            </td>
          </tr>
          <tr v-if="!alerts.length"><td colspan="4" class="text-center faint py-8">No alerts.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import ConfigField from '../components/ConfigField.vue'
import { api } from '../lib/api'

interface Alert {
  id: string
  symbol: string
  condition: 'above' | 'below'
  targetPrice: string
  label: string | null
  active: boolean
  triggeredAt: string | null
}

const alerts = ref<Alert[]>([])
const error = ref('')
const form = reactive({ condition: 'above', targetPrice: '', label: '' })

async function load(): Promise<void> {
  alerts.value = (await api.get<{ alerts: Alert[] }>('/alerts')).alerts
}

async function run(fn: () => Promise<unknown>): Promise<void> {
  error.value = ''
  try {
    await fn()
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Request failed.'
  }
}

const create = () =>
  run(async () => {
    await api.post('/alerts', { symbol: 'XAUUSD', condition: form.condition, targetPrice: Number(form.targetPrice), label: String(form.label) || undefined })
    form.targetPrice = ''
    form.label = ''
  })
const rearm = (id: string) => run(() => api.patch(`/alerts/${id}/rearm`, {}))
const remove = (id: string) => run(() => api.del(`/alerts/${id}`))

onMounted(load)
</script>
