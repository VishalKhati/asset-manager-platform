<template>
  <div class="p-6 max-w-5xl mx-auto space-y-6">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-bold">Admin Panel</h1>
        <p class="text-xs mt-0.5" style="color:var(--text-3)">System-wide overview across all trader accounts.</p>
      </div>
      <button @click="loadAll" :disabled="loading"
        class="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
        style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-2)">
        <span :class="loading ? 'animate-spin' : ''">↻</span>
        Refresh
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="p-4 rounded-xl text-sm"
      style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); color:#fca5a5">
      {{ error }}
    </div>

    <!-- Loading skeleton -->
    <template v-if="loading && !summary">
      <div v-for="i in 3" :key="i" class="card p-5 h-20 animate-pulse" style="background:var(--bg-card)"></div>
    </template>

    <template v-else-if="summary">

      <!-- ── Summary cards ────────────────────────────────────────────── -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Users"  :value="summary.totalUsers"  sub="registered accounts" />
        <StatCard label="Active Users" :value="summary.activeUsers" sub="not suspended" />
        <StatCard label="Bots Running" :value="summary.runningBots"
          :color="summary.runningBots > 0 ? 'var(--green)' : undefined" sub="live right now" />
        <StatCard label="Total Trades" :value="summary.totalTrades" sub="all time, all users" />
        <StatCard label="Total P&L"
          :value="(summary.totalPnl >= 0 ? '+' : '') + summary.totalPnl.toFixed(2)"
          :color="summary.totalPnl >= 0 ? 'var(--green)' : '#ef4444'"
          sub="sum across all accounts" />
        <StatCard label="Bridge Online" :value="summary.bridgeOnline" sub="MT5 bridges connected" />
        <StatCard label="Admins"        :value="summary.adminCount"  sub="admin-role users" />
      </div>

      <!-- ── System stats ─────────────────────────────────────────────── -->
      <section v-if="system" class="card p-5">
        <div class="text-xs font-bold mb-3" style="color:var(--text-3); letter-spacing:.08em">SERVER STATS</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div class="text-sm font-mono font-bold" style="color:var(--text-1)">{{ fmtUptime(system.uptime) }}</div>
            <div class="text-xs mt-0.5" style="color:var(--text-3)">Uptime</div>
          </div>
          <div>
            <div class="text-sm font-mono font-bold" style="color:var(--text-1)">{{ system.memory.heapUsedMb }} / {{ system.memory.heapTotalMb }} MB</div>
            <div class="text-xs mt-0.5" style="color:var(--text-3)">Heap used / total</div>
          </div>
          <div>
            <div class="text-sm font-mono font-bold"
              :style="system.db.latencyMs < 20 ? 'color:var(--green)' : system.db.latencyMs < 100 ? 'color:var(--gold)' : 'color:#ef4444'">
              {{ system.db.latencyMs }}ms
            </div>
            <div class="text-xs mt-0.5" style="color:var(--text-3)">DB latency</div>
          </div>
          <div>
            <div class="text-sm font-mono font-bold" style="color:var(--text-1)">{{ system.node }}</div>
            <div class="text-xs mt-0.5" style="color:var(--text-3)">Node.js</div>
          </div>
        </div>
      </section>

      <!-- ── Users table ──────────────────────────────────────────────── -->
      <section class="card overflow-hidden">
        <div class="px-5 py-4 flex items-center justify-between" style="border-bottom:1px solid var(--border)">
          <span class="text-sm font-bold">Traders</span>
          <span class="text-xs" style="color:var(--text-3)">{{ users.length }} accounts</span>
        </div>

        <div v-for="u in users" :key="u.id" class="border-b" style="border-color:var(--border-dim)">

          <!-- Row header -->
          <div class="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition-all"
            @click="toggleExpand(u.id)">

            <div class="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black shrink-0"
              :style="u.role === 'admin'
                ? 'background:linear-gradient(135deg,#a37f10,#f5c142); color:#060b14'
                : 'background:var(--bg-base); color:var(--text-2); border:1px solid var(--border)'">
              {{ u.username[0].toUpperCase() }}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-semibold" style="color:var(--text-1)">{{ u.username }}</span>
                <span class="text-xs px-1.5 py-0.5 rounded font-mono"
                  :style="u.role === 'admin'
                    ? 'background:rgba(245,193,66,0.12); color:var(--gold); border:1px solid rgba(245,193,66,0.3)'
                    : 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border-dim)'">
                  {{ u.role }}
                </span>
                <span v-if="!u.active" class="text-xs px-1.5 py-0.5 rounded"
                  style="background:rgba(239,68,68,0.08); color:#ef4444; border:1px solid rgba(239,68,68,0.2)">
                  suspended
                </span>
                <span v-if="u.totals.running" class="text-xs px-1.5 py-0.5 rounded flex items-center gap-1"
                  style="background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.2)">
                  <span class="w-1.5 h-1.5 rounded-full" style="background:var(--green)"></span>
                  LIVE
                </span>
              </div>
              <div class="text-xs mt-0.5" style="color:var(--text-3)">
                {{ u.email ?? 'no email' }}
                &nbsp;·&nbsp; joined {{ fmtDate(u.createdAt) }}
                <span v-if="u.lastSeenAt"> &nbsp;·&nbsp; seen {{ fmtRelative(u.lastSeenAt) }}</span>
              </div>
            </div>

            <div class="hidden sm:flex items-center gap-4 text-right shrink-0">
              <div>
                <div class="text-xs font-mono font-bold" style="color:var(--text-1)">{{ u.totals.tradeCount }}</div>
                <div class="text-xs" style="color:var(--text-3)">trades</div>
              </div>
              <div>
                <div class="text-xs font-mono font-bold"
                  :style="u.totals.totalPnl >= 0 ? 'color:var(--green)' : 'color:#ef4444'">
                  {{ u.totals.totalPnl >= 0 ? '+' : '' }}{{ u.totals.totalPnl.toFixed(2) }}
                </div>
                <div class="text-xs" style="color:var(--text-3)">P&L</div>
              </div>
              <span class="text-xs" style="color:var(--text-3)">{{ expanded.has(u.id) ? '▲' : '▼' }}</span>
            </div>
          </div>

          <!-- Expanded detail -->
          <div v-if="expanded.has(u.id)" class="px-5 pb-4 space-y-3"
            style="border-top:1px solid var(--border-dim); background:rgba(0,0,0,0.15)">

            <div class="grid grid-cols-2 gap-3 pt-3">
              <div v-for="sym in u.symbols" :key="sym.symbol"
                class="p-3 rounded-xl"
                style="background:var(--bg-base); border:1px solid var(--border-dim)">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold font-mono"
                    :style="sym.symbol === 'BTCUSD' ? 'color:var(--blue)' : 'color:var(--gold)'">
                    {{ sym.symbol === 'BTCUSD' ? '₿ BTC' : '⚡ GOLD' }}
                  </span>
                  <span class="text-xs" :style="sym.running ? 'color:var(--green)' : 'color:var(--text-3)'">
                    {{ sym.running ? 'Running' : 'Stopped' }}
                  </span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div class="text-xs font-mono font-bold" style="color:var(--text-1)">{{ sym.tradeCount }}</div>
                    <div class="text-xs" style="color:var(--text-3)">trades</div>
                  </div>
                  <div>
                    <div class="text-xs font-mono font-bold"
                      :style="sym.totalPnl >= 0 ? 'color:var(--green)' : 'color:#ef4444'">
                      {{ sym.totalPnl >= 0 ? '+' : '' }}{{ sym.totalPnl.toFixed(2) }}
                    </div>
                    <div class="text-xs" style="color:var(--text-3)">P&L</div>
                  </div>
                  <div>
                    <div class="text-xs font-mono font-bold" style="color:var(--text-1)">{{ sym.winRate }}%</div>
                    <div class="text-xs" style="color:var(--text-3)">win rate</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-wrap pt-1">
              <span class="text-xs font-semibold" style="color:var(--text-3)">Actions:</span>
              <button v-if="u.active" @click="setActive(u, false)"
                :disabled="actionLoading === u.id + ':suspend'"
                class="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-all active:scale-95"
                style="background:rgba(239,68,68,0.08); color:#ef4444; border:1px solid rgba(239,68,68,0.2)">
                {{ actionLoading === u.id + ':suspend' ? '…' : 'Suspend' }}
              </button>
              <button v-else @click="setActive(u, true)"
                :disabled="actionLoading === u.id + ':activate'"
                class="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-all active:scale-95"
                style="background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.2)">
                {{ actionLoading === u.id + ':activate' ? '…' : 'Reactivate' }}
              </button>
              <button v-if="u.role !== 'admin'" @click="setRole(u, 'admin')"
                :disabled="actionLoading === u.id + ':admin'"
                class="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-all active:scale-95"
                style="background:rgba(245,193,66,0.10); color:var(--gold); border:1px solid rgba(245,193,66,0.3)">
                {{ actionLoading === u.id + ':admin' ? '…' : 'Make Admin' }}
              </button>
              <button v-else-if="u.id !== currentUserId" @click="setRole(u, 'user')"
                :disabled="actionLoading === u.id + ':user'"
                class="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-all active:scale-95"
                style="background:var(--bg-base); color:var(--text-2); border:1px solid var(--border)">
                {{ actionLoading === u.id + ':user' ? '…' : 'Remove Admin' }}
              </button>
              <span v-if="u.id === currentUserId" class="text-xs" style="color:var(--text-3)">(you)</span>
            </div>
          </div>

        </div>
      </section>

      <!-- ── Audit Log ────────────────────────────────────────────────── -->
      <section class="card overflow-hidden">
        <div class="px-5 py-4 flex items-center justify-between" style="border-bottom:1px solid var(--border)">
          <span class="text-sm font-bold">Activity Log</span>
          <span class="text-xs" style="color:var(--text-3)">last {{ auditLogs.length }} events</span>
        </div>

        <div v-if="auditLogs.length === 0" class="px-5 py-8 text-center text-xs" style="color:var(--text-3)">
          No activity recorded yet.
        </div>

        <div v-for="log in auditLogs" :key="log.id"
          class="flex items-start gap-3 px-5 py-3 border-b"
          style="border-color:var(--border-dim)">

          <!-- Action badge -->
          <div class="shrink-0 mt-0.5">
            <span class="text-xs px-2 py-0.5 rounded-full font-mono font-bold"
              :style="auditStyle(log.action).badge">
              {{ auditStyle(log.action).icon }} {{ auditLabel(log.action) }}
            </span>
          </div>

          <!-- Description -->
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold" style="color:var(--text-1)">{{ log.actor_username }}</span>
            <span class="text-xs" style="color:var(--text-3)"> {{ auditDesc(log) }}</span>
          </div>

          <!-- Timestamp -->
          <div class="shrink-0 text-xs" style="color:var(--text-3)">
            {{ fmtRelative(log.created_at) }}
          </div>
        </div>
      </section>

    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const currentUserId = computed(() => auth.user?.id ?? '')

// ── Types ──────────────────────────────────────────────────────────────────────
interface SymbolStat {
  symbol: string; running: boolean; bridgeConnected: boolean
  tradeCount: number; closedCount: number; openCount: number
  totalPnl: number; winCount: number; winRate: number
}
interface UserRow {
  id: string; username: string; email: string | null; role: string
  active: boolean; createdAt: string; lastSeenAt: string | null
  symbols: SymbolStat[]
  totals: { tradeCount: number; totalPnl: number; running: boolean; bridgeConnected: boolean }
}
interface Summary {
  totalUsers: number; activeUsers: number; adminCount: number
  runningBots: number; bridgeOnline: number; totalTrades: number; totalPnl: number
}
interface SystemStats {
  uptime: number; node: string
  memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number }
  db: { latencyMs: number }
  bots: { total: number; running: number }
}
interface AuditLog {
  id: number; actor_id: string; actor_username: string; action: string
  target_id: string | null; target_username: string | null
  details: Record<string, unknown> | null; created_at: string
}

// ── State ──────────────────────────────────────────────────────────────────────
const loading       = ref(false)
const error         = ref<string | null>(null)
const summary       = ref<Summary | null>(null)
const users         = ref<UserRow[]>([])
const system        = ref<SystemStats | null>(null)
const auditLogs     = ref<AuditLog[]>([])
const expanded      = ref(new Set<string>())
const actionLoading = ref<string | null>(null)

// ── Fetch ──────────────────────────────────────────────────────────────────────
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('smc_jwt') ?? ''}`, 'Content-Type': 'application/json' }
}

async function loadAll() {
  loading.value = true
  error.value   = null
  try {
    const [overviewRes, auditRes, sysRes] = await Promise.all([
      fetch('/api/admin/overview', { headers: authHeaders() }),
      fetch('/api/admin/audit?limit=50', { headers: authHeaders() }),
      fetch('/api/admin/system', { headers: authHeaders() }),
    ])
    const [overview, audit, sys] = await Promise.all([
      overviewRes.json(), auditRes.json(), sysRes.json(),
    ])
    if (!overviewRes.ok) throw new Error(overview.error ?? 'Failed to load')
    summary.value   = overview.summary
    users.value     = overview.users
    auditLogs.value = audit.ok ? audit.logs : []
    system.value    = sys.ok  ? sys        : null
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Unknown error'
  } finally {
    loading.value = false
  }
}

// ── Expand ─────────────────────────────────────────────────────────────────────
function toggleExpand(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}

// ── Admin actions ──────────────────────────────────────────────────────────────
async function patchUser(userId: string, body: object, key: string) {
  actionLoading.value = `${userId}:${key}`
  try {
    const res  = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Update failed')
    await loadAll()
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Update failed'
  } finally {
    actionLoading.value = null
  }
}

function setActive(u: UserRow, active: boolean) { patchUser(u.id, { active }, active ? 'activate' : 'suspend') }
function setRole(u: UserRow, role: string)       { patchUser(u.id, { role  }, role  === 'admin' ? 'admin' : 'user') }

// ── Formatters ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)           return 'just now'
  if (diff < 3_600_000)        return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)       return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
function fmtUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}

// ── Audit helpers ──────────────────────────────────────────────────────────────
const ACTION_META: Record<string, { icon: string; label: string; badge: string }> = {
  'user.login':    { icon: '→', label: 'LOGIN',    badge: 'background:rgba(59,130,246,0.1); color:#93c5fd; border:1px solid rgba(59,130,246,0.25)' },
  'user.register': { icon: '✦', label: 'REGISTER', badge: 'background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.2)' },
  'user.suspend':  { icon: '⊘', label: 'SUSPEND',  badge: 'background:rgba(239,68,68,0.08); color:#ef4444; border:1px solid rgba(239,68,68,0.2)' },
  'user.activate': { icon: '✓', label: 'ACTIVATE', badge: 'background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.2)' },
  'user.promote':  { icon: '▲', label: 'PROMOTE',  badge: 'background:rgba(245,193,66,0.10); color:var(--gold); border:1px solid rgba(245,193,66,0.3)' },
  'user.demote':   { icon: '▼', label: 'DEMOTE',   badge: 'background:rgba(156,163,175,0.1); color:var(--text-3); border:1px solid var(--border-dim)' },
}
const DEFAULT_META = { icon: '·', label: 'EVENT', badge: 'background:var(--bg-base); color:var(--text-3); border:1px solid var(--border-dim)' }

function auditStyle(action: string)  { return ACTION_META[action] ?? DEFAULT_META }
function auditLabel(action: string)  { return (ACTION_META[action] ?? DEFAULT_META).label }
function auditDesc(log: AuditLog) {
  switch (log.action) {
    case 'user.login':    return 'logged in'
    case 'user.register': return `registered (role: ${(log.details as any)?.role ?? 'user'})`
    case 'user.suspend':  return `suspended ${log.target_username ?? ''}`
    case 'user.activate': return `reactivated ${log.target_username ?? ''}`
    case 'user.promote':  return `promoted ${log.target_username ?? ''} to admin`
    case 'user.demote':   return `removed admin from ${log.target_username ?? ''}`
    default:              return log.action
  }
}

onMounted(loadAll)

// ── StatCard ───────────────────────────────────────────────────────────────────
const StatCard = defineComponent({
  props: { label: String, value: [String, Number], sub: String, color: String },
  setup(props) {
    return () => h('div', { class: 'card p-4' }, [
      h('div', { class: 'text-lg font-black font-mono', style: `color:${props.color ?? 'var(--text-1)'}` }, String(props.value ?? 0)),
      h('div', { class: 'text-xs font-semibold mt-0.5', style: 'color:var(--text-2)' }, props.label),
      h('div', { class: 'text-xs mt-0.5', style: 'color:var(--text-3)' }, props.sub),
    ])
  },
})
</script>
