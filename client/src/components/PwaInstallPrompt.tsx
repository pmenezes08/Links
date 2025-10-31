import { useCallback, useEffect, useMemo, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string[] }>
}

const DISMISS_STORAGE_KEY = 'pwa-install-dismissed-at'
const INSTALL_COMPLETED_KEY = 'pwa-install-completed'
const DISMISS_DURATION_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

type PromptMode = 'none' | 'web' | 'ios'

interface NavigatorStandalone extends Navigator {
  standalone?: boolean
}

function isStandaloneDisplay(){
  if (typeof window === 'undefined') return false
  const nav = navigator as NavigatorStandalone
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function shouldSuppressPrompt(){
  if (typeof window === 'undefined') return true
  const completed = localStorage.getItem(INSTALL_COMPLETED_KEY)
  if (completed === 'true') return true
  const dismissedAtRaw = localStorage.getItem(DISMISS_STORAGE_KEY)
  if (!dismissedAtRaw) return false
  const dismissedAt = Number(dismissedAtRaw)
  if (!Number.isFinite(dismissedAt)) return false
  return Date.now() - dismissedAt < DISMISS_DURATION_MS
}

function isIosDevice(){
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const maxTouch = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints || 0

  const directMatch = /iPad|iPhone|iPod/.test(ua)
  const ipadOs13 = platform === 'MacIntel' && maxTouch > 1
  return directMatch || ipadOs13
}

export default function PwaInstallPrompt(){
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [mode, setMode] = useState<PromptMode>('none')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isStandaloneDisplay()) return

    const maybeShowIosPrompt = () => {
      if (!isIosDevice()) return
      if (shouldSuppressPrompt()) return
      setMode('ios')
      setVisible(true)
    }

    function handleBeforeInstallPrompt(event: Event){
      event.preventDefault()
      if (shouldSuppressPrompt()) return
      setDeferredPrompt(event as BeforeInstallPromptEvent)
      setMode('web')
      setVisible(true)
    }

    function handleAppInstalled(){
      localStorage.setItem(INSTALL_COMPLETED_KEY, 'true')
      setDeferredPrompt(null)
      setMode('none')
      setVisible(false)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    window.addEventListener('appinstalled', handleAppInstalled)

    // Safari iOS does not emit beforeinstallprompt; fall back to a manual banner
    maybeShowIosPrompt()

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_STORAGE_KEY, Date.now().toString())
    setVisible(false)
    setDeferredPrompt(null)
    setMode('none')
  }, [])

  const handleInstall = useCallback(async () => {
    if (mode === 'ios'){
      localStorage.setItem(DISMISS_STORAGE_KEY, Date.now().toString())
      setVisible(false)
      setMode('none')
      return
    }
    if (!deferredPrompt) return
    try{
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice.catch(() => null)
      if (choice?.outcome === 'accepted'){
        localStorage.setItem(INSTALL_COMPLETED_KEY, 'true')
        setVisible(false)
      } else {
        localStorage.setItem(DISMISS_STORAGE_KEY, Date.now().toString())
        setVisible(false)
      }
    } catch (error) {
      console.warn('[PWA] Install prompt error', error)
    } finally {
      setDeferredPrompt(null)
      setMode('none')
    }
  }, [deferredPrompt, mode])

  const styles = useMemo(() => {
    return {
      wrapper: {
        position: 'fixed' as const,
        bottom: '16px',
        left: '16px',
        right: '16px',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 2147483646,
        pointerEvents: visible ? 'auto' as const : 'none' as const,
      },
      container: {
        maxWidth: '420px',
        width: '100%',
        background: 'rgba(17, 17, 17, 0.92)',
        color: '#ffffff',
        borderRadius: '16px',
        padding: '16px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '12px',
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 160ms ease, transform 160ms ease',
        pointerEvents: 'auto' as const,
      },
      title: {
        margin: 0,
        fontSize: '16px',
        lineHeight: 1.3,
        fontWeight: 600,
      },
      body: {
        margin: 0,
        fontSize: '14px',
        lineHeight: 1.4,
        color: 'rgba(255,255,255,0.75)',
      },
      actions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
      },
      ghostButton: {
        background: 'transparent',
        border: '1px solid rgba(255, 255, 255, 0.25)',
        color: '#ffffff',
        borderRadius: '999px',
        padding: '8px 16px',
        fontSize: '13px',
        cursor: 'pointer',
      },
      primaryButton: {
        background: '#4db6ac',
        border: 'none',
        color: '#041f1a',
        borderRadius: '999px',
        padding: '8px 18px',
        fontSize: '13px',
        cursor: 'pointer',
        fontWeight: 600,
      },
    }
  }, [visible])

  if (!visible || mode === 'none') return null

  const isIosMode = mode === 'ios'

  return (
    <div style={styles.wrapper}>
      <div style={styles.container} role="dialog" aria-live="polite" aria-label="Install the C-Point app">
        <div>
          <h2 style={styles.title}>Install C-Point</h2>
          {isIosMode ? (
            <>
              <p style={styles.body}>Install the C-Point app to get notifications, offline access, and the full experience:</p>
              <ol style={{ margin: 0, paddingLeft: '18px', color: 'rgba(255,255,255,0.75)', fontSize: '14px', lineHeight: 1.4 }}>
                <li>Tap the share icon in Safari.</li>
                <li>Select <strong style={{ color: '#ffffff' }}>&ldquo;Add to Home Screen&rdquo;</strong> to install the C-Point app.</li>
                <li>Confirm the name and tap Add.</li>
              </ol>
            </>
          ) : (
            <p style={styles.body}>Install the C-Point app to receive push notifications, unlock the full experience, and stay available offline.</p>
          )}
        </div>
        <div style={styles.actions}>
          <button type="button" style={styles.ghostButton} onClick={dismiss}>Maybe later</button>
          <button type="button" style={styles.primaryButton} onClick={handleInstall}>{isIosMode ? 'Got it' : 'Install'}</button>
        </div>
      </div>
    </div>
  )
}
