import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

/** Apply native status bar style while mounted (native platforms only). */
export function useNativeStatusBar(style: Style = Style.Dark, enabled = true): void {
  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() === 'web') return
    void StatusBar.setStyle({ style })
    return () => {
      void StatusBar.setStyle({ style: Style.Dark })
    }
  }, [style, enabled])
}

/** Hide status bar for immersive fullscreen overlays (e.g. media viewer). */
export function useImmersiveStatusBar(active: boolean): void {
  useEffect(() => {
    if (!active || Capacitor.getPlatform() === 'web') return
    void StatusBar.hide()
    return () => {
      void StatusBar.show()
      void StatusBar.setStyle({ style: Style.Dark })
    }
  }, [active])
}
