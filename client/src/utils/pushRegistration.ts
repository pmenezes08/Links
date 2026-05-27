/** Block native/web push server registration until the next authenticated login. */
export const PUSH_BLOCK_UNTIL_LOGIN_KEY = 'push_block_until_login'

export function setPushRegistrationBlocked(): void {
  try {
    localStorage.setItem(PUSH_BLOCK_UNTIL_LOGIN_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function clearPushRegistrationBlocked(): void {
  try {
    localStorage.removeItem(PUSH_BLOCK_UNTIL_LOGIN_KEY)
  } catch {
    /* ignore */
  }
}

export function isPushRegistrationBlocked(): boolean {
  try {
    return localStorage.getItem(PUSH_BLOCK_UNTIL_LOGIN_KEY) === '1'
  } catch {
    return false
  }
}

/** POST FCM/APNs token to the backend only when registration is allowed (logged-in session). */
export async function registerFcmTokenWithServer(
  token: string,
  platform: string,
): Promise<boolean> {
  const normalized = token.trim()
  if (!normalized) return false
  if (isPushRegistrationBlocked()) {
    console.log('📴 Skipping push server registration until login')
    return false
  }

  try {
    const response = await fetch('/api/push/register_fcm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: normalized, platform }),
    })
    if (response.ok) {
      console.log('✅ FCM token registered with server')
      return true
    }
    console.warn('register_fcm response:', response.status)
  } catch (error) {
    console.warn('register_fcm failed:', error)
  }
  return false
}
