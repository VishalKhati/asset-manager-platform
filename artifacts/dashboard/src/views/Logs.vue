<template>
  <div class="p-6 space-y-5">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-bold">System Logs</h1>
        <p class="text-xs mt-0.5" style="color:var(--text-3)">
          {{ filteredLogs.length }} entries · auto-refresh every 10 s
        </p>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1 rounded-lg p-1" style="background:var(--bg-card); border:1px solid var(--border)">
          <button
            @click="activeLevel = ''"
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
            :style="activeLevel === ''
              ? 'background:var(--bg-hover); color:var(--text-1)'
              : 'color:var(--text-3)'">
            All
          </button>
          <button v-for="lvl in levels" :key="lvl"
            @click="activeLevel = activeLevel === lvl ? '' : lvl"
            class="px-3 py-1.5 rounded-md text-xs font-mono font-bold uppercase transition-all"
            :style="activeLevel === lvl ? levelStyles[lvl].active : 'color:var(--text-3)'">
            {{ lvl }}
          </button>
        </div>
        <button @click="store.fetchLogs()"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-2)">
          ↻ Refresh
        </button>
        <button @click="scrollToBottom"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-2)">
          ↓ Latest
        </button>
      </div>
    </div>

    <!-- Log level summary pills -->
    <div class="flex items-center gap-2">
      <div v-for="lvl in levels" :key="lvl"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
        :style="`background:${levelStyles[lvl].bgDim}; border:1px solid ${levelStyles[lvl].border}`">
        <span :style="`color:${levelStyles[lvl].color}`" class="font-mono font-bold uppercase">{{ lvl }}</span>
        <span :style="`color:${levelStyles[lvl].color}`" class="font-mono opacity-70">
          {{ store.logs.filter(l => l.level === lvl).length }}
        </span>
      </div>
    </div>

    <!-- Terminal -->
    <div ref="terminalEl"
      class="card overflow-hidden"
      style="font-family:'JetBrains Mono','Fira Code',monospace; font-size:12px; max-height:calc(100vh - 260px); overflow-y:auto">

      <!-- Terminal header -->
      <div class="flex items-center gap-2 px-4 py-2.5 sticky top-0 z-10"
        style="background:#070b12; border-bottom:1px solid var(--border)">
        <div class="flex gap-1.5">
          <div class="w-3 h-3 rounded-full" style="background:#ff5f57"></div>
          <div class="w-3 h-3 rounded-full" style="background:#febc2e"></div>
          <div class="w-3 h-3 rounded-full" style="background:#28c840"></div>
        </div>
        <span class="text-xs ml-2" style="color:var(--text-3)">smc-gold-bot · system log</span>
      </div>

      <div class="p-4 space-y-0.5">
        <div v-if="!filteredLogs.length" class="text-center py-12" style="color:var(--text-3)">
          No log entries for this level.
        </div>

        <div v-for="(log, i) in filteredLogs" :key="i"
          class="flex items-start gap-3 py-1 px-2 rounded transition-colors hover:bg-white hover:bg-opacity-5 group">

          <!-- Level badge -->
          <span class="shrink-0 text-xs font-bold uppercase px-1.5 py-0.5 rounded leading-none"
            :style="`background:${levelStyles[log.level]?.bgDim ?? '#1a2540'}; color:${levelStyles[log.level]?.color ?? '#94a3b8'}`">
            {{ log.level.slice(0, 4) }}
          </span>

          <!-- Timestamp -->
          <span class="shrink-0 text-xs" style="color:var(--text-3); min-width:72px">
            {{ new Date(log.ts).toLocaleTimeString() }}
          </span>

          <!-- Message -->
          <span class="flex-1 leading-relaxed break-all"
            :style="`color:${levelStyles[log.level]?.text ?? 'var(--text-2)'}`">
            {{ log.message }}
          </span>
        </div>

        <!-- Cursor blink at end -->
        <div class="flex items-center gap-2 pt-2 pl-2">
          <span style="color:var(--green)" class="text-xs">●</span>
          <span class="text-xs pulse-dot" style="color:var(--text-3)">_</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useBotStore } from '../stores/bot'

const store = useBotStore()
const levels = ['info', 'warn', 'error', 'debug'] as const
const activeLevel = ref('')
const terminalEl = ref<HTMLElement | null>(null)

const levelStyles: Record<string, Record<string, string>> = {
  info:  { color: '#60a5fa', text: '#94a3b8',  bgDim: '#0c1830', border: '#1d3a6a', active: 'background:#1d4ed8; color:#fff' },
  warn:  { color: '#fb923c', text: '#fdba74',  bgDim: '#2a1200', border: '#7c3010', active: 'background:#c2410c; color:#fff' },
  error: { color: '#f87171', text: '#fca5a5',  bgDim: '#200808', border: '#7f1d1d', active: 'background:#b91c1c; color:#fff' },
  debug: { color: '#64748b', text: '#64748b',  bgDim: '#0c1120', border: '#1e2d4a', active: 'background:#1e2d4a; color:#94a3b8' },
}

const filteredLogs = computed(() =>
  activeLevel.value ? store.logs.filter(l => l.level === activeLevel.value) : store.logs
)

function scrollToBottom() {
  nextTick(() => {
    if (terminalEl.value) terminalEl.value.scrollTop = terminalEl.value.scrollHeight
  })
}

let intervalId: ReturnType<typeof setInterval>

onMounted(async () => {
  await store.fetchLogs()
  scrollToBottom()
  intervalId = setInterval(async () => {
    await store.fetchLogs()
    scrollToBottom()
  }, 10_000)
})
onUnmounted(() => clearInterval(intervalId))
</script>
