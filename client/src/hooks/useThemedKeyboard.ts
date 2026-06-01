import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard'
import { useTheme } from '../contexts/ThemeContext'

/**
 * Sync the native iOS keyboard appearance with the active theme.
 *
 * `Keyboard.setStyle` is iOS-only (Android keyboards follow the system
 * theme). On web / unsupported platforms the call is a no-op and we
 * exit early before importing the native bridge cost.
 *
 * Mount once at the app root (alongside `useNativeStatusBar`) so the
 * keyboard chrome stays in lockstep with `data-theme` switches.
 */
export function useThemedKeyboard(enabled = true): void {
  const { theme } = useTheme()
  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() !== 'ios') return
    const style = theme === 'light' ? KeyboardStyle.Light : KeyboardStyle.Dark
    void Keyboard.setStyle({ style }).catch(() => {
      // Plugin may be unavailable in some embedded contexts; ignore.
    })
  }, [theme, enabled])
}
