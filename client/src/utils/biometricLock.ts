// Opt-in biometric (Face ID / Touch ID / fingerprint) app-lock. This gates the UI only —
// auth is cookie-based, so NO secret is stored here. The single piece of state is a
// non-secret boolean preference under the `cpoint_` localStorage prefix, which
// clearAccountScopedLocalStorage() (see accountStateReset.ts) already wipes on account
// switch — that satisfies the privacy invariant without a dedicated teardown hook.
//
// Fail-open everywhere: web is a no-op, and if biometrics become unavailable or the flag
// is wiped, the app stays UNLOCKED. We never brick access to a remote-loaded app.
import { Capacitor } from '@capacitor/core'

const LOCK_FLAG_KEY = 'cpoint_biometric_lock_enabled'

export type BiometryKind = 'face' | 'touch' | 'biometric'

export interface BiometryInfo {
  available: boolean
  kind: BiometryKind
}

export interface BiometricPromptStrings {
  reason: string
  cancelTitle: string
  iosFallbackTitle: string
  androidTitle: string
  androidSubtitle: string
}

export function isBiometricLockSupported(): boolean {
  return Capacitor.isNativePlatform()
}

export function isBiometricLockEnabled(): boolean {
  if (!isBiometricLockSupported()) return false
  try {
    return localStorage.getItem(LOCK_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export function setBiometricLockEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(LOCK_FLAG_KEY, '1')
    else localStorage.removeItem(LOCK_FLAG_KEY)
  } catch {
    /* ignore */
  }
}

/** Whether biometric hardware exists AND the user has enrolled, plus the primary kind. */
export async function getBiometryInfo(): Promise<BiometryInfo> {
  if (!isBiometricLockSupported()) return { available: false, kind: 'biometric' }
  try {
    const { BiometricAuth, BiometryType } = await import('@aparajita/capacitor-biometric-auth')
    const r = await BiometricAuth.checkBiometry()
    let kind: BiometryKind = 'biometric'
    if (r.biometryType === BiometryType.faceId || r.biometryType === BiometryType.faceAuthentication) kind = 'face'
    else if (r.biometryType === BiometryType.touchId || r.biometryType === BiometryType.fingerprintAuthentication) kind = 'touch'
    return { available: !!r.isAvailable, kind }
  } catch {
    return { available: false, kind: 'biometric' }
  }
}

/** Present the OS biometric prompt. Returns true ONLY on a verified success. */
export async function verifyBiometric(strings: BiometricPromptStrings): Promise<boolean> {
  if (!isBiometricLockSupported()) return true // web: nothing to gate
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth')
    await BiometricAuth.authenticate({
      reason: strings.reason,
      cancelTitle: strings.cancelTitle,
      iosFallbackTitle: strings.iosFallbackTitle,
      androidTitle: strings.androidTitle,
      androidSubtitle: strings.androidSubtitle,
      // Passcode/PIN fallback so a failing finger or face never locks the user out of
      // their own account on a remote-loaded app.
      allowDeviceCredential: true,
      androidConfirmationRequired: false,
    })
    return true
  } catch {
    // userCancel / authenticationFailed / lockout → stay locked, let the user retry.
    return false
  }
}
