import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'

interface NetworkState {
  isOnline: boolean
  /** True after we transition from offline → online (resets after 5 s) */
  justReconnected: boolean
  /** Prevents false offline banner and cached/ghost mode on cold start */
  isInitialized: boolean
}

const NetworkContext = createContext<NetworkState>({ isOnline: true, justReconnected: false, isInitialized: true })

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator !== 'undefined') {
      return navigator.onLine; // Always start with navigator.onLine (plugin overrides). Fixes cold-start ghost/offline on simulator/Xcode.
    }
    return true;
  })
  const [justReconnected, setJustReconnected] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const wasOffline = useRef(false)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const goOnline = useCallback(() => {
    setIsOnline(true)
    setIsInitialized(true)
    if (wasOffline.current) {
      wasOffline.current = false
      setJustReconnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      reconnectTimer.current = setTimeout(() => setJustReconnected(false), 5000)
    }
  }, [])

  const goOffline = useCallback(() => {
    setIsOnline(false)
    setIsInitialized(true)
    wasOffline.current = true
  }, [])

  useEffect(() => {
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // Capacitor Network plugin (more reliable on native). Symmetric goOnline/goOffline + isInitialized prevents ghost/offline mode and false banner on cold start.
    let cleanup: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/network').then(({ Network }) => {
        Network.getStatus().then(s => {
          if (s.connected) goOnline()
          else goOffline()
          setIsInitialized(true)
        }).catch(() => {
          setIsInitialized(true)
        })
        Network.addListener('networkStatusChange', (status) => {
          if (status.connected) goOnline()
          else goOffline()
          setIsInitialized(true)
        }).then(handle => {
          cleanup = () => handle.remove()
        }).catch(() => {
          setIsInitialized(true)
        })
      }).catch(() => {
        setIsInitialized(true)
      })
    }

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      cleanup?.()
    }
  }, [goOnline, goOffline])

  return (
    <NetworkContext.Provider value={{ isOnline, justReconnected, isInitialized }}>
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetwork() {
  return useContext(NetworkContext)
}
