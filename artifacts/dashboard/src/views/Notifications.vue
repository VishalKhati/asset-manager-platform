<template>
  <div class="p-6 max-w-3xl mx-auto space-y-6">

    <div>
      <h1 class="text-lg font-bold">Notifications</h1>
      <p class="text-xs mt-0.5" style="color:var(--text-3)">
        Get alerted on Telegram or email when trades fire, signals appear, or you log in.
      </p>
    </div>

    <!-- Telegram -->
    <section class="card p-5 space-y-4">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2">
          <span class="text-lg">✈</span>
          <span class="text-sm font-bold">Telegram</span>
          <span v-if="form.telegramEnabled"
            class="text-xs px-2 py-0.5 rounded font-mono"
            style="background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.25)">
            ENABLED
          </span>
        </div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <span class="text-xs" style="color:var(--text-3)">Enable</span>
          <div @click="form.telegramEnabled = !form.telegramEnabled"
            class="relative w-10 h-5 rounded-full transition-all cursor-pointer"
            :style="form.telegramEnabled ? 'background:var(--green)' : 'background:var(--border)'">
            <div class="absolute top-0.5 w-4 h-4 rounded-full transition-all bg-white"
              :style="form.telegramEnabled ? 'left:calc(100% - 1.125rem)' : 'left:2px'"></div>
          </div>
        </label>
      </div>

      <!-- Setup guide -->
      <div class="rounded-xl p-4 space-y-2" style="background:rgba(59,130,246,0.05); border:1px solid rgba(59,130,246,0.15)">
        <div class="text-xs font-semibold" style="color:var(--blue)">How to set up</div>
        <ol class="text-xs space-y-1.5" style="color:var(--text-2)">
          <li>1. Open Telegram and search for <strong>@BotFather</strong></li>
          <li>2. Send <code class="px-1 py-0.5 rounded font-mono" style="background:var(--bg-base)">/newbot</code> and follow the prompts to get your <strong>Bot Token</strong></li>
          <li>3. Start a chat with your new bot, then open <strong>@userinfobot</strong> to get your <strong>Chat ID</strong></li>
          <li>4. Paste both below and click <strong>Save</strong></li>
        </ol>
      </div>

      <div class="grid gap-3">
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">Bot Token</label>
          <input v-model="form.telegramToken" type="password"
            placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
            class="input-field w-full font-mono text-xs"
            :disabled="!form.telegramEnabled"
            autocomplete="off" />
          <p v-if="settings.hasTelegramToken && form.telegramToken.startsWith('••••')"
            class="text-xs mt-1" style="color:var(--text-3)">
            Token saved — paste a new one to replace it.
          </p>
        </div>
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">Chat ID</label>
          <input v-model="form.telegramChatId" type="text"
            placeholder="123456789"
            class="input-field w-full font-mono text-xs"
            :disabled="!form.telegramEnabled" />
        </div>
      </div>
    </section>

    <!-- Email -->
    <section class="card p-5 space-y-4">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2">
          <span class="text-lg">✉</span>
          <span class="text-sm font-bold">Email (SMTP)</span>
          <span v-if="form.emailEnabled"
            class="text-xs px-2 py-0.5 rounded font-mono"
            style="background:rgba(16,185,129,0.08); color:var(--green); border:1px solid rgba(16,185,129,0.25)">
            ENABLED
          </span>
        </div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <span class="text-xs" style="color:var(--text-3)">Enable</span>
          <div @click="form.emailEnabled = !form.emailEnabled"
            class="relative w-10 h-5 rounded-full transition-all cursor-pointer"
            :style="form.emailEnabled ? 'background:var(--green)' : 'background:var(--border)'">
            <div class="absolute top-0.5 w-4 h-4 rounded-full transition-all bg-white"
              :style="form.emailEnabled ? 'left:calc(100% - 1.125rem)' : 'left:2px'"></div>
          </div>
        </label>
      </div>

      <!-- Gmail tip -->
      <div class="rounded-xl p-4 space-y-1" style="background:rgba(245,193,66,0.04); border:1px solid rgba(245,193,66,0.15)">
        <div class="text-xs font-semibold" style="color:var(--gold)">Gmail tip</div>
        <p class="text-xs" style="color:var(--text-2)">
          Use <code class="font-mono px-1 rounded" style="background:var(--bg-base)">smtp.gmail.com</code> port <strong>587</strong>.
          For password, use an <strong>App Password</strong> (Google Account → Security → 2FA → App Passwords).
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">SMTP Host</label>
          <input v-model="form.smtpHost" type="text"
            placeholder="smtp.gmail.com"
            class="input-field w-full text-xs"
            :disabled="!form.emailEnabled" />
        </div>
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">Port</label>
          <input v-model.number="form.smtpPort" type="number"
            placeholder="587"
            class="input-field w-full text-xs"
            :disabled="!form.emailEnabled" />
        </div>
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">SMTP Username</label>
          <input v-model="form.smtpUser" type="text"
            placeholder="you@gmail.com"
            class="input-field w-full text-xs"
            :disabled="!form.emailEnabled" />
        </div>
        <div>
          <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">SMTP Password</label>
          <input v-model="form.smtpPass" type="password"
            placeholder="App Password"
            class="input-field w-full text-xs"
            :disabled="!form.emailEnabled"
            autocomplete="new-password" />
        </div>
      </div>
      <div>
        <label class="text-xs font-medium block mb-1.5" style="color:var(--text-2)">Send notifications to</label>
        <input v-model="form.emailTo" type="email"
          placeholder="you@example.com"
          class="input-field w-full text-xs"
          :disabled="!form.emailEnabled" />
      </div>
    </section>

    <!-- Events -->
    <section class="card p-5 space-y-3">
      <div class="text-sm font-bold mb-1">Notify on these events</div>
      <div class="grid grid-cols-2 gap-2">
        <label v-for="ev in allEvents" :key="ev.key"
          class="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all select-none"
          :style="form.events.includes(ev.key)
            ? 'background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.3)'
            : 'background:var(--bg-base); border:1px solid var(--border)'">
          <input type="checkbox" class="hidden"
            :checked="form.events.includes(ev.key)"
            @change="toggleEvent(ev.key)" />
          <span class="text-base leading-none">{{ ev.icon }}</span>
          <div>
            <div class="text-xs font-semibold" style="color:var(--text-1)">{{ ev.label }}</div>
            <div class="text-xs" style="color:var(--text-3)">{{ ev.desc }}</div>
          </div>
          <span class="ml-auto text-xs font-bold"
            :style="form.events.includes(ev.key) ? 'color:var(--blue)' : 'color:var(--text-3)'">
            {{ form.events.includes(ev.key) ? 'ON' : 'OFF' }}
          </span>
        </label>
      </div>
    </section>

    <!-- Actions -->
    <div class="flex items-center gap-3">
      <button @click="save" :disabled="saving"
        class="btn-primary px-5 py-2.5 text-sm font-bold rounded-xl transition-all disabled:opacity-50">
        {{ saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings' }}
      </button>
      <button @click="sendTest" :disabled="testing || !(form.telegramEnabled || form.emailEnabled)"
        class="px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
        style="background:rgba(245,193,66,0.1); color:var(--gold); border:1px solid rgba(245,193,66,0.3)">
        {{ testing ? 'Sending…' : testResult ? testResult : 'Send Test' }}
      </button>
      <span v-if="error" class="text-xs" style="color:#f87171">{{ error }}</span>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const saving  = ref(false)
const saved   = ref(false)
const testing = ref(false)
const testResult = ref('')
const error   = ref('')

const allEvents = [
  { key: 'signal',       icon: '🔔', label: 'Signal',       desc: 'When a trade signal fires'       },
  { key: 'trade_opened', icon: '📂', label: 'Trade Opened',  desc: 'When a live trade is opened'     },
  { key: 'trade_closed', icon: '✅', label: 'Trade Closed',  desc: 'When a trade closes with P&L'    },
  { key: 'bot_started',  icon: '🚀', label: 'Bot Started',   desc: 'When the bot starts running'     },
  { key: 'bot_stopped',  icon: '🛑', label: 'Bot Stopped',   desc: 'When the bot is stopped'         },
  { key: 'user.login',   icon: '🔐', label: 'Login',         desc: 'When you log into the dashboard' },
]

interface ApiSettings {
  telegramEnabled: boolean
  telegramToken:   string
  telegramChatId:  string
  emailEnabled:    boolean
  emailTo:         string
  smtpHost:        string
  smtpPort:        number
  smtpUser:        string
  smtpPass:        string
  events:          string[]
  hasTelegramToken?: boolean
  hasSmtpPass?:     boolean
}

const settings = ref<ApiSettings>({
  telegramEnabled: false, telegramToken: '', telegramChatId: '',
  emailEnabled: false, emailTo: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
  events: ['signal', 'trade_opened', 'trade_closed'],
})

const form = reactive<ApiSettings>({
  telegramEnabled: false, telegramToken: '', telegramChatId: '',
  emailEnabled: false, emailTo: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
  events: ['signal', 'trade_opened', 'trade_closed'],
})

function applySettings(s: ApiSettings) {
  settings.value = s
  Object.assign(form, s)
}

async function load() {
  try {
    const res = await fetch('/api/notifications', {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    const data = await res.json()
    if (data.ok) applySettings(data.settings)
  } catch { /* silent */ }
}

function toggleEvent(key: string) {
  const idx = form.events.indexOf(key)
  if (idx === -1) form.events.push(key)
  else form.events.splice(idx, 1)
}

async function save() {
  saving.value = true
  error.value  = ''
  try {
    const res = await fetch('/api/notifications', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body:    JSON.stringify({ ...form }),
    })
    const data = await res.json()
    if (data.ok) {
      saved.value = true
      setTimeout(() => { saved.value = false }, 2500)
      await load()
    } else {
      error.value = data.error ?? 'Save failed.'
    }
  } catch {
    error.value = 'Network error.'
  } finally {
    saving.value = false
  }
}

async function sendTest() {
  testing.value = true
  testResult.value = ''
  error.value = ''
  try {
    const res = await fetch('/api/notifications/test', {
      method:  'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    const data = await res.json()
    if (data.ok) {
      testResult.value = '✓ Sent!'
      setTimeout(() => { testResult.value = '' }, 3000)
    } else {
      error.value = data.error ?? 'Test failed.'
    }
  } catch {
    error.value = 'Network error.'
  } finally {
    testing.value = false
  }
}

onMounted(load)
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
.input-field:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary {
  background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(59,130,246,0.1));
  color: var(--blue);
  border: 1px solid rgba(59,130,246,0.4);
}
.btn-primary:hover:not(:disabled) { border-color: var(--blue); }
</style>
