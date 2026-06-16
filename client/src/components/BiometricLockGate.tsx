import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import {
  isBiometricLockSupported,
  isBiometricLockEnabled,
  getBiometryInfo,
  verifyBiometric,
  type BiometricPromptStrings,
} from '../utils/biometricLock'

// English strings to match the settings surface (PrivacySecurityPanel) which is English-only.
const PROMPT: BiometricPromptStrings = {
  reason: 'Unlock C-Point',
  cancelTitle: 'Cancel',
  iosFallbackTitle: 'Use passcode',
  androidTitle: 'Unlock C-Point',
  androidSubtitle: 'Verify your identity to continue',
}

/**
 * Full-screen biometric lock. Self-reads the opt-in flag, so the App only has to mount it
 * once. Locks on cold start and whenever the app is backgrounded (which also covers the
 * iOS app-switcher snapshot), re-prompting on return. No-op on web / when disabled.
 */
export default function BiometricLockGate() {
  const supported = isBiometricLockSupported()
  // Start locked if enabled so content never flashes before the first prompt.
  const [locked, setLocked] = useState(() => supported && isBiometricLockEnabled())
  const [verifying, setVerifying] = useState(false)
  const verifyingRef = useRef(false)

  const tryUnlock = useCallback(async () => {
    if (verifyingRef.current) return
    verifyingRef.current = true
    setVerifying(true)
    try {
      // Fail-open if biometrics were removed/disabled at the OS level — never brick the app.
      const info = await getBiometryInfo()
      if (!info.available) {
        setLocked(false)
        return
      }
      if (await verifyBiometric(PROMPT)) setLocked(false)
    } finally {
      verifyingRef.current = false
      setVerifying(false)
    }
  }, [])

  // Cold start: prompt once if enabled.
  useEffect(() => {
    if (!supported || !isBiometricLockEnabled()) return
    setLocked(true)
    void tryUnlock()
  }, [supported, tryUnlock])

  // Re-lock on background; re-prompt on resume. Reads the flag live so a just-enabled
  // lock engages on the next background→foreground cycle without any extra wiring.
  useEffect(() => {
    if (!supported) return
    let sub: PluginListenerHandle | null = null
    let removed = false
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isBiometricLockEnabled()) return
      if (!isActive) setLocked(true)
      else void tryUnlock()
    }).then(s => {
      if (removed) void s.remove()
      else sub = s
    })
    return () => {
      removed = true
      sub?.remove()
    }
  }, [supported, tryUnlock])

  if (!supported || !locked) return null

  return (
    <div
      className="theme-always-dark fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-7 bg-black px-8"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cpoint-turquoise/15">
          <i className="fa-solid fa-lock text-2xl text-cpoint-turquoise" />
        </div>
        <div className="text-lg font-semibold text-white">C-Point is locked</div>
        <div className="text-center text-sm text-white/50">Unlock with biometrics to continue</div>
      </div>
      <button
        type="button"
        onClick={() => void tryUnlock()}
        disabled={verifying}
        className="min-w-[180px] rounded-full bg-cpoint-turquoise px-6 py-3 font-bold text-black active:opacity-80 disabled:opacity-60"
      >
        {verifying ? <i className="fa-solid fa-spinner fa-spin" /> : 'Unlock'}
      </button>
    </div>
  )
}
