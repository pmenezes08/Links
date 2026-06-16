import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import './index.css'
import App from './App'
import './i18n'
import { installLocaleFetchHeaders } from './i18n/fetchHeaders'

import('@fortawesome/fontawesome-free/css/all.min.css')

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

installLocaleFetchHeaders()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The native splash is held (launchAutoHide:false) so it covers the whole
// cold-open gap — native launch → remote SPA fetch → first paint — with the
// branded white/logo screen instead of a black WebView flash. Hand it off to
// the in-app loader once we've actually painted a frame (double rAF), then fade
// it out. No-op on web (the plugin stub + native-platform guard).
if (Capacitor.isNativePlatform()) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {})
    })
  })
}
