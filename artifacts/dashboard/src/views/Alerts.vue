<template>
  <div class="p-6 max-w-3xl mx-auto space-y-6">

    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-bold">Price Alerts</h1>
        <p class="text-xs mt-0.5" style="color:var(--text-3)">
          Get notified via Telegram or email when XAUUSD or BTCUSD hits your target.
        </p>
      </div>
      <RouterLink to="/notifications" class="text-xs px-3 py-1.5 rounded-lg transition-all"
        style="background:rgba(245,193,66,0.08); color:var(--gold); border:1px solid rgba(245,193,66,0.2)">
        ⚙ Notification Settings
      </RouterLink>
    </div>

    <!-- Live prices -->
    <div class="grid grid-cols-2 gap-3">
      <div v-for="sym in symbols" :key="sym.key"
        class="card p-4 flex items-center gap-3">
        <span class="text-2xl">{{ sym.icon }}</span>
        <div>
          <div class="text-xs font-semibold mb-0.5" :style="`color:${sym.color}`">{{ sym.key }}</div>
          <div v-if="prices[sym.key] != null" class="font-mono font-bold text-sm" style="color:var(--text-1)">
            {{ formatPrice(prices[sym.key]!, sym.key) }}
            <span class="text-xs font-normal ml-1" style="color:var(--text-3)">USD</span>
          </div>
          <div v-else class="text-xs font-mono" style="color:var(--text-3)">Loading…</div>
        </div>
        <span class="ml-auto flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full pulse-dot" :style="`background:${sym.color}`"></span>
          <span class="text-xs" style="color:var(--text-3)">Live</span>
        </span>
      </div>
    </div>

    <!-- Create alert -->
    <section class="card p-5 space-y-4">
      <div class="text-sm font-bold">New Alert</div>
      <div class="grid grid-cols-2 gap-3">
        <!-- Symbol -->
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">Symbol</label>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="sym in symbols" :key="sym.key"
              @click="form.symbol = sym.key"
              class="py-2 rounded-xl text-xs font-bold transition-all"
              :style="form.symbol === sym.key
                ? `background:${sym.activeBg}; color:${sym.color}; border:1px solid ${sym.color}`
                : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
              {{ sym.icon }} {{ sym.key }}
            </button>
          </div>
        </div>
        <!-- Condition -->
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">Condition</label>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="c in conditions" :key="c.val"
              @click="form.condition = c.val"
              class="py-2 rounded-xl text-xs font-bold transition-all"
              :style="form.condition === c.val
                ? `background:${c.activeBg}; color:${c.color}; border:1px solid ${c.color}`
                : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
              {{ c.icon }} {{ c.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <!-- Target price -->
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">
            Target Price
            <span v-if="currentSymbolPrice" class="ml-1 font-normal" style="color:var(--text-3)">
              (now: {{ formatPrice(currentSymbolPrice, form.symbol) }})
            </span>
          </label>
          <input v-model.number="form.targetPrice" type="number" step="0.01" min="0"
            :placeholder="form.symbol === 'BTCUSD' ? '95000' : '2350.00'"
            class="input-field w-full font-mono text-sm" />
        </div>
        <!-- Label -->
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">
            Label <span class="font-normal" style="color:var(--text-3)">(optional)</span>
          </label>
          <input v-model="form.label" type="text" maxlength="100"
            placeholder="e.g. Buy zone, Resistance, TP1"
            class="input-field w-full text-sm" />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button @click="createAlert" :disabled="creating || !form.targetPrice"
          class="btn-primary px-5 py-2.5 text-sm font-bold rounded-xl transition-all disabled:opacity-40">
          {{ creating ? 'Adding…' : '+ Add Alert' }}
        </button>
        <span v-if="createError" class="text-xs" style="color:#f87171">{{ createError }}</span>
      </div>
    </section>

    <!-- Alert list -->
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-bold">Your Alerts</div>
        <span class="text-xs" style="color:var(--text-3)">{{ alerts.length }} total</span>
      </div>

      <div v-if="loading" class="text-xs text-center py-8" style="color:var(--text-3)">Loading…</div>

      <div v-else-if="!alerts.length"
        class="card p-8 text-center text-sm" style="color:var(--text-3)">
        No alerts yet. Create one above to get started.
      </div>

      <div v-else class="space-y-2">
        <div v-for="alert in alerts" :key="alert.id"
          class="card p-4 flex items-center gap-4 transition-all"
          :style="!alert.active ? 'opacity:0.65' : ''">

          <!-- Icon + symbol -->
          <div class="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 text-base"
            :style="!alert.active
              ? 'background:rgba(255,255,255,0.04); color:var(--text-3)'
              : alert.condition === 'above'
                ? 'background:rgba(16,185,129,0.1); color:var(--green)'
                : 'background:rgba(239,68,68,0.1); color:#f87171'">
            {{ !alert.active ? '✓' : alert.condition === 'above' ? '↑' : '↓' }}
          </div>

          <!-- Main info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-xs font-bold" :style="`color:${symbolColor(alert.symbol)}`">
                {{ alert.symbol }}
              </span>
              <span class="text-xs px-1.5 py-0.5 rounded font-mono"
                :style="alert.condition === 'above'
                  ? 'background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.2)'
                  : 'background:rgba(239,68,68,0.08); color:#f87171; border:1px solid rgba(239,68,68,0.2)'">
                {{ alert.condition === 'above' ? 'ABOVE' : 'BELOW' }}
              </span>
              <span class="font-mono font-bold text-sm" style="color:var(--text-1)">
                {{ formatPrice(Number(alert.targetPrice), alert.symbol) }}
              </span>
              <span v-if="alert.label" class="text-xs truncate" style="color:var(--text-3)">
                — {{ alert.label }}
              </span>
            </div>
            <div class="text-xs" style="color:var(--text-3)">
              <span v-if="!alert.active && alert.triggeredAt">
                ✓ Triggered {{ relTime(alert.triggeredAt) }}
              </span>
              <span v-else>
                Active · Added {{ relTime(alert.createdAt) }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 shrink-0">
            <button v-if="!alert.active"
              @click="rearm(alert.id)"
              class="text-xs px-3 py-1.5 rounded-lg transition-all font-bold"
              style="background:rgba(59,130,246,0.08); color:var(--blue); border:1px solid rgba(59,130,246,0.2)">
              Re-arm
            </button>
            <button @click="deleteAlert(alert.id)"
              class="text-xs px-2.5 py-1.5 rounded-lg transition-all"
              style="color:var(--text-3); border:1px solid var(--border)"
              @mouseenter="e => (e.currentTarget as HTMLElement).style.color='#f87171'"
              @mouseleave="e => (e.currentTarget as HTMLElement).style.color='var(--text-3)'">
              ✕
            </button>
          </div>
        </div>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore }  from '../stores/auth'
import { useBotStore }   from '../stores/bot'

const auth  = useAuthStore()
const store = useBotStore()

// ─── Symbol / condition config ────────────────────────────────────────────────

const symbols = [
  { key: 'XAUUSD', icon: '⚡', label: 'Gold',    color: 'var(--gold)', activeBg: 'rgba(245,193,66,0.12)' },
  { key: 'BTCUSD', icon: '₿',  label: 'Bitcoin', color: 'var(--blue)', activeBg: 'rgba(59,130,246,0.12)' },
]
const conditions = [
  { val: 'above', icon: '↑', label: 'Above', color: 'var(--green)', activeBg: 'rgba(16,185,129,0.1)' },
  { val: 'below', icon: '↓', label: 'Below', color: '#f87171',      activeBg: 'rgba(239,68,68,0.08)'  },
]

function symbolColor(sym: string) {
  return sym === 'BTCUSD' ? 'var(--blue)' : 'var(--gold)'
}

// ─── Live prices ──────────────────────────────────────────────────────────────

const prices = reactive<Record<string, number | null>>({ XAUUSD: null, BTCUSD: null })

async function fetchPrice(sym: string) {
  try {
    const res = await fetch(`/api/bot/price?symbol=${sym}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    const data = await res.json()
    if (data.ok && data.price != null) prices[sym] = data.price
  } catch { /* silent */ }
}

async function refreshPrices() {
  await Promise.all(['XAUUSD', 'BTCUSD'].map(fetchPrice))
}

const currentSymbolPrice = computed(() => prices[form.symbol] ?? null)

function formatPrice(p: number, sym: string): string {
  if (sym === 'BTCUSD') return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return p.toFixed(2)
}

// ─── Alerts list ──────────────────────────────────────────────────────────────

interface Alert {
  id:          string
  symbol:      string
  condition:   string
  targetPrice: string
  label:       string | null
  active:      boolean
  triggeredAt: string | null
  createdAt:   string
}

const alerts  = ref<Alert[]>([])
const loading = ref(true)

async function loadAlerts() {
  try {
    const res  = await fetch('/api/alerts', { headers: { Authorization: `Bearer ${auth.token}` } })
    const data = await res.json()
    if (data.ok) alerts.value = data.alerts
  } catch { /* silent */ } finally {
    loading.value = false
  }
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)         return 'just now'
  if (s < 3600)       return `${Math.floor(s / 60)}m ago`
  if (s < 86400)      return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ─── Create ───────────────────────────────────────────────────────────────────

const form = reactive({ symbol: 'XAUUSD', condition: 'above', targetPrice: 0, label: '' })
const creating   = ref(false)
const createError = ref('')

async function createAlert() {
  createError.value = ''
  if (!form.targetPrice || form.targetPrice <= 0) {
    createError.value = 'Enter a valid target price.'
    return
  }
  creating.value = true
  try {
    const res = await fetch('/api/alerts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body:    JSON.stringify({ symbol: form.symbol, condition: form.condition, targetPrice: form.targetPrice, label: form.label || undefined }),
    })
    const data = await res.json()
    if (data.ok) {
      alerts.value.unshift(data.alert)
      form.targetPrice = 0
      form.label       = ''
    } else {
      createError.value = data.error ?? 'Failed to create alert.'
    }
  } catch {
    createError.value = 'Network error.'
  } finally {
    creating.value = false
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteAlert(id: string) {
  try {
    const res = await fetch(`/api/alerts/${id}`, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    const data = await res.json()
    if (data.ok) alerts.value = alerts.value.filter(a => a.id !== id)
  } catch { /* silent */ }
}

// ─── Re-arm ───────────────────────────────────────────────────────────────────

async function rearm(id: string) {
  try {
    const res = await fetch(`/api/alerts/${id}/rearm`, {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    const data = await res.json()
    if (data.ok) {
      const idx = alerts.value.findIndex(a => a.id === id)
      if (idx !== -1) alerts.value[idx] = data.alert
    }
  } catch { /* silent */ }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let priceTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  await Promise.all([loadAlerts(), refreshPrices()])
  priceTimer = setInterval(refreshPrices, 30_000)
})

onUnmounted(() => clearInterval(priceTimer))
</script>

<style scoped>
.input-field {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 12px;
  color: var(--text-1);
  outline: none;
  transition: border-color 0.15s;
}
.input-field:focus { border-color: rgba(59,130,246,0.5); }
.btn-primary {
  background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(59,130,246,0.1));
  color: var(--blue);
  border: 1px solid rgba(59,130,246,0.4);
}
.btn-primary:hover:not(:disabled) { border-color: var(--blue); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.pulse-dot { animation: pulse 2s ease-in-out infinite; }
</style>
