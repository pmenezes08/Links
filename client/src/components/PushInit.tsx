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
        await navigator.serviceWorker.ready
        try{
          navigator.serviceWorker.addEventListener('message', (e: any) => {
            if (e?.data?.type === 'SW_ACTIVATED' && !sessionStorage.getItem('swReloaded')){
              sessionStorage.setItem('swReloaded', '1')
              // Light reload to pick up new index.html/assets
              location.reload()
            }
          })
        }catch{}

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
            setReady(true)
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
  return ready ? null : null
}
