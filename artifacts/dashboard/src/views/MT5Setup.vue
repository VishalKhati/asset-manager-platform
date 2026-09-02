<template>
  <div class="p-6 max-w-3xl mx-auto space-y-5">

    <div>
      <h1 class="text-lg font-bold">MT5 Bridge Setup</h1>
      <p class="text-xs mt-0.5" style="color:var(--text-3)">
        Connect your local MetaTrader 5 to this bot so it can execute real trades.
      </p>
    </div>

    <!-- Connection status card -->
    <section class="card p-5">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-bold mb-0.5">Bridge Connection</div>
          <div v-if="bridgeStatus.connected" class="text-xs" style="color:var(--text-3)">
            Last ping: {{ relativeTime(bridgeStatus.lastPing) }} &nbsp;·&nbsp; v{{ bridgeStatus.version }}
          </div>
          <div v-else-if="bridgeStatus.lastPing" class="text-xs" style="color:var(--text-3)">
            Last seen: {{ relativeTime(bridgeStatus.lastPing) }} — bridge may be offline
          </div>
          <div v-else class="text-xs" style="color:var(--text-3)">
            bridge.js has never connected to this symbol
          </div>
        </div>
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl"
          :style="bridgeStatus.connected
            ? 'background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.2)'
            : 'background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2)'">
          <span class="w-2 h-2 rounded-full"
            :style="bridgeStatus.connected ? 'background:var(--green)' : 'background:#ef4444'"></span>
          <span class="text-xs font-bold"
            :style="bridgeStatus.connected ? 'color:var(--green)' : 'color:#ef4444'">
            {{ bridgeStatus.connected ? 'CONNECTED' : 'OFFLINE' }}
          </span>
        </div>
      </div>
    </section>

    <!-- Symbol selector for bridge config -->
    <div class="flex items-center gap-3">
      <span class="text-sm font-medium" style="color:var(--text-2)">Configuring bridge for:</span>
      <div class="flex gap-1">
        <button v-for="s in (['XAUUSD','BTCUSD'] as const)" :key="s"
          @click="configSymbol = s"
          class="px-3 py-1 rounded-lg text-xs font-bold transition-all"
          :style="configSymbol === s
            ? (s === 'BTCUSD' ? 'background:rgba(59,130,246,0.15); color:var(--blue); border:1px solid rgba(59,130,246,0.4)' : 'background:rgba(245,193,66,0.12); color:var(--gold); border:1px solid rgba(245,193,66,0.4)')
            : 'background:var(--bg-card); color:var(--text-3); border:1px solid var(--border)'">
          {{ s === 'BTCUSD' ? '₿ BTC' : '⚡ GOLD' }}
        </button>
      </div>
    </div>

    <!-- Step 1: Install Node bridge -->
    <section class="card p-5 space-y-4">
      <StepHeader n="1" title="Install & configure bridge.js" subtitle="Runs on your local PC alongside MT5" />

      <div class="text-xs space-y-1.5" style="color:var(--text-2)">
        <p>The bridge is a small Node.js script (included in the <code class="font-mono px-1 py-0.5 rounded" style="background:var(--bg-base)">mt5_bridge/</code> folder). Run it on the same machine as MT5.</p>
        <p>Requirements: <span class="font-mono" style="color:var(--gold)">Node.js ≥ 18</span></p>
      </div>

      <div class="space-y-1">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold" style="color:var(--text-3)">mt5_bridge/.env</span>
          <button @click="copy(envFileContent, 'env')"
            class="text-xs px-2.5 py-1 rounded-lg transition-all"
            style="background:var(--bg-base); border:1px solid var(--border); color:var(--text-2)">
            {{ copied === 'env' ? '✓ Copied' : 'Copy' }}
          </button>
        </div>
        <pre class="text-xs p-3 rounded-xl overflow-x-auto leading-5"
          style="background:var(--bg-base); border:1px solid var(--border-dim); color:var(--text-2); font-family:monospace">{{ envFileContent }}</pre>
      </div>

      <div class="text-xs p-3 rounded-xl" style="background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.15); color:#93c5fd">
        <strong>API_TOKEN options:</strong><br>
        · <strong>Option A</strong> — use <code class="font-mono">BOT_API_TOKEN</code> from your Replit Secrets (permanent, never expires).<br>
        · <strong>Option B</strong> — use your personal token below (expires in 30 days, trades show in your account).
      </div>

      <!-- Personal bridge token -->
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold" style="color:var(--text-3)">Your personal bridge token (Option B)</span>
          <button @click="copy(personalToken, 'jwt')"
            class="text-xs px-2.5 py-1 rounded-lg transition-all"
            style="background:var(--bg-base); border:1px solid var(--border); color:var(--text-2)">
            {{ copied === 'jwt' ? '✓ Copied' : 'Copy' }}
          </button>
        </div>
        <div class="font-mono text-xs px-3 py-2.5 rounded-xl break-all"
          style="background:var(--bg-base); border:1px solid var(--border-dim); color:var(--text-3)">
          {{ personalToken || 'Not logged in' }}
        </div>
      </div>

      <CodeBlock label="Install & start bridge" :code="`cd mt5_bridge\ncp .env.example .env\n# Edit .env with your values above\nnode bridge.js`" />
    </section>

    <!-- Step 2: Install MT5 EA -->
    <section class="card p-5 space-y-4">
      <StepHeader n="2" title="Install the Expert Advisor in MT5" subtitle="One-time setup in MetaTrader 5" />

      <ol class="space-y-2.5 text-xs" style="color:var(--text-2)">
        <li class="flex gap-2.5">
          <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold" style="background:rgba(245,193,66,0.15); color:var(--gold)">1</span>
          <span>Open MetaTrader 5 → <strong>File → Open Data Folder</strong></span>
        </li>
        <li class="flex gap-2.5">
          <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold" style="background:rgba(245,193,66,0.15); color:var(--gold)">2</span>
          <span>Navigate to <code class="font-mono px-1 rounded" style="background:var(--bg-base)">MQL5\Experts\</code> and copy <code class="font-mono px-1 rounded" style="background:var(--bg-base)">mt5_connector.mq5</code> there. Rename it <code class="font-mono px-1 rounded" style="background:var(--bg-base)">smc_bridge.mq5</code></span>
        </li>
        <li class="flex gap-2.5">
          <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold" style="background:rgba(245,193,66,0.15); color:var(--gold)">3</span>
          <span>Press <kbd class="px-1.5 py-0.5 rounded text-xs font-mono" style="background:var(--bg-base); border:1px solid var(--border)">F4</kbd> to open MetaEditor → open <code class="font-mono px-1 rounded" style="background:var(--bg-base)">smc_bridge.mq5</code> → press <kbd class="px-1.5 py-0.5 rounded text-xs font-mono" style="background:var(--bg-base); border:1px solid var(--border)">F7</kbd> to compile</span>
        </li>
        <li class="flex gap-2.5">
          <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold" style="background:rgba(245,193,66,0.15); color:var(--gold)">4</span>
          <span>Open a <strong>{{ configSymbol === 'BTCUSD' ? 'BTCUSD' : 'XAUUSD' }} M5</strong> chart. Drag <code class="font-mono px-1 rounded" style="background:var(--bg-base)">smc_bridge</code> from the Navigator pane onto it</span>
        </li>
        <li class="flex gap-2.5">
          <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold" style="background:rgba(245,193,66,0.15); color:var(--gold)">5</span>
          <span>In the EA settings dialog, configure the inputs below</span>
        </li>
      </ol>

      <!-- EA input settings table -->
      <div class="rounded-xl overflow-hidden" style="border:1px solid var(--border)">
        <table class="w-full text-xs">
          <thead>
            <tr style="background:var(--bg-base); border-bottom:1px solid var(--border)">
              <th class="text-left px-4 py-2.5 font-semibold" style="color:var(--text-3)">EA Input</th>
              <th class="text-left px-4 py-2.5 font-semibold" style="color:var(--text-3)">Value</th>
              <th class="text-left px-4 py-2.5 font-semibold" style="color:var(--text-3)">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in eaInputs" :key="row.name"
              class="border-b" style="border-color:var(--border-dim)">
              <td class="px-4 py-2.5 font-mono" style="color:var(--gold)">{{ row.name }}</td>
              <td class="px-4 py-2.5">
                <span class="font-mono px-1.5 py-0.5 rounded text-xs"
                  style="background:var(--bg-base); color:var(--text-1)">{{ row.value }}</span>
              </td>
              <td class="px-4 py-2.5" style="color:var(--text-3)">{{ row.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="text-xs p-3 rounded-xl" style="background:rgba(245,193,66,0.05); border:1px solid rgba(245,193,66,0.15); color:#d4a700">
        <strong>BrokerSymbol</strong> is the most common setup issue. Check your broker's Market Watch window to find the exact symbol name. Common variants: <code class="font-mono">XAUUSD</code> · <code class="font-mono">XAUUSDm</code> · <code class="font-mono">XAUUSD.</code> · <code class="font-mono">GOLD</code>
      </div>
    </section>

    <!-- Step 3: IPC path -->
    <section class="card p-5 space-y-4">
      <StepHeader n="3" title="Set the IPC folder path" subtitle="The folder bridge.js and MT5 EA share" />

      <div class="text-xs space-y-2" style="color:var(--text-2)">
        <p>Both bridge.js (<code class="font-mono">IPC_DIR</code>) and the MT5 EA (<code class="font-mono">IpcFolder</code>) must point to the same folder. The EA always uses a path relative to <code class="font-mono">MQL5\Files\</code>, so:</p>
      </div>

      <div class="space-y-3">
        <div>
          <div class="text-xs font-semibold mb-1" style="color:var(--text-3)">MT5 EA input (IpcFolder) — always just:</div>
          <CopyLine value="smc_bridge" />
        </div>
        <div>
          <div class="text-xs font-semibold mb-1" style="color:var(--text-3)">IPC_DIR in bridge .env — full path to the same folder:</div>
          <CopyLine value="C:\Users\YourName\AppData\Roaming\MetaQuotes\Terminal\<HASH>\MQL5\Files\smc_bridge" />
        </div>
      </div>

      <div class="text-xs p-3 rounded-xl space-y-1.5" style="background:var(--bg-base); border:1px solid var(--border-dim)">
        <div class="font-semibold mb-1" style="color:var(--text-2)">How to find your MT5 data folder:</div>
        <div style="color:var(--text-3)">1. In MetaTrader 5: <strong>File → Open Data Folder</strong></div>
        <div style="color:var(--text-3)">2. The folder that opens is your MT5 data root</div>
        <div style="color:var(--text-3)">3. Navigate into <code class="font-mono">MQL5\Files\</code></div>
        <div style="color:var(--text-3)">4. The <code class="font-mono">smc_bridge</code> folder will be created automatically when the EA initializes</div>
        <div style="color:var(--text-3)">5. Copy that full path and set it as <code class="font-mono">IPC_DIR</code></div>
      </div>
    </section>

    <!-- Step 4: Enable trading + final check -->
    <section class="card p-5 space-y-4">
      <StepHeader n="4" title="Enable automated trading" subtitle="Required MT5 permissions" />

      <div class="grid grid-cols-1 gap-2">
        <div v-for="item in permissions" :key="item.label"
          class="flex items-center gap-3 p-3 rounded-xl"
          style="background:var(--bg-base); border:1px solid var(--border-dim)">
          <span style="color:var(--green)">✓</span>
          <div>
            <div class="text-xs font-semibold" style="color:var(--text-1)">{{ item.label }}</div>
            <div class="text-xs" style="color:var(--text-3)">{{ item.where }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Step 5: Verify -->
    <section class="card p-5 space-y-4">
      <StepHeader n="5" title="Verify the connection" subtitle="What to expect after everything is running" />

      <div class="grid grid-cols-2 gap-3">
        <div v-for="check in verifyChecks" :key="check.label"
          class="p-3 rounded-xl"
          style="background:var(--bg-base); border:1px solid var(--border-dim)">
          <div class="text-xs font-semibold mb-0.5" style="color:var(--text-1)">{{ check.label }}</div>
          <div class="text-xs" style="color:var(--text-3)">{{ check.desc }}</div>
        </div>
      </div>

      <div class="text-xs p-3 rounded-xl" style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.15); color:#fca5a5">
        <strong>Demo → Live upgrade checklist:</strong><br>
        ① Set <code class="font-mono">TRADE_MODE=live</code> in bridge .env<br>
        ② Set <code class="font-mono">DemoMode=false</code> in MT5 EA inputs<br>
        ③ Test on a <strong>demo account</strong> first even in "live" mode<br>
        ④ Set bot mode to <strong>Live</strong> on the Dashboard page
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, defineComponent, h } from 'vue'
import { useBotStore } from '../stores/bot'

// ── Inline sub-components (available to this template via script setup) ────────
const StepHeader = defineComponent({
  props: { n: String, title: String, subtitle: String },
  setup(props) {
    return () => h('div', { class: 'flex items-center gap-3 mb-1' }, [
      h('div', {
        class: 'flex items-center justify-center w-7 h-7 rounded-xl shrink-0 text-xs font-black',
        style: 'background:linear-gradient(135deg,#a37f10,#f5c142); color:#060b14',
      }, props.n),
      h('div', {}, [
        h('div', { class: 'text-sm font-bold', style: 'color:var(--text-1)' }, props.title),
        h('div', { class: 'text-xs', style: 'color:var(--text-3)' }, props.subtitle),
      ]),
    ])
  },
})

const CodeBlock = defineComponent({
  props: { label: String, code: String },
  setup(props) {
    return () => h('div', {}, [
      h('div', { class: 'text-xs font-semibold mb-1', style: 'color:var(--text-3)' }, props.label),
      h('pre', {
        class: 'text-xs p-3 rounded-xl overflow-x-auto leading-5',
        style: 'background:var(--bg-base); border:1px solid var(--border-dim); color:#7dd3fc; font-family:monospace',
      }, props.code),
    ])
  },
})

const CopyLine = defineComponent({
  props: { value: String },
  setup(props) {
    return () => h('div', {
      class: 'flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all',
      style: 'background:var(--bg-base); border:1px solid var(--border-dim)',
      onClick: async () => { await navigator.clipboard.writeText(props.value ?? '') },
    }, [
      h('code', { class: 'text-xs flex-1 break-all', style: 'color:var(--gold); font-family:monospace' }, props.value),
      h('span', { class: 'text-xs shrink-0', style: 'color:var(--text-3)' }, '📋'),
    ])
  },
})

const store = useBotStore()

const configSymbol = ref<'XAUUSD' | 'BTCUSD'>(store.activeSymbol)
const copied       = ref<string | null>(null)
const bridgeStatus = ref({ connected: false, lastPing: null as string | null, version: null as string | null })

// ── Personal bridge token (JWT from localStorage) ─────────────────────────────
const personalToken = computed(() => localStorage.getItem('smc_jwt') ?? '')

// ── API URL ───────────────────────────────────────────────────────────────────
const apiUrl = computed(() => {
  const origin = window.location.origin
  return `${origin}/api`
})

// ── .env file content ─────────────────────────────────────────────────────────
const envFileContent = computed(() => `API_BASE_URL=${apiUrl.value}
API_TOKEN=<your_BOT_API_TOKEN_from_Replit_Secrets>
SYMBOL=${configSymbol.value}
IPC_DIR=C:\\Users\\YourName\\AppData\\Roaming\\MetaQuotes\\Terminal\\<HASH>\\MQL5\\Files\\smc_bridge
TRADE_MODE=demo
MIN_CONFIDENCE=0.70
POLL_INTERVAL_MS=30000`)

// ── EA input table ────────────────────────────────────────────────────────────
const eaInputs = computed(() => [
  { name: 'IpcFolder',    value: 'smc_bridge',    note: 'Subfolder inside MQL5/Files/ — do not change' },
  { name: 'BrokerSymbol', value: configSymbol.value === 'BTCUSD' ? 'BTCUSD (check broker)' : 'XAUUSD (check broker)', note: 'Exact name as shown in Market Watch' },
  { name: 'DemoMode',     value: 'true',          note: 'Keep true until ready for live trading' },
  { name: 'DefaultLots',  value: configSymbol.value === 'BTCUSD' ? '0.001' : '0.01',  note: 'Fallback lot size if not in signal' },
  { name: 'MagicNumber',  value: '20250502',       note: 'Unique ID for this EA\'s trades' },
  { name: 'Slippage',     value: '30',             note: 'Max slippage in points' },
])

const permissions = [
  { label: 'Allow Automated Trading',  where: 'MT5 toolbar (robot icon) must be green' },
  { label: 'Allow DLL Imports',        where: 'EA Properties → Common tab' },
  { label: 'Allow Live Trading',       where: 'EA Properties → Common tab' },
  { label: 'Allow File Operations',    where: 'Granted by default in MT5' },
]

const verifyChecks = [
  { label: 'bridge.js console',        desc: 'Should say "API connected" and "Bridge is running"' },
  { label: 'MT5 EA comment',           desc: 'Chart should show "SMC Bridge | Connected"' },
  { label: 'Connection status above',  desc: 'This page shows CONNECTED in green' },
  { label: 'System Logs page',         desc: 'Should show "[Bridge] Signal forwarded" entries' },
]

// ── Clipboard helper ──────────────────────────────────────────────────────────
async function copy(text: string, key: string) {
  await navigator.clipboard.writeText(text)
  copied.value = key
  setTimeout(() => { copied.value = null }, 2000)
}

// ── Bridge status polling ─────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const res = await fetch(`/api/bot/bridge-status?symbol=${configSymbol.value}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('smc_jwt') ?? ''}` }
    })
    if (res.ok) bridgeStatus.value = await res.json()
  } catch { /* silent */ }
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

let pollTimer: ReturnType<typeof setInterval>

onMounted(() => {
  fetchStatus()
  pollTimer = setInterval(fetchStatus, 15_000)
})
onUnmounted(() => clearInterval(pollTimer))
</script>

