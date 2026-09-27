import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '../lib/api'

export interface AuthUser {
  id: string
  username: string
  email?: string | null
  role: 'admin' | 'viewer' | string
}

/** Session state comes from the server (httpOnly cookie); nothing is kept in localStorage. */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const checked = ref(false)
  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function refresh(): Promise<void> {
    try {
      const res = await api.get<{ user: AuthUser }>('/auth/me')
      user.value = res.user
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) user.value = null
    } finally {
      checked.value = true
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await api.post<{ user: AuthUser }>('/auth/login', { username, password })
    user.value = res.user
    checked.value = true
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      user.value = null
    }
  }

  function clear(): void {
    user.value = null
  }

  return { user, checked, isAuthenticated, isAdmin, refresh, login, logout, clear }
})
