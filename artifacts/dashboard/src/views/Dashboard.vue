<template>
  <div class="p-6 space-y-5">

    <!-- ── Row 1: KPI cards ─────────────────────────────── -->
    <div class="grid grid-cols-4 gap-4">
      <KpiCard
        :label="store.activeSymbol + ' Price'"
        :value="store.price
          ? store.activeSymbol === 'BTCUSD'
            ? `$${store.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            : `$${store.price.toFixed(2)}`
          : '—'"
        sub="Live spot price"
        :accent="store.symbolColor"
        icon="◈"
      />
      <KpiCard
        label="Current Signal"
        :value="store.lastSignal?.signal ?? 'WAIT'"
        :sub="store.lastSignal?.signal ? `${Math.round((store.lastSignal.confidence ?? 0) * 100)}% confidence` : 'No signal yet'"
        :accent="store.lastSignal?.signal === 'BUY' ? 'var(--green)' : store.lastSignal?.signal === 'SELL' ? 'var(--red)' : 'var(--text-3)'"
        icon="◉"
      />
      <KpiCard
        label="Win Rate"
        :value="`${store.winRate}%`"
        :sub="`${closedTrades} closed trades`"
        accent="var(--green)"
        icon="▲"
      />
      <KpiCard
        label="Total PnL"
        :value="`$${store.totalPnl.toFixed(2)}`"
        sub="All closed positions"
        :accent="store.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'"
        icon="$"
      />
    </div>

    <!-- ── Row 2: Price chart ──────────────────────────── -->
    <div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-4">
          <span class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">
            {{ store.activeSymbol }} · 1m · Last {{ (store.candles ?? []).length }} candles
          </span>
          <div class="flex items-center gap-3 text-xs font-mono">
            <span class="flex items-center gap-1">
              <span class="inline-block w-3 h-0.5 rounded" style="background:var(--gold)"></span>
              MA25
            </span>
            <span class="flex items-center gap-1" style="color:var(--blue)">
              <span class="inline-block w-3 h-0.5 rounded" style="background:var(--blue)"></span>
              MA50
            </span>
            <span class="flex items-center gap-1" style="color:#a855f7">
              <span class="inline-block w-3 h-0.5 rounded" style="background:#a855f7"></span>
              MA100
            </span>
          </div>
        </div>
        <div v-if="store.lastSignal?.signal" class="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg"
          :style="store.lastSignal.signal === 'BUY'
            ? 'background:rgba(16,185,129,0.1); color:var(--green); border:1px solid rgba(16,185,129,0.3)'
            : 'background:rgba(239,68,68,0.1); color:var(--red); border:1px solid rgba(239,68,68,0.3)'">
          <span>{{ store.lastSignal.signal === 'BUY' ? '▲' : '▼' }}</span>
          Signal at close
        </div>
      </div>
      <PriceChart
        :candles="store.candles"
        :mas="store.mas"
        :signal-dir="store.lastSignal?.signal ?? null"
      />
    </div>

    <!-- ── Row 3: P&L Daily Chart ──────────────────────── -->
    <div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-4">
          <span class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">
            Daily P&amp;L · {{ store.activeSymbol }} · Last 30 Days
          </span>
          <div class="flex items-center gap-3 text-xs font-mono">
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-3 h-2 rounded-sm" style="background:rgba(16,185,129,0.75)"></span>
              <span style="color:var(--text-3)">Profit</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-3 h-2 rounded-sm" style="background:rgba(239,68,68,0.7)"></span>
              <span style="color:var(--text-3)">Loss</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-5 border-t-2 border-blue-500" style="border-style:solid"></span>
              <span style="color:#3b82f6">Cumulative</span>
            </span>
          </div>
        </div>
        <div class="flex items-center gap-3 text-xs font-mono">
          <span v-if="store.dailyPnl.length">
            <span style="color:var(--text-3)">Period P&amp;L: </span>
            <span class="font-bold" :style="periodPnl >= 0 ? 'color:var(--green)' : 'color:var(--red)'">
              {{ periodPnl >= 0 ? '+' : '' }}${{ periodPnl.toFixed(2) }}
            </span>
          </span>
          <span v-if="store.dailyPnl.length" style="color:var(--text-3)">
            {{ store.dailyPnl.reduce((s,d)=>s+d.trades,0) }} trades across {{ store.dailyPnl.length }} days
          </span>
        </div>
      </div>
      <PnlChart :data="store.dailyPnl" />
    </div>

    <!-- ── Row 4: Signal + Controls + MA ───────────────── -->
    <div class="grid grid-cols-12 gap-4">

      <!-- Signal panel -->
      <div class="col-span-5 card p-5 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">Live Signal</span>
          <span class="text-xs font-mono" style="color:var(--text-3)">
            {{ store.lastSignal ? new Date(store.lastSignal.timestamp).toLocaleTimeString() : '—' }}
          </span>
        </div>

        <div v-if="store.lastSignal" class="slide-up">
          <!-- Direction -->
          <div class="flex items-center gap-5 mb-4">
            <div class="relative flex items-center justify-center w-24 h-24 rounded-2xl"
              :style="signalBg">
              <span class="text-3xl font-black tracking-tight"
                :class="store.lastSignal.signal === 'BUY' ? 'glow-buy' : store.lastSignal.signal === 'SELL' ? 'glow-sell' : ''"
                :style="{ color: signalColor }">
                {{ store.lastSignal.signal ?? 'WAIT' }}
              </span>
            </div>

            <div class="flex-1 space-y-3">
              <!-- Confidence bar -->
              <div>
                <div class="flex justify-between text-xs mb-1.5">
                  <span style="color:var(--text-3)">Confidence</span>
                  <span class="font-mono font-bold" :style="{ color: signalColor }">
                    {{ Math.round((store.lastSignal.confidence ?? 0) * 100) }}%
                  </span>
                </div>
                <div class="h-2 rounded-full overflow-hidden" style="background:var(--border)">
                  <div class="h-full rounded-full transition-all duration-700"
                    :style="{ width: `${Math.round((store.lastSignal.confidence ?? 0) * 100)}%`, background: signalColor }">
                  </div>
                </div>
              </div>

              <!-- Engine mode -->
              <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded font-mono"
                  style="background:var(--blue-dim); color:var(--blue); border:1px solid #1d4ed8">
                  {{ store.lastSignal.mode }}
                </span>
                <span class="text-xs" style="color:var(--text-3)">engine mode</span>
              </div>
            </div>
          </div>

          <!-- Reason -->
          <div class="text-xs leading-relaxed mb-3 px-3 py-2 rounded-lg"
            style="background:var(--bg-base); color:var(--text-2); border:1px solid var(--border-dim)">
            {{ store.lastSignal.reason }}
          </div>

          <!-- Agreeing strategies -->
          <div v-if="store.lastSignal.agreeing?.length" class="flex flex-wrap gap-1.5">
            <span v-for="s in store.lastSignal.agreeing" :key="s"
              class="px-2 py-0.5 rounded-full text-xs font-mono font-medium"
              :style="store.lastSignal.signal === 'BUY'
                ? 'background:var(--green-dim); color:var(--green)'
                : 'background:var(--red-dim); color:var(--red)'">
              ✓ {{ s }}
            </span>
          </div>
        </div>

        <div v-else class="flex-1 flex flex-col items-center justify-center gap-2 py-8">
          <div class="text-3xl opacity-20">◉</div>
          <p class="text-sm" style="color:var(--text-3)">Waiting for scan…</p>
        </div>
      </div>

      <!-- Controls -->
      <div class="col-span-3 card p-5 flex flex-col gap-4">
        <span class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">Bot Control</span>

        <!-- Start/Stop -->
        <button @click="toggleBot"
          class="w-full py-3 rounded-xl font-bold text-sm tracking-wide transition-all active:scale-95"
          :style="store.running
            ? 'background:var(--red-dim); color:var(--red); border:1px solid #7f1d1d'
            : 'background:var(--green-dim); color:var(--green); border:1px solid #166534'">
          {{ store.running ? '⏹  Stop Bot' : '▶  Start Bot' }}
        </button>

        <!-- Mode -->
        <div>
          <div class="text-xs mb-2" style="color:var(--text-3)">Engine mode</div>
          <div class="grid grid-cols-3 gap-1">
            <button v-for="m in modes" :key="m.val"
              @click="setMode(m.val)"
              class="py-2 rounded-lg text-xs font-mono font-bold uppercase transition-all"
              :style="store.mode === m.val
                ? 'background:var(--blue-dim); color:var(--blue); border:1px solid #2563eb'
                : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
              {{ m.label }}
            </button>
          </div>
        </div>

        <!-- Trades today progress -->
        <div class="rounded-xl p-3" style="background:var(--bg-base); border:1px solid var(--border)">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs" style="color:var(--text-3)">Trades today</span>
            <span class="text-sm font-bold font-mono" :style="`color:${store.symbolColor}`">
              {{ store.tradesToday }} / {{ store.maxTradesPerDay }}
            </span>
          </div>
          <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--border)">
            <div class="h-full rounded-full transition-all duration-500" :style="`background:${store.symbolColor};width:${Math.min(100, (store.tradesToday / store.maxTradesPerDay) * 100)}%`">
            </div>
          </div>
        </div>
      </div>

      <!-- Moving averages -->
      <div class="col-span-4 card p-5">
        <div class="text-xs font-semibold uppercase tracking-widest mb-4" style="color:var(--text-3)">Moving Averages</div>
        <div class="space-y-3">
          <div v-for="(val, period) in store.mas" :key="period"
            class="flex items-center justify-between p-2.5 rounded-lg"
            style="background:var(--bg-base); border:1px solid var(--border-dim)">
            <div class="flex items-center gap-2.5">
              <div class="w-3 h-3 rounded-full" :style="{ background: maColors[Number(period)] }"></div>
              <span class="text-sm font-medium" style="color:var(--text-2)">MA({{ period }})</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="font-mono text-sm font-semibold">{{ val != null ? val.toFixed(2) : '—' }}</span>
              <div v-if="val && store.price" class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold"
                :style="store.price > val
                  ? 'background:var(--green-dim); color:var(--green)'
                  : 'background:var(--red-dim); color:var(--red)'">
                {{ store.price > val ? '▲' : '▼' }}
                {{ Math.abs(store.price - val).toFixed(1) }}
              </div>
            </div>
          </div>

          <!-- Price vs MAs summary -->
          <div class="mt-2 pt-3" style="border-top:1px solid var(--border-dim)">
            <div class="text-xs text-center" style="color:var(--text-3)">
              Price is
              <span :style="priceAboveMAs ? 'color:var(--green)' : 'color:var(--red)'" class="font-bold">
                {{ priceAboveMAs ? 'above' : 'below' }}
              </span>
              all MAs →
              <span :style="priceAboveMAs ? 'color:var(--green)' : 'color:var(--red)'" class="font-bold">
                {{ priceAboveMAs ? 'Bullish' : 'Bearish' }} bias
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Row 4: Strategies + Recent Trades ────────────── -->
    <div class="grid grid-cols-12 gap-4">

      <!-- Strategy status -->
      <div class="col-span-7 card p-5">
        <div class="text-xs font-semibold uppercase tracking-widest mb-4" style="color:var(--text-3)">Strategy Engine</div>
        <div class="grid grid-cols-2 gap-2">
          <div v-for="(cfg, name) in store.strategies" :key="name"
            class="flex items-center justify-between px-4 py-3 rounded-xl transition-all"
            :style="(cfg as any).enabled
              ? 'background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2)'
              : 'background:var(--bg-base); border:1px solid var(--border-dim)'">
            <div class="flex items-center gap-2.5">
              <div class="w-2 h-2 rounded-full shrink-0"
                :style="(cfg as any).enabled ? 'background:var(--green)' : 'background:var(--border)'"></div>
              <div>
                <div class="text-sm font-medium" :style="(cfg as any).enabled ? 'color:var(--text-1)' : 'color:var(--text-3)'">
                  {{ strategyLabel(String(name)) }}
                </div>
                <div class="text-xs mt-0.5" style="color:var(--text-3)">{{ strategyDesc(String(name)) }}</div>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span v-if="(cfg as any).weight" class="text-xs font-mono px-1.5 py-0.5 rounded"
                style="background:var(--bg-card-2); color:var(--text-3)">
                w{{ (cfg as any).weight }}
              </span>
              <span class="text-xs font-bold font-mono"
                :style="(cfg as any).enabled ? 'color:var(--green)' : 'color:var(--text-3)'">
                {{ (cfg as any).enabled ? 'ON' : 'OFF' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent trades -->
      <div class="col-span-5 card p-5">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">Recent Trades</span>
          <router-link to="/history" class="text-xs font-medium transition-colors hover:text-blue-300"
            style="color:var(--blue)">View all →</router-link>
        </div>

        <div v-if="!store.trades.length" class="flex flex-col items-center justify-center py-8 gap-2">
          <div class="text-3xl opacity-20">◉</div>
          <p class="text-xs" style="color:var(--text-3)">No trades yet</p>
        </div>

        <div v-else class="space-y-2">
          <div v-for="t in store.trades.slice(0, 5)" :key="t.id"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
            style="background:var(--bg-base); border:1px solid var(--border-dim)">
            <span class="text-xs font-bold px-2 py-0.5 rounded-md shrink-0"
              :style="t.direction === 'BUY'
                ? 'background:var(--green-dim); color:var(--green)'
                : 'background:var(--red-dim); color:var(--red)'">
              {{ t.direction }}
            </span>
            <span class="font-mono text-xs flex-1" style="color:var(--text-2)">{{ t.entry.toFixed(2) }}</span>
            <span class="text-xs font-mono" style="color:var(--text-3)">
              SL {{ t.sl.toFixed(0) }}
            </span>
            <span class="text-xs font-mono font-bold"
              :style="(t.pnl ?? 0) >= 0 ? 'color:var(--green)' : 'color:var(--red)'">
              {{ t.pnl != null ? `$${t.pnl.toFixed(2)}` : '—' }}
            </span>
            <span class="text-xs px-1.5 py-0.5 rounded font-mono"
              :style="t.status === 'open'
                ? 'background:var(--blue-dim); color:var(--blue)'
                : 'background:var(--bg-card-2); color:var(--text-3)'">
              {{ t.status }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useBotStore } from '../stores/bot'
import KpiCard from '../components/KpiCard.vue'
import PriceChart from '../components/PriceChart.vue'
import PnlChart from '../components/PnlChart.vue'

const store = useBotStore()

const maColors: Record<number, string> = { 25: '#f5c142', 50: '#3b82f6', 100: '#a855f7' }
const modes = [
  { val: 'signal',   label: 'SIG' },
  { val: 'live',     label: 'LIVE' },
  { val: 'backtest', label: 'BT' },
]

const signalColor = computed(() => {
  if (store.lastSignal?.signal === 'BUY')  return 'var(--green)'
  if (store.lastSignal?.signal === 'SELL') return 'var(--red)'
  return 'var(--text-3)'
})

const signalBg = computed(() => {
  if (store.lastSignal?.signal === 'BUY')
    return 'background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25)'
  if (store.lastSignal?.signal === 'SELL')
    return 'background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25)'
  return 'background:var(--bg-base); border:1px solid var(--border)'
})

const closedTrades = computed(() => store.trades.filter(t => t.status === 'closed').length)

const periodPnl = computed(() =>
  parseFloat(store.dailyPnl.reduce((s, d) => s + d.pnl, 0).toFixed(2))
)

const priceAboveMAs = computed(() => {
  if (!store.price) return true
  return Object.values(store.mas).every(v => v != null && store.price! > v!)
})

function strategyLabel(name: string): string {
  return ({
    liquiditySweep:  'Liquidity Sweep',
    fairValueGap:    'Fair Value Gap',
    maFilter:        'MA Filter',
    orderBlock:      'Order Block',
    marketStructure: 'Market Structure',
    sessionFilter:   'Session Filter',
  } as Record<string, string>)[name] ?? name
}

function strategyDesc(name: string): string {
  return ({
    liquiditySweep:  'Equal highs/lows sweep',
    fairValueGap:    '3-candle imbalance zone',
    maFilter:        'MA 25 / 50 / 100 trend',
    orderBlock:      'Last opposing candle',
    marketStructure: 'BOS + CHOCH detection',
    sessionFilter:   'London & New York gates',
  } as Record<string, string>)[name] ?? ''
}

async function toggleBot() {
  if (store.running) await store.stopBot()
  else await store.startBot()
}

async function setMode(m: string) {
  await store.updateConfig({ mode: m })
}

onMounted(() => {
  store.fetchHistory()
  store.fetchDailyPnl()
})
</script>
