<template>
  <div class="p-6 space-y-5">

    <!-- ── Apply-to-Live toast (fixed, bottom-center) ──────────────────────── -->
    <transition name="toast-slide">
      <div v-if="applyLiveToast"
        class="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold"
        style="transform:translateX(-50%); max-width:520px; white-space:nowrap"
        :style="applyLiveToast.ok
          ? 'background:#052e16; border:1px solid var(--green); color:var(--green)'
          : 'background:#2d1515; border:1px solid var(--red); color:var(--red)'">
        <span>{{ applyLiveToast.ok ? '✓' : '✕' }}</span>
        <span style="white-space:normal; word-break:break-word">{{ applyLiveToast.msg }}</span>
        <button @click="applyLiveToast = null"
          class="ml-2 text-xs opacity-60 hover:opacity-100 transition-opacity" style="cursor:pointer">✕</button>
      </div>
    </transition>

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-bold">Backtesting Engine</h1>
        <p class="text-xs mt-0.5" style="color:var(--text-3)">
          Walk-forward simulation on live
          <span class="font-mono font-bold" :style="`color:${store.symbolColor}`">{{ store.activeSymbol }}</span>
          candles
        </p>
      </div>

      <!-- Tab switcher + action button -->
      <div class="flex items-center gap-3">

        <!-- Tabs -->
        <div class="flex p-1 gap-1 rounded-xl" style="background:var(--bg-base); border:1px solid var(--border)">
          <button v-for="tab in TABS" :key="tab.id" @click="activeTab = tab.id"
            class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
            :style="activeTab === tab.id
              ? `background:${store.symbolColor}20; color:${store.symbolColor}; border:1px solid ${store.symbolColor}50`
              : 'color:var(--text-3)'">
            {{ tab.icon }} {{ tab.label }}
          </button>
        </div>

        <!-- Action button -->
        <button @click="activeTab === 'backtest' ? doRun() : doOptimize()"
          :disabled="loading || optLoading"
          class="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all"
          :style="(loading || optLoading)
            ? 'background:var(--bg-card); color:var(--text-3); cursor:not-allowed; border:1px solid var(--border)'
            : `background:${store.symbolColor}22; color:${store.symbolColor}; border:1px solid ${store.symbolColor}55; cursor:pointer`">
          <span :class="(loading || optLoading) ? 'spin-bt' : ''">
            {{ (loading || optLoading) ? '↻' : (activeTab === 'backtest' ? '▶' : '⌗') }}
          </span>
          {{ loading ? 'Running…' : optLoading ? `Testing…` : activeTab === 'backtest' ? 'Run Backtest' : `Run Optimizer` }}
        </button>
      </div>
    </div>

    <!-- ── Shared config panel ────────────────────────────────────────────── -->
    <div class="card p-5 space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">
          {{ activeTab === 'backtest' ? 'Configuration' : 'Base Configuration' }}
        </div>
        <div class="flex items-center gap-2">
          <span v-if="activeTab === 'optimize'" class="text-xs px-2 py-0.5 rounded-lg"
            style="background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)">
            {{ totalCombos }} combinations
          </span>
          <button @click="showConfig = !showConfig"
            class="text-xs px-2.5 py-1 rounded-lg transition-all"
            style="background:var(--bg-card-2); color:var(--text-3); border:1px solid var(--border)">
            {{ showConfig ? '▲ Hide' : '▼ Show' }}
          </button>
        </div>
      </div>

      <div v-if="showConfig" class="space-y-4">
        <!-- Signal mode (only for single backtest) -->
        <div v-if="activeTab === 'backtest'">
          <div class="text-xs mb-2" style="color:var(--text-3)">Signal Mode</div>
          <div class="flex gap-2">
            <button v-for="m in ['STRICT','FLEX','WEIGHTED']" :key="m"
              @click="cfg.engine.mode = m as any"
              class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
              :style="cfg.engine.mode === m
                ? `background:${store.symbolColor}22; color:${store.symbolColor}; border:1px solid ${store.symbolColor}55`
                : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
              {{ m }}
            </button>
          </div>
        </div>

        <!-- Optimizer sort metric -->
        <div v-if="activeTab === 'optimize'">
          <div class="text-xs mb-2" style="color:var(--text-3)">Rank Results By</div>
          <div class="flex gap-2 flex-wrap">
            <button v-for="s in SORT_OPTS" :key="s.key"
              @click="optSortBy = s.key as any"
              class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
              :style="optSortBy === s.key
                ? `background:${store.symbolColor}22; color:${store.symbolColor}; border:1px solid ${store.symbolColor}55`
                : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
              {{ s.label }}
            </button>
          </div>
        </div>

        <!-- Min confidence (single backtest only) -->
        <div v-if="activeTab === 'backtest'" class="flex items-center gap-4">
          <div class="text-xs" style="color:var(--text-3)">Min Confidence</div>
          <input type="range" min="0" max="100" step="5"
            v-model.number="minConfPct"
            class="flex-1 accent-yellow-400" style="max-width:160px" />
          <span class="font-mono text-xs font-bold" style="color:var(--gold); min-width:36px">
            {{ minConfPct }}%
          </span>
        </div>

        <!-- Initial equity -->
        <div class="flex items-center gap-4">
          <div class="text-xs" style="color:var(--text-3)">Initial Equity</div>
          <input v-model.number="initialEquity" type="number" min="100" step="500"
            class="font-mono text-xs rounded-lg px-3 py-1.5 w-32"
            style="background:var(--bg-base); border:1px solid var(--border); color:var(--text-1)" />
          <span class="text-xs" style="color:var(--text-3)">USD</span>
        </div>

        <!-- Strategy toggles (single backtest only) -->
        <div v-if="activeTab === 'backtest'">
          <div class="text-xs mb-2" style="color:var(--text-3)">Strategies</div>
          <div class="grid grid-cols-3 gap-2">
            <label v-for="s in strategyList" :key="s.key"
              class="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-all"
              :style="s.enabled
                ? `background:${store.symbolColor}12; border:1px solid ${store.symbolColor}40`
                : 'background:var(--bg-base); border:1px solid var(--border)'">
              <div class="relative shrink-0">
                <input type="checkbox" class="sr-only" v-model="s.enabled" />
                <div class="w-8 h-4 rounded-full transition-all"
                  :style="s.enabled ? `background:${store.symbolColor}` : 'background:var(--border)'">
                  <div class="w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all"
                    :style="s.enabled ? 'left:calc(100% - 14px)' : 'left:2px'"></div>
                </div>
              </div>
              <span class="text-xs font-medium"
                :style="s.enabled ? `color:${store.symbolColor}` : 'color:var(--text-3)'">
                {{ s.label }}
              </span>
            </label>
          </div>
        </div>

        <!-- Optimizer: preset list info -->
        <div v-if="activeTab === 'optimize'"
          class="rounded-xl p-3 text-xs space-y-1" style="background:var(--bg-base); border:1px solid var(--border)">
          <div class="font-semibold mb-2" style="color:var(--text-2)">Sweep Space</div>
          <div class="grid grid-cols-3 gap-x-6 gap-y-1" style="color:var(--text-3)">
            <span>3 Signal modes</span>
            <span>4 Confidence levels</span>
            <span>8 Strategy presets</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="p in PRESET_NAMES" :key="p"
              class="px-2 py-0.5 rounded-full text-xs"
              style="background:var(--bg-card); color:var(--text-3); border:1px solid var(--border)">
              {{ p }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Error ──────────────────────────────────────────────────────────── -->
    <div v-if="runError"
      class="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
      style="background:#1c0a0a; color:#fca5a5; border:1px solid #7f1d1d">
      ⚠ {{ runError }}
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <!-- BACKTEST TAB                                                          -->
    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <template v-if="activeTab === 'backtest'">

      <!-- Empty state -->
      <div v-if="!result && !loading && !runError"
        class="card flex flex-col items-center justify-center py-20 text-center">
        <div class="text-4xl mb-3 opacity-20">◈</div>
        <p class="text-sm" style="color:var(--text-3)">
          Set your parameters above, then click
          <strong style="color:var(--text-2)">Run Backtest</strong>.
        </p>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card p-6">
        <div class="flex flex-col items-center gap-4 py-10">
          <div class="w-10 h-10 rounded-full border-2 spin-bt"
            :style="`border-color:${store.symbolColor}30; border-top-color:${store.symbolColor}`"></div>
          <p class="text-sm" style="color:var(--text-3)">Simulating {{ store.activeSymbol }} strategy engine…</p>
        </div>
      </div>

      <!-- Results -->
      <template v-if="result && !loading">

        <!-- KPI row -->
        <div class="grid grid-cols-5 gap-4">
          <div class="card p-4">
            <div class="kpi-label">Win Rate</div>
            <div class="kpi-value" :style="result.stats.winRate >= 0.5 ? 'color:var(--green)' : 'color:var(--red)'">
              {{ (result.stats.winRate * 100).toFixed(1) }}%
            </div>
            <div class="kpi-sub">{{ result.stats.wins }}W / {{ result.stats.losses }}L</div>
          </div>
          <div class="card p-4">
            <div class="kpi-label">Net PnL</div>
            <div class="kpi-value" :style="result.stats.totalPnl >= 0 ? 'color:var(--green)' : 'color:var(--red)'">
              {{ result.stats.totalPnl >= 0 ? '+' : '' }}${{ result.stats.totalPnl.toFixed(2) }}
            </div>
            <div class="kpi-sub">{{ result.stats.totalTrades }} trades</div>
          </div>
          <div class="card p-4">
            <div class="kpi-label">Max Drawdown</div>
            <div class="kpi-value" style="color:var(--red)">-${{ result.stats.maxDrawdown.toFixed(2) }}</div>
            <div class="kpi-sub">Peak → trough</div>
          </div>
          <div class="card p-4">
            <div class="kpi-label">Profit Factor</div>
            <div class="kpi-value"
              :style="result.stats.profitFactor >= 1.5 ? 'color:var(--green)' : result.stats.profitFactor >= 1 ? 'color:var(--gold)' : 'color:var(--red)'">
              {{ result.stats.profitFactor === 999 ? '∞' : result.stats.profitFactor.toFixed(2) }}
            </div>
            <div class="kpi-sub">Gross profit / loss</div>
          </div>
          <div class="card p-4">
            <div class="kpi-label">Avg Trade</div>
            <div class="kpi-value" :style="result.stats.avgTradePnl >= 0 ? 'color:var(--green)' : 'color:var(--red)'">
              {{ result.stats.avgTradePnl >= 0 ? '+' : '' }}${{ result.stats.avgTradePnl.toFixed(2) }}
            </div>
            <div class="kpi-sub">Avg conf {{ (result.stats.avgConfidence * 100).toFixed(0) }}%</div>
          </div>
        </div>

        <!-- Equity curve -->
        <div class="card p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">Equity Curve</div>
            <div class="flex items-center gap-4 text-xs" style="color:var(--text-3)">
              <span class="flex items-center gap-1.5">
                <span class="inline-block w-5 h-0.5 rounded-full" :style="`background:${store.symbolColor}`"></span>
                Equity
              </span>
              <span class="flex items-center gap-1.5">
                <span class="inline-block w-5 h-0.5 rounded-full" style="background:var(--red)"></span>
                Drawdown
              </span>
              <span class="font-mono" style="color:var(--text-3)">{{ result.candleCount }} candles · {{ result.elapsedMs }}ms</span>
            </div>
          </div>
          <div style="height:240px; position:relative">
            <canvas ref="chartCanvas"></canvas>
          </div>
        </div>

        <!-- Strategy stats + trade list -->
        <div class="grid grid-cols-2 gap-4">
          <div class="card overflow-hidden">
            <div class="px-4 py-3" style="border-bottom:1px solid var(--border)">
              <div class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">Per-Strategy Stats</div>
            </div>
            <table class="data-table">
              <thead><tr><th>Strategy</th><th>Signals</th><th>Wins</th><th>Win Rate</th></tr></thead>
              <tbody>
                <tr v-for="(s, name) in result.strategyStats" :key="name">
                  <td class="text-xs font-medium">{{ name }}</td>
                  <td class="font-mono text-xs" style="color:var(--text-2)">{{ s.signals }}</td>
                  <td class="font-mono text-xs" style="color:var(--green)">{{ s.wins }}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--border); width:52px">
                        <div class="h-full rounded-full"
                          :style="`width:${(s.winRate*100).toFixed(0)}%; background:${s.winRate>=0.5?'var(--green)':'var(--red)'}`"></div>
                      </div>
                      <span class="font-mono text-xs" :style="s.winRate>=0.5?'color:var(--green)':'color:var(--red)'">
                        {{ (s.winRate*100).toFixed(0) }}%
                      </span>
                    </div>
                  </td>
                </tr>
                <tr v-if="!Object.keys(result.strategyStats).length">
                  <td colspan="4" class="text-center py-8" style="color:var(--text-3)">No strategy hits.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card overflow-hidden">
            <div class="px-4 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--border)">
              <div class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">Simulated Trades</div>
              <span class="text-xs font-mono" style="color:var(--text-3)">
                last {{ Math.min(result.trades.length, 30) }} / {{ result.trades.length }}
              </span>
            </div>
            <div class="overflow-y-auto" style="max-height:320px">
              <table class="data-table">
                <thead><tr><th>Dir</th><th>Entry</th><th>Close</th><th>PnL</th><th>Result</th></tr></thead>
                <tbody>
                  <tr v-for="(t, i) in recentTrades" :key="i">
                    <td>
                      <span class="text-xs font-bold px-2 py-0.5 rounded-lg"
                        :style="t.direction==='BUY'
                          ? 'background:var(--green-dim); color:var(--green)'
                          : 'background:var(--red-dim); color:var(--red)'">
                        {{ t.direction }}
                      </span>
                    </td>
                    <td class="font-mono text-xs">{{ fmtPrice(t.openPrice) }}</td>
                    <td class="font-mono text-xs">{{ fmtPrice(t.closePrice) }}</td>
                    <td class="font-mono text-xs font-semibold"
                      :style="t.pnl>=0 ? 'color:var(--green)' : 'color:var(--red)'">
                      {{ t.pnl>=0?'+':'' }}${{ t.pnl.toFixed(2) }}
                    </td>
                    <td>
                      <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                        :style="t.outcome==='win'
                          ? 'background:var(--green-dim); color:var(--green)'
                          : 'background:var(--red-dim); color:var(--red)'">
                        {{ t.outcome==='win' ? '✓ WIN' : '✕ LOSS' }}
                      </span>
                    </td>
                  </tr>
                  <tr v-if="!result.trades.length">
                    <td colspan="5" class="text-center py-8" style="color:var(--text-3)">No trades triggered.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <!-- OPTIMIZER TAB                                                         -->
    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <template v-if="activeTab === 'optimize'">

      <!-- Empty state -->
      <div v-if="!optResult && !optLoading && !runError"
        class="card flex flex-col items-center justify-center py-20 text-center">
        <div class="text-4xl mb-3 opacity-20">⌗</div>
        <p class="text-sm mb-1" style="color:var(--text-3)">
          Click <strong style="color:var(--text-2)">Run Optimizer</strong> to sweep
          <strong style="color:var(--text-2)">{{ totalCombos }}</strong> parameter combinations.
        </p>
        <p class="text-xs" style="color:var(--text-3)">
          3 modes × 4 confidence levels × 8 strategy presets — typically completes in &lt;200ms.
        </p>
      </div>

      <!-- Loading -->
      <div v-if="optLoading" class="card p-6">
        <div class="flex flex-col items-center gap-4 py-10">
          <div class="w-10 h-10 rounded-full border-2 spin-bt"
            :style="`border-color:${store.symbolColor}30; border-top-color:${store.symbolColor}`"></div>
          <p class="text-sm" style="color:var(--text-3)">
            Running {{ totalCombos }} combinations on {{ store.activeSymbol }}…
          </p>
        </div>
      </div>

      <!-- Results -->
      <template v-if="optResult && !optLoading">

        <!-- Best-config banner -->
        <div v-if="optResult.best" class="rounded-2xl p-5"
          :style="`background:linear-gradient(135deg, ${store.symbolColor}12, ${store.symbolColor}06); border:1px solid ${store.symbolColor}40`">
          <div class="flex items-start justify-between">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-base">🏆</span>
                <span class="text-xs font-bold uppercase tracking-widest" :style="`color:${store.symbolColor}`">
                  Best Configuration
                </span>
                <span class="text-xs px-2 py-0.5 rounded-full font-mono"
                  :style="`background:${store.symbolColor}20; color:${store.symbolColor}`">
                  Ranked by {{ SORT_OPTS.find(s=>s.key===optResult!.sortBy)?.label ?? optResult.sortBy }}
                </span>
              </div>
              <div class="flex items-center gap-3 flex-wrap">
                <span class="mode-badge" :style="`color:${store.symbolColor}; border-color:${store.symbolColor}50`">
                  {{ optResult.best.mode }}
                </span>
                <span class="mode-badge" style="color:var(--text-2); border-color:var(--border)">
                  conf ≥ {{ (optResult.best.minConfidence*100).toFixed(0) }}%
                </span>
                <span class="mode-badge" style="color:var(--text-2); border-color:var(--border)">
                  {{ optResult.best.strategyPreset }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-6 text-right">
              <div>
                <div class="text-xs mb-0.5" style="color:var(--text-3)">Win Rate</div>
                <div class="font-bold text-lg"
                  :style="optResult.best.stats.winRate>=0.5 ? 'color:var(--green)' : 'color:var(--red)'">
                  {{ (optResult.best.stats.winRate*100).toFixed(1) }}%
                </div>
              </div>
              <div>
                <div class="text-xs mb-0.5" style="color:var(--text-3)">Profit Factor</div>
                <div class="font-bold text-lg" style="color:var(--green)">
                  {{ optResult.best.stats.profitFactor===999 ? '∞' : optResult.best.stats.profitFactor.toFixed(2) }}
                </div>
              </div>
              <div>
                <div class="text-xs mb-0.5" style="color:var(--text-3)">Net PnL</div>
                <div class="font-bold text-lg"
                  :style="optResult.best.stats.totalPnl>=0 ? 'color:var(--green)' : 'color:var(--red)'">
                  {{ optResult.best.stats.totalPnl>=0?'+':'' }}${{ optResult.best.stats.totalPnl.toFixed(2) }}
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <button @click="applyCombo(optResult!.best!)"
                  class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                  :style="`background:${store.symbolColor}; color:#000; cursor:pointer`">
                  ▶ Apply &amp; Run
                </button>
                <button @click="applyToLiveBot(optResult!.best!)"
                  :disabled="applyLiveLoading"
                  class="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border"
                  style="background:var(--bg-card); color:var(--green); border-color:var(--green); cursor:pointer; opacity:1"
                  :style="applyLiveLoading ? 'opacity:0.6;cursor:not-allowed' : ''">
                  <span v-if="applyLiveLoading" class="spin-bt">⟳</span>
                  <span v-else>⚡</span>
                  Apply to Live Bot
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Scrollable results table -->
        <div class="card overflow-hidden">
          <div class="px-5 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--border)">
            <div class="text-xs font-semibold uppercase tracking-widest" style="color:var(--text-3)">
              All {{ optResult.totalRuns }} Results
              <span class="ml-2 font-mono" style="color:var(--text-3); font-weight:400">· {{ optResult.elapsedMs }}ms</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs" style="color:var(--text-3)">Show top</span>
              <button v-for="n in [10,25,96]" :key="n" @click="optShowN = n"
                class="px-2 py-0.5 rounded-lg text-xs transition-all"
                :style="optShowN===n
                  ? `background:${store.symbolColor}22; color:${store.symbolColor}; border:1px solid ${store.symbolColor}55`
                  : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)'">
                {{ n === 96 ? 'All' : n }}
              </button>
            </div>
          </div>
          <div class="overflow-y-auto" style="max-height:520px">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:46px">#</th>
                  <th>Mode</th>
                  <th>Conf</th>
                  <th>Strategy Preset</th>
                  <th>Trades</th>
                  <th>Win %</th>
                  <th>Net PnL</th>
                  <th>Max DD</th>
                  <th>Profit Factor</th>
                  <th style="width:80px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in visibleOptResults" :key="row.rank"
                  :class="row.rank === 1 ? 'opt-best-row' : ''"
                  :style="row.rank === 1 ? `background:${store.symbolColor}08` : ''">
                  <!-- Rank -->
                  <td>
                    <span v-if="row.rank===1"
                      class="flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold"
                      :style="`background:${store.symbolColor}; color:#000`">1</span>
                    <span v-else class="text-xs font-mono" style="color:var(--text-3)">{{ row.rank }}</span>
                  </td>
                  <!-- Mode -->
                  <td>
                    <span class="mode-badge text-xs"
                      :style="row.mode==='WEIGHTED'
                        ? `color:${store.symbolColor}; border-color:${store.symbolColor}40`
                        : row.mode==='FLEX'
                          ? 'color:var(--blue); border-color:#1d4ed860'
                          : 'color:var(--text-2); border-color:var(--border)'">
                      {{ row.mode }}
                    </span>
                  </td>
                  <!-- Confidence -->
                  <td class="font-mono text-xs" style="color:var(--text-2)">
                    {{ (row.minConfidence*100).toFixed(0) }}%
                  </td>
                  <!-- Strategy preset -->
                  <td class="text-xs" style="color:var(--text-2); max-width:160px">
                    {{ row.strategyPreset }}
                  </td>
                  <!-- Trades -->
                  <td class="font-mono text-xs" style="color:var(--text-3)">{{ row.stats.totalTrades }}</td>
                  <!-- Win Rate -->
                  <td>
                    <div class="flex items-center gap-1.5">
                      <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--border); width:36px">
                        <div class="h-full rounded-full"
                          :style="`width:${(row.stats.winRate*100).toFixed(0)}%; background:${row.stats.winRate>=0.5?'var(--green)':'var(--red)'}`">
                        </div>
                      </div>
                      <span class="font-mono text-xs"
                        :style="row.stats.winRate>=0.5?'color:var(--green)':'color:var(--red)'">
                        {{ (row.stats.winRate*100).toFixed(1) }}%
                      </span>
                    </div>
                  </td>
                  <!-- Net PnL -->
                  <td class="font-mono text-xs font-semibold"
                    :style="row.stats.totalPnl>=0?'color:var(--green)':'color:var(--red)'">
                    {{ row.stats.totalPnl>=0?'+':'' }}${{ row.stats.totalPnl.toFixed(2) }}
                  </td>
                  <!-- Max DD -->
                  <td class="font-mono text-xs" style="color:var(--red)">
                    -${{ row.stats.maxDrawdown.toFixed(2) }}
                  </td>
                  <!-- Profit Factor -->
                  <td>
                    <span class="font-mono text-xs font-bold"
                      :style="row.stats.profitFactor>=1.5?'color:var(--green)':row.stats.profitFactor>=1?'color:var(--gold)':'color:var(--red)'">
                      {{ row.stats.profitFactor===999 ? '∞' : row.stats.profitFactor.toFixed(2) }}
                    </span>
                  </td>
                  <!-- Apply buttons -->
                  <td>
                    <div class="flex items-center gap-1.5">
                      <button @click="applyCombo(row)"
                        class="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                        style="background:var(--bg-base); color:var(--text-3); border:1px solid var(--border)"
                        :class="'hover:text-white hover:border-blue-500'"
                        title="Load into Backtest config and re-run">
                        ▶
                      </button>
                      <button @click="applyToLiveBot(row)"
                        :disabled="applyLiveLoading"
                        class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                        style="background:var(--bg-base); color:var(--green); border:1px solid var(--green); cursor:pointer"
                        :style="applyLiveLoading ? 'opacity:0.5;cursor:not-allowed' : ''"
                        title="Save this config to the live bot">
                        ⚡
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </template>
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useBotStore } from '../stores/bot'
import { api } from '../composables/useApi'
import {
  Chart, LineController, LineElement, PointElement, LinearScale,
  Filler, Tooltip, CategoryScale
} from 'chart.js'

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip, CategoryScale)

const store = useBotStore()

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'backtest', icon: '▶', label: 'Backtest'  },
  { id: 'optimize', icon: '⌗', label: 'Optimizer' },
] as const
type TabId = typeof TABS[number]['id']
const activeTab = ref<TabId>('backtest')

// ─── Optimizer sort options ───────────────────────────────────────────────────
const SORT_OPTS = [
  { key: 'profitFactor', label: 'Profit Factor' },
  { key: 'winRate',      label: 'Win Rate'      },
  { key: 'totalPnl',     label: 'Net PnL'       },
  { key: 'totalTrades',  label: 'Most Trades'   },
] as const

const PRESET_NAMES = [
  'Core', 'Core + Session', 'Core + OrderBlock', 'Core + MarketStructure',
  'All Strategies', 'Sweep + MA Only', 'FVG + MA Only', 'All + No Session',
]

const totalCombos = 3 * 4 * 8  // modes × confidences × presets

// ─── Shared config ────────────────────────────────────────────────────────────
const showConfig    = ref(true)
const initialEquity = ref(10_000)
const minConfPct    = ref(40)
const optSortBy     = ref<'profitFactor'|'winRate'|'totalPnl'|'totalTrades'>('profitFactor')

const cfg = reactive({ engine: { mode: 'WEIGHTED' as 'STRICT'|'FLEX'|'WEIGHTED' } })

const strategyList = reactive([
  { key: 'liquiditySweep',  label: 'Liquidity Sweep',  enabled: true  },
  { key: 'fairValueGap',    label: 'Fair Value Gap',    enabled: true  },
  { key: 'maFilter',        label: 'MA Filter',         enabled: true  },
  { key: 'orderBlock',      label: 'Order Block',       enabled: false },
  { key: 'marketStructure', label: 'Market Structure',  enabled: false },
  { key: 'sessionFilter',   label: 'Session Filter',    enabled: store.activeSymbol === 'XAUUSD' },
])

watch(() => store.activeSymbol, (sym) => {
  const sf = strategyList.find(s => s.key === 'sessionFilter')
  if (sf) sf.enabled = sym === 'XAUUSD'
  result.value    = null
  optResult.value = null
  runError.value  = null
})

// ─── Backtest state ───────────────────────────────────────────────────────────
interface BtResult {
  trades:        Array<{ direction: string; openPrice: number; closePrice: number; pnl: number; outcome: 'win'|'loss'; strategies: string[]; confidence: number }>
  stats:         { totalTrades: number; wins: number; losses: number; winRate: number; totalPnl: number; maxDrawdown: number; avgTradePnl: number; profitFactor: number; avgConfidence: number }
  equityCurve:   Array<{ time: number; equity: number; drawdown: number }>
  strategyStats: Record<string, { signals: number; wins: number; losses: number; winRate: number }>
  candleCount:   number
  elapsedMs:     number
}

const result   = ref<BtResult | null>(null)
const loading  = ref(false)
const runError = ref<string | null>(null)

async function doRun() {
  loading.value  = true
  runError.value = null
  const strategiesOverride: Record<string, { enabled: boolean }> = {}
  for (const s of strategyList) strategiesOverride[s.key] = { enabled: s.enabled }

  try {
    const data = await api.post<BtResult & { ok: boolean }>(
      store.symQ('/backtest'),
      {
        initialEquity: initialEquity.value,
        config: {
          engine:     { mode: cfg.engine.mode, minConfidence: minConfPct.value / 100 },
          strategies: strategiesOverride,
        },
      },
    )
    if (!data.ok) throw new Error('Backtest failed')
    result.value     = data
    showConfig.value = false
    await nextTick()
    buildChart()
  } catch (e) {
    runError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const recentTrades = computed(() =>
  result.value ? [...result.value.trades].reverse().slice(0, 30) : []
)
function fmtPrice(v: number) {
  return store.activeSymbol === 'BTCUSD'
    ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v.toFixed(2)
}

// ─── Equity chart ──────────────────────────────────────────────────────────────
const chartCanvas = ref<HTMLCanvasElement | null>(null)
let chartInstance: Chart | null = null

function buildChart() {
  if (!result.value || !chartCanvas.value) return
  if (chartInstance) { chartInstance.destroy(); chartInstance = null }

  const curve        = result.value.equityCurve
  const labels       = curve.map(p => {
    const d = new Date(p.time * 1000)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  })
  const equityData   = curve.map(p => p.equity)
  const drawdownData = curve.map(p => -p.drawdown)
  const symColor     = store.activeSymbol === 'BTCUSD' ? '#3b82f6' : '#f5c142'

  chartInstance = new Chart(chartCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Equity',   data: equityData,   borderColor: symColor,   backgroundColor: symColor + '18', fill: 'origin', tension: 0.3, pointRadius: 0, borderWidth: 2,   yAxisID: 'y',  order: 1 },
        { label: 'Drawdown', data: drawdownData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)', fill: 'origin', tension: 0.3, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y2', order: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a', borderColor: '#1e293b', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#e2e8f0', padding: 10,
          callbacks: {
            label: (ctx) => {
              const y = ctx.parsed.y ?? 0
              return ctx.datasetIndex === 0
                ? `  Equity: $${y.toFixed(2)}`
                : `  Drawdown: -$${Math.abs(y).toFixed(2)}`
            },
          },
        },
      },
      scales: {
        x:  { ticks: { color: '#475569', font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y:  { position: 'left',  ticks: { color: symColor,   font: { size: 10 }, callback: v => `$${Number(v).toLocaleString()}` }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y2: { position: 'right', ticks: { color: '#ef4444', font: { size: 10 }, callback: v => `-$${Math.abs(Number(v)).toLocaleString()}` }, grid: { display: false }, min: Math.min(...drawdownData) * 1.2, max: 0 },
      },
    },
  })
}

// ─── Optimizer state ──────────────────────────────────────────────────────────
interface OptCombo {
  rank:           number
  mode:           string
  minConfidence:  number
  strategyPreset: string
  strategyConfig: Record<string, boolean>
  stats:          { totalTrades: number; wins: number; losses: number; winRate: number; totalPnl: number; maxDrawdown: number; avgTradePnl: number; profitFactor: number; avgConfidence: number }
}
interface OptResult {
  results:   OptCombo[]
  best:      OptCombo | null
  totalRuns: number
  elapsedMs: number
  sortBy:    string
}

const optResult  = ref<OptResult | null>(null)
const optLoading = ref(false)
const optShowN   = ref(25)

const visibleOptResults = computed(() =>
  optResult.value?.results.slice(0, optShowN.value) ?? []
)

async function doOptimize() {
  optLoading.value = true
  runError.value   = null
  try {
    const data = await api.post<OptResult & { ok: boolean }>(
      store.symQ('/optimize'),
      { initialEquity: initialEquity.value, sortBy: optSortBy.value },
    )
    if (!data.ok) throw new Error('Optimizer failed')
    optResult.value  = data
    showConfig.value = false
  } catch (e) {
    runError.value = e instanceof Error ? e.message : String(e)
  } finally {
    optLoading.value = false
  }
}

/** Load an optimizer result into the single-backtest config and run it. */
function applyCombo(combo: OptCombo) {
  cfg.engine.mode = combo.mode as any
  minConfPct.value = Math.round(combo.minConfidence * 100)
  for (const s of strategyList) {
    s.enabled = combo.strategyConfig[s.key] ?? false
  }
  activeTab.value  = 'backtest'
  showConfig.value = true
  nextTick(() => doRun())
}

// ─── Apply to Live Bot ────────────────────────────────────────────────────────

const applyLiveLoading = ref(false)
const applyLiveToast   = ref<{ ok: boolean; msg: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

async function applyToLiveBot(combo: OptCombo) {
  if (applyLiveLoading.value) return
  applyLiveLoading.value = true
  applyLiveToast.value   = null

  // Build strategies object in the shape PUT /api/bot/config expects
  const strategies: Record<string, { enabled: boolean }> = {}
  for (const [key, enabled] of Object.entries(combo.strategyConfig)) {
    strategies[key] = { enabled }
  }

  try {
    const data = await api.put<{ ok: boolean; error?: string }>(
      store.symQ('/config'),
      {
        engine: {
          mode:          combo.mode,
          minConfidence: combo.minConfidence,
          weightThreshold: combo.minConfidence,
        },
        strategies,
      },
    )
    if (!data.ok) throw new Error(data.error ?? 'Config update failed')

    // Refresh the local store so the Config page reflects the new values
    await store.fetchConfig()

    applyLiveToast.value = {
      ok:  true,
      msg: `Live bot updated → ${combo.mode} · conf ≥ ${Math.round(combo.minConfidence * 100)}% · ${combo.strategyPreset}`,
    }
  } catch (e) {
    applyLiveToast.value = {
      ok:  false,
      msg: e instanceof Error ? e.message : String(e),
    }
  } finally {
    applyLiveLoading.value = false
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { applyLiveToast.value = null }, 5000)
  }
}

onBeforeUnmount(() => { if (chartInstance) chartInstance.destroy() })
</script>

<style scoped>
.kpi-label { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--text-3); margin-bottom:4px; }
.kpi-value { font-size:22px; font-weight:700; line-height:1.1; }
.kpi-sub   { font-size:11px; color:var(--text-3); margin-top:3px; }

.mode-badge {
  display:inline-block; padding:2px 8px; border-radius:9999px;
  font-size:10px; font-weight:700; font-family:monospace; letter-spacing:.04em;
  border:1px solid;
}

@keyframes spin-anim { to { transform: rotate(360deg); } }
.spin-bt { display:inline-block; animation: spin-anim 0.9s linear infinite; }

.toast-slide-enter-active,
.toast-slide-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.toast-slide-enter-from,
.toast-slide-leave-to   { opacity: 0; transform: translateX(-50%) translateY(12px); }
</style>
