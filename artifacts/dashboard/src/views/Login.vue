<template>
  <div class="min-h-screen flex items-center justify-center p-4"
    style="background:radial-gradient(ellipse at 50% 0%,#0d1a38 0%,#060b14 60%)">

    <!-- Card -->
    <div class="w-full max-w-sm rounded-2xl overflow-hidden"
      style="background:#090d18; border:1px solid rgba(255,255,255,0.08); box-shadow:0 32px 80px rgba(0,0,0,0.6)">

      <!-- Header -->
      <div class="px-8 pt-8 pb-6 text-center" style="border-bottom:1px solid rgba(255,255,255,0.06)">
        <div class="flex items-center justify-center w-14 h-14 rounded-2xl mx-auto mb-4 pulse-gold"
          style="background:linear-gradient(135deg,#a37f10,#f5c142); font-size:24px">⚡</div>
        <h1 class="text-xl font-bold" style="color:#f5c142">SMC Gold Bot</h1>
        <p class="text-xs mt-1" style="color:var(--text-3)">Smart Money Concepts Dashboard</p>
      </div>

      <!-- Tabs -->
      <div class="flex" style="border-bottom:1px solid rgba(255,255,255,0.06)">
        <button v-for="t in (['Login','Register'] as const)" :key="t"
          @click="tab = t"
          class="flex-1 py-3 text-sm font-semibold transition-colors"
          :style="tab === t
            ? 'color:#f5c142; border-bottom:2px solid #f5c142; background:rgba(245,193,66,0.04)'
            : 'color:var(--text-3); border-bottom:2px solid transparent'">
          {{ t }}
        </button>
      </div>

      <!-- Form -->
      <form class="px-8 py-7 space-y-4" @submit.prevent="submit">
        <div>
          <label class="block text-xs font-medium mb-1.5" style="color:var(--text-2)">Username</label>
          <input v-model="username" type="text" autocomplete="username" required
            placeholder="your_username"
            class="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
            style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-1)"
            @focus="e => (e.target as HTMLElement).style.borderColor='#f5c142'"
            @blur="e => (e.target as HTMLElement).style.borderColor='var(--border)'">
        </div>

        <div v-if="tab === 'Register'">
          <label class="block text-xs font-medium mb-1.5" style="color:var(--text-2)">Email <span style="color:var(--text-3)">(optional)</span></label>
          <input v-model="email" type="email" autocomplete="email"
            placeholder="you@example.com"
            class="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
            style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-1)"
            @focus="e => (e.target as HTMLElement).style.borderColor='#f5c142'"
            @blur="e => (e.target as HTMLElement).style.borderColor='var(--border)'">
        </div>

        <div>
          <label class="block text-xs font-medium mb-1.5" style="color:var(--text-2)">Password</label>
          <div class="relative">
            <input v-model="password" :type="showPw ? 'text' : 'password'"
              :autocomplete="tab === 'Login' ? 'current-password' : 'new-password'"
              required minlength="8"
              placeholder="••••••••"
              class="w-full px-3 py-2.5 pr-10 rounded-lg text-sm outline-none transition-all"
              style="background:var(--bg-card); border:1px solid var(--border); color:var(--text-1)"
              @focus="e => (e.target as HTMLElement).style.borderColor='#f5c142'"
              @blur="e => (e.target as HTMLElement).style.borderColor='var(--border)'">
            <button type="button" @click="showPw = !showPw"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
              style="color:var(--text-3)">{{ showPw ? 'Hide' : 'Show' }}</button>
          </div>
          <p v-if="tab === 'Register'" class="text-xs mt-1" style="color:var(--text-3)">Minimum 8 characters</p>
        </div>

        <!-- Error -->
        <div v-if="error"
          class="px-3 py-2.5 rounded-lg text-xs"
          style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); color:#fca5a5">
          {{ error }}
        </div>

        <!-- Submit -->
        <button type="submit" :disabled="loading"
          class="w-full py-2.5 rounded-lg text-sm font-bold transition-all mt-2"
          :style="loading
            ? 'background:rgba(245,193,66,0.3); color:rgba(245,193,66,0.5); cursor:not-allowed'
            : 'background:linear-gradient(135deg,#b8940a,#f5c142); color:#060b14; cursor:pointer'">
          {{ loading ? 'Please wait…' : tab }}
        </button>
      </form>

      <!-- Footer hint -->
      <p class="px-8 pb-6 text-center text-xs" style="color:var(--text-3)">
        Each account has its own isolated bot state, trades, and configuration.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth    = useAuthStore()
const router  = useRouter()
const tab     = ref<'Login' | 'Register'>('Login')
const username = ref('')
const email    = ref('')
const password = ref('')
const showPw   = ref(false)
const loading  = ref(false)
const error    = ref<string | null>(null)

async function submit() {
  error.value   = null
  loading.value = true
  try {
    if (tab.value === 'Login') {
      await auth.login(username.value, password.value)
    } else {
      await auth.register(username.value, password.value, email.value || undefined)
    }
    router.push('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Something went wrong.'
  } finally {
    loading.value = false
  }
}
</script>
