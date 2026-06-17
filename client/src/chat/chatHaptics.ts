import { triggerHaptic } from '../utils/haptics'

/** Primary send action (text, voice, enter key). */
export function chatHapticSend() {
  void triggerHaptic('medium')
}

/** + / attach menu toggle. */
export function chatHapticAttachToggle() {
  void triggerHaptic('selection')
}

/** Secondary composer controls (mic, pause, preview play/delete). */
export function chatHapticComposerTap() {
  void triggerHaptic('light')
}

/** Long-press action menu opened. */
export function chatHapticMenuOpen() {
  void triggerHaptic('selection')
}

/** Reaction picked from menu or picker. */
export function chatHapticReaction() {
  void triggerHaptic('light')
}

/** Swipe-to-reply drag crossed the trigger threshold (fires once per crossing). */
export function chatHapticReply() {
  void triggerHaptic('selection')
}

/** Light tick for navigation/affordance taps (back, scroll-to-bottom, new-messages chip). */
export function chatHapticTap() {
  void triggerHaptic('light')
}
