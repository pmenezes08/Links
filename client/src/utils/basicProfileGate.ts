export const BASIC_PROFILE_REQUIRED = 'basic_profile_required'
export const BASIC_PROFILE_GATE_EVENT = 'cpoint-basic-profile-required'
export const BASIC_PROFILE_COMPLETED_EVENT = 'cpoint-basic-profile-completed'

export type BasicProfileStatus = {
  complete: boolean
  missing_fields?: string[]
  required_fields?: string[]
  profile?: {
    first_name?: string | null
    last_name?: string | null
    profile_picture?: string | null
  }
}

export type BasicProfileRequiredPayload = {
  error_code?: string
  message_key?: string
  basic_profile?: BasicProfileStatus
}

export function isBasicProfileRequired(payload: unknown): payload is BasicProfileRequiredPayload {
  if (!payload || typeof payload !== 'object') return false
  const data = payload as BasicProfileRequiredPayload
  return data.error_code === BASIC_PROFILE_REQUIRED || data.message_key === BASIC_PROFILE_REQUIRED
}

export function openBasicProfileGate(payload?: BasicProfileRequiredPayload | null) {
  window.dispatchEvent(
    new CustomEvent(BASIC_PROFILE_GATE_EVENT, {
      detail: {
        status: payload?.basic_profile ?? null,
      },
    }),
  )
}

export function handleBasicProfileRequired(payload: unknown): boolean {
  if (!isBasicProfileRequired(payload)) return false
  openBasicProfileGate(payload)
  return true
}
