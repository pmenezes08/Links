import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
