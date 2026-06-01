import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { useTheme, type Theme } from '../contexts/ThemeContext'

/**
 * Native status bar / keyboard chrome colors per theme.
 *
 * Capacitor's `Style` enum is named after the *background* the icons
 * sit on, not the icon color itself:
 *   • `Style.Dark`  → light icons (use on a dark canvas → dark theme)
 *   • `Style.Light` → dark icons  (use on a light canvas → light theme)
 *
 * Background color (`setBackgroundColor`) is Android-only — iOS picks up
 * the WebView background — but the call is safe to issue on iOS too.
 */
const STATUS_BAR_BG: Record<Theme, string> = {
  dark: '#000000',
  light: '#FAFBFC',
}

function styleForTheme(theme: Theme): Style {
  return theme === 'light' ? Style.Light : Style.Dark
}

function applyStatusBar(theme: Theme): void {
  void StatusBar.setStyle({ style: styleForTheme(theme) })
  void StatusBar.setBackgroundColor({ color: STATUS_BAR_BG[theme] }).catch(() => {
    // setBackgroundColor is Android-only; iOS rejects silently
  })
}

/**
 * Apply native status bar style/background for the active theme while
 * mounted (native platforms only). Mount once near the app root —
 * additional mounts inside themed routes are harmless but redundant.
 *
 * When the user's preference is 'system', also listens for app resume
 * events to re-resolve the theme in case the OS switched while the app
 * was backgrounded (some WebViews don't replay the matchMedia change
 * event on resume).
 */
export function useNativeStatusBar(enabled = true): void {
  const { theme, preference } = useTheme()

  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() === 'web') return
    applyStatusBar(theme)
  }, [theme, enabled])

  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() === 'web') return
    if (preference !== 'system') return

    const listener = App.addListener('resume', () => {
      if (typeof window === 'undefined' || !window.matchMedia) return
      const osTheme: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      applyStatusBar(osTheme)
    })

    return () => { void listener.then(h => h.remove()) }
  }, [preference, enabled])
}

/**
 * Hide status bar for immersive fullscreen overlays (media viewer).
 * On cleanup, restore the bar with the *current* theme style so we
 * don't briefly flash light icons on a light canvas.
 */
export function useImmersiveStatusBar(active: boolean): void {
  const { theme } = useTheme()
  useEffect(() => {
    if (!active || Capacitor.getPlatform() === 'web') return
    void StatusBar.hide()
    return () => {
      void StatusBar.show()
      applyStatusBar(theme)
    }
  }, [active, theme])
}
