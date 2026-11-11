import { useContext } from 'react'

import { AuthContext, type AuthContextValue } from './AuthProvider'

/** The acting identity. Throws outside the provider rather than returning null. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.')
  return value
}

/** The signed-in profile, or null while loading or signed out. */
export function useMe() {
  return useAuth().me
}
