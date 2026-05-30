import type { ReactNode, RefObject } from 'react'

export type ChatVirtualMessageListProps<T> = {
  messages: T[]
  messageStackRef: RefObject<HTMLDivElement | null>
  lastMessageRef: (node: HTMLDivElement | null) => void
  /** Kept for API symmetry with previous Virtuoso-aware implementation. */
  listRef?: RefObject<HTMLDivElement | null>
  renderItem: (message: T, index: number, isLast: boolean) => ReactNode
  itemKey?: (message: T, index: number) => string | number
  footer?: ReactNode
  className?: string
  /** Reserved for future use; the inverted layout follows new tail automatically. */
  followOutput?: boolean
  /** Reserved for future use; native scroll events on the inverted container drive this. */
  onAtBottomStateChange?: (atBottom: boolean) => void
}

/**
 * Chat message stack rendered inside the inverted (column-reverse) scroll container.
 *
 * Messages are rendered in their natural (oldest → newest) DOM order. The
 * parent scroll container uses `flex-direction: column-reverse`, which makes
 * `scrollTop = 0` correspond to the visual bottom (newest message above the
 * composer). No virtualization is used — chat threads cap at the loaded
 * pagination set and the column-reverse layout is self-correcting under media
 * reflow without any JS pinning.
 *
 * Layout in the parent container (DOM order, with column-reverse applied):
 *   [ this stack (newest at bottom, oldest at top), loadOlder slot, empty state ]
 * resulting in visual top-to-bottom:
 *   [ empty state, loadOlder slot, oldest ... newest, footer (typing) ]
 */
export function ChatVirtualMessageList<T>({
  messages,
  messageStackRef,
  lastMessageRef,
  renderItem,
  itemKey,
  footer,
  className = 'space-y-[9px]',
}: ChatVirtualMessageListProps<T>) {
  const resolveKey = (msg: T, index: number) => String(itemKey?.(msg, index) ?? index)

  return (
    <div ref={messageStackRef} className={className}>
      {messages.map((msg, idx) => {
        const isLast = idx === messages.length - 1
        return (
          <div key={resolveKey(msg, idx)} ref={isLast ? lastMessageRef : undefined} data-message-id={resolveKey(msg, idx)}>
            {renderItem(msg, idx, isLast)}
          </div>
        )
      })}
      {footer}
    </div>
  )
}
