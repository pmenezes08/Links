import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'

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
 * Only the plugin knows the occluded height there. On web there is no plugin, so
 * `visualViewport` is the signal.
 *
 * Pass `enabled` (typically the dialog's open state) so nothing is listening
 * while the surface is closed.
 */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0)
  const insetRef = useRef(0)
  const isNativePlatform = useMemo(
    () => typeof window !== 'undefined' && Capacitor.getPlatform() !== 'web',
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
    if (!enabled || isNativePlatform) return
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
  }, [enabled, isNativePlatform, update])

  // Native: the plugin is the only source of the occluded height.
  useEffect(() => {
    if (!enabled || !isNativePlatform) return
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
  }, [enabled, isNativePlatform, update])

  // Closed surfaces report no inset, and reopen from a clean slate.
  useEffect(() => {
    if (enabled) return
    insetRef.current = 0
    setInset(0)
  }, [enabled])

  return enabled ? inset : 0
}

export default useKeyboardInset
