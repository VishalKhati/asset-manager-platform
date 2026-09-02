<template>
  <div class="p-6 space-y-5">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-bold">Trade History</h1>
        <p class="text-xs mt-0.5" style="color:var(--text-3)">
          {{ store.trades.length }} total records
        </p>
      </div>
      <button @click="store.fetchHistory()"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
        style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-2)">
        ↻ Refresh
      </button>
    </div>

    <!-- Stats row -->
    <div class="grid grid-cols-4 gap-4">
      <div class="card p-4">
        <div class="text-xs font-semibold uppercase tracking-widest mb-1" style="color:var(--text-3)">Win Rate</div>
        <div class="text-2xl font-bold" style="color:var(--green)">{{ store.winRate }}%</div>
        <div class="text-xs mt-1" style="color:var(--text-3)">{{ wins }}W / {{ losses }}L</div>
      </div>
      <div class="card p-4">
        <div class="text-xs font-semibold uppercase tracking-widest mb-1" style="color:var(--text-3)">Total PnL</div>
        <div class="text-2xl font-bold" :style="store.totalPnl >= 0 ? 'color:var(--green)' : 'color:var(--red)'">
          ${{ store.totalPnl.toFixed(2) }}
        </div>
        <div class="text-xs mt-1" style="color:var(--text-3)">All closed positions</div>
      </div>
      <div class="card p-4">
        <div class="text-xs font-semibold uppercase tracking-widest mb-1" style="color:var(--text-3)">Avg Confidence</div>
        <div class="text-2xl font-bold" style="color:var(--gold)">{{ avgConfidence }}%</div>
        <div class="text-xs mt-1" style="color:var(--text-3)">Signal strength</div>
      </div>
      <div class="card p-4">
        <div class="text-xs font-semibold uppercase tracking-widest mb-1" style="color:var(--text-3)">Open Positions</div>
        <div class="text-2xl font-bold" style="color:var(--blue)">{{ openCount }}</div>
        <div class="text-xs mt-1" style="color:var(--text-3)">Currently active</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-2">
      <span class="text-xs" style="color:var(--text-3)">Filter:</span>
      <button v-for="f in filters" :key="f"
        @click="activeFilter = f"
        class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
        :style="activeFilter === f
          ? 'background:var(--blue-dim); color:var(--blue); border:1px solid #2563eb'
          : 'background:var(--bg-card); color:var(--text-3); border:1px solid var(--border)'">
        {{ f }}
        <span class="ml-1 font-mono" style="opacity:0.6">{{ filterCount(f) }}</span>
      </button>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th>Direction</th>
            <th>Entry</th>
            <th>Stop Loss</th>
            <th>Take Profit</th>
            <th>Lots</th>
            <th>Confidence</th>
            <th>Status</th>
            <th>PnL</th>
            <th>Opened</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in filteredTrades" :key="t.id">
            <td>
              <span class="text-xs font-bold px-2.5 py-1 rounded-lg"
                :style="t.direction === 'BUY'
                  ? 'background:var(--green-dim); color:var(--green)'
                  : 'background:var(--red-dim); color:var(--red)'">
                {{ t.direction }}
              </span>
            </td>
            <td class="font-mono font-semibold">{{ t.entry.toFixed(2) }}</td>
            <td class="font-mono" style="color:var(--red)">{{ t.sl.toFixed(2) }}</td>
            <td class="font-mono" style="color:var(--green)">{{ t.tp.toFixed(2) }}</td>
            <td class="font-mono" style="color:var(--text-2)">{{ t.lots }}</td>
            <td>
              <div class="flex items-center gap-2">
                <div class="w-14 h-1.5 rounded-full overflow-hidden" style="background:var(--border)">
                  <div class="h-full rounded-full transition-all"
                    :style="{
                      width: `${Math.round(t.confidence * 100)}%`,
                      background: t.direction === 'BUY' ? 'var(--green)' : 'var(--red)'
                    }"></div>
                </div>
                <span class="text-xs font-mono" style="color:var(--text-3)">
                  {{ Math.round(t.confidence * 100) }}%
                </span>
              </div>
            </td>
            <td>
              <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                :style="t.status === 'open'
                  ? 'background:var(--blue-dim); color:var(--blue); border:1px solid #1d4ed8'
                  : t.status === 'closed'
                  ? 'background:var(--bg-card-2); color:var(--text-3); border:1px solid var(--border)'
                  : 'background:#1c1917; color:#78716c; border:1px solid #292524'">
                {{ t.status }}
              </span>
            </td>
            <td class="font-mono font-semibold"
              :style="(t.pnl ?? 0) >= 0 ? 'color:var(--green)' : 'color:var(--red)'">
              {{ t.pnl != null ? `$${t.pnl.toFixed(2)}` : '—' }}
            </td>
            <td class="font-mono text-xs" style="color:var(--text-3)">
              {{ new Date(t.openedAt).toLocaleDateString() }}
              {{ new Date(t.openedAt).toLocaleTimeString() }}
            </td>
          </tr>

          <tr v-if="!filteredTrades.length">
            <td colspan="9" class="text-center py-16" style="color:var(--text-3)">
              <div class="text-3xl mb-2 opacity-20">◉</div>
              No trades match this filter.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useBotStore } from '../stores/bot'

const store = useBotStore()
const filters = ['All', 'Open', 'Closed', 'BUY', 'SELL']
const activeFilter = ref('All')

const filteredTrades = computed(() => {
  const f = activeFilter.value
  if (f === 'All')    return store.trades
  if (f === 'Open')   return store.trades.filter(t => t.status === 'open')
  if (f === 'Closed') return store.trades.filter(t => t.status === 'closed')
  return store.trades.filter(t => t.direction === f)
})

const wins       = computed(() => store.trades.filter(t => t.status === 'closed' && (t.pnl ?? 0) > 0).length)
const losses     = computed(() => store.trades.filter(t => t.status === 'closed' && (t.pnl ?? 0) <= 0).length)
const openCount  = computed(() => store.trades.filter(t => t.status === 'open').length)

const avgConfidence = computed(() => {
  if (!store.trades.length) return 0
  const avg = store.trades.reduce((s, t) => s + t.confidence, 0) / store.trades.length
  return Math.round(avg * 100)
})

function filterCount(f: string): number {
  if (f === 'All')    return store.trades.length
  if (f === 'Open')   return store.trades.filter(t => t.status === 'open').length
  if (f === 'Closed') return store.trades.filter(t => t.status === 'closed').length
  return store.trades.filter(t => t.direction === f).length
}

onMounted(() => store.fetchHistory())
</script>
