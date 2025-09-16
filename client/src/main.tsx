import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Minimal client error reporter
function installClientLogger(){
  const send = (level: 'error'|'warn', payload: any) => {
    try{
      fetch('/api/client_log', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ level, ...payload })
      }).catch(()=>{})
    }catch{}
  }
  window.addEventListener('error', (e) => {
    try{
      const msg = e.message || 'Unknown error'
      const src = (e as any).filename
      const lineno = (e as any).lineno
      const colno = (e as any).colno
      const stack = e.error && (e.error as any).stack
      send('error', { type:'window_error', msg, src, lineno, colno, stack, ua: navigator.userAgent })
    }catch{}
  })
  window.addEventListener('unhandledrejection', (e:any) => {
    try{
      const reason = e?.reason
      const msg = typeof reason === 'string' ? reason : (reason?.message || 'Unhandled rejection')
      const stack = reason?.stack
      send('error', { type:'unhandledrejection', msg, stack, ua: navigator.userAgent })
    }catch{}
  })
}

installClientLogger()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
