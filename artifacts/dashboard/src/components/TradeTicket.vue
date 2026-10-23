<template>
  <Section title="Trade ticket">
    <p v-if="!ticket" class="text-xs faint">Loading…</p>
    <template v-else>
      <p class="text-sm">{{ ticket.order }}</p>
      <div class="mt-3 text-xs font-bold" :style="{ color: ticket.pass ? 'var(--green)' : 'var(--red)' }">Risk check: {{ ticket.pass ? 'PASS' : 'BLOCK' }}</div>
      <ul class="mt-1 space-y-1 text-xs">
        <li v-for="c in ticket.checks" :key="c.id" class="flex gap-2">
          <span>{{ c.pass ? '✅' : '❌' }}</span><span><b>{{ c.label }}:</b> <span class="muted">{{ c.detail }}</span></span>
        </li>
      </ul>

      <div v-if="ticket.approved" class="card p-3 mt-3 text-xs" style="border-color: var(--green-dim)">
        Approved by {{ ticket.approved.approvedBy }} via {{ ticket.approved.via }} at {{ ticket.approved.approvedAt.slice(0, 16).replace('T', ' ') }} UTC:
        {{ ticket.approved.lots }} lots. <b>Place it in MT5 yourself</b>; automatic execution is not built yet.
      </div>
      <form v-else-if="auth.isAdmin && ticket.pass" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="approve">
        <div class="flex-1 min-w-40">
          <label class="text-xs mb-1 block faint">Type YES to approve this exact order</label>
          <input v-model="confirm" class="input num" placeholder="YES" autocomplete="off" />
        </div>
        <button class="btn btn-gold" :disabled="confirm !== 'YES' || busy">Approve</button>
      </form>
      <p v-else-if="!ticket.pass" class="text-xs mt-3" style="color: #fca5a5">Blocked: do not take this trade.</p>
      <p v-if="error" class="text-xs mt-2" style="color: #fca5a5">{{ error }}</p>
      <p class="text-xs faint mt-3">Sized for a {{ cur }}{{ ticket.account.balance.toLocaleString() }} account at {{ ticket.account.riskPerTradePct }}% risk. Change it under Account &amp; risk.</p>
    </template>
  </Section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Section from './Section.vue'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

interface Ticket {
  pass: boolean
  order: string
  checks: Array<{ id: string; label: string; pass: boolean; detail: string }>
  account: { balance: number; currency: 'USD' | 'INR'; riskPerTradePct: number }
  approved: { approvedBy: string; via: string; approvedAt: string; lots: number } | null
}

const props = defineProps<{ publicNo: string }>()
const auth = useAuthStore()
const ticket = ref<Ticket | null>(null)
const confirm = ref('')
const busy = ref(false)
const error = ref('')
const cur = computed(() => (ticket.value?.account.currency === 'INR' ? '₹' : '$'))
const base = computed(() => `/signals/by-no/${encodeURIComponent(props.publicNo)}`)

async function load(): Promise<void> {
  ticket.value = (await api.get<{ ticket: Ticket }>(`${base.value}/ticket`)).ticket
}

async function approve(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await api.post(`${base.value}/approve`, { confirm: confirm.value })
    confirm.value = ''
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Approval failed.'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>
