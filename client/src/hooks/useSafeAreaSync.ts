import { useLayoutEffect } from 'react'
import { Capacitor } from '@capacitor/core'

const IPHONE_HOME_INDICATOR_MIN = 34

function hasIosHomeIndicator(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.screen.height
  const w = window.screen.width
  return Math.max(h, w) >= 812 && Math.min(h, w) >= 375
}

/** Probe env(safe-area-inset-*) and sync pixel CSS vars (Capacitor iOS often reports env as 0). */
export function measureSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  if (typeof document === 'undefined') {
    return { top: 0, bottom: 0, left: 0, right: 0 }
  }

  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;right:0;bottom:0;left:0;width:0;height:0;margin:0;border:0;padding:0;' +
    'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);' +
    'visibility:hidden;pointer-events:none;z-index:-1;'
  document.body.appendChild(probe)

  const style = getComputedStyle(probe)
  let top = parseFloat(style.paddingTop) || 0
  let right = parseFloat(style.paddingRight) || 0
  let bottom = parseFloat(style.paddingBottom) || 0
  let left = parseFloat(style.paddingLeft) || 0
  probe.remove()

  if (bottom < 1 && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' && hasIosHomeIndicator()) {
    bottom = IPHONE_HOME_INDICATOR_MIN
  }

  if (top < 1 && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' && hasIosHomeIndicator()) {
    const statusFallback = typeof window !== 'undefined' && window.innerHeight >= 812 ? 47 : 20
    top = statusFallback
  }

  return { top, bottom, left, right }
}

export function applySafeAreaCssVars(insets: { top: number; bottom: number; left: number; right: number }) {
  const root = document.documentElement
  root.style.setProperty('--sab-px', `${insets.bottom}px`)
  root.style.setProperty('--sat-px', `${insets.top}px`)
  root.style.setProperty('--sal-px', `${insets.left}px`)
  root.style.setProperty('--sar-px', `${insets.right}px`)
  root.style.setProperty('--app-dashboard-bottom-nav-height', `calc(3.5rem + ${insets.bottom}px)`)
  root.style.setProperty('--app-dashboard-content-pad-bottom', `calc(3.5rem + ${insets.bottom}px + 12px)`)
  root.style.setProperty('--app-feed-bottom-nav-height', `calc(70px + ${insets.bottom}px)`)
  root.style.setProperty('--app-feed-content-pad-bottom', `calc(70px + ${insets.bottom}px + 12px)`)
}

export function useSafeAreaSync() {
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const sync = () => {
      applySafeAreaCssVars(measureSafeAreaInsets())
    }

    sync()
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)

    return () => {
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
    }
  }, [])
}
