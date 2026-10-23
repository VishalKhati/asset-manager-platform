<template>
  <div class="space-y-4 max-w-3xl">
    <h1 class="text-xl font-black">Account &amp; risk</h1>
    <p class="text-xs muted">
      Every signal is sized to these settings and checked against your limits before you can approve it. Match them to your MT5 account and broker.
    </p>
    <p v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</p>
    <p v-if="saved" class="text-sm" style="color: #6ee7b7">Saved.</p>
    <template v-if="form">
      <Section title="Account">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ConfigField v-model="form.balance" label="Balance" type="number" />
          <div>
            <label class="text-xs mb-1 block" style="color: #64748b">Currency</label>
            <select v-model="form.currency" class="input"><option>USD</option><option>INR</option></select>
          </div>
          <ConfigField v-model="form.usdInr" label="INR per USD (INR accounts)" type="number" />
        </div>
      </Section>
      <Section title="Limits">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ConfigField v-model="form.riskPerTradePct" label="Risk per trade (%)" type="number" />
          <ConfigField v-model="form.maxDailyLossPct" label="Max daily loss (%)" type="number" />
          <ConfigField v-model="form.maxTradesPerDay" label="Max trades per day" type="number" />
          <ConfigField v-model="form.minRewardRisk" label="Minimum reward to risk (R)" type="number" />
        </div>
      </Section>
      <Section title="Broker contract">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ConfigField v-model="form.contractSize" label="Ounces per lot" type="number" />
          <ConfigField v-model="form.minLot" label="Minimum lot" type="number" />
          <ConfigField v-model="form.lotStep" label="Lot step" type="number" />
          <ConfigField v-model="form.maxLot" label="Maximum lot" type="number" />
        </div>
      </Section>
      <div class="flex gap-2">
        <button v-if="auth.isAdmin" class="btn btn-gold" :disabled="busy" @click="save">Save</button>
        <span v-else class="text-xs faint">Only admins can change these.</span>
      </div>
      <Section title="Example">
        <p class="text-sm num">{{ example }}</p>
      </Section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Section from '../../components/Section.vue'
import ConfigField from '../../components/ConfigField.vue'
import { api } from '../../lib/api'
import { useAuthStore } from '../../stores/auth'

type Account = Record<string, number | string>
const NUMERIC = ['balance', 'usdInr', 'riskPerTradePct', 'maxDailyLossPct', 'maxTradesPerDay', 'minRewardRisk', 'contractSize', 'minLot', 'lotStep', 'maxLot']
const auth = useAuthStore()
const form = ref<Account | null>(null)
const error = ref('')
const saved = ref(false)
const busy = ref(false)

const example = computed(() => {
  const f = form.value
  if (!f) return ''
  const budget = (Number(f.balance) * Number(f.riskPerTradePct)) / 100
  const perLotUsd = 4.5 * Number(f.contractSize)
  const perLot = f.currency === 'INR' ? perLotUsd * Number(f.usdInr) : perLotUsd
  const lots = Math.max(Number(f.minLot), Math.floor(budget / perLot / Number(f.lotStep) + 1e-9) * Number(f.lotStep))
  const cur = f.currency === 'INR' ? '₹' : '$'
  return `A $4.50 stop risks ${cur}${perLot.toFixed(2)} per lot. With a ${cur}${budget.toFixed(2)} budget that is ${lots.toFixed(2)} lots.`
})

onMounted(async () => {
  form.value = (await api.get<{ account: Account }>('/account')).account
})

async function save(): Promise<void> {
  if (!form.value) return
  busy.value = true
  error.value = ''
  saved.value = false
  try {
    const body: Account = { ...form.value }
    for (const k of NUMERIC) body[k] = Number(body[k])
    form.value = (await api.put<{ account: Account }>('/account', body)).account
    saved.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Save failed.'
  } finally {
    busy.value = false
  }
}
</script>
