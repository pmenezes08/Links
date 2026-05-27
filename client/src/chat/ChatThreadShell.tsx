import type { CSSProperties, ReactNode, RefObject } from 'react'

export type ChatThreadShellProps = {
  header: ReactNode
  listRef: RefObject<HTMLDivElement | null>
  listOpening?: boolean
  listRevealReady?: boolean
  listPaddingBottom: string | number
  listScrollPaddingBottom?: string | number
  onScroll?: React.UIEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>
  androidKeyboardOpen?: boolean
  maxWidthClass?: string
  listClassName?: string
  loadOlderSlot?: ReactNode
  children: ReactNode
}

/** Fixed viewport shell: header slot + scrollable message list with composer inset. */
export function ChatThreadShell({
  header,
  listRef,
  listOpening = false,
  listRevealReady = true,
  listPaddingBottom,
  listScrollPaddingBottom,
  onScroll,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  androidKeyboardOpen = false,
  maxWidthClass = 'max-w-3xl',
  listClassName = 'flex-1 space-y-[9px] overflow-y-auto overflow-x-hidden text-white px-2.5 sm:px-3 chat-list-inset',
  loadOlderSlot,
  children,
}: ChatThreadShellProps) {
  return (
    <div
      className="glass-page text-white chat-thread-bg"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {header}

      <div
        className="flex-1 flex flex-col min-h-0 px-0"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 48px)',
          ...(androidKeyboardOpen
            ? { maxHeight: `${window.visualViewport?.height ?? window.innerHeight}px` }
            : {}),
        }}
      >
        <div className={`mx-auto flex ${maxWidthClass} w-full flex-1 flex-col min-h-0`}>
          <div
            ref={listRef}
            data-preserve-scroll="true"
            className={`${listClassName}${listOpening ? ' chat-list-opening' : ''}`}
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehaviorY: 'auto',
              paddingBottom: listPaddingBottom,
              scrollPaddingBottom: listScrollPaddingBottom,
              minHeight: 0,
              visibility: listRevealReady ? 'visible' : 'hidden',
            } as CSSProperties}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onScroll={onScroll}
          >
            {loadOlderSlot}
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
