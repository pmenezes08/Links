// Version tracking for updates
const SW_VERSION = '1.0.0'

self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${SW_VERSION}`)
  self.skipWaiting() // Force immediate activation
})

self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${SW_VERSION}`)
  event.waitUntil(
    // Clear all caches to ensure fresh content
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log(`[SW] Clearing cache: ${cacheName}`)
          return caches.delete(cacheName)
        })
      )
    }).then(async () => {
      console.log('[SW] All caches cleared')
      await self.clients.claim()
      // Inform open clients to refresh once (lightweight)
      try{
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of clientsList){
          try{ client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION }) }catch{}
        }
      }catch{}
    })
  )
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}
  // Suppress notification if a focused client is already on the same URL (e.g., active chat thread)
  const targetUrl = data.url || '/'
  const tag = data.tag || undefined
  const maybeNotify = async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList){
      try{
        const href = client.url || ''
        const focused = client.focused || false
        // Suppress if focused and same section (exact chat, or messages landing)
        if (focused && (href.includes(targetUrl) || (tag && tag.startsWith('message-') && href.includes('/user_chat')))){
          // Already viewing the target; skip OS notification
          return
        }
      }catch{}
    }
    const title = data.title || 'Notification'
    const options = {
      body: data.body || '',
      icon: data.icon || '/vite.svg',
      badge: data.badge || '/vite.svg',
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

