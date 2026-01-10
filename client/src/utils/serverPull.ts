const DASHBOARD_PULL_ENDPOINTS = [
  '/api/profile_me',
  '/api/user_parent_community',
  '/api/user_communities_hierarchical',
  '/get_user_communities_with_members',
  '/api/premium_dashboard_summary',
]

type Resolver = {
  resolve: (value: boolean) => void
  timer: number
}

const pendingResolvers = new Map<string, Resolver>()
let listenerInitialized = false

function ensureServiceWorkerListener() {
  if (listenerInitialized) return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'SERVER_PULL_COMPLETE' || !data.requestId) return
      const entry = pendingResolvers.get(data.requestId)
      if (!entry) return
      pendingResolvers.delete(data.requestId)
      window.clearTimeout(entry.timer)
      try {
        entry.resolve(Boolean(data.success !== false))
      } catch {
        entry.resolve(false)
      }
    })
    listenerInitialized = true
  } catch {
    listenerInitialized = true
  }
}

function createRequestId() {
  return `pull-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function fallbackNetworkFetch(urls: string[]) {
  const timestamp = Date.now()
  await Promise.all(
    urls.map(async (url) => {
      try {
        // Add cache-busting query parameter
        const bustUrl = `${url}${url.includes('?') ? '&' : '?'}_nocache=${timestamp}`
        await fetch(bustUrl, { credentials: 'include', cache: 'no-store' })
      } catch {
        // ignore
      }
    })
  )
  return true
}

export async function triggerDashboardServerPull(extraUrls: string[] = []): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const urls = Array.from(new Set([...DASHBOARD_PULL_ENDPOINTS, ...extraUrls]))
  if (!urls.length) return true

  ensureServiceWorkerListener()

  try {
    const controller = navigator.serviceWorker?.controller
    if (controller) {
      const requestId = createRequestId()
      const promise = new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => {
          pendingResolvers.delete(requestId)
          resolve(false)
        }, 5000)
        pendingResolvers.set(requestId, { resolve, timer })
      })
      controller.postMessage({ type: 'SERVER_PULL', urls, requestId })
      return await promise
    }
  } catch {
    // fall through to direct fetch
  }

  return fallbackNetworkFetch(urls)
}
