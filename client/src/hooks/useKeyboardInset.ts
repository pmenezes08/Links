import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { readVisualViewportImeInset } from '../utils/keyboardLift'

/** Ignore sub-pixel jitter from the plugin / viewport events. */
const INSET_EPSILON = 2

/**
 * Height in px that the on-screen keyboard currently covers at the bottom of
 * the viewport.
 *
 * Centered dialogs need this because native runs with `Keyboard.resize: 'none'`
 * (see `client/capacitor.config.ts`): the WebView keeps its full height when the
 * IME opens, so `100vh`, `inset-0`, and safe-area insets all still describe the
 * whole screen and the dialog's action row ends up underneath the keyboard.
 * On iOS only the plugin knows the occluded height; on Android and web the
 * `visualViewport` IME inset is the signal (the plugin over-reports on Android
 * under adjustNothing).
 *
 * Pass `enabled` (typically the dialog's open state) so nothing is listening
 * while the surface is closed.
 */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0)
  const insetRef = useRef(0)
  const platform = useMemo(
    () => (typeof window !== 'undefined' ? Capacitor.getPlatform() : 'web'),
    [],
  )

  const update = useCallback((next: number) => {
    const clamped = Math.max(0, Math.round(next))
    if (Math.abs(insetRef.current - clamped) < INSET_EPSILON) return
    insetRef.current = clamped
    setInset(clamped)
  }, [])

  // Web: the visual viewport shrinks under the IME.
  useEffect(() => {
    if (!enabled || platform !== 'web') return
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    let baseHeight: number | null = null
    let rafId: number | null = null

    const measure = () => {
      const current = viewport.height
      // Track the tallest height seen as "keyboard closed" so rotation and
      // browser chrome collapse do not read as a keyboard.
      if (baseHeight === null || current > baseHeight - 4) baseHeight = current
      update((baseHeight ?? current) - current - viewport.offsetTop)
    }

    const onChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(measure)
    }

    viewport.addEventListener('resize', onChange)
    viewport.addEventListener('scroll', onChange)
    measure()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', onChange)
      viewport.removeEventListener('scroll', onChange)
    }
  }, [enabled, platform, update])

  // Android: the plugin over-reports with resize:'none' (adjustNothing), so the
  // visualViewport IME inset is the trustworthy signal — mirrors
  // useFixedComposerKeyboard.
  useEffect(() => {
    if (!enabled || platform !== 'android') return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null
    const onChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => update(readVisualViewportImeInset()))
    }

    viewport.addEventListener('resize', onChange)
    onChange()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', onChange)
    }
  }, [enabled, platform, update])

  // iOS: the plugin is the only source of the occluded height.
  useEffect(() => {
    if (!enabled || platform !== 'ios') return
    let showSub: PluginListenerHandle | undefined
    let resizeSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined
    let disposed = false

    const attach = (handle: PluginListenerHandle, assign: (h: PluginListenerHandle) => void) => {
      if (disposed) void handle.remove()
      else assign(handle)
    }

    const onShow = (info: KeyboardInfo) => update(info?.keyboardHeight ?? 0)
    const onHide = () => update(0)

    void Keyboard.addListener('keyboardWillShow', onShow).then(h => attach(h, x => { showSub = x }))
    void Keyboard.addListener('keyboardDidShow', onShow).then(h => attach(h, x => { resizeSub = x }))
    void Keyboard.addListener('keyboardWillHide', onHide).then(h => attach(h, x => { hideSub = x }))

    return () => {
      disposed = true
      void showSub?.remove()
      void resizeSub?.remove()
      void hideSub?.remove()
    }
  }, [enabled, platform, update])

  // Closed surfaces report no inset, and reopen from a clean slate.
  useEffect(() => {
    if (enabled) return
    insetRef.current = 0
    setInset(0)
  }, [enabled])

  return enabled ? inset : 0
}

/**
 * Mount once at the app root. Publishes the live occluded height as the global
 * `--keyboard-inset` CSS variable on `<html>`.
 *
 * Unlike `--keyboard-offset` (which App.tsx forces to 0 on chat routes because
 * their composers manage their own lift), this variable is always live on every
 * route. Centered dialogs opt in with the `.kb-avoid-center` utility
 * (index.css) instead of wiring per-modal keyboard listeners.
 */
export function useGlobalKeyboardInsetVar(): void {
  const inset = useKeyboardInset(true)
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`)
  }, [inset])
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--keyboard-inset')
    },
    [],
  )
}

export default useKeyboardInset
