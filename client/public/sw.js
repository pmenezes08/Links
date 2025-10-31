const SW_VERSION = '2.0.0'
const APP_SHELL_CACHE = `cp-shell-${SW_VERSION}`
const RUNTIME_CACHE = `cp-runtime-${SW_VERSION}`

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/static/logo.png',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/apple-touch-icon.png'
]

const STATIC_ASSET_PATHS = new Set(STATIC_ASSETS)

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(APP_SHELL_CACHE)
      await cache.addAll(STATIC_ASSETS)
      console.log(`[SW] Cached app shell v${SW_VERSION}`)
    } catch (error) {
      console.warn('[SW] Precaching failed', error)
    } finally {
      await self.skipWaiting()
    }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== APP_SHELL_CACHE && cacheName !== RUNTIME_CACHE)
          .map((cacheName) => caches.delete(cacheName))
      )
      await self.clients.claim()
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients){
        try {
          client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION })
        } catch (error) {
          console.warn('[SW] Failed to notify client', error)
        }
      }
      console.log(`[SW] Activated v${SW_VERSION}`)
    } catch (error) {
      console.error('[SW] Activation error', error)
    }
  })())
})

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

async function cacheFirst(request, cacheName){
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response?.status === 200){
    cache.put(request, response.clone())
  }
  return response
}

async function staleWhileRevalidate(request, cacheName){
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const networkPromise = fetch(request).then((response) => {
    if (response?.status === 200){
      cache.put(request, response.clone())
    }
    return response
  }).catch(() => undefined)

  if (cached){
    // Ensure the network update still runs in background
    networkPromise?.catch(() => {})
    return cached
  }

  const networkResponse = await networkPromise
  if (networkResponse) return networkResponse
  throw new Error('Network unavailable and no cached response')
}

async function networkFirst(request, cacheName){
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response?.status === 200){
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (request.mode === 'navigate'){
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request)
        if (networkResponse?.status === 200){
          const cache = await caches.open(APP_SHELL_CACHE)
          const cachedResponse = networkResponse.clone()
          cache.put('/index.html', cachedResponse)
          cache.put('/', networkResponse.clone())
        }
        return networkResponse
      } catch (error) {
        const cache = await caches.open(APP_SHELL_CACHE)
        const cached = await cache.match('/index.html') || await cache.match('/')
        if (cached) return cached
        throw error
      }
    })())
    return
  }

  if (url.origin === self.location.origin && STATIC_ASSET_PATHS.has(url.pathname)){
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE))
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')){
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/static/icons/')){
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
    return
  }

  if (url.origin === self.location.origin && request.destination === 'image'){
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
    return
  }

  if (url.pathname.startsWith('/api/') && request.headers.get('accept')?.includes('application/json')){
    event.respondWith(networkFirst(request, RUNTIME_CACHE))
    return
  }
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}
  const targetUrl = data.url || '/'
  const tag = data.tag || undefined
  const maybeNotify = async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList){
      try{
        const href = client.url || ''
        const focused = client.focused || false
        if (focused && (href.includes(targetUrl) || (tag && tag.startsWith('message-') && href.includes('/user_chat')))){
          return
        }
      }catch{}
    }
    const title = data.title || 'Notification'
    const options = {
      body: data.body || '',
      icon: data.icon || '/static/icons/icon-192.png',
      badge: data.badge || '/static/icons/icon-192.png',
      data: { url: targetUrl },
      tag,
      requireInteraction: !!data.requireInteraction
    }
    await self.registration.showNotification(title, options)
  }
  event.waitUntil(maybeNotify())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList){
        if ('focus' in client){
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow){
        return self.clients.openWindow(url)
      }
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const resp = await fetch('/api/push/public_key', { credentials: 'include' })
      const json = await resp.json().catch(() => ({}))
      const publicKey = json?.publicKey
      if (!publicKey) return
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      })
    } catch (error) {
      console.warn('[SW] pushsubscriptionchange failed', error)
    }
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING'){
    self.skipWaiting()
  }
})
