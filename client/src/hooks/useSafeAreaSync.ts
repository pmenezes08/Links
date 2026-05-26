import { useEffect, useLayoutEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { FEED_NAV_FLOAT_GAP_PX } from '../constants/feedLayout'

const IPHONE_HOME_INDICATOR_MIN = 34

function hasIosHomeIndicator(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.screen.height
  const w = window.screen.width
  return Math.max(h, w) >= 812 && Math.min(h, w) >= 375
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPod|iPad/i.test(navigator.userAgent)
}

/** Probe env(safe-area-inset-*) and sync pixel CSS vars (Capacitor iOS often reports env as 0). */
export function measureSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  if (typeof document === 'undefined') {
    return { top: 0, bottom: 0, left: 0, right: 0 }
  }

  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);' +
    'pointer-events:none;visibility:hidden;z-index:-1;'
  document.body.appendChild(probe)
  let bottom = probe.getBoundingClientRect().height || 0
  probe.remove()

  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);' +
    'pointer-events:none;visibility:hidden;z-index:-1;'
  document.body.appendChild(probe)
  let top = probe.getBoundingClientRect().height || 0
  probe.remove()

  const edgeProbe = document.createElement('div')
  edgeProbe.style.cssText =
    'position:fixed;top:0;right:0;bottom:0;left:0;width:0;height:0;margin:0;border:0;padding:0;' +
    'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);' +
    'visibility:hidden;pointer-events:none;z-index:-1;'
  document.body.appendChild(edgeProbe)
  const edgeStyle = getComputedStyle(edgeProbe)
  if (top < 1) top = parseFloat(edgeStyle.paddingTop) || 0
  if (bottom < 1) bottom = parseFloat(edgeStyle.paddingBottom) || 0
  const left = parseFloat(edgeStyle.paddingLeft) || 0
  const right = parseFloat(edgeStyle.paddingRight) || 0
  edgeProbe.remove()

  if (bottom < 1 && isIosDevice() && hasIosHomeIndicator()) {
    bottom = IPHONE_HOME_INDICATOR_MIN
  }

  if (top < 1 && isIosDevice() && hasIosHomeIndicator()) {
    top = typeof window !== 'undefined' && window.innerHeight >= 812 ? 47 : 20
  }

  return { top, bottom, left, right }
}

export function applySafeAreaCssVars(insets: { top: number; bottom: number; left: number; right: number }) {
  const root = document.documentElement
  root.style.setProperty('--sab-px', `${insets.bottom}px`)
  root.style.setProperty('--sat-px', `${insets.top}px`)
  root.style.setProperty('--sal-px', `${insets.left}px`)
  root.style.setProperty('--sar-px', `${insets.right}px`)
  root.style.setProperty('--sab', `${insets.bottom}px`)
  root.style.setProperty('--sat', `${insets.top}px`)
  root.style.setProperty('--app-header-height', `calc(56px + ${insets.top}px)`)
  root.style.setProperty('--app-dashboard-bottom-nav-height', `calc(3.5rem + ${insets.bottom}px)`)
  root.style.setProperty('--app-dashboard-content-pad-bottom', `calc(3.5rem + ${insets.bottom}px + 12px)`)
  root.style.setProperty('--app-feed-nav-float-gap', `${FEED_NAV_FLOAT_GAP_PX}px`)
  root.style.setProperty('--app-feed-bottom-nav-height', `calc(3.5rem + ${FEED_NAV_FLOAT_GAP_PX}px + ${insets.bottom}px)`)
  root.style.setProperty('--app-feed-content-pad-bottom', `calc(3.5rem + ${FEED_NAV_FLOAT_GAP_PX}px + ${insets.bottom}px + 12px)`)
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

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let resumeHandle: PluginListenerHandle | undefined

    const sync = () => {
      applySafeAreaCssVars(measureSafeAreaInsets())
    }

    CapacitorApp.addListener('resume', sync).then((handle) => {
      resumeHandle = handle
    })

    return () => {
      resumeHandle?.remove()
    }
  }, [])
}
