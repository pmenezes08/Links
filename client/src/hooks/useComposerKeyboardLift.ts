import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { computeKeyboardLift } from '../utils/keyboardLift'

const VISUAL_VIEWPORT_KEYBOARD_THRESHOLD = 48
const NATIVE_KEYBOARD_MIN_HEIGHT = 60
const KEYBOARD_OFFSET_EPSILON = 6

export interface UseComposerKeyboardLiftOptions {
  isMobile?: boolean
  onKeyboardOpen?: () => void
}

/**
 * Slim keyboard lift tracker for fixed bottom composers (Networking Steve bar, etc.).
 */
export function useComposerKeyboardLift({
  isMobile = typeof window !== 'undefined' &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
  onKeyboardOpen,
}: UseComposerKeyboardLiftOptions = {}) {
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [viewportLift, setViewportLift] = useState(0)
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  const keyboardOffsetRef = useRef(0)
  const viewportBaseRef = useRef<number | null>(null)
  const onKeyboardOpenRef = useRef(onKeyboardOpen)
  onKeyboardOpenRef.current = onKeyboardOpen

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;opacity:0;z-index:-1'
    document.body.appendChild(probe)
    const update = () => {
      const next = probe.getBoundingClientRect().height || 0
      setSafeBottomPx(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      probe.remove()
    }
  }, [])

  const nudge = useCallback(() => {
    onKeyboardOpenRef.current?.()
  }, [])

  useEffect(() => {
    if (!isMobile) return
    if (Capacitor.getPlatform() !== 'web') return
    const viewport = window.visualViewport
    if (!viewport) return
    let rafId: number | null = null
    const updateOffset = () => {
      const h = viewport.height
      if (viewportBaseRef.current === null || h > (viewportBaseRef.current ?? h) - 4) {
        viewportBaseRef.current = h
      }
      const base = viewportBaseRef.current ?? h
      const raw = Math.max(0, base - h)
      const offset = raw < VISUAL_VIEWPORT_KEYBOARD_THRESHOLD ? 0 : raw
      if (Math.abs(keyboardOffsetRef.current - offset) < 5) return
      keyboardOffsetRef.current = offset
      setViewportLift(offset)
      setKeyboardOffset(offset)
      if (offset > 0) requestAnimationFrame(nudge)
    }
    const onChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }
    viewport.addEventListener('resize', onChange)
    onChange()
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', onChange)
    }
  }, [isMobile, nudge])

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined
    const norm = (v: number) => (v < NATIVE_KEYBOARD_MIN_HEIGHT ? 0 : v)
    const onShow = (info: KeyboardInfo) => {
      const h = norm(info?.keyboardHeight ?? 0)
      if (Math.abs(keyboardOffsetRef.current - h) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = h
      setKeyboardOffset(h)
      requestAnimationFrame(nudge)
    }
    const onHide = () => {
      if (Math.abs(keyboardOffsetRef.current) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
    }
    Keyboard.addListener('keyboardWillShow', onShow).then(s => {
      showSub = s
    })
    Keyboard.addListener('keyboardWillHide', onHide).then(s => {
      hideSub = s
    })
    return () => {
      showSub?.remove()
      hideSub?.remove()
    }
  }, [nudge])

  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = computeKeyboardLift(liftSource)
  const showKeyboard = liftSource > 50

  return { keyboardLift, showKeyboard, safeBottomPx, liftSource }
}
