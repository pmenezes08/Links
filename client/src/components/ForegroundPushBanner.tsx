import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import {
  foregroundBannerFromPushDetail,
  navigateToPushUrl,
  shouldSkipForegroundBannerDueToSameRoute,
} from '../utils/pushNotificationPayload'

const AUTO_DISMISS_MS = 5000
const DEDupe_MS = 3500
const SWIPE_UP_DISMISS_PX = 48
const LOGO_PRIMARY = '/static/logo.png'
const LOGO_FALLBACK = '/static/icons/icon-192.png'

type BannerState =
  | { visible: false }
  | {
      visible: true
      headline: string
      subline?: string
      url?: string
      entered: boolean
    }

/**
 * Native-only toast when a push arrives in the foreground (see PushInit).
 * Bottom-anchored light card with logo; tap opens deep link; swipe up dismisses.
 */
export default function ForegroundPushBanner() {
  const navigate = useNavigate()
  const location = useLocation()
  const [banner, setBanner] = useState<BannerState>({ visible: false })
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPayloadKeyRef = useRef<{ key: string; at: number } | null>(null)
  const touchStartY = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const hideBanner = useCallback(() => {
    clearTimer()
    setBanner((b) => (b.visible ? { ...b, entered: false } : b))
    window.setTimeout(() => setBanner({ visible: false }), 200)
  }, [clearTimer])

  const showBanner = useCallback(
    (headline: string, subline: string | undefined, url?: string) => {
      if (!Capacitor.isNativePlatform()) return
      if (document.visibilityState === 'hidden') return
      if (shouldSkipForegroundBannerDueToSameRoute(location.pathname, url)) return

      const payloadKey = `${headline}\0${subline ?? ''}\0${url ?? ''}`
      const now = Date.now()
      const prev = lastPayloadKeyRef.current
      if (prev && prev.key === payloadKey && now - prev.at < DEDupe_MS) return
      lastPayloadKeyRef.current = { key: payloadKey, at: now }

      clearTimer()
      setBanner({ visible: true, headline, subline, url, entered: false })
      requestAnimationFrame(() => {
        setBanner((b) => (b.visible ? { ...b, entered: true } : b))
      })
      dismissTimerRef.current = setTimeout(hideBanner, AUTO_DISMISS_MS)
    },
    [clearTimer, hideBanner, location.pathname],
  )

  useEffect(() => {
    const onForegroundPush = (ev: Event) => {
      const parsed = foregroundBannerFromPushDetail((ev as CustomEvent).detail)
      if (!parsed) return
      showBanner(parsed.headline, parsed.subline, parsed.url)
    }
    window.addEventListener('cpoint:push-notification-received', onForegroundPush)
    return () => {
      window.removeEventListener('cpoint:push-notification-received', onForegroundPush)
      clearTimer()
    }
  }, [clearTimer, showBanner])

  const onBannerClick = () => {
    clearTimer()
    if (banner.visible) {
      navigateToPushUrl(navigate, banner.url)
    }
    setBanner({ visible: false })
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartY.current
    touchStartY.current = null
    if (start == null) return
    const end = e.changedTouches[0]?.clientY ?? start
    if (start - end > SWIPE_UP_DISMISS_PX) {
      hideBanner()
    }
  }

  if (!banner.visible) return null

  const transform = banner.entered ? 'translateY(0)' : 'translateY(110%)'
  const opacity = banner.entered ? 1 : 0

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-[1200] flex justify-center px-3"
      style={{
        bottom: 0,
        paddingBottom: 'max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 5.25rem))',
      }}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onBannerClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="pointer-events-auto flex max-w-lg gap-3 rounded-2xl border border-black/10 bg-white px-3.5 py-3 text-left shadow-xl transition-[transform,opacity] duration-200 ease-out"
        style={{ transform, opacity }}
        aria-label={`${banner.headline}. Tap to open.`}
      >
        <img
          src={LOGO_PRIMARY}
          alt=""
          width={40}
          height={40}
          className="mt-0.5 h-10 w-10 shrink-0 rounded-lg object-contain"
          onError={(e) => {
            const el = e.currentTarget
            if (el.src.endsWith(LOGO_FALLBACK)) return
            el.src = LOGO_FALLBACK
          }}
        />
        <div className="min-w-0 flex-1 flex flex-col gap-0.5 pt-0.5">
          <span className="text-sm font-semibold leading-snug text-neutral-900 line-clamp-2">{banner.headline}</span>
          {banner.subline ? (
            <span className="text-xs leading-snug text-neutral-600 line-clamp-2">{banner.subline}</span>
          ) : null}
        </div>
      </button>
    </div>
  )
}
