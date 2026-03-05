import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

const PROMPT_DISMISSED_KEY = 'notif-prompt-dismissed'

export default function NotificationPrompt() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        if (localStorage.getItem(PROMPT_DISMISSED_KEY)) return
      } catch {
        return
      }

      try {
        if (Capacitor.isNativePlatform()) {
          const mod = await import('@capacitor/push-notifications')
          const PushNotifications = mod.PushNotifications
          const result = await PushNotifications.checkPermissions()
          if (result.receive !== 'granted') {
            setShow(true)
          }
        } else {
          if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
            setShow(true)
          }
        }
      } catch (err) {
        console.warn('NotificationPrompt check failed:', err)
      }
    }, 4000)

    return () => clearTimeout(timer)
  }, [])

  if (!show) return null

  const dismiss = () => {
    try { localStorage.setItem(PROMPT_DISMISSED_KEY, '1') } catch {}
    setShow(false)
  }

  const handleEnable = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        // On native, request permission first
        const mod = await import('@capacitor/push-notifications')
        const result = await mod.PushNotifications.requestPermissions()
        if (result.receive === 'granted') {
          await mod.PushNotifications.register()
          dismiss()
          return
        }
        // If denied, try to open settings
        try {
          if (Capacitor.getPlatform() === 'ios') {
            const { App: CapApp } = await import('@capacitor/app')
            await (CapApp as any).openUrl({ url: 'app-settings:' })
          }
        } catch {}
      } else {
        if (typeof Notification !== 'undefined') {
          const perm = await Notification.requestPermission()
          if (perm === 'granted') {
            dismiss()
            return
          }
        }
      }
    } catch (err) {
      console.warn('NotificationPrompt enable failed:', err)
    }
    dismiss()
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }} />
      <div
        style={{ position: 'relative', width: '100%', maxWidth: 360, borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: '#111', padding: 20, color: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 12px', borderRadius: '50%', background: 'rgba(77,182,172,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="fa-solid fa-bell" style={{ color: '#4db6ac', fontSize: 24 }} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Turn On Notifications</h3>
        </div>

        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 16, lineHeight: 1.5 }}>
          Stay in the loop with your communities. Get notified about new messages, event reminders, poll updates, and when someone mentions you.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={handleEnable}
            style={{ width: '100%', padding: '12px 0', borderRadius: 12, background: '#4db6ac', color: '#000', fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer' }}
          >
            Enable Notifications
          </button>
          <button
            onClick={dismiss}
            style={{ width: '100%', padding: '12px 0', borderRadius: 12, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', fontSize: 14, border: 'none', cursor: 'pointer' }}
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  )
}
