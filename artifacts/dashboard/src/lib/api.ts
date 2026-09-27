/**
 * The one HTTP client for every view. Sessions live in an httpOnly cookie, so no token is
 * ever stored in the browser. Writes carry X-Requested-With (the API's CSRF guard).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type Handler = () => void
let onUnauthorized: Handler = () => {}
export function setUnauthorizedHandler(fn: Handler): void {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-Requested-With': 'fetch' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON body */
  }
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/public')) onUnauthorized()
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}
