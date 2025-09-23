self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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

