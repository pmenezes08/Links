import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

type BadgeContextType = {
  unreadMsgs: number
  unreadNotifs: number
  refreshBadges: () => void
  adjustBadges: (delta: { msgs?: number; notifs?: number }) => void
}

const BadgeContext = createContext<BadgeContextType>({
  unreadMsgs: 0,
  unreadNotifs: 0,
  refreshBadges: () => {},
  adjustBadges: () => {},
})

export function useBadges() {
  return useContext(BadgeContext)
}

const POLL_INTERVAL_MS = 5000

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [unreadNotifs, setUnreadNotifs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    let msgs = 0
    let notifs = 0
    try {
      const m = await fetch('/check_unread_messages', { credentials: 'include' })
      const mj = await m.json().catch(() => null)
      if (mj && typeof mj.unread_count === 'number') {
        msgs = mj.unread_count
        setUnreadMsgs(mj.unread_count)
      }
    } catch {}
    try {
      const n = await fetch('/api/notifications', { credentials: 'include', headers: { Accept: 'application/json' } })
      const nj = await n.json().catch(() => null)
      if (nj?.success && Array.isArray(nj.notifications)) {
        const cnt = nj.notifications.filter(
          (x: any) => x && x.is_read === false && x.type !== 'message' && x.type !== 'reaction',
        ).length
        notifs = cnt
        setUnreadNotifs(cnt)
      }
    } catch {}

    const total = msgs + notifs
    try {
      const navAny = navigator as any
      if (total > 0) {
        if (typeof navAny.setAppBadge === 'function') navAny.setAppBadge(total)
        else if (typeof navAny.setExperimentalAppBadge === 'function') navAny.setExperimentalAppBadge(total)
      } else {
        if (typeof navAny.clearAppBadge === 'function') navAny.clearAppBadge()
        else if (typeof navAny.setExperimentalAppBadge === 'function') navAny.setExperimentalAppBadge(0)
      }
    } catch {}

    if (total === 0 && Capacitor.isNativePlatform()) {
      try {
        await PushNotifications.removeAllDeliveredNotifications()
      } catch {}
      try {
        await fetch('/api/notifications/clear-badge', { method: 'POST', credentials: 'include' })
      } catch {}
    }
  }, [])

  useEffect(() => {
    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [poll])

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) poll()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [poll])

  const refreshBadges = useCallback(() => {
    poll()
  }, [poll])

  const adjustBadges = useCallback(({ msgs, notifs }: { msgs?: number; notifs?: number }) => {
    if (msgs !== undefined) setUnreadMsgs(prev => Math.max(0, prev + msgs))
    if (notifs !== undefined) setUnreadNotifs(prev => Math.max(0, prev + notifs))
  }, [])

  return (
    <BadgeContext.Provider value={{ unreadMsgs, unreadNotifs, refreshBadges, adjustBadges }}>
      {children}
    </BadgeContext.Provider>
  )
}
