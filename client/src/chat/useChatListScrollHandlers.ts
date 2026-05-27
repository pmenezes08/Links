import { useCallback, type MutableRefObject, type RefObject, type UIEvent } from 'react'
import {
  DEFAULT_NEAR_BOTTOM_PX,
  LOAD_OLDER_TRIGGER_PX,
  distanceFromInvertedBottom,
  distanceFromInvertedTop,
} from './scrollPin'

interface TouchDismissState {
  active: boolean
  x: number
  y: number
  pointerId: number | null
}

export interface UseChatListScrollHandlersOptions {
  userHasScrolledRef: MutableRefObject<boolean>
  setShowScrollDown: (show: boolean) => void
  touchDismissRef?: MutableRefObject<TouchDismissState>
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  dismissComposerKeyboard?: () => void
  hasMoreMessages: boolean
  loadingOlderRef: MutableRefObject<boolean>
  onLoadOlder?: () => void
  loadOlderEnabled?: boolean
  onNearBottom?: () => void
}

/**
 * Shared scroll handler for the inverted chat message list.
 *
 * In an inverted (column-reverse) list:
 * - `scrollTop = 0` is the visual bottom (newest message above the composer).
 * - `scrollTop > 0` means the user scrolled upward into older history.
 * - The "load older" trigger lives at the visual top, i.e. close to
 *   `scrollHeight - scrollTop - clientHeight ≈ 0`.
 */
export function useChatListScrollHandlers({
  userHasScrolledRef,
  setShowScrollDown,
  touchDismissRef,
  textareaRef,
  dismissComposerKeyboard,
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
      const distFromBottom = distanceFromInvertedBottom(el)
      const distFromTop = distanceFromInvertedTop(el)
      const nearBottom = distFromBottom < DEFAULT_NEAR_BOTTOM_PX

      if (nearBottom) {
        userHasScrolledRef.current = false
        setShowScrollDown(false)
        onNearBottom?.()
      } else {
        userHasScrolledRef.current = true
        setShowScrollDown(true)
        // Scroll-to-dismiss: reading history should reclaim vertical space.
        if (
          dismissComposerKeyboard &&
          textareaRef?.current &&
          document.activeElement === textareaRef.current
        ) {
          dismissComposerKeyboard()
        }
      }

      if (
        loadOlderEnabled &&
        onLoadOlder &&
        distFromTop < LOAD_OLDER_TRIGGER_PX &&
        !loadingOlderRef.current &&
        hasMoreMessages
      ) {
        onLoadOlder()
      }
    },
    [
      hasMoreMessages,
      loadOlderEnabled,
      loadingOlderRef,
      onLoadOlder,
      setShowScrollDown,
      touchDismissRef,
      textareaRef,
      dismissComposerKeyboard,
      userHasScrolledRef,
      onNearBottom,
    ],
  )

  return { onScroll }
}
