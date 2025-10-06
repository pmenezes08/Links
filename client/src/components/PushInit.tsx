import { useEffect, useState } from 'react'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export default function PushInit(){
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    async function run(){
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
      try{
        const reg = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready

        // Check for service worker updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              console.log('[App] New version available!')
              setUpdateAvailable(true)
            }
          })
        })

        // Check for updates every 30 minutes
        setInterval(() => {
          reg.update().catch(() => {})
        }, 30 * 60 * 1000)

        // Check for updates when page becomes visible
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            reg.update().catch(() => {})
          }
        })

        async function subscribeAndRegister(){
          try{
            const vapidRes = await fetch('/api/push/public_key', { credentials:'include' })
            const { publicKey } = await vapidRes.json()
            if (!publicKey) return
            let subscription = await reg.pushManager.getSubscription()
            if (!subscription){
              subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
            }
            const resp = await fetch('/api/push/subscribe', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(subscription) })
            if (!resp.ok){
              try{ await subscription.unsubscribe() }catch{}
              const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
              await fetch('/api/push/subscribe', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(fresh) })
            }
          }catch{ /* ignore */ }
        }

        const perm: NotificationPermission = Notification.permission
        if (perm === 'granted'){
          await subscribeAndRegister()
          return
        }
        if (perm === 'denied') return
        // perm === 'default' → request on first user gesture, then subscribe
        const clickOnce = () => {
          document.removeEventListener('click', clickOnce)
          Notification.requestPermission().then((p) => {
            if (p === 'granted') subscribeAndRegister()
          }).catch(()=>{})
        }
        document.addEventListener('click', clickOnce, { once: true })
      }catch{
        // ignore
      }
    }
    run()
  }, [])

  // Show update notification banner
  if (updateAvailable) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[99999] bg-gradient-to-r from-[#4db6ac] to-[#26a69a] text-black px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-circle-info" />
          <span className="text-sm font-medium">New version available!</span>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1 rounded-md bg-black/20 hover:bg-black/30 text-sm font-medium transition-colors"
        >
          Refresh Now
        </button>
      </div>
    )
  }

  return null
}
