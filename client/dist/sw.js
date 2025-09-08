self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}
  const title = data.title || 'Notification'
  const options = {
    body: data.body || '',
    icon: data.icon || '/vite.svg',
    badge: data.badge || '/vite.svg',
    data: { url: data.url || '/' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
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

