<template>
  <div class="min-h-screen flex flex-col">
    <header class="border-b sticky top-0 z-20 backdrop-blur" style="border-color: var(--border); background: rgba(7, 11, 18, 0.85)">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
        <router-link to="/" class="flex items-center gap-2 font-black tracking-tight">
          <span class="w-7 h-7 rounded-lg flex items-center justify-center text-xs" style="background: linear-gradient(135deg, #f5c142, #a37f10); color: #1a1200">Au</span>
          <span>Gold Signals</span>
        </router-link>
        <nav class="flex items-center gap-1 text-sm overflow-x-auto">
          <router-link v-for="l in links" :key="l.to" :to="l.to" class="px-3 py-1.5 rounded-lg whitespace-nowrap muted hover:text-white" active-class="!text-white bg-[var(--bg-card-2)]" :exact-active-class="l.exact ? '!text-white bg-[var(--bg-card-2)]' : ''">
            {{ l.label }}
          </router-link>
        </nav>
        <div class="ml-auto flex items-center gap-3 text-sm">
          <template v-if="auth.isAuthenticated">
            <span class="muted hidden md:inline">{{ auth.user?.username }} · {{ auth.user?.role }}</span>
            <button class="btn" @click="signOut">Sign out</button>
          </template>
          <router-link v-else to="/login" class="btn">Operator sign in</router-link>
        </div>
      </div>
    </header>
    <main class="flex-1" :class="isOps ? 'max-w-7xl w-full mx-auto px-4 py-6' : ''">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const isOps = computed(() => route.path.startsWith('/ops'))

const links = computed(() => {
  const out: Array<{ to: string; label: string; exact?: boolean }> = [{ to: '/', label: 'Track record', exact: true }]
  if (auth.isAuthenticated) {
    out.push(
      { to: '/ops', label: 'Overview', exact: true },
      { to: '/ops/signals', label: 'Signals' },
      { to: '/ops/evaluations', label: 'Why no signal' },
      { to: '/ops/strategy', label: 'Strategy' },
      { to: '/ops/research', label: 'Research' },
      { to: '/ops/alerts', label: 'Alerts' },
    )
    if (auth.isAdmin) out.push({ to: '/ops/users', label: 'Users' })
  }
  return out
})

async function signOut(): Promise<void> {
  await auth.logout()
  await router.push('/')
}
</script>
