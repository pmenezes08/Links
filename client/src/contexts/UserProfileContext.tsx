import { createContext, useContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export type UserProfile = Record<string, unknown> | null

export type UserProfileContextValue = {
  profile: UserProfile
  setProfile: Dispatch<SetStateAction<UserProfile>>
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
