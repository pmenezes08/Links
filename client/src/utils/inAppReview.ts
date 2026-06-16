// Ask for an App Store / Play rating at a genuinely positive moment. The OS decides
// whether to actually show the sheet (Apple ~3/yr, silently throttled) and gives no
// success signal — so we never block UX on it and self-throttle to once per ~120 days.
import { Capacitor } from '@capacitor/core'

const REVIEW_KEY = 'cpoint.lastReviewPromptAt'
const MIN_INTERVAL_MS = 1000 * 60 * 60 * 24 * 120 // 120 days, inside Apple's own cap

/** Fire-and-forget; never throws, never blocks. `reason` is for our own logging only. */
export async function maybeRequestReview(reason: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: REVIEW_KEY })
    const last = Number(value || 0)
    if (last && Date.now() - last < MIN_INTERVAL_MS) return
    const { InAppReview } = await import('@capacitor-community/in-app-review')
    await InAppReview.requestReview()
    await Preferences.set({ key: REVIEW_KEY, value: String(Date.now()) })
  } catch {
    void reason // never surface a rating-prompt failure to the user
  }
}
