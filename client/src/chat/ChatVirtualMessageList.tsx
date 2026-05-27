import { forwardRef, useEffect, useState, type ReactNode, type RefObject } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { CHAT_VIRTUAL_LIST_THRESHOLD } from './constants'

export type ChatVirtualMessageListProps<T> = {
  messages: T[]
  messageStackRef: RefObject<HTMLDivElement | null>
  lastMessageRef: (node: HTMLDivElement | null) => void
  listRef: RefObject<HTMLDivElement | null>
  renderItem: (message: T, index: number, isLast: boolean) => ReactNode
  itemKey?: (message: T, index: number) => string | number
  footer?: ReactNode
  className?: string
}

function assignRef<T>(ref: RefObject<T | null>, value: T | null) {
  ;(ref as { current: T | null }).current = value
}

type VirtualListProps = React.HTMLAttributes<HTMLDivElement> & {
  messageStackRef: RefObject<HTMLDivElement | null>
  className?: string
}

const VirtualList = forwardRef<HTMLDivElement, VirtualListProps>(
  ({ messageStackRef, className, style, children, ...props }, ref) => (
    <div
      {...props}
      ref={node => {
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
        assignRef(messageStackRef, node)
      }}
      className={className}
      style={style}
    >
      {children}
    </div>
  ),
)
VirtualList.displayName = 'ChatVirtualList'

/** Standard map below threshold; Virtuoso window above threshold (same scroll parent). */
export function ChatVirtualMessageList<T>({
  messages,
  messageStackRef,
  lastMessageRef,
  listRef,
  renderItem,
  itemKey,
  footer,
  className = 'space-y-[9px]',
}: ChatVirtualMessageListProps<T>) {
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setScrollParent(listRef.current)
  }, [listRef])

  const resolveKey = (msg: T, index: number) => String(itemKey?.(msg, index) ?? index)

  if (messages.length <= CHAT_VIRTUAL_LIST_THRESHOLD || !scrollParent) {
    return (
      <div ref={messageStackRef} className={className}>
        {messages.map((msg, idx) => {
          const isLast = idx === messages.length - 1
          return (
            <div key={resolveKey(msg, idx)} ref={isLast ? lastMessageRef : undefined}>
              {renderItem(msg, idx, isLast)}
            </div>
          )
        })}
        {footer}
        <div className="scroll-anchor h-px w-full flex-shrink-0" aria-hidden="true" />
      </div>
    )
  }

  return (
    <Virtuoso
      customScrollParent={scrollParent}
      totalCount={messages.length}
      increaseViewportBy={{ top: 400, bottom: 200 }}
      computeItemKey={index => resolveKey(messages[index], index)}
      components={{
        List: props => (
          <VirtualList
            {...props}
            messageStackRef={messageStackRef}
            className={className}
          />
        ),
        Footer: () => (
          <>
            {footer}
            <div className="scroll-anchor h-px w-full flex-shrink-0" aria-hidden="true" />
          </>
        ),
      }}
      itemContent={index => {
        const isLast = index === messages.length - 1
        return (
          <div ref={isLast ? lastMessageRef : undefined} className="pb-[9px]">
            {renderItem(messages[index], index, isLast)}
          </div>
        )
      }}
    />
  )
}
