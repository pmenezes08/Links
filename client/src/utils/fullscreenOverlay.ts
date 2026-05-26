/** Body dataset flag while a full-screen overlay owns keyboard/composer layout. */
export const FULLSCREEN_OVERLAY_DATASET = 'fullscreenOverlay'
export const FULLSCREEN_OVERLAY_ONBOARDING = 'onboarding'

export function isOnboardingFullscreenOverlayActive(): boolean {
  if (typeof document === 'undefined') return false
  return document.body?.dataset[FULLSCREEN_OVERLAY_DATASET] === FULLSCREEN_OVERLAY_ONBOARDING
}

export function setOnboardingFullscreenOverlay(active: boolean): void {
  if (typeof document === 'undefined') return
  if (active) {
    document.body.dataset[FULLSCREEN_OVERLAY_DATASET] = FULLSCREEN_OVERLAY_ONBOARDING
  } else {
    delete document.body.dataset[FULLSCREEN_OVERLAY_DATASET]
  }
  window.dispatchEvent(new Event('resize'))
  window.dispatchEvent(new CustomEvent('cpoint-fullscreen-overlay'))
}
