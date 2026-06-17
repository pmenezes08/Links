import type { CSSProperties, ReactNode, RefObject } from 'react'

export type ChatThreadShellProps = {
  header: ReactNode
  listRef: RefObject<HTMLDivElement | null>
  listPaddingBottom: string | number
  listScrollPaddingBottom?: string | number
  onScroll?: React.UIEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>
  androidKeyboardOpen?: boolean
  /**
   * When true (keyboard fully closed and not animating), the list element gets
   * the `chat-list-idle-smooth` class so post-paint inset settles ease over
   * the shared 250ms curve instead of snapping. Drive from
   * `useChatComposerChrome().insetMotionIdle`. Defaults to `false` so callers
   * that don't wire it preserve today's tick-precise behaviour.
   */
  insetMotionIdle?: boolean
  maxWidthClass?: string
  listClassName?: string
  loadOlderSlot?: ReactNode
  children: ReactNode
}

/**
 * Fixed viewport shell: header slot + inverted (column-reverse) scrollable
 * message list with composer inset.
 *
 * The scroll container uses `flex-direction: column-reverse` so the newest
 * message renders at the visual bottom in `scrollTop = 0` coordinates, with
 * no JS pinning required on open.
 *
 * DOM child order is reversed visually:
 *   first DOM child  -> visual bottom (newest)
 *   last DOM child   -> visual top    (oldest / load-older trigger)
 */
export function ChatThreadShell({
  header,
  listRef,
  listPaddingBottom,
  listScrollPaddingBottom,
  onScroll,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  androidKeyboardOpen = false,
  insetMotionIdle = false,
  maxWidthClass = 'max-w-3xl',
  listClassName = 'flex-1 overflow-y-auto overflow-x-hidden text-c-text-primary px-2.5 sm:px-3 chat-list-inset',
  loadOlderSlot,
  children,
}: ChatThreadShellProps) {
  const composedListClassName = insetMotionIdle
    ? `${listClassName} chat-list-idle-smooth`
    : listClassName
  return (
    <div
      className="glass-page text-c-text-primary chat-thread-bg"
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
            className={composedListClassName}
            style={{
              WebkitOverflowScrolling: 'touch',
              // contain (not auto): keep the inverted list's rubber-band self-contained so
              // overscroll at the top (oldest) / bottom (newest) doesn't chain into the page
              // scroll or the native WebView bounce — reads as a leaky web page otherwise.
              overscrollBehaviorY: 'contain',
              paddingBottom: listPaddingBottom,
              scrollPaddingBottom: listScrollPaddingBottom,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column-reverse',
            } as CSSProperties}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onScroll={onScroll}
          >
            {children}
            {loadOlderSlot}
          </div>
        </div>
      </div>
    </div>
  )
}
