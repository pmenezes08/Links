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

  // Helpers
  function clamp(val: number, min: number, max: number) { return Math.max(min, Math.min(max, val)) }

  const getContainerSize = () => {
    const el = containerRef.current
    if (!el) return { width: 0, height: 0 }
    const rect = el.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }

  const getBounds = useCallback((nextScale: number) => {
    // Limit panning based on scaled content size; approximate bounds by container size
    const { width, height } = getContainerSize()
    if (width === 0 || height === 0) return { maxX: 0, maxY: 0 }
    // When scaled, we allow translating up to half of the overflow in each direction
    const overflowX = (nextScale - 1) * (width / 2)
    const overflowY = (nextScale - 1) * (height / 2)
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
    const delta = -e.deltaY
    const zoomIntensity = 0.0015
    const nextScale = clamp(scale * (1 + delta * zoomIntensity), 1, maxScale)

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
    if (scale > 1) {
      reset()
      return
    }
    // Zoom in to 2x and center around click
    const targetScale = clamp(2, 1, maxScale)
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
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointers.current.size === 2) {
      // Begin pinch
      const pts = Array.from(activePointers.current.values())
      const dx = pts[1].x - pts[0].x
      const dy = pts[1].y - pts[0].y
      pinchStartDistance.current = Math.hypot(dx, dy)
      pinchStartScale.current = scale
    } else if (scale > 1) {
      // Begin pan
      setIsPanning(true)
      panStartRef.current = { x: e.clientX, y: e.clientY }
      translateStartRef.current = { ...translate }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
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
        if (scale > 1) {
          reset()
        } else if (onRequestClose) {
          onRequestClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scale, reset, onRequestClose])

  // Keep translate within bounds when scale changes by external layout
  useEffect(() => {
    const onResize = () => {
      const { maxX, maxY } = getBounds(scale)
      setTranslate(prev => ({ x: clamp(prev.x, -maxX, maxX), y: clamp(prev.y, -maxY, maxY) }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [scale, getBounds])

  const computedStyle: React.CSSProperties = {
    transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
    transition: isPanning || activePointers.current.size > 0 ? 'none' : 'transform 0.12s ease-out',
    touchAction: scale > 1 ? 'none' as any : 'pan-y',
    cursor: scale > 1 ? 'grab' : 'zoom-in',
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none ${className || ''}`}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUpOrCancel}
      onPointerCancel={onPointerUpOrCancel}
      role="img"
      aria-label={alt}
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-none"
        style={computedStyle}
        draggable={false}
      />

      {/* Hint label when not zoomed */}
      {scale === 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] px-2 py-1 rounded-full bg-black/50 border border-white/10 text-white/80">
          Double-tap or scroll to zoom
        </div>
      )}
    </div>
  )
}
