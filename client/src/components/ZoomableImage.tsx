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

  // For pinch gestures
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStartDistance = useRef<number | null>(null)
  const pinchStartScale = useRef<number>(1)

  // Loading and source candidates (fallbacks)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const candidates: string[] = (() => {
    const p = (src || '').trim()
    const out: string[] = []
    if (!p) return out
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
    // Compute bounds relative to minScale so panning is proportional
    const { width, height } = getContainerSize()
    if (width === 0 || height === 0) return { maxX: 0, maxY: 0 }
    const base = baseScaleRef.current || 1
    const ms = Math.min(1, base)
    const ratio = Math.max(1, nextScale / ms)
    const overflowX = (ratio - 1) * (width / 2)
    const overflowY = (ratio - 1) * (height / 2)
    return { maxX: overflowX, maxY: overflowY }
  }, [])

  const reset = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

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
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointers.current.size === 2) {
      // Pinch zoom
      const pts = Array.from(activePointers.current.values())
      const dx = pts[1].x - pts[0].x
      const dy = pts[1].y - pts[0].y
      const dist = Math.hypot(dx, dy)
      if (pinchStartDistance.current) {
        const factor = dist / pinchStartDistance.current
        const nextScale = clamp(pinchStartScale.current * factor, 1, maxScale)
        const { maxX, maxY } = getBounds(nextScale)
        setScale(nextScale)
        setTranslate(prev => ({ x: clamp(prev.x, -maxX, maxX), y: clamp(prev.y, -maxY, maxY) }))
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
    transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
    transition: isPanning || activePointers.current.size > 0 ? 'none' : 'transform 0.12s ease-out',
    touchAction: scale > minScale ? 'none' as any : 'manipulation',
    cursor: scale > minScale ? 'grab' : 'zoom-in',
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${className || ''}`}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onClick={(e)=> e.stopPropagation()}
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
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-none"
        style={computedStyle}
        draggable={false}
        onLoad={(e) => {
          setLoading(false)
          setError(false)
          try {
            const img = e.currentTarget
            const el = containerRef.current
            if (el && img.naturalWidth && img.naturalHeight) {
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

      {/* Hint label when not zoomed */}
      {scale <= minScale + 0.0001 && !loading && !error && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] px-2 py-1 rounded-full bg-black/50 border border-white/10 text-white/80">
          Double-tap or pinch to zoom • drag to pan
        </div>
      )}

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

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="w-7 h-7 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
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
