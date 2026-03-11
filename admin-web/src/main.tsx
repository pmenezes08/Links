import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// Set favicon from API base (staging or production)
const apiBase = import.meta.env.VITE_API_BASE || 'https://app.c-point.co'
const favicon = document.getElementById('dynamic-favicon') as HTMLLinkElement | null
if (favicon) favicon.href = `${apiBase}/api/public/logo`

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
