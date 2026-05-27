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
  fastOpen?: boolean
}

/**
 * Composes composer keyboard chrome, thread scroll pin, and list scroll handlers
 * for DM + group chat threads.
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
  fastOpen = false,
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
    bottomInsetPx: chrome.bottomInsetPx,
    fastOpen,
  })

  layoutNudgeRef.current = scroll.scrollToBottomIfAppropriate

  const { onScroll: handleListScroll } = useChatListScrollHandlers({
    userHasScrolledRef: scroll.userHasScrolledRef,
    cancelInitialPin: scroll.cancelInitialPin,
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
