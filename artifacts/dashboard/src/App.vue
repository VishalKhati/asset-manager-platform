<template>
  <div class="flex h-screen overflow-hidden" style="background:var(--bg-base)">

    <!-- ── Offline / API error banner ──────────────────────────────────── -->
    <transition name="slide-down">
      <div v-if="offline"
        class="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 py-2 text-xs font-bold"
        style="background:#7f1d1d; color:#fca5a5; border-bottom:1px solid #991b1b">
        ⚠ API unreachable — retrying…
      </div>
    </transition>

    <!-- ── Sidebar (hidden on login page) ─────────────────────────────── -->
    <aside v-if="route.path !== '/login'"
      class="sidebar flex flex-col shrink-0"
      style="width:220px; background:#090d18; border-right:1px solid var(--border)">

      <!-- Logo + Symbol Switcher -->
      <div class="px-4 py-4" style="border-bottom:1px solid var(--border-dim)">
        <div class="flex items-center gap-2.5 mb-3">
          <div class="flex items-center justify-center w-8 h-8 rounded-xl shrink-0 pulse-gold"
            :style="`background:linear-gradient(135deg,${store.activeSymbol === 'BTCUSD' ? '#1d4ed8,#3b82f6' : '#a37f10,#f5c142'}); font-size:15px`">
            {{ store.symbolIcon }}
          </div>
          <div>
            <div class="font-bold text-xs tracking-tight" :style="`color:${store.symbolColor}`">SMC Bot</div>
            <div class="text-xs" style="color:var(--text-3)">Smart Money Concepts</div>
          </div>
        </div>

        <!-- Symbol tabs -->
        <div class="grid grid-cols-2 gap-1 p-1 rounded-xl" style="background:var(--bg-base); border:1px solid var(--border-dim)">
          <button v-for="sym in symbols" :key="sym.value"
            @click="switchSymbol(sym.value)"
            class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all"
            :style="store.activeSymbol === sym.value
              ? `background:${sym.bg}; color:${sym.color}; box-shadow:0 1px 8px ${sym.glow}`
              : 'color:var(--text-3)'">
            <span style="font-size:11px">{{ sym.icon }}</span>
            {{ sym.label }}
          </button>
        </div>
      </div>

      <!-- Nav -->
      <nav class="flex-1 p-3 space-y-1 pt-4">
        <router-link v-for="link in navLinks" :key="link.to" :to="link.to"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
          :class="$route.path === link.to ? 'nav-active' : 'nav-item'">
          <span class="text-base leading-none">{{ link.icon }}</span>
          <span>{{ link.label }}</span>
        </router-link>
      </nav>

      <!-- Bot status -->
      <div class="px-4 pb-3" style="border-top:1px solid var(--border-dim)">
        <div class="rounded-xl p-3 mt-3" style="background:var(--bg-card); border:1px solid var(--border)">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold" style="color:var(--text-3)">BOT STATUS</span>
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full pulse-dot"
                :style="store.running ? 'background:var(--green)' : 'background:var(--text-3)'"></span>
              <span class="text-xs font-bold"
                :style="store.running ? 'color:var(--green)' : 'color:var(--text-3)'">
                {{ store.running ? 'RUNNING' : 'STOPPED' }}
              </span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs" style="color:var(--text-3)">Mode</span>
            <span class="text-xs font-mono font-bold" style="color:var(--blue)">{{ store.mode?.toUpperCase() }}</span>
          </div>
          <div class="flex items-center justify-between mt-1">
            <span class="text-xs" style="color:var(--text-3)">Trades today</span>
            <span class="text-xs font-mono font-bold" :style="`color:${store.symbolColor}`">{{ store.tradesToday }}</span>
          </div>
        </div>
      </div>

      <!-- User block + logout -->
      <div class="px-4 pb-4">
        <div class="flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style="background:rgba(255,255,255,0.03); border:1px solid var(--border-dim)">
          <div class="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 text-xs font-bold"
            :style="auth.user?.role === 'admin'
              ? 'background:linear-gradient(135deg,#a37f10,#f5c142); color:#060b14'
              : 'background:linear-gradient(135deg,#1e3a6e,#3b82f6); color:#93c5fd'">
            {{ auth.user?.username?.charAt(0).toUpperCase() ?? '?' }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold truncate" style="color:var(--text-1)">{{ auth.user?.username }}</div>
            <div class="text-xs" :style="auth.user?.role === 'admin' ? 'color:var(--gold)' : 'color:var(--text-3)'">
              {{ auth.user?.role ?? 'user' }}
            </div>
          </div>
          <button @click="handleLogout" title="Logout"
            class="text-xs px-2 py-1 rounded-lg transition-all hover:text-red-400"
            style="color:var(--text-3); border:1px solid transparent"
            @mouseenter="e => (e.currentTarget as HTMLElement).style.borderColor='rgba(239,68,68,0.3)'"
            @mouseleave="e => (e.currentTarget as HTMLElement).style.borderColor='transparent'">
            ⏻
          </button>
        </div>
      </div>
    </aside>

    <!-- ── Main area ───────────────────────────────────────────────────── -->
    <div class="flex flex-col flex-1 min-w-0">

      <!-- Top bar (hidden on login page) -->
      <header v-if="route.path !== '/login'"
        class="flex items-center justify-between px-6 h-14 shrink-0"
        style="background:#090d18; border-bottom:1px solid var(--border)">

        <div class="font-semibold text-sm" style="color:var(--text-1)">
          {{ currentPageTitle }}
        </div>

        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold font-mono"
            :style="`background:${store.activeSymbol === 'BTCUSD' ? 'rgba(59,130,246,0.1)' : 'rgba(245,193,66,0.08)'}; color:${store.symbolColor}; border:1px solid ${store.activeSymbol === 'BTCUSD' ? 'rgba(59,130,246,0.25)' : 'rgba(245,193,66,0.2)'}`">
            {{ store.activeSymbol }}
          </div>

          <div v-if="store.price" class="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style="background:var(--bg-card); border:1px solid var(--border)">
            <span class="w-1.5 h-1.5 rounded-full pulse-dot" :style="`background:${store.symbolColor}`"></span>
            <span class="font-mono font-bold" :style="`color:${store.symbolColor}; font-size:13px`">
              {{ store.activeSymbol === 'BTCUSD'
                  ? store.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                  : store.price.toFixed(2) }}
            </span>
            <span class="text-xs" style="color:var(--text-3)">USD</span>
          </div>
          <div v-else class="px-3 py-1.5 rounded-lg text-xs font-mono"
            style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-3)">
            Loading...
          </div>

          <div v-if="lastScan" class="text-xs" style="color:var(--text-3)">
            Scanned {{ lastScan }}
          </div>

          <button @click="manualScan" :disabled="store.loading"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-2)"
            :class="store.loading ? 'opacity-50' : 'hover:border-blue-500 hover:text-blue-400'">
            <span :class="store.loading ? 'spin-once' : ''">↻</span>
            {{ store.loading ? 'Scanning…' : 'Scan' }}
          </button>
        </div>
      </header>

      <main class="flex-1 overflow-auto">
        <router-view />
      </main>
    </div>

    <!-- Error toast -->
    <transition name="fade">
      <div v-if="store.error"
        class="fixed bottom-5 right-5 flex items-center gap-3 px-4 py-3 rounded-xl text-sm z-50"
        style="background:#1c0a0a; color:#fca5a5; border:1px solid #7f1d1d; box-shadow:0 8px 32px rgba(0,0,0,0.5)">
        <span>⚠ {{ store.error }}</span>
        <button @click="store.error = null"
          class="opacity-60 hover:opacity-100 transition-opacity text-base leading-none">✕</button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBotStore, type SupportedSymbol } from './stores/bot'
import { useAuthStore } from './stores/auth'

const store  = useBotStore()
const auth   = useAuthStore()
const route  = useRoute()
const router = useRouter()
const lastScan = ref('')
const offline  = ref(false)

const symbols = [
  { value: 'XAUUSD' as SupportedSymbol, label: 'GOLD', icon: '⚡', color: 'var(--gold)', bg: 'rgba(245,193,66,0.12)', glow: 'rgba(245,193,66,0.2)' },
  { value: 'BTCUSD' as SupportedSymbol, label: 'BTC',  icon: '₿',  color: 'var(--blue)', bg: 'rgba(59,130,246,0.15)', glow: 'rgba(59,130,246,0.25)' },
]

const isAdmin = computed(() => auth.user?.role === 'admin')

const navLinks = computed(() => [
  { to: '/',               icon: '◈', label: 'Dashboard'     },
  { to: '/history',        icon: '◉', label: 'Trade History'  },
  { to: '/backtest',       icon: '⌗', label: 'Backtesting'    },
  { to: '/logs',           icon: '≡', label: 'System Logs'    },
  { to: '/config',         icon: '◎', label: 'Configuration'  },
  { to: '/notifications',  icon: '🔔', label: 'Notifications'  },
  { to: '/alerts',         icon: '⚑',  label: 'Price Alerts'   },
  { to: '/mt5-setup',      icon: '⬡', label: 'MT5 Setup'      },
  ...(isAdmin.value ? [{ to: '/admin', icon: '⊛', label: 'Admin Panel' }] : []),
])

const pageTitles: Record<string, string> = {
  '/':               'Live Dashboard',
  '/history':        'Trade History',
  '/backtest':       'Backtesting Engine',
  '/logs':           'System Logs',
  '/config':         'Configuration',
  '/mt5-setup':      'MT5 Bridge Setup',
  '/notifications':  'Notifications',
  '/alerts':         'Price Alerts',
  '/admin':          'Admin Panel',
}

const currentPageTitle = computed(() => pageTitles[route.path] ?? 'SMC Bot')

function handleLogout() {
  auth.logout()
  router.push('/login')
}

async function switchSymbol(sym: SupportedSymbol) {
  store.setSymbol(sym)
  lastScan.value = new Date().toLocaleTimeString()
}

async function manualScan() {
  await store.fetchSignal()
  await store.fetchStatus()
  lastScan.value = new Date().toLocaleTimeString()
}

// ── Session health check — refresh user role + detect suspension ──────────────
let sessionCheckInterval: ReturnType<typeof setInterval>

async function checkSession() {
  if (!auth.isAuthenticated || route.path === '/login') return
  const ok = await auth.refreshUser()
  if (!ok) {
    // Account suspended or token revoked
    router.push('/login')
  }
}

// ── Offline detection ─────────────────────────────────────────────────────────
async function checkOnline() {
  try {
    const res = await fetch('/api/healthz', { cache: 'no-store' })
    offline.value = !res.ok
  } catch {
    offline.value = true
  }
}

let offlineInterval: ReturnType<typeof setInterval>

// ── Polling ───────────────────────────────────────────────────────────────────
let intervalId: ReturnType<typeof setInterval>

watch(
  () => route.path,
  (path) => {
    clearInterval(intervalId)
    if (path === '/login' || !auth.isAuthenticated) return
    void Promise.all([store.fetchStatus(), store.fetchConfig()])
    void store.fetchSignal().then(() => { lastScan.value = new Date().toLocaleTimeString() })
    intervalId = setInterval(async () => {
      await store.fetchSignal()
      await store.fetchStatus()
      lastScan.value = new Date().toLocaleTimeString()
    }, 20_000)
  },
  { immediate: true },
)

onMounted(async () => {
  // Refresh user profile to pick up any role changes since last login
  if (auth.isAuthenticated) {
    await checkSession()
  }

  // Check API health every 30s
  void checkOnline()
  offlineInterval = setInterval(checkOnline, 30_000)

  // Check session validity every 5 minutes
  sessionCheckInterval = setInterval(checkSession, 5 * 60 * 1000)
})

onUnmounted(() => {
  clearInterval(intervalId)
  clearInterval(offlineInterval)
  clearInterval(sessionCheckInterval)
})
</script>

<style scoped>
.nav-active {
  background: linear-gradient(90deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05));
  color: #7dd3fc;
  border-left: 2px solid #3b82f6;
  padding-left: 10px;
}
.nav-item {
  color: var(--text-3);
  border-left: 2px solid transparent;
  padding-left: 10px;
}
.nav-item:hover { background: var(--bg-hover); color: var(--text-2); }

@keyframes spin { to { transform: rotate(360deg); } }
.spin-once { display: inline-block; animation: spin 0.8s linear infinite; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-down-enter-active, .slide-down-leave-active { transition: transform 0.25s ease, opacity 0.25s ease; }
.slide-down-enter-from, .slide-down-leave-to { transform: translateY(-100%); opacity: 0; }
</style>
