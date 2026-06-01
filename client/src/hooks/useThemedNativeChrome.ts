import { useNativeStatusBar } from './useNativeStatusBar'
import { useThemedKeyboard } from './useThemedKeyboard'

/**
 * Unified native (Capacitor) chrome sync for the active theme.
 *
 * Composes the focused chrome hooks so the app root has a single mount
 * point that keeps every native surface in lockstep with `data-theme`:
 *   • **Status bar** style + background color — `useNativeStatusBar`
 *     (`Style.Light` on the light canvas, `Style.Dark` on the dark canvas;
 *     `setBackgroundColor` is Android-only but issued safely everywhere).
 *   • **iOS keyboard** appearance — `useThemedKeyboard`
 *     (`KeyboardStyle.Light` / `.Dark`; Android follows the system theme).
 *
 * Each composed hook already guards on platform / plugin availability and
 * degrades to a no-op on web or when a Capacitor plugin is missing, so this
 * is safe to mount once near the app root on every platform.
 *
 * @param enabled - set false to suspend syncing (e.g. while an immersive
 *   overlay owns the chrome); defaults to true.
 */
export function useThemedNativeChrome(enabled = true): void {
  useNativeStatusBar(enabled)
  useThemedKeyboard(enabled)
}
