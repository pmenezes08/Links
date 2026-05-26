import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { computeKeyboardLift, readCssPxVar, readVisualViewportImeInset } from '../utils/keyboardLift'

const VISUAL_VIEWPORT_KEYBOARD_THRESHOLD = 48
const NATIVE_KEYBOARD_MIN_HEIGHT = 60

type UseFixedComposerKeyboardOptions = {
  /** Called after keyboard offset reset (visibility/resume) to nudge scroll containers. */
  onLayoutNudge?: () => void
}

export function useFixedComposerKeyboard(options: UseFixedComposerKeyboardOptions = {}) {
  const { onLayoutNudge } = options
  const onLayoutNudgeRef = useRef(onLayoutNudge)
  onLayoutNudgeRef.current = onLayoutNudge

  const keyboardOffsetRef = useRef(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const viewportBaseRef = useRef<number | null>(null)
  const [viewportLift, setViewportLift] = useState(0)
  const [androidImeInset, setAndroidImeInset] = useState(0)
  const [safeBottomPx, setSafeBottomPx] = useState(0)

  const isAndroid = Capacitor.getPlatform() === 'android'

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncSafeBottom = () => {
      if (keyboardOffsetRef.current > 0) return
      const next = readCssPxVar('--sab-px')
      setSafeBottomPx(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }

    syncSafeBottom()
    window.addEventListener('resize', syncSafeBottom)
    window.visualViewport?.addEventListener('resize', syncSafeBottom)

    return () => {
      window.removeEventListener('resize', syncSafeBottom)
      window.visualViewport?.removeEventListener('resize', syncSafeBottom)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null
    const isWeb = Capacitor.getPlatform() === 'web'

    const updateOffset = () => {
      if (isAndroid) {
        const ime = readVisualViewportImeInset(VISUAL_VIEWPORT_KEYBOARD_THRESHOLD)
        setAndroidImeInset(prev => (Math.abs(prev - ime) < 1 ? prev : ime))
        keyboardOffsetRef.current = ime
        setKeyboardOffset(ime)
        setViewportLift(ime)
        return
      }

      const currentHeight = viewport.height
      if (
        viewportBaseRef.current === null ||
        currentHeight > (viewportBaseRef.current ?? currentHeight) - 4
      ) {
        viewportBaseRef.current = currentHeight
      }
      const baseHeight = viewportBaseRef.current ?? currentHeight
      const rawOffset = isWeb
        ? Math.max(0, baseHeight - currentHeight - viewport.offsetTop)
        : Math.max(0, baseHeight - currentHeight)
      const nextOffset = rawOffset < VISUAL_VIEWPORT_KEYBOARD_THRESHOLD ? 0 : rawOffset
      setViewportLift(prev => (Math.abs(prev - nextOffset) < 1 ? prev : nextOffset))
      if (Math.abs(keyboardOffsetRef.current - nextOffset) < 1) return
      keyboardOffsetRef.current = nextOffset
      setKeyboardOffset(nextOffset)
    }

    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }

    viewport.addEventListener('resize', handleChange)
    viewport.addEventListener('scroll', handleChange)
    handleChange()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
      viewport.removeEventListener('scroll', handleChange)
    }
  }, [isAndroid])

  useEffect(() => {
    const nudgeLayout = () => {
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
      setViewportLift(0)
      setAndroidImeInset(0)
      viewportBaseRef.current = null
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
        requestAnimationFrame(() => {
          onLayoutNudgeRef.current?.()
        })
      })
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') nudgeLayout()
    }
    document.addEventListener('visibilitychange', onVisibility)

    let resumeHandle: PluginListenerHandle | undefined
    const setupResume = async () => {
      if (!Capacitor.isNativePlatform()) return
      const { App } = await import('@capacitor/app')
      resumeHandle = await App.addListener('resume', nudgeLayout)
    }
    void setupResume()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void resumeHandle?.remove()
    }
  }, [])

  // iOS only — Android uses visualViewport IME inset (Capacitor plugin over-reports with adjustNothing).
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const normalizeHeight = (raw: number) => (raw < NATIVE_KEYBOARD_MIN_HEIGHT ? 0 : raw)

    const handleShow = (info: KeyboardInfo) => {
      const height = normalizeHeight(info?.keyboardHeight ?? 0)
      if (height === 0) return
      if (Math.abs(keyboardOffsetRef.current - height) < 2) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
    }

    const handleHide = () => {
      if (keyboardOffsetRef.current === 0) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
    }

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => {
      showSub = handle
    })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => {
      hideSub = handle
    })

    return () => {
      showSub?.remove()
      hideSub?.remove()
    }
  }, [])

  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = isAndroid
    ? androidImeInset
    : computeKeyboardLift(liftSource)
  const showKeyboard = keyboardLift > 0

  return {
    keyboardOffset,
    viewportLift,
    liftSource,
    keyboardLift,
    showKeyboard,
    safeBottomPx,
  }
}
