/** Distance from scroll bottom (px) to treat the list as pinned. */
export const DEFAULT_NEAR_BOTTOM_PX = 150

export function isNearBottom(
  el: HTMLElement,
  thresholdPx = DEFAULT_NEAR_BOTTOM_PX,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx
}

/** Suppress scroll-down FAB briefly after thread open to avoid open flicker. */
export function shouldShowScrollDownAfterOpen(
  openedAtMs: number,
  nowMs: number,
  debounceMs = 300,
): boolean {
  return nowMs - openedAtMs >= debounceMs
}

export function scrollElementToBottom(el: HTMLElement, behavior: ScrollBehavior = 'auto'): void {
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  if (behavior === 'auto') {
    el.scrollTop = maxScroll
  } else {
    el.scrollTo({ top: maxScroll, behavior })
  }
  if (el.scrollHeight <= el.clientHeight) {
    const anchor = el.querySelector('.scroll-anchor')
    if (anchor instanceof HTMLElement) {
      anchor.scrollIntoView({ behavior, block: 'end' })
    }
  }
}

/** Run scroll-to-bottom while ignoring spurious iOS scroll events. */
export function scrollElementToBottomProgrammatic(
  el: HTMLElement,
  behavior: ScrollBehavior = 'auto',
  onProgrammaticScroll?: (active: boolean) => void,
): void {
  onProgrammaticScroll?.(true)
  scrollElementToBottom(el, behavior)
  if (typeof requestAnimationFrame === 'undefined') {
    onProgrammaticScroll?.(false)
    return
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      onProgrammaticScroll?.(false)
    })
  })
}

/** Maximum scrollTop for a scroll container (for tests). */
export function maxScrollTop(el: Pick<HTMLElement, 'scrollHeight' | 'clientHeight'>): number {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}
