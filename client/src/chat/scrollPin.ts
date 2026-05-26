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
  if (behavior === 'auto') {
    // Synchronous jump — avoids a visible smooth scroll through history on thread open.
    el.scrollTop = el.scrollHeight
  } else {
    el.scrollTo({ top: el.scrollHeight, behavior })
  }
  const anchor = el.querySelector('.scroll-anchor')
  if (anchor instanceof HTMLElement) {
    anchor.scrollIntoView({ behavior, block: 'end' })
  }
}
