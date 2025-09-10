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
  const [ready, setReady] = useState(false)
  useEffect(() => {
    async function run(){
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
      try{
        const reg = await navigator.serviceWorker.register('/sw.js')
        // Ensure service worker is active before subscribing
        await navigator.serviceWorker.ready
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') return
        const vapidRes = await fetch('/api/push/public_key', { credentials:'include' })
        const { publicKey } = await vapidRes.json()
        if (!publicKey){
          // Server not configured; do not attempt subscription
          return
        }
        // Attempt to get an existing subscription first
        let subscription = await reg.pushManager.getSubscription()
        if (!subscription){
          subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
        }
        const resp = await fetch('/api/push/subscribe', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(subscription) })
        if (!resp.ok){
          // If server rejected, try re-subscribe once
          try{ await subscription.unsubscribe() }catch{}
          const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
          await fetch('/api/push/subscribe', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(fresh) })
        }
        setReady(true)
      }catch{
        // ignore
      }
    }
    run()
  }, [])
  return ready ? null : null
}

