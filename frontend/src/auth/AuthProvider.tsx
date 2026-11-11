import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { ApiError, configureApi, identity, setQueryScope, type AuthToken, type Me } from '@/api'
import { disconnectRealtime } from '@/realtime/connection'

import {
  clearSession,
  expiryFromSeconds,
  isExpired,
  loadSession,
  saveSession,
  type StoredSession,
  type TokenSource,
} from './session'

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous'
  me: Me | null
  session: StoredSession | null
  /** Set when a stored token was rejected, so the sign-in page can say why. */
  reason: string | null
}

export interface AuthContextValue extends AuthState {
  /** Adopts a token an auth endpoint just issued and loads `/me`. */
  adopt: (token: AuthToken, source: TokenSource) => Promise<Me>
  signOut: (reason?: string) => void
  /** Re-reads `/me` — after a profile edit, or when a role may have changed. */
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    me: null,
    session: null,
    reason: null,
  })

  // The API client reads the token through a function, so a persona switch takes
  // effect on the very next request without a reload and without any module
  // importing this context.
  const sessionRef = useRef<StoredSession | null>(null)
  /**
   * How many `/me` calls are currently verifying a token.
   *
   * While one is in flight its caller has a more precise explanation for a 401
   * ("saved sign-in is no longer valid") than the global handler's ("session has
   * ended"). Letting both write the reason made the banner depend on which
   * promise settled last.
   */
  const verifyingRef = useRef(0)

  /**
   * Tears down everything that belongs to the outgoing identity.
   *
   * Order matters: stop the socket first so a late frame cannot invalidate a
   * query for the new identity, then move the cache scope, then clear. Anything
   * still in flight settles into a scope nothing is subscribed to.
   */
  const teardown = useCallback(
    (reason: string | null) => {
      disconnectRealtime()
      sessionRef.current = null
      clearSession()
      setQueryScope(null)
      queryClient.cancelQueries()
      queryClient.clear()
      setState({ status: 'anonymous', me: null, session: null, reason })
    },
    [queryClient],
  )

  const signOut = useCallback(
    (reason?: string) => {
      teardown(reason ?? null)
    },
    [teardown],
  )

  useEffect(() => {
    configureApi({
      token: () => sessionRef.current?.token ?? null,
      unauthorized: () => {
        // The API has no refresh endpoint for local or demo tokens, and a
        // Supabase refresh belongs to its own SDK. Rather than invent one, the
        // session ends and the sign-in page explains why.
        if (sessionRef.current && verifyingRef.current === 0) {
          teardown('Your session has ended. Sign in to continue.')
        }
      },
    })
  }, [teardown])

  /** Loads `/me` for a token and installs it as the acting identity. */
  const establish = useCallback(
    async (session: StoredSession): Promise<Me> => {
      sessionRef.current = session
      setQueryScope(null)
      verifyingRef.current += 1
      try {
        const me = await identity.me()
        sessionRef.current = session
        saveSession(session)
        setQueryScope(me.profileId)
        setState({ status: 'authenticated', me, session, reason: null })
        return me
      } finally {
        verifyingRef.current -= 1
      }
    },
    [],
  )

  const adopt = useCallback(
    async (token: AuthToken, source: TokenSource) => {
      // A new identity must not inherit the previous one's cached reads.
      disconnectRealtime()
      queryClient.cancelQueries()
      queryClient.clear()

      const session: StoredSession = {
        token: token.accessToken,
        source,
        email: token.email ?? null,
        expiresAt: expiryFromSeconds(token.expiresIn),
      }
      try {
        return await establish(session)
      } catch (error) {
        teardown(
          error instanceof ApiError
            ? error.message
            : 'That sign-in succeeded but the workspace profile could not be loaded.',
        )
        throw error
      }
    },
    [establish, queryClient, teardown],
  )

  const refresh = useCallback(async () => {
    if (!sessionRef.current) return
    try {
      const me = await identity.me()
      setQueryScope(me.profileId)
      setState((previous) => ({ ...previous, status: 'authenticated', me, reason: null }))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return // teardown already ran
      throw error
    }
  }, [])

  // Restore a stored session once, on first mount.
  useEffect(() => {
    let cancelled = false
    const stored = loadSession()

    if (!stored) {
      // Preserve a reason already set by the expired-session branch above.
      // React StrictMode runs this effect twice in development: the first run
      // clears the expired token and records why, and without this guard the
      // second run would reset the state and silently drop the explanation.
      setState((previous) =>
        previous.reason
          ? previous
          : { status: 'anonymous', me: null, session: null, reason: null },
      )
      return
    }
    if (isExpired(stored)) {
      clearSession()
      setState({
        status: 'anonymous',
        me: null,
        session: null,
        reason: 'Your previous session expired. Sign in to continue.',
      })
      return
    }

    void establish(stored).catch(() => {
      if (cancelled) return
      clearSession()
      sessionRef.current = null
      setQueryScope(null)
      setState({
        status: 'anonymous',
        me: null,
        session: null,
        reason: 'Your saved sign-in is no longer valid. Sign in to continue.',
      })
    })

    return () => {
      cancelled = true
    }
  }, [establish])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, adopt, signOut, refresh }),
    [state, adopt, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
