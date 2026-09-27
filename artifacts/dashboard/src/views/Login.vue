<template>
  <div class="min-h-[70vh] flex items-center justify-center px-4">
    <form class="card p-8 w-full max-w-sm space-y-4" @submit.prevent="submit">
      <div>
        <h1 class="text-xl font-black" style="color: var(--gold)">Operator sign in</h1>
        <p class="text-xs muted mt-1">The public track record needs no account. Accounts are created by an admin.</p>
      </div>
      <ConfigField v-model="username" label="Username" />
      <ConfigField v-model="password" label="Password" type="password" />
      <p v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</p>
      <button class="btn btn-gold w-full justify-center" :disabled="busy || !username || !password">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfigField from '../components/ConfigField.vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await auth.login(String(username.value).trim(), String(password.value))
    const next = typeof route.query['next'] === 'string' && route.query['next'].startsWith('/') ? route.query['next'] : '/ops'
    await router.replace(next)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Sign in failed.'
  } finally {
    busy.value = false
  }
}
</script>
