const SW_VERSION = '2.70.1'
const APP_SHELL_CACHE = `cp-shell-${SW_VERSION}`
const RUNTIME_CACHE = `cp-runtime-${SW_VERSION}`
const MEDIA_CACHE = `cp-media-${SW_VERSION}`
const MAX_MEDIA_CACHE_SIZE = 50 // Max number of videos/large media to cache
const FORCE_UPDATE_TIMESTAMP = 1778716800000 // May 2 2026 — account-isolation hardening

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

// Default-deny posture for authenticated/dynamic routes:
// any request whose pathname starts with one of these prefixes is passed
// straight through to the network with NO service-worker cache lookup or
// cache write, so a previous user's response can never be replayed under
// another session.
// Keep in sync with `client/src/utils/swCachePolicy.ts` and
// `backend/services/http_headers.py::_AUTHENTICATED_PREFIXES`.
const NEVER_CACHE_PREFIXES = [
  '/api/',
  '/get_',
  '/check_',
  '/update_',
  '/delete_',
  '/add_',
  '/upload_',
  '/admin',
  '/profile/',
  '/notifications',
  '/event/',
  '/account_',
  '/edit_',
  '/business_',
  '/remove_',
  '/resend_',
  '/clear_',
  '/verify_',
  '/logout',
  '/login',
  '/signup',
]

// Pure helper exported on `self` for vitest. Returns true when the SW must
// stay out of the request entirely (no cache read, no cache write).
function shouldBypassCache(pathname) {
  for (let i = 0; i < NEVER_CACHE_PREFIXES.length; i++) {
    if (pathname.startsWith(NEVER_CACHE_PREFIXES[i])) return true
  }
  return false
}
self.shouldBypassCache = shouldBypassCache

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
      // Delete every old SW cache from previous versions. Critical for
      // account isolation: pre-2.70.0 caches stored authenticated /api/*
      // responses (chat threads, /api/me/*, admin endpoints) keyed by URL
      // alone, so they would replay the previous user's data on the next
      // session. Force-purge them all.
      await Promise.all(
        cacheNames
          .filter((cacheName) =>
            cacheName !== APP_SHELL_CACHE &&
            cacheName !== RUNTIME_CACHE &&
            cacheName !== MEDIA_CACHE,
          )
          .map((cacheName) => caches.delete(cacheName))
      )

      // Also delete the current runtime cache to evict any partial state
      // accumulated by an in-flight migration.
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
    networkPromise?.catch(() => {})
    return cached
  }

  const networkResponse = await networkPromise
  if (networkResponse) return networkResponse
  throw new Error('Network unavailable and no cached response')
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
    const responseToCache = response.clone()

    cache.keys().then(async (keys) => {
      if (keys.length >= MAX_MEDIA_CACHE_SIZE) {
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

  // Same-origin gate: cross-origin GETs (e.g. analytics, third-party fonts)
  // pass through without SW interference.
  if (url.origin !== self.location.origin) return

  // SECURITY-CRITICAL: never let the SW touch authenticated/dynamic routes.
  // No cache read, no cache write, no offline fallback — the request goes
  // straight to the network so the server's session cookie scopes the
  // response to the correct user. See NEVER_CACHE_PREFIXES above for the
  // path list and backend/services/http_headers.py for the matching
  // server-side `Cache-Control: no-store` policy.
  if (shouldBypassCache(url.pathname)) return

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

  if (STATIC_ASSET_PATHS.has(url.pathname)){
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE))
    return
  }

  if (url.pathname.startsWith('/assets/')){
    // Network-first for JS so deploys take effect; SWR for CSS.
    if (url.pathname.endsWith('.js')) {
      event.respondWith((async () => {
        const cache = await caches.open(RUNTIME_CACHE)
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
      })())
    } else {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
    }
    return
  }

  if (url.pathname.startsWith('/static/icons/')){
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
    return
  }

  if (url.pathname.startsWith('/static/welcome/')){
    // Welcome card images may be updated by admins at any time.
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE)
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
    })())
    return
  }

  if (request.destination === 'image'){
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
    return
  }

  if (url.pathname.startsWith('/uploads/') && request.destination === 'video'){
    event.respondWith(cacheFirstMedia(request))
    return
  }

  if (/\.(mp4|webm|mov|m4v)$/i.test(url.pathname)){
    event.respondWith(cacheFirstMedia(request))
    return
  }

  // Fall through: anything not matched above (e.g. /uploads/<id>.bin) goes
  // to the network without SW caching.
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

async function clearAllRuntimeCaches(){
  try {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((name) =>
          name.startsWith('cp-runtime-') ||
          name.startsWith('runtime-') ||
          name.startsWith('cp-media-')
        )
        .map((name) => caches.delete(name))
    )
  } catch (error) {
    console.warn('[SW] clearAllRuntimeCaches failed', error)
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'SKIP_WAITING'){
    self.skipWaiting()
    return
  }

  if (data.type === 'CLEAR_USER_CACHES'){
    // Triggered by client during logout / account switch so any cached
    // bytes for the previous identity are gone before the next request.
    event.waitUntil((async () => {
      await clearAllRuntimeCaches()
      const requestId = data.requestId
      const targets = []
      if (event.source) targets.push(event.source)
      try {
        const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
        for (const client of clientsList){
          if (!targets.includes(client)) targets.push(client)
        }
      } catch {}
      for (const client of targets){
        try { client.postMessage({ type: 'CLEAR_USER_CACHES_COMPLETE', requestId }) } catch {}
      }
    })())
    return
  }

  if (data.type === 'SERVER_PULL'){
    const urls = Array.isArray(data.urls) ? data.urls : []
    const requestId = data.requestId
    if (!urls.length) return
    event.waitUntil((async () => {
      const results = []
      const cache = await caches.open(RUNTIME_CACHE)
      for (const rawUrl of urls){
        const absolute = rawUrl.startsWith('http') ? rawUrl : new URL(rawUrl, self.location.origin).href
        try{
          // SERVER_PULL is only used for explicit prefetch of static-ish data.
          // We still respect the bypass list so authenticated APIs are not
          // accidentally cached by a misuse of this channel.
          const targetPath = new URL(absolute).pathname
          if (shouldBypassCache(targetPath)){
            results.push({ url: rawUrl, success: false, error: 'bypass' })
            continue
          }
          const request = new Request(absolute, { credentials: 'include', cache: 'reload' })
          const response = await fetch(request)
          if (response && response.ok){
            await cache.put(request, response.clone())
            results.push({ url: rawUrl, success: true })
          } else {
            results.push({ url: rawUrl, success: false, status: response?.status || 0 })
          }
        }catch(error){
          results.push({ url: rawUrl, success: false, error: String(error) })
        }
      }
      const payload = {
        type: 'SERVER_PULL_COMPLETE',
        requestId,
        success: results.every((result) => result.success),
        results,
      }
      const targets = []
      if (event.source) targets.push(event.source)
      try{
        const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
        for (const client of clientsList){
          if (!targets.includes(client)) targets.push(client)
        }
      }catch{}
      for (const client of targets){
        try{
          client.postMessage(payload)
        }catch{}
      }
    })())
  }
})
