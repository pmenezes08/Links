import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

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
      // Native iOS/Android app - use Capacitor Push Notifications
      if (Capacitor.isNativePlatform()) {
        console.log('🔔 Initializing native push notifications...')
        try {
          // Check current permission status first
          const currentStatus = await PushNotifications.checkPermissions()
          console.log('🔔 Current permission status:', currentStatus)
          
          // Request permission
          console.log('🔔 Requesting push notification permissions...')
          const permResult = await PushNotifications.requestPermissions()
          console.log('🔔 Permission result:', permResult)
          
          if (permResult.receive === 'granted') {
            console.log('🔔 Permission granted! Registering for push...')
            // Register for push notifications
            await PushNotifications.register()
            console.log('🔔 Registration initiated')
            
            // Listen for registration token from Capacitor
            // When Firebase generates FCM token, Capacitor catches it and fires this event
            PushNotifications.addListener('registration', async (token) => {
              console.log('🔥 Capacitor registration event fired!')
              console.log('🔥 FCM token received: ' + token.value.substring(0, 30) + '...')
              console.log('🔥 Token length: ' + token.value.length + ' characters')
              
              // Send token to backend
              try {
                console.log('📤 Sending FCM token to server...')
                const response = await fetch('/api/push/register_fcm', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    token: token.value,
                    platform: Capacitor.getPlatform()
                  })
                })
                
                const result = await response.json()
                
                if (response.ok) {
                  console.log('✅ FCM token successfully registered with server!')
                  console.log('✅ Server response:', result)
                } else {
                  console.error('❌ Failed to register token. Status:', response.status)
                  console.error('❌ Error response:', result)
                }
              } catch (error) {
                console.error('❌ Network error registering push token:', error)
              }
            })
            
            // Listen for registration errors
            PushNotifications.addListener('registrationError', (error) => {
              console.error('Push registration error:', error)
            })
            
            // Listen for push notifications received while app is in foreground
            PushNotifications.addListener('pushNotificationReceived', (notification) => {
              console.log('Push notification received:', notification)
              // You can show an in-app notification here if desired
            })
            
            // Listen for notification taps (user clicked notification)
            PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
              console.log('Push notification action performed:', notification)
              // Handle navigation based on notification data
            })
            
            setReady(true)
          } else {
            console.log('🔔 ❌ Push notification permission not granted:', permResult.receive)
          }
        } catch (error) {
          console.error('🔔 ❌ Push notification setup error:', error)
          console.error('🔔 Error details:', JSON.stringify(error, null, 2))
        }
        return
      }
      
      console.log('🔔 Not a native platform, skipping native push setup')
      
      // Web platform - use service worker push
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
