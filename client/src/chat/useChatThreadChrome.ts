import { useRef, type MutableRefObject, type RefObject } from 'react'
import { useChatComposerChrome, type ChatComposerSurfaceKey } from './useChatComposerChrome'
import { useChatListScrollHandlers } from './useChatListScrollHandlers'
import { useChatThreadScroll, type ChatThreadScrollMessage } from './hooks'

export interface UseChatThreadChromeOptions {
  isMobile: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  composerRef: RefObject<HTMLDivElement | null>
  listRef: RefObject<HTMLDivElement | null>
  threadKey: string | undefined
  messages: ChatThreadScrollMessage[]
  hasMoreMessages: boolean
  loadingOlderRef: MutableRefObject<boolean>
  onLoadOlder?: () => void
  loadOlderEnabled?: boolean
  /**
   * Which chat surface this thread belongs to. Forwarded to
   * `useChatComposerChrome` so the per-surface composer height cache (and
   * `--chat-composer-height-${surface}` CSS var) stay separate between DM
   * and group chat. Required for both pages.
   */
  surfaceKey: ChatComposerSurfaceKey
}

/**
 * Composes composer keyboard chrome, inverted-list scroll state, and list
 * scroll handlers for DM + group chat threads.
 */
export function useChatThreadChrome({
  isMobile,
  textareaRef,
  composerRef,
  listRef,
  threadKey,
  messages,
  hasMoreMessages,
  loadingOlderRef,
  onLoadOlder,
  loadOlderEnabled = true,
  surfaceKey,
}: UseChatThreadChromeOptions) {
  const layoutNudgeRef = useRef<(() => void) | undefined>(undefined)

  const chrome = useChatComposerChrome({
    isMobile,
    textareaRef,
    composerRef,
    surfaceKey,
    onLayoutNudge: () => layoutNudgeRef.current?.(),
  })

  const scroll = useChatThreadScroll({
    listRef,
    threadKey,
    messages,
  })

  // Keyboard / inset changes do not need to pin — the inverted layout keeps
  // the newest message anchored at scrollTop = 0 automatically. We only need
  // to clear pending count if the user happens to be at the bottom.
  layoutNudgeRef.current = () => {
    scroll.notifyMessagesSettled(0)
  }

  const { onScroll: handleListScroll } = useChatListScrollHandlers({
    userHasScrolledRef: scroll.userHasScrolledRef,
    setShowScrollDown: scroll.setShowScrollDown,
    touchDismissRef: chrome.touchDismissRef,
    textareaRef,
    dismissComposerKeyboard: chrome.dismissComposerKeyboard,
    hasMoreMessages,
    loadingOlderRef,
    onLoadOlder,
    loadOlderEnabled,
    onNearBottom: scroll.clearPendingNew,
  })

  return {
    layoutNudgeRef,
    handleListScroll,
    ...chrome,
    ...scroll,
  }
}
