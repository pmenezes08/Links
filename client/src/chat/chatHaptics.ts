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
