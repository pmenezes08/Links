import type { MouseEvent, PointerEvent } from 'react'

/** Prevent textarea blur when tapping composer toolbar controls (keeps keyboard up). */
export function preventComposerBlur(event: { preventDefault(): void }) {
  event.preventDefault()
}

export const composerControlPointerProps = {
  onPointerDown: preventComposerBlur,
  onMouseDown: (event: MouseEvent) => {
    event.preventDefault()
  },
} as const

export function composerPointerDown(event: PointerEvent) {
  preventComposerBlur(event)
}
