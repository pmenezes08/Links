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

const LOGO_SOURCES = ['/api/public/logo', '/static/logo.png', '/static/icons/icon-192.png'] as const

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
 * Full-width compact bar at the top (above in-app chrome such as z-[1000] headers);
 * tap opens deep link; swipe up dismisses; auto-dismiss after ~5s.
 */
export default function ForegroundPushBanner() {
  const navigate = useNavigate()
  const location = useLocation()
  const [banner, setBanner] = useState<BannerState>({ visible: false })
  const [logoSrcIndex, setLogoSrcIndex] = useState(0)
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
      setLogoSrcIndex(0)
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

  const transform = banner.entered ? 'translateY(0)' : 'translateY(-100%)'
  const opacity = banner.entered ? 1 : 0

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-[1200]"
      style={{
        paddingTop: 'max(0px, env(safe-area-inset-top, 0px))',
      }}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onBannerClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="pointer-events-auto flex w-full items-center gap-2.5 border-b border-black/10 bg-white px-3 py-2 text-left shadow-md transition-[transform,opacity] duration-200 ease-out"
        style={{ transform, opacity }}
        aria-label={`${banner.headline}. Tap to open.`}
      >
        <img
          src={LOGO_SOURCES[logoSrcIndex]}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded-md object-contain"
          onError={() =>
            setLogoSrcIndex((i) => (i + 1 < LOGO_SOURCES.length ? i + 1 : i))
          }
        />
        <div className="min-w-0 flex-1 py-0.5">
          <span className="block text-sm font-semibold leading-tight text-neutral-900 line-clamp-1">
            {banner.headline}
          </span>
          {banner.subline ? (
            <span className="mt-0.5 block text-xs leading-tight text-neutral-600 line-clamp-1">
              {banner.subline}
            </span>
          ) : null}
        </div>
      </button>
    </div>
  )
}
