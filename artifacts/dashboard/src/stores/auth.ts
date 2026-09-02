import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AuthUser {
  id:       string
  username: string
  email?:   string | null
  role:     string
}

const TOKEN_KEY = 'smc_jwt'
const USER_KEY  = 'smc_user'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const user  = ref<AuthUser | null>((() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') } catch { return null }
  })())

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function setSession(newToken: string, newUser: AuthUser) {
    token.value = newToken
    user.value  = newUser
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USER_KEY, JSON.stringify(newUser))
  }

  function clearSession() {
    token.value = null
    user.value  = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error ?? 'Login failed')
    setSession(data.token, data.user)
  }

  async function register(username: string, password: string, email?: string): Promise<void> {
    const res = await fetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password, email }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error ?? 'Registration failed')
    setSession(data.token, data.user)
  }

  function logout() {
    clearSession()
  }

  /**
   * Refresh user profile from the server — picks up role changes and detects
   * suspended accounts. Returns false if the session should be terminated.
   */
  async function refreshUser(): Promise<boolean> {
    if (!token.value) return false
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token.value}` },
      })
      if (res.status === 401 || res.status === 403) {
        clearSession()
        return false
      }
      if (!res.ok) return true // transient server error — keep session
      const data = await res.json()
      if (data.ok && data.user) {
        user.value = { ...user.value!, ...data.user }
        localStorage.setItem(USER_KEY, JSON.stringify(user.value))
      }
      return true
    } catch {
      return true // network error — keep session, try again later
    }
  }

  return { token, user, isAuthenticated, login, register, logout, setSession, clearSession, refreshUser }
})
