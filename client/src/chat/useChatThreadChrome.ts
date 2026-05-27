import { useRef, type MutableRefObject, type RefObject } from 'react'
import { useChatComposerChrome } from './useChatComposerChrome'
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
}: UseChatThreadChromeOptions) {
  const layoutNudgeRef = useRef<(() => void) | undefined>(undefined)

  const chrome = useChatComposerChrome({
    isMobile,
    textareaRef,
    composerRef,
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
