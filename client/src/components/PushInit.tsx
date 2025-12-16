import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()

  useEffect(() => {
    // Handle navigation based on notification URL
    const handleNotificationNavigation = (url: string | undefined) => {
      if (!url) {
        console.log('📍 No URL in notification, going to notifications page')
        navigate('/notifications')
        return
      }

      console.log('📍 Navigating to:', url)

      // Message notifications: /user_chat/chat/{username} - navigate directly
      if (url.startsWith('/user_chat/chat/')) {
        navigate(url)
        return
      }

      // Profile URLs: /profile/{username}
      if (url.startsWith('/profile/')) {
        navigate(url)
        return
      }

      // Event URLs: /event/{id} or /community/{id}/calendar
      if (url.startsWith('/event/') || url.includes('/calendar')) {
        const reactUrl = url.replace('/calendar', '/calendar_react')
        navigate(reactUrl)
        return
      }

      // Poll URLs: /community/{id}/polls_react
      if (url.includes('/polls')) {
        const reactUrl = url.includes('_react') ? url : url.replace('/polls', '/polls_react')
        navigate(reactUrl)
        return
      }

      // Community feed: /community_feed/{id}
      if (url.startsWith('/community_feed/')) {
        const id = url.replace('/community_feed/', '')
        navigate(`/community_feed_react/${id}`)
        return
      }

      // Post detail: /post/{id}
      if (url.startsWith('/post/')) {
        navigate(url)
        return
      }

      // Followers/requests
      if (url.startsWith('/followers')) {
        navigate(url)
        return
      }

      // Default: try to navigate to the URL directly
      navigate(url)
    }

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
            
            // Listen for notification taps - NAVIGATE TO RELEVANT PAGE
            PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
              console.log('👆 Push notification tapped:', JSON.stringify(action, null, 2))
              
              // Extract URL from notification data
              // The data can be in different places depending on iOS/Android and FCM/APNs
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const notification: any = action.notification || {}
              const data = notification.data || {}
              
              // Try multiple possible locations for the URL
              const url = data.url 
                || data.link 
                || data.deepLink
                || notification.url  // Sometimes at root level
                || notification.link
                || notification.custom?.url  // FCM custom data
                || notification.userInfo?.url  // APNs userInfo
              
              console.log('📍 Full notification object:', JSON.stringify(notification, null, 2))
              console.log('📍 Data object:', JSON.stringify(data, null, 2))
              console.log('📍 Extracted URL:', url)
              
              // Navigate to the relevant page
              handleNotificationNavigation(url)
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
            if (e?.data?.type === 'SW_ACTIVATED'){
              const version = e?.data?.version || 'unknown'
              console.log(`[SW] Service worker activated: v${version}`)
              
              // Force reload if explicitly requested, or if not reloaded yet
              if (e?.data?.forceReload || !sessionStorage.getItem('swReloaded')){
                sessionStorage.setItem('swReloaded', '1')
                console.log('[SW] Reloading to pick up new assets...')
                // Hard reload to bypass cache
                location.reload()
              }
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
  }, [navigate])
  return ready ? null : null
}
