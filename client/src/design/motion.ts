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

/**
 * Steve onboarding reply pacing — length-scaled typing delay.
 * delay = clamp(BASE + chars*PER_CHAR, MIN, MAX) * (burst ? DISCOUNT : 1) + jitter
 * Short acks land fast; long questions read as composed; consecutive
 * bubbles in one burst pay a discounted price so multi-bubble stages
 * never drag (the old flat 600-1000ms added 15-20s across the flow,
 * and a flat 250ms read as vending-machine instant).
 */
export const STEVE_REPLY_DELAY_BASE_MS = 180
export const STEVE_REPLY_DELAY_PER_CHAR_MS = 4
export const STEVE_REPLY_DELAY_MIN_MS = 350
export const STEVE_REPLY_DELAY_MAX_MS = 1100
export const STEVE_REPLY_DELAY_JITTER_MS = 120
export const STEVE_REPLY_BURST_DISCOUNT = 0.6

/**
 * Networking "Steve is thinking" staged status — elapsed-ms thresholds at
 * which the wait line advances. The match pipeline is a single non-streamed
 * call (planner → retrieval → fusion → answer, ~8-15s warm), so these are
 * client-timed and advance-only: the copy never claims completion or
 * progress it cannot know. Recalibrate from ai_usage_log.response_time_ms
 * percentiles, not by feel.
 */
export const STEVE_THINKING_SEARCHING_MS = 2_500
export const STEVE_THINKING_NARROWING_MS = 7_000
export const STEVE_THINKING_LONG_MS = 14_000
