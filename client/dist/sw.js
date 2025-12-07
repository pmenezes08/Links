const SW_VERSION = '2.14.0'
const APP_SHELL_CACHE = `cp-shell-${SW_VERSION}`
const RUNTIME_CACHE = `cp-runtime-${SW_VERSION}`
const MEDIA_CACHE = `cp-media-${SW_VERSION}`
const MAX_MEDIA_CACHE_SIZE = 50 // Max number of videos/large media to cache
const FORCE_UPDATE_TIMESTAMP = 1764987500000 // Force cache clear after this timestamp

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
const STALE_API_ENDPOINTS = new Set([
  '/api/profile_me',
  '/api/user_communities_hierarchical',
  '/get_user_communities_with_members',
  '/api/premium_dashboard_summary',
])

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
      // Delete ALL old caches to force refresh
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== APP_SHELL_CACHE && cacheName !== RUNTIME_CACHE && cacheName !== MEDIA_CACHE)
          .map((cacheName) => caches.delete(cacheName))
      )
      
      // Also clear current runtime cache to force refetch of assets
      await caches.delete(RUNTIME_CACHE)
      
      await self.clients.claim()
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients){
        try {
          client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION, forceReload: true })
        } catch (error) {
          console.warn('[SW] Failed to notify client', error)
        }
      }
      console.log(`[SW] Activated v${SW_VERSION} - forced cache clear`)
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

// Cache-first for large media (videos) with size limit
async function cacheFirstMedia(request){
  const cache = await caches.open(MEDIA_CACHE)
  const cached = await cache.match(request)
  if (cached) {
    console.log('[SW] Video served from cache:', request.url)
    return cached
  }
  
  const response = await fetch(request)
  if (response?.status === 200){
    // Clone before caching
    const responseToCache = response.clone()
    
    // Limit cache size - remove oldest entries if needed
    cache.keys().then(async (keys) => {
      if (keys.length >= MAX_MEDIA_CACHE_SIZE) {
        // Delete oldest 10 entries
        const toDelete = keys.slice(0, 10)
        for (const key of toDelete) {
          await cache.delete(key)
        }
      }
    })
    
    cache.put(request, responseToCache)
    console.log('[SW] Video cached:', request.url)
  }
  return response
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
    // Use network-first for JS files to ensure latest code, stale-while-revalidate for CSS
    if (url.pathname.endsWith('.js')) {
      event.respondWith(networkFirst(request, RUNTIME_CACHE))
    } else {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
    }
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

  // Cache videos from /uploads/ - cache-first since videos don't change
  if (url.origin === self.location.origin && url.pathname.startsWith('/uploads/') && request.destination === 'video'){
    event.respondWith(cacheFirstMedia(request))
    return
  }

  // Also catch video files by extension (fallback)
  if (url.origin === self.location.origin && /\.(mp4|webm|mov|m4v)$/i.test(url.pathname)){
    event.respondWith(cacheFirstMedia(request))
    return
  }

  if (STALE_API_ENDPOINTS.has(url.pathname) && request.headers.get('accept')?.includes('application/json')){
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
