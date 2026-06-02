import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { useTranslation } from 'react-i18next'
import { CPOINT_EASE_OUT, PAGE_TRANSITION_MS, REDUCED_MOTION_FADE_MS } from '../design/motion'
import { hapticImpactLight, hapticSelection } from '../utils/haptics'
import { NativeIconButton } from './NativeIconButton'

export type GifSelection = {
  id: string
  url: string
  previewUrl: string
}

type GifPickerProps = {
  isOpen: boolean
  onClose: () => void
  onSelect: (gif: GifSelection) => void
}

type GiphyItem = {
  id: string
  images?: {
    original?: { url?: string }
    downsized_medium?: { url?: string }
    fixed_width?: { url?: string }
    fixed_width_downsampled?: { url?: string }
    fixed_width_small?: { url?: string }
    preview_gif?: { url?: string }
    original_still?: { url?: string }
  }
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const SHEET_MIN_HEIGHT_PX = 320
const SHEET_MAX_HEIGHT_PX = 560
const SHEET_HEIGHT_RATIO = 0.6
const DRAG_DISMISS_THRESHOLD_RATIO = 0.3
const DRAG_DISMISS_VELOCITY_PX_PER_S = 600
const DRAG_START_THRESHOLD_PX = 6
const SHEET_VIEWPORT_MARGIN_PX = 12

function isIosCapacitor(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (window as any).Capacitor?.getPlatform?.() === 'ios'
  } catch {
    return false
  }
}

function isAndroidCapacitor(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}

function detectPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function getInitialViewportHeight(): number {
  if (typeof window === 'undefined') return 600
  return window.visualViewport?.height || window.innerHeight || 600
}

function readSafeAreaTopPx(): number {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 0
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--sat-px').trim()
    if (raw) {
      const parsed = parseFloat(raw)
      if (!Number.isNaN(parsed) && parsed >= 0) return parsed
    }
  } catch {}
  try {
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px);'
    document.body.appendChild(probe)
    const measured = probe.getBoundingClientRect().height
    document.body.removeChild(probe)
    if (!Number.isNaN(measured) && measured >= 0) return measured
  } catch {}
  return 0
}

export default function GifPicker({ isOpen, onClose, onSelect }: GifPickerProps){
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GifSelection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [keyLoading, setKeyLoading] = useState(false)

  const [useProxy] = useState(true)

  const envKey = useMemo(() => {
    const raw = (import.meta as any)?.env?.VITE_GIPHY_API_KEY
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  }, [])

  const [apiKey, setApiKey] = useState<string | null>(envKey)

  // Sheet/motion state
  const [mounted, setMounted] = useState(isOpen)
  const [entered, setEntered] = useState(false)
  const [reducedMotion, setReducedMotion] = useState<boolean>(detectPrefersReducedMotion)
  const [keyboardLift, setKeyboardLift] = useState(0)
  const [vvHeight, setVvHeight] = useState<number>(getInitialViewportHeight)
  const [safeAreaTopPx, setSafeAreaTopPx] = useState<number>(0)

  // Drag-to-dismiss state
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [dragTransition, setDragTransition] = useState(false)

  const sheetRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const dragTransitionTimerRef = useRef<number | null>(null)
  const dragStateRef = useRef<{
    startY: number
    lastY: number
    lastTime: number
    velocity: number
    sheetHeight: number
    started: boolean
    active: boolean
  }>({ startY: 0, lastY: 0, lastTime: 0, velocity: 0, sheetHeight: 0, started: false, active: false })

  const isIosNative = useMemo(() => isIosCapacitor(), [])
  const isAndroidNative = useMemo(() => isAndroidCapacitor(), [])

  const sheetHeight = useMemo(() => {
    const base = Math.min(
      SHEET_MAX_HEIGHT_PX,
      Math.max(SHEET_MIN_HEIGHT_PX, vvHeight * SHEET_HEIGHT_RATIO),
    )
    const clamped = base - safeAreaTopPx - 8
    const computedBase = Math.max(SHEET_MIN_HEIGHT_PX, clamped)
    const available = vvHeight - keyboardLift - safeAreaTopPx - SHEET_VIEWPORT_MARGIN_PX
    return Math.min(computedBase, Math.max(SHEET_MIN_HEIGHT_PX, available))
  }, [vvHeight, safeAreaTopPx, keyboardLift])

  // ESC key dismiss
  useEffect(() => {
    if (!isOpen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape'){
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Measure safe-area-inset-top once on open so the sheet height accounts for
  // the iOS status bar / notch. Re-measure on viewport size changes (rotation).
  useEffect(() => {
    if (!isOpen) return
    const sync = () => setSafeAreaTopPx(prev => {
      const next = readSafeAreaTopPx()
      return Math.abs(prev - next) < 0.5 ? prev : next
    })
    sync()
    if (typeof window === 'undefined') return
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [isOpen])

  // Reset query/results on open
  useEffect(() => {
    if (!isOpen) return
    if (Capacitor.getPlatform() === 'android') {
      const active = document.activeElement
      if (active instanceof HTMLElement) {
        active.blur()
      }
    }
    setQuery('')
    setDebouncedQuery('')
    setResults([])
    setError(null)
  }, [isOpen])

  // Debounce search input
  useEffect(() => {
    if (!isOpen) return
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [query, isOpen])

  // GIPHY fetch — UNCHANGED logic from prior implementation
  const loadGifs = useCallback(async (searchTerm: string, signal: AbortSignal) => {
    setLoading(true)
    setError(null)
    const endpoint = searchTerm ? 'search' : 'trending'

    try{
      let res: Response
      if (useProxy || !apiKey) {
        const params = new URLSearchParams({ endpoint, limit: '24', rating: 'pg-13' })
        if (searchTerm) params.set('q', searchTerm)
        res = await fetch(`/api/giphy/search?${params.toString()}`, { signal, credentials: 'include', headers: { 'Accept': 'application/json' } })
      } else {
        const params = new URLSearchParams({ api_key: apiKey, limit: '24', rating: 'pg-13' })
        if (searchTerm) params.set('q', searchTerm)
        res = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`, { signal })
      }
      if (!res.ok){
        if (res.status === 403){
          throw new Error('GIPHY API key rejected (HTTP 403)')
        }
        if (res.status === 503){
          throw new Error('GIF search is not configured on the server (GIPHY_API_KEY missing)')
        }
        throw new Error(`GIPHY request failed: ${res.status}`)
      }
      const data = await res.json() as { data?: GiphyItem[] }
      const mapped = (data?.data || []).map((item) => {
        const imgs = item.images || {}
        const original = imgs.original?.url || imgs.downsized_medium?.url || imgs.fixed_width?.url
        const thumb = imgs.fixed_width_small?.url || imgs.preview_gif?.url || imgs.original_still?.url || original
        if (!original) return null
        return {
          id: item.id,
          url: original,
          previewUrl: thumb || original,
        }
      }).filter((item): item is GifSelection => Boolean(item && item.url))
      setResults(mapped)
    }catch (err){
      if ((err as Error).name === 'AbortError') return
      console.error('GIF search error', err)
      const message = (err as Error).message.includes('GIPHY API key rejected')
        ? 'GIF search requires a valid GIPHY API key. Ask an admin to configure VITE_GIPHY_API_KEY.'
        : 'Failed to load GIFs. Please try again.'
      setError(message)
    }finally{
      setLoading(false)
    }
  }, [apiKey, useProxy])

  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    loadGifs(debouncedQuery, controller.signal)
    return () => controller.abort()
  }, [debouncedQuery, isOpen, loadGifs])

  // GIPHY API key bootstrap — UNCHANGED logic from prior implementation
  useEffect(() => {
    if (!isOpen) return
    if (apiKey || useProxy) { setKeyLoading(false); return }
    let cancelled = false
    setKeyLoading(true)
    setError(null)
    fetch('/api/config/giphy_key', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json().catch(() => null)
      })
      .then((json) => {
        if (!json || cancelled) return
        if (json?.success && json.key){
          setApiKey(String(json.key))
        }else{
          setError('GIF search requires a valid GIPHY API key. Ask an admin to configure it in the server environment.')
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load GIPHY API key', err)
        setError('Unable to load GIF configuration from server. Please try again later.')
      })
      .finally(() => {
        if (!cancelled) setKeyLoading(false)
      })
    return () => { cancelled = true }
  }, [apiKey, isOpen])

  // prefers-reduced-motion subscription
  useEffect(() => {
    if (typeof window === 'undefined') return
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    } catch {
      return
    }
    const handler = () => setReducedMotion(mq.matches)
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else if ((mq as any).addListener) (mq as any).addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else if ((mq as any).removeListener) (mq as any).removeListener(handler)
    }
  }, [])

  // Mount / enter / exit lifecycle for slide-up animation
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current =
        typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
      setMounted(true)
      let raf1: number | null = null
      let raf2: number | null = null
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setEntered(true))
      })
      return () => {
        if (raf1 !== null) cancelAnimationFrame(raf1)
        if (raf2 !== null) cancelAnimationFrame(raf2)
      }
    }
    setEntered(false)
    const exitMs = reducedMotion ? REDUCED_MOTION_FADE_MS : PAGE_TRANSITION_MS
    const timer = window.setTimeout(() => {
      setMounted(false)
      setDragY(0)
      setDragging(false)
      setDragTransition(false)
      const prev = previousFocusRef.current
      previousFocusRef.current = null
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus({ preventScroll: true } as FocusOptions) } catch { try { prev.focus() } catch {} }
      }
    }, exitMs)
    return () => window.clearTimeout(timer)
  }, [isOpen, reducedMotion])

  // visualViewport keyboard lift + height (mirrors CommentReply.tsx :349-374 RAF pattern)
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      setKeyboardLift(0)
      return
    }
    const viewport = window.visualViewport
    if (!viewport) {
      setKeyboardLift(0)
      setVvHeight(window.innerHeight)
      return
    }
    let rafId: number | null = null
    const update = () => {
      const lift = Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
      setKeyboardLift(prev => (Math.abs(prev - lift) < 1 ? prev : lift))
      const nextH = viewport.height
      setVvHeight(prev => (Math.abs(prev - nextH) < 1 ? prev : nextH))
    }
    const schedule = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(update)
    }
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    update()
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      setKeyboardLift(0)
    }
  }, [isOpen])

  // Programmatic focus on iOS (autoFocus prop covers other platforms)
  useEffect(() => {
    if (!mounted || !isIosNative) return
    const t = window.setTimeout(() => {
      try { inputRef.current?.focus() } catch {}
    }, 50)
    return () => window.clearTimeout(t)
  }, [mounted, isIosNative])

  // Android: defer search focus until sheet enter animation completes
  useEffect(() => {
    if (!mounted || !entered || !isAndroidNative) return
    const delay = reducedMotion ? REDUCED_MOTION_FADE_MS : PAGE_TRANSITION_MS
    const timer = window.setTimeout(() => {
      try { inputRef.current?.focus() } catch {}
    }, delay)
    return () => window.clearTimeout(timer)
  }, [mounted, entered, isAndroidNative, reducedMotion])

  // IntersectionObserver — pause off-screen GIF tiles, resume when visible
  useEffect(() => {
    if (!mounted || typeof IntersectionObserver === 'undefined') return
    const root = gridRef.current
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const img = entry.target as HTMLImageElement
        const realSrc = img.dataset.src
        if (!realSrc) return
        const paused = img.dataset.paused === '1'
        if (entry.isIntersecting && paused) {
          img.src = realSrc
          img.dataset.paused = '0'
        } else if (!entry.isIntersecting && !paused) {
          img.src = TRANSPARENT_PIXEL
          img.dataset.paused = '1'
        }
      })
    }, { root, rootMargin: '256px', threshold: 0 })
    observerRef.current = observer
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [mounted])

  const tileImgRef = useCallback((node: HTMLImageElement | null) => {
    if (!node) return
    const obs = observerRef.current
    if (obs) obs.observe(node)
  }, [])

  // Cleanup any pending drag transition timer on unmount
  useEffect(() => {
    return () => {
      if (dragTransitionTimerRef.current !== null) {
        window.clearTimeout(dragTransitionTimerRef.current)
        dragTransitionTimerRef.current = null
      }
    }
  }, [])

  // Drag-to-dismiss — pointer-down on the drag-affordance area only.
  // Uses window-level move/up listeners with a small movement threshold so
  // tapping the search input still focuses normally instead of stealing the
  // click. Grid scrolling is unaffected because its pointer-down is on a
  // sibling element, not this handler.
  const handleDragPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (dragTransition) return
    const sheetRect = sheetRef.current?.getBoundingClientRect()
    const sheetH = sheetRect?.height || sheetHeight
    const now = performance.now()
    dragStateRef.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: now,
      velocity: 0,
      sheetHeight: sheetH,
      started: false,
      active: true,
    }

    const onMove = (e: PointerEvent) => {
      const state = dragStateRef.current
      if (!state.active) return
      const t1 = performance.now()
      const delta = e.clientY - state.startY
      if (!state.started) {
        if (delta < 0) {
          // Upward motion — not a dismiss gesture; ignore until a downward
          // movement past threshold occurs.
          state.lastY = e.clientY
          state.lastTime = t1
          return
        }
        if (delta < DRAG_START_THRESHOLD_PX) {
          state.lastY = e.clientY
          state.lastTime = t1
          return
        }
        state.started = true
        setDragging(true)
      }
      const next = Math.max(0, delta)
      const dt = t1 - state.lastTime
      if (dt > 0) {
        state.velocity = (e.clientY - state.lastY) / (dt / 1000)
      }
      state.lastY = e.clientY
      state.lastTime = t1
      setDragY(next)
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }

    const onCancel = () => {
      const state = dragStateRef.current
      cleanup()
      state.active = false
      if (!state.started) return
      setDragging(false)
      setDragY(0)
      setDragTransition(true)
      if (dragTransitionTimerRef.current !== null) window.clearTimeout(dragTransitionTimerRef.current)
      dragTransitionTimerRef.current = window.setTimeout(() => {
        dragTransitionTimerRef.current = null
        setDragTransition(false)
      }, reducedMotion ? REDUCED_MOTION_FADE_MS : PAGE_TRANSITION_MS) as unknown as number
    }

    const onUp = (e: PointerEvent) => {
      const state = dragStateRef.current
      cleanup()
      if (!state.active) return
      state.active = false
      if (!state.started) return
      const sheetH2 = state.sheetHeight
      const dragDistance = Math.max(0, e.clientY - state.startY)
      const velocity = state.velocity
      const shouldDismiss =
        dragDistance >= sheetH2 * DRAG_DISMISS_THRESHOLD_RATIO ||
        velocity >= DRAG_DISMISS_VELOCITY_PX_PER_S
      setDragging(false)
      if (shouldDismiss) {
        // Slide the rest of the way down via the dragTransition path; then
        // notify the parent. Parent's isOpen=false will run the regular
        // unmount cleanup which clears dragY/dragTransition.
        setDragY(sheetH2)
        setDragTransition(true)
        // Drag-dismiss is the only path that gets a haptic; tap-outside,
        // Esc, and programmatic close stay silent so the closing surface
        // doesn't double up on the caller's own dismiss UX.
        hapticImpactLight()
        onClose()
      } else {
        setDragY(0)
        setDragTransition(true)
        if (dragTransitionTimerRef.current !== null) window.clearTimeout(dragTransitionTimerRef.current)
        dragTransitionTimerRef.current = window.setTimeout(() => {
          dragTransitionTimerRef.current = null
          setDragTransition(false)
        }, reducedMotion ? REDUCED_MOTION_FADE_MS : PAGE_TRANSITION_MS) as unknown as number
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }, [dragTransition, sheetHeight, reducedMotion, onClose])

  // Compute sheet style each render
  const sheetStyle = useMemo<CSSProperties>(() => {
    const useDrag = dragging || dragTransition
    let transform: string
    if (reducedMotion) {
      transform = useDrag ? `translateY(${dragY}px)` : 'translateY(0%)'
    } else if (useDrag) {
      transform = `translateY(${dragY}px)`
    } else {
      transform = entered ? 'translateY(0%)' : 'translateY(100%)'
    }
    const opacity = reducedMotion ? (entered ? 1 : 0) : 1
    let transition: string
    if (dragging) {
      transition = 'none'
    } else if (reducedMotion) {
      transition = `opacity ${REDUCED_MOTION_FADE_MS}ms linear`
    } else {
      transition = `transform ${PAGE_TRANSITION_MS}ms ${CPOINT_EASE_OUT}, opacity ${PAGE_TRANSITION_MS}ms linear`
    }
    return {
      transform,
      opacity,
      transition,
      bottom: keyboardLift,
      height: sheetHeight,
      maxHeight: sheetHeight,
      // Defense in depth: an opaque near-black background sits behind the
      // glass material so any caller that forgets to hide its composer still
      // gets an opaque sheet (no bleed-through). The liquid-glass-surface
      // ::before highlight still renders on top via CSS specificity.
      // Respect the iOS status bar / notch so the search row never tucks
      // under the system UI. Pairs with the sheetHeight clamp above.
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }
  }, [dragging, dragTransition, dragY, entered, keyboardLift, reducedMotion, sheetHeight])

  const backdropStyle = useMemo<CSSProperties>(() => {
    let opacity: number
    if (reducedMotion) {
      opacity = entered ? 1 : 0
    } else if (dragging || dragTransition) {
      const sheetH = dragStateRef.current.sheetHeight || sheetHeight
      const ratio = sheetH > 0 ? Math.max(0, Math.min(1, 1 - dragY / sheetH)) : 1
      opacity = entered ? ratio : 0
    } else {
      opacity = entered ? 1 : 0
    }
    const transition = dragging
      ? 'none'
      : `opacity ${reducedMotion ? REDUCED_MOTION_FADE_MS : PAGE_TRANSITION_MS}ms linear`
    return {
      opacity,
      transition,
      pointerEvents: dragging || dragTransition ? 'none' : 'auto',
    }
  }, [dragY, dragging, dragTransition, entered, reducedMotion, sheetHeight])

  if (!mounted) return null

  const trimmedQuery = query.trim()
  const truncatedQuery = trimmedQuery.length > 30 ? `${trimmedQuery.slice(0, 30)}…` : trimmedQuery
  const headerLabel = trimmedQuery ? `Results for "${truncatedQuery}"` : 'Trending'

  const showFullSkeleton = (keyLoading || (loading && results.length === 0)) && !error
  const showInlineLoadingDot = loading && results.length > 0
  const showResults = results.length > 0
  const showEmpty = !loading && !keyLoading && !error && results.length === 0
  const ariaLabel = t('shared.search_gifs') || 'GIF picker'

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[1399] bg-c-hover-bg backdrop-blur-sm"
        style={backdropStyle}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="fixed left-0 right-0 z-[1400] mx-auto sm:max-w-2xl rounded-t-2xl liquid-glass-surface bg-c-bg-elevated border-0 border-t border-c-border flex flex-col overflow-hidden"
        style={sheetStyle}
      >
        {/* Drag-affordance area: handle pill + search row. Pointer-down here
            starts a drag (with 6px movement threshold so taps focus the
            input normally). Grid scrolling is on a sibling element below and
            never starts a drag. */}
        <div
          className="shrink-0 select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={handleDragPointerDown}
        >
          <div className="mx-auto mt-2 mb-1 h-1 w-7 rounded-full bg-white/20" aria-hidden="true" />
          <div className="px-3 pt-1 pb-2 flex items-center">
            <div className="flex-1 min-w-0 min-h-9 rounded-lg border border-c-border bg-c-composer-input-bg flex items-center transition-colors focus-within:border-cpoint-turquoise">
              <i className="fa-solid fa-magnifying-glass text-[12px] text-c-text-tertiary ml-2.5" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                autoFocus={false}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('shared.search_gifs') || 'Search GIFs'}
                aria-label={t('shared.search_gifs') || 'Search GIFs'}
                className="flex-1 min-w-0 bg-transparent px-2 py-1 text-[13px] text-c-text-primary placeholder:text-c-text-tertiary outline-none"
                style={{ touchAction: 'auto' }}
              />
              {query && (
                <NativeIconButton
                  size="sm"
                  variant="muted"
                  preventBlur
                  className="mr-1"
                  aria-label={t('shared.clear_search') || 'Clear search'}
                  onClick={() => setQuery('')}
                >
                  <i className="fa-solid fa-xmark text-[11px]" aria-hidden="true" />
                </NativeIconButton>
              )}
            </div>
            <span className="text-[10px] text-c-text-tertiary tracking-wide uppercase shrink-0 ml-2 mr-2">via GIPHY</span>
          </div>
        </div>

        <div ref={gridRef} className="flex-1 overflow-y-auto px-3 pb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-c-text-tertiary px-1">
              {headerLabel}
            </div>
            {showInlineLoadingDot && (
              <div
                className="flex items-center gap-1 text-[11px] text-c-text-tertiary"
                role="status"
                aria-live="polite"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/60 animate-pulse" aria-hidden="true" />
                <span className="sr-only">Loading</span>
              </div>
            )}
          </div>

          {error && (
            <div className="text-red-400 text-xs px-1 pb-2" role="alert">
              {error}
            </div>
          )}

          {showFullSkeleton ? (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="aspect-[4/3] rounded-md bg-c-hover-bg animate-pulse"
                />
              ))}
            </div>
          ) : showResults ? (
            <div
              className={`grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 transition-opacity duration-150 ${
                showInlineLoadingDot ? 'opacity-60' : 'opacity-100'
              }`}
            >
              {results.map((gif) => (
                <button
                  key={gif.id}
                  type="button"
                  className="relative group aspect-[4/3] rounded-md overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-cpoint-turquoise focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
                  onClick={() => {
                    // Fire selection haptic before onSelect so the tap feels
                    // immediate; selection cue maps to a soft tick on iOS /
                    // Android and a silent no-op on web.
                    hapticSelection()
                    onSelect(gif)
                  }}
                  aria-label="Select GIF"
                >
                  <img
                    ref={tileImgRef}
                    src={gif.previewUrl}
                    data-src={gif.previewUrl}
                    data-paused="0"
                    alt="GIF"
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                  <div
                    className="absolute inset-0 bg-c-hover-bg opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          ) : showEmpty ? (
            <div className="min-h-[160px] flex items-center justify-center">
              <p className="text-[13px] text-c-text-tertiary text-center">
                {t('shared.no_gifs_found_friendly', { defaultValue: 'Nothing matched — try a different search' })}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  )
}
