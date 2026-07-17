import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * Shared modal UX kernel — Android hardware back, Escape, focus
 * containment/restore, and optional body-scroll lock for every ad-hoc
 * dialog/sheet in the app.
 *
 * Android back coordination: Capacitor invokes EVERY registered
 * `backButton` listener, so page-level handlers (chat threads) and modal
 * handlers would otherwise both fire on one press. Open modals join a
 * module-level stack — only the top entry acts on a press, and page-level
 * hooks (`useAndroidBackButton`) call `hasOpenModalBackHandler()` and
 * no-op while any modal is open. One back press = top modal closes,
 * nothing else moves. Listeners are removed on close so Capacitor's
 * default back behavior returns when nothing is open.
 */

type ModalStackEntry = { close: () => void }

const modalBackStack: ModalStackEntry[] = []

export function hasOpenModalBackHandler(): boolean {
  return modalBackStack.length > 0
}

/**
 * Each open modal registers its own listener (removed on close so
 * Capacitor's default back behavior returns once nothing is open), but
 * only the entry on top of the stack acts on a press.
 */
function registerModalBack(entry: ModalStackEntry): () => void {
  modalBackStack.push(entry)
  let handle: PluginListenerHandle | undefined
  let disposed = false
  void App.addListener('backButton', () => {
    if (modalBackStack[modalBackStack.length - 1] === entry) entry.close()
  }).then(h => {
    if (disposed) void h.remove()
    else handle = h
  })
  return () => {
    disposed = true
    void handle?.remove()
    const idx = modalBackStack.indexOf(entry)
    if (idx !== -1) modalBackStack.splice(idx, 1)
  }
}

// Body scroll lock with reference counting so stacked modals don't clobber
// each other's cleanup.
let scrollLockCount = 0
let scrollLockPrevOverflow = ''

function acquireScrollLock(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (scrollLockCount === 0) {
    scrollLockPrevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    scrollLockCount = Math.max(0, scrollLockCount - 1)
    if (scrollLockCount === 0) {
      document.body.style.overflow = scrollLockPrevOverflow
    }
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => el.offsetParent !== null || el === document.activeElement,
  )
}

export interface UseModalUXOptions {
  /** Whether the modal is currently open. */
  open: boolean
  /** Dismiss handler — invoked by Escape and Android hardware back. */
  onClose: () => void
  /**
   * Ref to the dialog container. Enables focus containment: initial focus
   * moves onto the container (not the first input, so mobile keyboards
   * don't pop unexpectedly), Tab cycles inside, and focus returns to the
   * previously focused element on close.
   */
  containerRef?: React.RefObject<HTMLElement | null>
  /** Close on Escape (default true). Disable when the caller has bespoke Escape logic. */
  escape?: boolean
  /**
   * Register for Android hardware back (default true). Disable for
   * non-dismissible compliance surfaces (e.g. the age gate).
   */
  androidBack?: boolean
  /** Lock body scroll while open (default false; enable where the modal owned it before). */
  lockScroll?: boolean
  /** Restore focus to the previously focused element on close (default true). */
  restoreFocus?: boolean
}

export function useModalUX({
  open,
  onClose,
  containerRef,
  escape = true,
  androidBack = true,
  lockScroll = false,
  restoreFocus = true,
}: UseModalUXOptions): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape → dismiss
  useEffect(() => {
    if (!open || !escape || typeof window === 'undefined') return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, escape])

  // Android hardware back → dismiss top-most modal
  useEffect(() => {
    if (!open || !androidBack) return
    if (Capacitor.getPlatform() !== 'android') return
    return registerModalBack({ close: () => onCloseRef.current() })
  }, [open, androidBack])

  // Body scroll lock
  useEffect(() => {
    if (!open || !lockScroll) return
    return acquireScrollLock()
  }, [open, lockScroll])

  // Focus containment + restore
  useEffect(() => {
    if (!open || !containerRef || typeof document === 'undefined') return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Initial focus lands on the container itself so screen readers enter
    // the dialog without popping the mobile keyboard on the first input.
    if (!container.contains(document.activeElement)) {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1')
      try {
        container.focus({ preventScroll: true })
      } catch {
        try { container.focus() } catch { /* non-focusable environment */ }
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = getFocusable(container)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!container.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (!restoreFocus || !previouslyFocused) return
      // Only restore when focus is still inside the (now closing) dialog or
      // was dropped to body — never steal focus the user moved elsewhere.
      const active = document.activeElement
      if (active === document.body || (container && container.contains(active))) {
        try {
          previouslyFocused.focus({ preventScroll: true })
        } catch {
          try { previouslyFocused.focus() } catch { /* gone from DOM */ }
        }
      }
    }
  }, [open, containerRef, restoreFocus])
}
