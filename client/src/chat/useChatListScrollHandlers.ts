import { useCallback, type MutableRefObject, type UIEvent } from 'react'
import { DEFAULT_NEAR_BOTTOM_PX } from './scrollPin'

interface TouchDismissState {
  active: boolean
  x: number
  y: number
  pointerId: number | null
}

export interface UseChatListScrollHandlersOptions {
  userHasScrolledRef: MutableRefObject<boolean>
  cancelInitialPin: () => void
  setShowScrollDown: (show: boolean) => void
  touchDismissRef?: MutableRefObject<TouchDismissState>
  hasMoreMessages: boolean
  loadingOlderRef: MutableRefObject<boolean>
  onLoadOlder?: () => void
  loadOlderEnabled?: boolean
  onNearBottom?: () => void
}

/**
 * Shared list scroll behaviour for DM + group threads (load older, FAB, manual scroll).
 */
export function useChatListScrollHandlers({
  userHasScrolledRef,
  cancelInitialPin,
  setShowScrollDown,
  touchDismissRef,
  hasMoreMessages,
  loadingOlderRef,
  onLoadOlder,
  loadOlderEnabled = true,
  onNearBottom,
}: UseChatListScrollHandlersOptions) {
  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (touchDismissRef?.current.active) {
        touchDismissRef.current.active = false
      }

      const el = event.currentTarget
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const nearBottom = distFromBottom < DEFAULT_NEAR_BOTTOM_PX

      if (nearBottom) {
        userHasScrolledRef.current = false
        setShowScrollDown(false)
        onNearBottom?.()
      } else if (distFromBottom > 80) {
        userHasScrolledRef.current = true
        cancelInitialPin()
        if (distFromBottom > DEFAULT_NEAR_BOTTOM_PX) {
          setShowScrollDown(true)
        }
      }

      if (
        loadOlderEnabled &&
        onLoadOlder &&
        el.scrollTop < 100 &&
        !loadingOlderRef.current &&
        hasMoreMessages
      ) {
        onLoadOlder()
      }
    },
    [
      cancelInitialPin,
      hasMoreMessages,
      loadOlderEnabled,
      loadingOlderRef,
      onLoadOlder,
      setShowScrollDown,
      touchDismissRef,
      userHasScrolledRef,
      onNearBottom,
    ],
  )

  return { onScroll }
}
