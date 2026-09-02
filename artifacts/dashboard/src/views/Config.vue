<template>
  <div class="p-6 max-w-3xl mx-auto space-y-6">

    <div>
      <h1 class="text-lg font-bold">Configuration</h1>
      <p class="text-xs mt-0.5" style="color:var(--text-3)">
        All changes apply immediately to the running bot.
      </p>
    </div>

    <!-- MT5 Bridge -->
    <section class="card p-5">
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-bold">MT5 Bridge</span>
            <span class="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-mono"
              :style="mt5Connected
                ? 'background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.25)'
                : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
              <span class="w-1.5 h-1.5 rounded-full"
                :style="mt5Connected ? 'background:var(--green)' : 'background:var(--text-3)'"></span>
              {{ mt5Connected ? 'CONNECTED' : 'OFFLINE' }}
            </span>
          </div>
          <p class="text-xs" style="color:var(--text-3)">
            {{ mt5Connected
              ? `bridge.js connected — last ping ${mt5LastPing}`
              : 'bridge.js is not running. See MT5 Setup for connection instructions.' }}
          </p>
        </div>
        <RouterLink to="/mt5-setup"
          class="px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ml-4"
          style="background:rgba(245,193,66,0.1); color:var(--gold); border:1px solid rgba(245,193,66,0.3)">
          MT5 Setup →
        </RouterLink>
      </div>
    </section>

    <!-- Engine mode -->
    <section class="card p-5 space-y-4">
      <div class="text-sm font-bold mb-1">Signal Engine Mode</div>
      <div class="grid grid-cols-3 gap-3">
        <button v-for="m in engineModes" :key="m.val"
          @click="cfg.engine.mode = m.val; save()"
          class="flex flex-col items-center gap-1 py-4 rounded-xl font-bold text-sm transition-all active:scale-95"
          :style="cfg.engine.mode === m.val
            ? 'background:rgba(59,130,246,0.12); color:var(--blue); border:1px solid #2563eb'
            : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
          <span class="text-xl">{{ m.icon }}</span>
          <span>{{ m.val }}</span>
          <span class="text-xs font-normal" style="color:inherit; opacity:0.7">{{ m.desc }}</span>
        </button>
      </div>
    </section>

    <!-- Strategies -->
    <section class="card p-5 space-y-3">
      <div class="text-sm font-bold mb-3">Strategy Engine</div>
      <div v-for="(s, name) in cfg.strategies" :key="name"
        class="flex items-center justify-between p-4 rounded-xl transition-all"
        :style="(s as any).enabled
          ? 'background:rgba(16,185,129,0.04); border:1px solid rgba(16,185,129,0.15)'
          : 'background:var(--bg-base); border:1px solid var(--border-dim)'">
        <div class="flex-1">
          <div class="text-sm font-semibold" :style="(s as any).enabled ? 'color:var(--text-1)' : 'color:var(--text-3)'">
            {{ stratLabel(String(name)) }}
          </div>
          <div class="text-xs mt-0.5" style="color:var(--text-3)">{{ stratDesc[String(name)] }}</div>
        </div>

        <div class="flex items-center gap-4">
          <!-- Weight input -->
          <div v-if="'weight' in (s as any)" class="flex items-center gap-2">
            <span class="text-xs" style="color:var(--text-3)">Weight</span>
            <div class="flex items-center gap-1">
              <button @click="adjustWeight(s as any, -1)"
                class="w-6 h-6 rounded flex items-center justify-center text-sm transition-all"
                style="background:var(--bg-card-2); border:1px solid var(--border); color:var(--text-2)">
                −
              </button>
              <span class="w-6 text-center font-mono text-sm font-bold" style="color:var(--gold)">
                {{ (s as any).weight }}
              </span>
              <button @click="adjustWeight(s as any, 1)"
                class="w-6 h-6 rounded flex items-center justify-center text-sm transition-all"
                style="background:var(--bg-card-2); border:1px solid var(--border); color:var(--text-2)">
                +
              </button>
            </div>
          </div>

          <!-- Toggle -->
          <button @click="toggleStrategy(s as any)"
            class="toggle-track"
            :style="(s as any).enabled ? 'background:var(--green)' : 'background:var(--border)'">
            <span class="toggle-thumb"
              :style="(s as any).enabled
                ? 'left:23px; background:#fff'
                : 'left:3px; background:#9ca3af'">
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- Risk Management -->
    <section class="card p-5 space-y-4">
      <div class="text-sm font-bold mb-3">Risk Management</div>
      <div class="grid grid-cols-2 gap-5">
        <RiskField
          label="Risk per trade"
          suffix="%"
          v-model.number="cfg.risk.riskPercent"
          :min="0.1" :max="5" :step="0.1"
          desc="% of account per trade"
          @change="save()" />
        <RiskField
          label="Risk:Reward Ratio"
          suffix="x"
          v-model.number="cfg.risk.rrRatio"
          :min="1" :max="10" :step="0.5"
          desc="TP = SL × ratio"
          @change="save()" />
        <RiskField
          label="Max trades / day"
          suffix=""
          v-model.number="cfg.risk.maxTradesPerDay"
          :min="1" :max="20" :step="1"
          desc="Daily trade limit"
          @change="save()" />
      </div>

      <div class="grid grid-cols-2 gap-4 pt-2" style="border-top:1px solid var(--border-dim)">
        <div class="flex items-center justify-between p-3 rounded-xl"
          style="background:var(--bg-base); border:1px solid var(--border-dim)">
          <div>
            <div class="text-sm font-medium">Trailing Stop</div>
            <div class="text-xs mt-0.5" style="color:var(--text-3)">Lock profits as price moves</div>
          </div>
          <button @click="cfg.risk.trailingStop = !cfg.risk.trailingStop; save()"
            class="toggle-track"
            :style="cfg.risk.trailingStop ? 'background:var(--green)' : 'background:var(--border)'">
            <span class="toggle-thumb"
              :style="cfg.risk.trailingStop ? 'left:23px; background:#fff' : 'left:3px; background:#9ca3af'">
            </span>
          </button>
        </div>
        <div class="flex items-center justify-between p-3 rounded-xl"
          style="background:var(--bg-base); border:1px solid var(--border-dim)">
          <div>
            <div class="text-sm font-medium">Break Even</div>
            <div class="text-xs mt-0.5" style="color:var(--text-3)">Move SL to entry at 1:1</div>
          </div>
          <button @click="cfg.risk.breakEven = !cfg.risk.breakEven; save()"
            class="toggle-track"
            :style="cfg.risk.breakEven ? 'background:var(--green)' : 'background:var(--border)'">
            <span class="toggle-thumb"
              :style="cfg.risk.breakEven ? 'left:23px; background:#fff' : 'left:3px; background:#9ca3af'">
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- Save toast -->
    <transition name="fade">
      <div v-if="saved"
        class="fixed bottom-5 right-5 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm z-50"
        style="background:var(--green-dim); color:var(--green); border:1px solid #166534; box-shadow:0 8px 32px rgba(0,0,0,0.5)">
        ✓ Configuration saved
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useBotStore } from '../stores/bot'
import RiskField from '../components/RiskField.vue'

const store        = useBotStore()
const saved        = ref(false)
const mt5Connected = ref(false)
const mt5LastPing  = ref<string>('never')

async function fetchMT5Status() {
  try {
    const res = await fetch(`/api/bot/bridge-status?symbol=${store.activeSymbol}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('smc_jwt') ?? ''}` }
    })
    if (res.ok) {
      const data = await res.json()
      mt5Connected.value = data.connected ?? false
      if (data.lastPing) {
        const secs = Math.floor((Date.now() - new Date(data.lastPing).getTime()) / 1000)
        mt5LastPing.value = secs < 60 ? `${secs}s ago` : `${Math.floor(secs/60)}m ago`
      }
    }
  } catch { /* silent */ }
}

let statusTimer: ReturnType<typeof setInterval>
onMounted(async () => {
  await store.fetchConfig()
  Object.assign(cfg.strategies, store.strategies)
  await fetchMT5Status()
  statusTimer = setInterval(fetchMT5Status, 30_000)
})
onUnmounted(() => clearInterval(statusTimer))

const cfg = reactive({
  engine: { mode: 'STRICT', weightThreshold: 0.6, requireSession: true },
  risk:   { riskPercent: 1, rrRatio: 2, maxTradesPerDay: 3, trailingStop: true, breakEven: true },
  strategies: {} as Record<string, { enabled: boolean; weight?: number }>,
})

const engineModes = [
  { val: 'STRICT',   icon: '🔒', desc: 'All must agree'   },
  { val: 'FLEX',     icon: '⚖',  desc: 'Majority wins'    },
  { val: 'WEIGHTED', icon: '◎',  desc: 'Score threshold'  },
]

const stratLabel = (n: string) => ({
  liquiditySweep:  'Liquidity Sweep',
  fairValueGap:    'Fair Value Gap',
  maFilter:        'MA Filter (25/50/100)',
  orderBlock:      'Order Block',
  marketStructure: 'Market Structure',
  sessionFilter:   'Session Filter',
} as Record<string,string>)[n] ?? n

const stratDesc: Record<string, string> = {
  liquiditySweep:  'Detects equal lows/highs sweep with rejection candle',
  fairValueGap:    '3-candle imbalance zone (smart money FVG)',
  maFilter:        'Trend direction filter using MA 25 / 50 / 100',
  orderBlock:      'Last opposing candle before impulse move',
  marketStructure: 'Break of Structure (BOS) and Change of Character (CHOCH)',
  sessionFilter:   'Gates signals to London (08–17 UTC) and NY (13–22 UTC)',
}

function toggleStrategy(s: { enabled: boolean }) {
  s.enabled = !s.enabled
  save()
}

function adjustWeight(s: { weight?: number }, delta: number) {
  if (s.weight != null) {
    s.weight = Math.max(1, Math.min(5, s.weight + delta))
    save()
  }
}

let saveTimer: ReturnType<typeof setTimeout>
async function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    await store.updateConfig({ engine: cfg.engine, risk: cfg.risk, strategies: cfg.strategies })
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
  }, 400)
}

</script>
