import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

const SWIPE_THRESHOLD_PX = 56
const MAX_DRAG_PX = 72

export type SwipeToReplyProps = {
  children: ReactNode
  onReply: () => void
  disabled?: boolean
  className?: string
}

/**
 * Horizontal pan wrapper — drag past threshold triggers reply (WhatsApp-style hint).
 */
export function SwipeToReply({ children, onReply, disabled = false, className = '' }: SwipeToReplyProps) {
  const startRef = useRef<{ x: number; y: number; pointerId: number; active: boolean } | null>(null)
  const dragRef = useRef(0)
  const nodeRef = useRef<HTMLDivElement>(null)

  const resetTransform = useCallback(() => {
    dragRef.current = 0
    const node = nodeRef.current
    if (node) {
      node.style.transform = ''
      node.style.transition = ''
    }
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || event.pointerType === 'mouse') return
      startRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        active: true,
      }
    },
    [disabled],
  )

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start?.active || start.pointerId !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      start.active = false
      resetTransform()
      return
    }
    if (dx <= 0) {
      resetTransform()
      return
    }
    const drag = Math.min(dx, MAX_DRAG_PX)
    dragRef.current = drag
    const node = nodeRef.current
    if (node) {
      node.style.transition = 'none'
      node.style.transform = `translateX(${drag}px)`
    }
  }, [resetTransform])

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = startRef.current
      if (!start || start.pointerId !== event.pointerId) return
      startRef.current = null
      const triggered = dragRef.current >= SWIPE_THRESHOLD_PX
      resetTransform()
      if (triggered) onReply()
    },
    [onReply, resetTransform],
  )

  const handlePointerCancel = useCallback(() => {
    startRef.current = null
    resetTransform()
  }, [resetTransform])

  return (
    <div
      ref={nodeRef}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{ touchAction: 'pan-y' }}
    >
      {children}
    </div>
  )
}
