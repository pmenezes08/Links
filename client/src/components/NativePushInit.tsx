import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { useUserProfile } from '../contexts/UserProfileContext'

const APNS_ENVIRONMENT = (import.meta as any).env?.VITE_APNS_ENVIRONMENT || 'sandbox'

export default function NativePushInit(){
  const { profile, loading } = useUserProfile()
  const initializedRef = useRef(false)
  const claimedRef = useRef(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    if (initializedRef.current) return
    initializedRef.current = true

    let registrationHandle: { remove: () => Promise<void> } | undefined
    let errorHandle: { remove: () => Promise<void> } | undefined

    ;(async () => {
      try{
        const hasPermission = await ensurePermission()
        if (!hasPermission) return

        registrationHandle = await PushNotifications.addListener('registration', async ({ value }) => {
          await registerTokenWithServer(value)
        })

        errorHandle = await PushNotifications.addListener('registrationError', (err) => {
          console.warn('[NativePush] Registration error', err)
        })

        await PushNotifications.register()
      }catch(err){
        console.warn('[NativePush] Failed to initialize native push', err)
      }
    })()

    return () => {
      registrationHandle?.remove()
      errorHandle?.remove()
    }
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    if (loading) return
    if (!profile){
      claimedRef.current = false
      return
    }
    if (claimedRef.current) return
    claimedRef.current = true
    ;(async () => {
      try{
        await fetch('/api/native_push/claim', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      }catch(err){
        console.warn('[NativePush] claim error', err)
      }
    })()
  }, [profile, loading])

  return null
}

async function ensurePermission(){
  const status = await PushNotifications.checkPermissions()
  if (status.receive === 'granted') return true
  const request = await PushNotifications.requestPermissions()
  return request.receive === 'granted'
}

async function registerTokenWithServer(token: string){
  if (!token) return
  try{
    await fetch('/api/native_push/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        platform: Capacitor.getPlatform(),
        environment: APNS_ENVIRONMENT,
      }),
    })
  }catch(err){
    console.warn('[NativePush] Failed to register token', err)
  }
}
