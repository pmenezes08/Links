import { useCallback, useEffect, useRef, useState } from 'react'

interface ZoomableImageProps {
  src: string
  alt?: string
  className?: string
  maxScale?: number
  // Called when the user requests to close (e.g., ESC when scale=1)
  onRequestClose?: () => void
}

// A self-contained zoomable image with:
// - Click/double-click/tap to toggle zoom in/out
// - Wheel to zoom
// - Pinch to zoom (multi-pointer)
// - Drag to pan when zoomed
// - ESC to reset (or close if already at 1x)
export default function ZoomableImage({ src, alt = 'image', className = '', maxScale = 3, onRequestClose }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  const translateStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // For pinch gestures
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStartDistance = useRef<number | null>(null)
  const pinchStartScale = useRef<number>(1)
  // Image natural dimensions
  const naturalWidthRef = useRef<number>(0)
  const naturalHeightRef = useRef<number>(0)

  // Loading and source candidates (fallbacks)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const candidates: string[] = (() => {
    const p = (src || '').trim()
    const out: string[] = []
    if (!p) return out
    // Handle blob URLs directly (for pasted images, local previews)
    if (p.startsWith('blob:')) return [p]
    if (p.startsWith('data:')) return [p]
    if (p.startsWith('http')) return [p]
    if (p.startsWith('/uploads')) out.push(p)
    if (p.startsWith('uploads/')) out.push('/' + p)
    if (p.startsWith('/static')) out.push(p)
    if (p.startsWith('static/')) out.push('/' + p)
    if (!p.startsWith('/uploads') && !p.startsWith('uploads/') && !p.startsWith('/static') && !p.startsWith('static/')){
      // Include path-preserving fallbacks first
      out.push(`/uploads/${p}`)
      out.push(`/static/${p}`)
      // Also include name-only fallbacks as last resorts
      const nameOnly = p.split('/').slice(-1)[0]
      out.push(`/uploads/${nameOnly}`)
      out.push(`/static/${nameOnly}`)
      out.push(`/static/uploads/${nameOnly}`)
    }
    return Array.from(new Set(out))
  })()
  const [index, setIndex] = useState(0)
  const currentSrc = candidates[index] || ''

  // Base scale (fit-to-contain); use ref to avoid jitter in handlers
  const [minScale, setMinScale] = useState(1)
  const baseScaleRef = useRef(1)

  // Helpers
  function clamp(val: number, min: number, max: number) { return Math.max(min, Math.min(max, val)) }

  const getContainerSize = () => {
    const el = containerRef.current
    if (!el) return { width: 0, height: 0 }
    const rect = el.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }

  const getBounds = useCallback((nextScale: number) => {
    // Compute panning bounds from displayed size vs container
    const { width: cw, height: ch } = getContainerSize()
    const nw = naturalWidthRef.current || 0
    const nh = naturalHeightRef.current || 0
    if (cw === 0 || ch === 0 || nw === 0 || nh === 0) return { maxX: 0, maxY: 0 }
    const displayedW = nextScale * nw
    const displayedH = nextScale * nh
    const maxX = Math.max(0, (displayedW - cw) / 2)
    const maxY = Math.max(0, (displayedH - ch) / 2)
    return { maxX, maxY }
  }, [])

  const reset = useCallback(() => {
    // Reset to fitted scale (minScale), not 1, to avoid unexpected upscaling
    setScale((prev) => (minScale > 0 ? minScale : prev))
    setTranslate({ x: 0, y: 0 })
  }, [minScale])

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const delta = -e.deltaY
    const zoomIntensity = 0.0015
    const nextScale = clamp(scale * (1 + delta * zoomIntensity), minScale, maxScale)

    if (nextScale === scale) return

    // Adjust translate so zoom focuses roughly around cursor
    const rect = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2

    const scaleRatio = nextScale / scale
    const nextX = cx - (cx - translate.x) * scaleRatio
    const nextY = cy - (cy - translate.y) * scaleRatio

    const { maxX, maxY } = getBounds(nextScale)
    setScale(nextScale)
    setTranslate({ x: clamp(nextX, -maxX, maxX), y: clamp(nextY, -maxY, maxY) })
  }

  // Double click/tap to toggle
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Cancel single-tap-to-close timer
    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current)
      singleTapTimerRef.current = null
    }
    const alreadyZoomed = scale > minScale + 0.001
    const targetScale = alreadyZoomed ? minScale : clamp(minScale * 1.6, minScale, maxScale)
    if (!containerRef.current) {
      setScale(targetScale)
      return
    }
    const rect = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2
    const scaleRatio = targetScale / scale
    const nextX = cx - (cx - translate.x) * scaleRatio
    const nextY = cy - (cy - translate.y) * scaleRatio
    const { maxX, maxY } = getBounds(targetScale)
    setScale(targetScale)
    setTranslate({ x: clamp(nextX, -maxX, maxX), y: clamp(nextY, -maxY, maxY) })
  }

  // Pointer handlers for pan + pinch
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    // Prevent default to stop browser zoom/scroll interference
    if (e.pointerType === 'touch') {
      e.preventDefault()
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointers.current.size === 2) {
      // Begin pinch
      const pts = Array.from(activePointers.current.values())
      const dx = pts[1].x - pts[0].x
      const dy = pts[1].y - pts[0].y
      pinchStartDistance.current = Math.hypot(dx, dy)
      pinchStartScale.current = scale
    } else if (scale > minScale + 0.001) {
      // Begin pan
      setIsPanning(true)
      panStartRef.current = { x: e.clientX, y: e.clientY }
      translateStartRef.current = { ...translate }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!activePointers.current.has(e.pointerId)) return
    
    // Prevent default for touch to avoid browser interference
    if (e.pointerType === 'touch' && activePointers.current.size >= 2) {
      e.preventDefault()
    }
    
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointers.current.size === 2) {
      // Pinch zoom (anchor at pinch center)
      const pts = Array.from(activePointers.current.values())
      const dx = pts[1].x - pts[0].x
      const dy = pts[1].y - pts[0].y
      const dist = Math.hypot(dx, dy)
      if (pinchStartDistance.current) {
        const factor = dist / pinchStartDistance.current
        const nextScale = clamp(pinchStartScale.current * factor, minScale, maxScale)

        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const cx = (pts[0].x + pts[1].x) / 2 - rect.left - rect.width / 2
          const cy = (pts[0].y + pts[1].y) / 2 - rect.top - rect.height / 2
          const scaleRatio = nextScale / scale
          const nextX = cx - (cx - translate.x) * scaleRatio
          const nextY = cy - (cy - translate.y) * scaleRatio
          const { maxX, maxY } = getBounds(nextScale)
          setTranslate({ x: clamp(nextX, -maxX, maxX), y: clamp(nextY, -maxY, maxY) })
        }
        setScale(nextScale)
      }
      return
    }

    if (!isPanning || !panStartRef.current) return
    const dx = e.clientX - panStartRef.current.x
    const dy = e.clientY - panStartRef.current.y
    const { maxX, maxY } = getBounds(scale)
    const nextX = translateStartRef.current.x + dx
    const nextY = translateStartRef.current.y + dy
    setTranslate({ x: clamp(nextX, -maxX, maxX), y: clamp(nextY, -maxY, maxY) })
  }

  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const onPointerUpOrCancel = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    activePointers.current.delete(e.pointerId)
    
    if (activePointers.current.size < 2) {
      pinchStartDistance.current = null
    }
    if (isPanning) {
      setIsPanning(false)
      panStartRef.current = null
    }

    // Double-tap detection for mobile (fallback when onDoubleClick doesn't fire)
    try {
      const now = Date.now()
      const lx = e.clientX
      const ly = e.clientY
      const prev = lastTapRef.current
      lastTapRef.current = { t: now, x: lx, y: ly }
      if (prev && (now - prev.t) < 280) {
        const dx = lx - prev.x
        const dy = ly - prev.y
        if ((dx*dx + dy*dy) < 1000) {
          // Treat as double tap - cancel single-tap-to-close timer
          if (singleTapTimerRef.current) {
            clearTimeout(singleTapTimerRef.current)
            singleTapTimerRef.current = null
          }
          const alreadyZoomed = scale > minScale + 0.001
          const targetScale = alreadyZoomed ? minScale : clamp(minScale * 1.6, minScale, maxScale)
          const rect = containerRef.current?.getBoundingClientRect()
          if (rect) {
            const cx = lx - rect.left - rect.width / 2
            const cy = ly - rect.top - rect.height / 2
            const scaleRatio = targetScale / scale
            const nextX = cx - (cx - translate.x) * scaleRatio
            const nextY = cy - (cy - translate.y) * scaleRatio
            const { maxX, maxY } = getBounds(targetScale)
            setScale(targetScale)
            setTranslate({ x: clamp(nextX, -maxX, maxX), y: clamp(nextY, -maxY, maxY) })
          } else {
            setScale(targetScale)
          }
        }
      }
    } catch {}
  }

  // ESC handler
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (scale > minScale) {
          reset()
        } else if (onRequestClose) {
          onRequestClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scale, minScale, reset, onRequestClose])

  // Keep translate within bounds when scale changes by external layout
  useEffect(() => {
    const onResize = () => {
      // Recompute fit scale when container changes size
      const el = containerRef.current
      const img = imageRef.current
      if (el && img && img.naturalWidth && img.naturalHeight) {
        const rect = el.getBoundingClientRect()
        const s = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
        baseScaleRef.current = s
        setMinScale(s)
        setScale((cur) => Math.max(s, cur))
        const { maxX, maxY } = getBounds(Math.max(s, scale))
        setTranslate(prev => ({ x: clamp(prev.x, -maxX, maxX), y: clamp(prev.y, -maxY, maxY) }))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [scale, getBounds])

  const computedStyle: React.CSSProperties = {
    // Apply centering AND zoom/pan transform together
    transform: `translate(-50%, -50%) translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
    transformOrigin: 'center center',
    transition: isPanning || activePointers.current.size > 0 ? 'none' : 'transform 0.12s ease-out',
    cursor: scale > minScale ? 'grab' : 'zoom-in',
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${className || ''}`}
      style={{ touchAction: 'none' }}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onClick={(e) => {
        e.stopPropagation()
        // Single tap to close when not zoomed (with delay to allow double-tap)
        if (scale <= minScale + 0.001 && onRequestClose) {
          // Clear any existing timer
          if (singleTapTimerRef.current) {
            clearTimeout(singleTapTimerRef.current)
            singleTapTimerRef.current = null
          }
          // Set timer - if not cancelled by double-tap, close
          singleTapTimerRef.current = setTimeout(() => {
            onRequestClose()
          }, 250)
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUpOrCancel}
      onPointerCancel={onPointerUpOrCancel}
      role="img"
      aria-label={alt}
    >
      <img
        ref={imageRef}
        src={currentSrc}
        alt={alt}
        className="absolute top-1/2 left-1/2 max-w-none"
        style={computedStyle}
        draggable={false}
        onLoad={(e) => {
          setLoading(false)
          setError(false)
          try {
            const img = e.currentTarget
            const el = containerRef.current
            if (el && img.naturalWidth && img.naturalHeight) {
              naturalWidthRef.current = img.naturalWidth
              naturalHeightRef.current = img.naturalHeight
              const rect = el.getBoundingClientRect()
              const fit = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
              const s = Math.min(1, fit) // never upscale on initial fit
              baseScaleRef.current = fit
              setMinScale(s)
              setScale(s)
              setTranslate({ x: 0, y: 0 })
            }
          } catch {}
        }}
        onError={() => {
          if (index < candidates.length - 1) {
            setIndex(index + 1)
            setLoading(true)
          } else {
            setError(true)
            setLoading(false)
          }
        }}
      />

      {/* Mobile-friendly reset control when zoomed */}
      {scale > minScale && (
        <button
          type="button"
          className="absolute top-2 right-2 z-10 px-2 py-1 rounded-md bg-black/60 border border-white/15 text-white/90 text-xs hover:bg-black/70 active:scale-95"
          onClick={(e)=> { e.stopPropagation(); reset() }}
          aria-label="Reset zoom"
        >
          Reset
        </button>
      )}

      {/* Small loading spinner (non-blocking) */}
      {loading && (
        <div className="absolute bottom-2 right-2">
          <div className="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
        </div>
      )}

      {/* Error placeholder */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-white/60 text-xs bg-black/20">
          Image unavailable
        </div>
      )}
    </div>
  )
}
