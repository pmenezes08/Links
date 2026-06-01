export type DeletedMediaItem = {
  message_id: number
  media_url: string
}

const STORE_KEY = 'cpoint.chat.deletedMediaEvents'

function safeScope(scope: string): string {
  return scope.trim().toLowerCase()
}

function readStore(): Record<string, DeletedMediaItem[]> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, DeletedMediaItem[]>): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // ignore storage failures; live event still helps mounted threads
  }
}

export function recordDeletedMedia(scope: string, items: DeletedMediaItem[]): void {
  const key = safeScope(scope)
  if (!key || !items.length) return
  const store = readStore()
  store[key] = [...(store[key] || []), ...items]
  writeStore(store)
  window.dispatchEvent(new CustomEvent('chat-media-deleted', { detail: { scope: key, items } }))
}

export function consumeDeletedMedia(scope: string): DeletedMediaItem[] {
  const key = safeScope(scope)
  const store = readStore()
  const items = store[key] || []
  if (items.length) {
    delete store[key]
    writeStore(store)
  }
  return items
}

export function mediaDeleteScopeForDm(peer: string): string {
  return `dm:${peer.trim().toLowerCase()}`
}

export function mediaDeleteScopeForGroup(groupId: string | number): string {
  return `group:${String(groupId).trim()}`
}

export function comparableMediaUrl(url: string): string {
  const raw = (url || '').split('#', 1)[0].split('?', 1)[0].trim()
  try {
    const parsed = new URL(raw, window.location.origin)
    return parsed.pathname.replace(/^\/uploads\//, '').replace(/^\//, '').toLowerCase()
  } catch {
    return raw.replace(/^\/?uploads\//, '').replace(/^\//, '').toLowerCase()
  }
}
