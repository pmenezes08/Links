import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { chatHapticReply } from './chatHaptics'

const SWIPE_THRESHOLD_PX = 56
const MAX_DRAG_PX = 72
// iOS-style spring snap-back when the finger lifts (matches CPOINT_EASE_OUT in motion.ts).
const SNAP_BACK_TRANSITION = 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)'

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
  const crossedRef = useRef(false)
  const nodeRef = useRef<HTMLDivElement>(null)

  const resetTransform = useCallback((smooth = false) => {
    dragRef.current = 0
    crossedRef.current = false
    const node = nodeRef.current
    if (node) {
      // smooth = finger lifted → glide back with a spring; otherwise (gesture abandoned
      // mid-move) snap instantly so it doesn't fight the vertical scroll.
      node.style.transition = smooth ? SNAP_BACK_TRANSITION : 'none'
      node.style.transform = smooth ? 'translateX(0px)' : ''
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
    // Fire a single selection tick the moment the drag crosses the reply threshold (and re-arm
    // if the user pulls back under it), so the gesture confirms tactilely like WhatsApp/iMessage.
    const crossed = drag >= SWIPE_THRESHOLD_PX
    if (crossed && !crossedRef.current) {
      crossedRef.current = true
      chatHapticReply()
    } else if (!crossed && crossedRef.current) {
      crossedRef.current = false
    }
  }, [resetTransform])

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = startRef.current
      if (!start || start.pointerId !== event.pointerId) return
      startRef.current = null
      const triggered = dragRef.current >= SWIPE_THRESHOLD_PX
      resetTransform(true)
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
      // When disabled (e.g. a message is being edited) drop the pan-y restriction
      // so the edit textarea inside gets normal touch behaviour — tap-to-place
      // cursor, double-tap word select, and reliable button taps. pan-y on this
      // ancestor was making the editor's cursor flaky and swallowing taps on iOS.
      style={{ touchAction: disabled ? 'auto' : 'pan-y' }}
    >
      {children}
    </div>
  )
}
