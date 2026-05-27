/**
 * Scroll helpers for the inverted (column-reverse) chat message list.
 *
 * In an inverted list, `scrollTop = 0` corresponds to the visual bottom
 * (newest message above the composer). `scrollTop > 0` means the user has
 * scrolled upward into older history. The latest message is in view from
 * the very first paint frame without any JS pin call.
 */

/** Distance (in `scrollTop` units) below which the inverted list is treated as pinned at the bottom. */
export const DEFAULT_NEAR_BOTTOM_PX = 150

/** Distance from the visual top (older history) below which we trigger "load older". */
export const LOAD_OLDER_TRIGGER_PX = 100

/** True when the inverted list is at (or within `tolerancePx` of) the visual bottom. */
export function isInvertedAtBottom(
  el: Pick<HTMLElement, 'scrollTop'>,
  tolerancePx = 0,
): boolean {
  return el.scrollTop <= tolerancePx
}

/** Distance from the visual bottom in inverted coordinates. */
export function distanceFromInvertedBottom(el: Pick<HTMLElement, 'scrollTop'>): number {
  return Math.max(0, el.scrollTop)
}

/** Distance from the visual top (older history) of the inverted list. */
export function distanceFromInvertedTop(
  el: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight)
}

/** Synchronously pin the inverted list to the visual bottom (newest message). */
export function pinInvertedToBottom(el: HTMLElement): void {
  el.scrollTop = 0
}

/** Smoothly scroll the inverted list back to the visual bottom (for FAB tap). */
export function smoothPinInvertedToBottom(el: HTMLElement): void {
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    el.scrollTop = 0
  }
}
