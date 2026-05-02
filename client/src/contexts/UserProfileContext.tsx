import { createContext, useContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export type UserProfile = Record<string, unknown> | null

export type UserProfileContextValue = {
  profile: UserProfile
  setProfile: Dispatch<SetStateAction<UserProfile>>
  /**
   * Apply a full server profile (same side effects as a successful
   * loadProfile fetch, without toggling loading).
   *
   * `loginId` is the per-session epoch returned by `/api/profile_me`
   * starting in PR 2. When it differs from the value cached in
   * `localStorage.last_login_id`, App.tsx triggers
   * `resetAllAccountState` + reload — that is the second-line guarantee
   * a new login cannot inherit any state from the previous identity.
   * Older callers may omit it; the contract degrades gracefully.
   */
  applyProfileFromServer: (
    profile: Record<string, unknown>,
    loginId?: string,
  ) => void
  loading: boolean
  error: string | null
  refresh: () => Promise<UserProfile>
}

export const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined)

export function useUserProfile(): UserProfileContextValue {
  const context = useContext(UserProfileContext)
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileContext.Provider')
  }
  return context
}
