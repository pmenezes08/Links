import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'

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
  const [safeBottomPx, setSafeBottomPx] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.bottom = '0'
    probe.style.left = '0'
    probe.style.width = '0'
    probe.style.height = 'env(safe-area-inset-bottom, 0px)'
    probe.style.pointerEvents = 'none'
    probe.style.opacity = '0'
    probe.style.zIndex = '-1'
    document.body.appendChild(probe)

    const updateSafeBottom = () => {
      const rect = probe.getBoundingClientRect()
      const next = rect.height || 0
      setSafeBottomPx(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }

    updateSafeBottom()
    window.addEventListener('resize', updateSafeBottom)

    return () => {
      window.removeEventListener('resize', updateSafeBottom)
      probe.remove()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (Capacitor.getPlatform() !== 'web') return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null

    const updateOffset = () => {
      const currentHeight = viewport.height
      if (
        viewportBaseRef.current === null ||
        currentHeight > (viewportBaseRef.current ?? currentHeight) - 4
      ) {
        viewportBaseRef.current = currentHeight
      }
      const baseHeight = viewportBaseRef.current ?? currentHeight
      const nextOffset = Math.max(0, baseHeight - currentHeight - viewport.offsetTop)
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
    updateOffset()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
      viewport.removeEventListener('scroll', handleChange)
    }
  }, [])

  useEffect(() => {
    const nudgeLayout = () => {
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
      setViewportLift(0)
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

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const handleShow = (info: KeyboardInfo) => {
      const height = info?.keyboardHeight ?? 0
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
  const keyboardLift = Math.max(0, liftSource - safeBottomPx)
  const showKeyboard = liftSource > 2

  return {
    keyboardOffset,
    viewportLift,
    liftSource,
    keyboardLift,
    showKeyboard,
    safeBottomPx,
  }
}
