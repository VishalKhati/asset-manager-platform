/**
 * API composable — wraps all /api/bot/* calls.
 * Reads the JWT from localStorage (set by the auth store on login).
 * Auto-redirects to /login on 401 (expired / revoked session).
 */

const API_BASE = '/api/bot'
const TOKEN_KEY = 'smc_jwt'

function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`,
  }
}

function handleUnauthorized(): never {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('smc_user')
  // Use replace so the browser doesn't add an extra history entry,
  // and don't trigger a full HMR reload — the router guard handles navigation.
  if (!window.location.pathname.endsWith('/login')) {
    window.location.replace('/login')
  }
  throw new Error('Session expired. Please log in again.')
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = { get, post, put }
