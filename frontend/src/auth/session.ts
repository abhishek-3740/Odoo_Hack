/**
 * Where the access token comes from, and where it is kept.
 *
 * Three identity modes exist and they refresh differently, so the source is
 * recorded alongside the token rather than inferred later:
 *
 *  - `LOCAL`  — a password account on this server. There is no refresh endpoint
 *               in the API, so an expired token means signing in again.
 *  - `DEMO`   — a pre-seeded persona, only when the server enables it.
 *  - `SUPABASE` — a hosted identity. Refresh belongs to the Supabase SDK, not to
 *               an invented local endpoint. The adapter below is the seam that
 *               work drops into; nothing else in the app needs to change.
 *
 * The token is a bearer credential, so it lives in `localStorage` alongside its
 * source and is cleared completely on sign-out. No Supabase service key and no
 * assistant provider key is ever read by this code — those belong to the server.
 */

export type TokenSource = 'LOCAL' | 'DEMO' | 'SUPABASE'

export interface StoredSession {
  token: string
  source: TokenSource
  email: string | null
  /** Epoch milliseconds, when the issuing endpoint told us. */
  expiresAt: number | null
}

const STORAGE_KEY = 'dealflow.session'

/** A private-mode browser can throw on access; a missing session is not fatal. */
function safeRead(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function loadSession(): StoredSession | null {
  const raw = safeRead()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed?.token) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // A session that cannot be persisted still works for this tab.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do; the in-memory session is cleared by the caller regardless.
  }
}

/** True when the issuer gave an expiry and it has passed. */
export function isExpired(session: StoredSession | null): boolean {
  return session?.expiresAt != null && session.expiresAt <= Date.now()
}

/** Turns the auth endpoints' `expiresIn` (seconds) into an absolute instant. */
export function expiryFromSeconds(expiresIn: number | null | undefined): number | null {
  if (!expiresIn || !Number.isFinite(expiresIn)) return null
  return Date.now() + expiresIn * 1000
}
