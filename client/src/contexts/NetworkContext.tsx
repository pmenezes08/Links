import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'

interface NetworkState {
  isOnline: boolean
  /** True after we transition from offline → online (resets after 5 s) */
  justReconnected: boolean
}

const NetworkContext = createContext<NetworkState>({ isOnline: true, justReconnected: false })

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [justReconnected, setJustReconnected] = useState(false)
  const wasOffline = useRef(false)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const goOnline = useCallback(() => {
    setIsOnline(true)
    if (wasOffline.current) {
      wasOffline.current = false
      setJustReconnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      reconnectTimer.current = setTimeout(() => setJustReconnected(false), 5000)
    }
  }, [])

  const goOffline = useCallback(() => {
    setIsOnline(false)
    wasOffline.current = true
  }, [])

  useEffect(() => {
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // Capacitor Network plugin (more reliable on native)
    let cleanup: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/network').then(({ Network }) => {
        Network.getStatus().then(s => {
          if (!s.connected) goOffline()
        }).catch(() => {})
        Network.addListener('networkStatusChange', (status) => {
          if (status.connected) goOnline()
          else goOffline()
        }).then(handle => {
          cleanup = () => handle.remove()
        }).catch(() => {})
      }).catch(() => {})
    }

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      cleanup?.()
    }
  }, [goOnline, goOffline])

  return (
    <NetworkContext.Provider value={{ isOnline, justReconnected }}>
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetwork() {
  return useContext(NetworkContext)
}
