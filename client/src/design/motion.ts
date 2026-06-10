/**
 * Motion tokens for C-Point page transitions.
 * Canonical values documented in docs/DESIGN.md § Motion.
 */

/** Push/pop route transition duration. */
export const PAGE_TRANSITION_MS = 340

/** Tab cross-fade duration (Dashboard ↔ Feed ↔ About). */
export const TAB_CROSSFADE_MS = 120

/** Composer and list inset smoothing during keyboard events. */
export const CHAT_KEYBOARD_ANIMATION_MS = 250

/** Native-style deceleration easing for page push/pop. */
export const CPOINT_EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)'

/** Reduced-motion fallback: quick opacity fade instead of slide. */
export const REDUCED_MOTION_FADE_MS = 80
