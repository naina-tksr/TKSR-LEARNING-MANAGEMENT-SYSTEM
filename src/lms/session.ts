// Reactive auth session: who is signed in, login/logout, bootstrap from token.

import { computed, reactive } from 'vue'
import { api, tokenStore } from './api'
import type { Role, User } from './types'

interface SessionState {
  user: User | null
  ready: boolean
  busy: boolean
}

export const session = reactive<SessionState>({
  user: null,
  ready: false,
  busy: false,
})

export const isAuthenticated = computed(() => session.user !== null)
export const userRole = computed<Role | null>(() => session.user?.role ?? null)

let bootstrap: Promise<void> | null = null

/**
 * Resolves once the session has been checked against the API.
 * Safe to call multiple times — the network request happens once.
 */
export function initSession(): Promise<void> {
  bootstrap ??= (async () => {
    if (tokenStore.get()) {
      try {
        const result = await api.get<{ user: User }>('/auth/me')
        session.user = result.user
      } catch {
        session.user = null
        tokenStore.clear()
      }
    }
    session.ready = true
  })()
  return bootstrap
}

export async function login(email: string, password: string): Promise<User> {
  session.busy = true
  try {
    const result = await api.post<{ token: string; user: User }>('/auth/login', { email, password })
    tokenStore.set(result.token)
    session.user = result.user
    return result.user
  } finally {
    session.busy = false
  }
}

export function logout(): void {
  tokenStore.clear()
  session.user = null
  window.location.assign('/login')
}

export function hasRole(...roles: Role[]): boolean {
  return session.user !== null && roles.includes(session.user.role)
}
