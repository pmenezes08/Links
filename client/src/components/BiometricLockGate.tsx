import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import BrandLogo from './BrandLogo'
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

// Presenting the OS biometric prompt itself fires appStateChange (inactive→active). Without
// guarding, that re-triggers the prompt on the trailing `active`, looping forever. We ignore
// state changes while a prompt is in flight AND for a short window after one ends, and only
// auto-prompt when actually locked.
const PROMPT_SETTLE_MS = 1200

/**
 * Full-screen biometric lock. Self-reads the opt-in flag, so the App only has to mount it
 * once. Locks on cold start and whenever the app is backgrounded (which also covers the
 * iOS app-switcher snapshot), re-prompting on a genuine return. No-op on web / when disabled.
 */
export default function BiometricLockGate() {
  const supported = isBiometricLockSupported()
  // Start locked if enabled so content never flashes before the first prompt.
  const [locked, setLockedState] = useState(() => supported && isBiometricLockEnabled())
  const [verifying, setVerifying] = useState(false)
  const lockedRef = useRef(locked)
  const verifyingRef = useRef(false)
  const lastPromptEndRef = useRef(0)

  const setLocked = useCallback((v: boolean) => {
    lockedRef.current = v
    setLockedState(v)
    // When locking, drop focus and hide the native keyboard so it can't sit on top of
    // the lock screen (e.g. backgrounded while a chat composer was focused).
    if (v) {
      try {
        ;(document.activeElement as HTMLElement | null)?.blur()
      } catch {
        /* ignore */
      }
      void import('@capacitor/keyboard').then(({ Keyboard }) => Keyboard.hide()).catch(() => {})
    }
  }, [])

  const tryUnlock = useCallback(async () => {
    if (verifyingRef.current || !lockedRef.current) return
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
      // On failure/cancel we stay locked and let the user tap "Unlock" to retry — we do NOT
      // auto-retry, which (combined with the settle window below) is what stops the loop.
    } finally {
      verifyingRef.current = false
      lastPromptEndRef.current = Date.now()
      setVerifying(false)
    }
  }, [setLocked])

  // Cold start: prompt once if enabled.
  useEffect(() => {
    if (!supported || !isBiometricLockEnabled()) return
    setLocked(true)
    void tryUnlock()
  }, [supported, setLocked, tryUnlock])

  // Re-lock on a real background; re-prompt on a real foreground. Transitions caused by the
  // prompt itself are filtered by the verifying guard + settle window.
  useEffect(() => {
    if (!supported) return
    let sub: PluginListenerHandle | null = null
    let removed = false
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isBiometricLockEnabled()) return
      if (verifyingRef.current) return // ignore the inactive/active pair the prompt triggers
      if (!isActive) {
        setLocked(true)
      } else if (lockedRef.current && Date.now() - lastPromptEndRef.current > PROMPT_SETTLE_MS) {
        void tryUnlock()
      }
    }).then(s => {
      if (removed) void s.remove()
      else sub = s
    })
    return () => {
      removed = true
      sub?.remove()
    }
  }, [supported, setLocked, tryUnlock])

  if (!supported || !locked || typeof document === 'undefined') return null

  // Portal to <body> so the overlay escapes any ancestor stacking context and reliably
  // covers the fixed dashboard nav bar (z-900) and any focused composer.
  return createPortal(
    <div
      className="theme-always-dark fixed inset-0 z-[2147483600] flex flex-col items-center justify-center gap-8 bg-black px-8"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex flex-col items-center gap-4">
        <BrandLogo className="h-20 w-20 rounded-3xl object-contain" />
        <div className="flex items-center gap-2 text-white">
          <i className="fa-solid fa-lock text-sm text-cpoint-turquoise" />
          <span className="text-lg font-semibold">C-Point is locked</span>
        </div>
        <div className="text-center text-sm text-white/45">Unlock with biometrics to continue</div>
      </div>
      <button
        type="button"
        onClick={() => void tryUnlock()}
        disabled={verifying}
        className="min-w-[180px] rounded-full bg-cpoint-turquoise px-6 py-3 font-bold text-black active:opacity-80 disabled:opacity-60"
      >
        {verifying ? <i className="fa-solid fa-spinner fa-spin" /> : 'Unlock'}
      </button>
    </div>,
    document.body,
  )
}
