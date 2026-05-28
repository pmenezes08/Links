import { Capacitor } from '@capacitor/core'

export type HapticCue = 'light' | 'medium' | 'selection' | 'success' | 'warning' | 'error'

const WEB_VIBRATION_MS: Record<HapticCue, number | number[]> = {
  light: 8,
  medium: 16,
  selection: 6,
  success: [8, 32, 8],
  warning: [12, 32, 12],
  error: [20, 40, 20],
}

export async function triggerHaptic(cue: HapticCue = 'light'): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')

      if (cue === 'selection') {
        await Haptics.selectionChanged()
        return
      }

      if (cue === 'success' || cue === 'warning' || cue === 'error') {
        const type =
          cue === 'success'
            ? NotificationType.Success
            : cue === 'warning'
              ? NotificationType.Warning
              : NotificationType.Error
        await Haptics.notification({ type })
        return
      }

      await Haptics.impact({ style: cue === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light })
      return
    }

    const nav = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean })
      : null
    nav?.vibrate?.(WEB_VIBRATION_MS[cue])
  } catch {
    // Haptics should never block the interaction that requested them.
  }
}

// Convenience wrappers for hot-path UI handlers. Each is `void`-returning so
// callers don't have to remember `void triggerHaptic(...)`. Failures are
// swallowed inside `triggerHaptic`, so these are safe to call from any
// event handler — web, iOS Capacitor, Android Capacitor, or a device with
// system haptics disabled.

export function hapticImpactLight(): void {
  void triggerHaptic('light')
}

export function hapticImpactMedium(): void {
  void triggerHaptic('medium')
}

export function hapticSelection(): void {
  void triggerHaptic('selection')
}
