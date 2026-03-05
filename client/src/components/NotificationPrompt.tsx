import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

const PROMPT_DISMISSED_KEY = 'notif-prompt-dismissed'

export default function NotificationPrompt() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (localStorage.getItem(PROMPT_DISMISSED_KEY)) return

      try {
        if (Capacitor.isNativePlatform()) {
          const { PushNotifications } = await import('@capacitor/push-notifications')
          const result = await PushNotifications.checkPermissions()
          if (result.receive === 'denied') setShow(true)
        } else if ('Notification' in window && Notification.permission === 'denied') {
          setShow(true)
        }
      } catch {}
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  if (!show) return null

  const dismiss = () => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, '1')
    setShow(false)
  }

  const openSettings = async () => {
    dismiss()
    try {
      if (Capacitor.getPlatform() === 'ios') {
        const { App: CapApp } = await import('@capacitor/app')
        // @ts-ignore
        if (CapApp.openUrl) await CapApp.openUrl({ url: 'app-settings:' })
      } else if (Capacitor.getPlatform() === 'android') {
        const { App: CapApp } = await import('@capacitor/app')
        // @ts-ignore
        if (CapApp.openUrl) await CapApp.openUrl({ url: 'android.settings.APP_NOTIFICATION_SETTINGS' })
      }
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#111] p-5 text-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#4db6ac]/10 flex items-center justify-center">
            <i className="fa-solid fa-bell text-[#4db6ac] text-2xl" />
          </div>
          <h3 className="text-lg font-semibold">Turn On Notifications</h3>
        </div>

        <p className="text-sm text-white/70 text-center mb-4 leading-relaxed">
          Stay in the loop with your communities. Get notified about new messages, event reminders,
          poll updates, and when someone mentions you.
        </p>

        <div className="space-y-2">
          <button
            onClick={openSettings}
            className="w-full py-3 rounded-xl bg-[#4db6ac] text-black font-semibold text-sm hover:bg-[#45a99c] transition"
          >
            Enable Notifications
          </button>
          <button
            onClick={dismiss}
            className="w-full py-3 rounded-xl bg-white/5 text-white/60 text-sm hover:bg-white/10 transition"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  )
}
