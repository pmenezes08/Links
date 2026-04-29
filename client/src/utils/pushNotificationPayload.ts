import type { NavigateFunction } from 'react-router-dom'

/** Extract push URL using the same fallbacks as PushInit tap handling. */
function extractPushUrl(payload: Record<string, unknown>): string | undefined {
  const data = payload.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {}

  const fromData =
    typeof data.url === 'string'
      ? data.url
      : typeof data.link === 'string'
        ? data.link
        : typeof (data as { deepLink?: string }).deepLink === 'string'
          ? (data as { deepLink: string }).deepLink
          : undefined

  const custom =
    payload.custom &&
    typeof payload.custom === 'object' &&
    typeof (payload.custom as { url?: string }).url === 'string'
      ? (payload.custom as { url: string }).url
      : undefined

  const userInfo =
    payload.userInfo &&
    typeof payload.userInfo === 'object' &&
    typeof (payload.userInfo as { url?: string }).url === 'string'
      ? (payload.userInfo as { url: string }).url
      : undefined

  return (
    fromData ||
    (typeof payload.url === 'string' ? payload.url : undefined) ||
    (typeof payload.link === 'string' ? payload.link : undefined) ||
    custom ||
    userInfo ||
    undefined
  )
}

function collectDataStrings(payload: Record<string, unknown>): Record<string, string> {
  const dataStrings: Record<string, string> = {}
  if (payload.data && typeof payload.data === 'object') {
    for (const [k, v] of Object.entries(payload.data as Record<string, unknown>)) {
      if (v != null) dataStrings[k] = String(v)
    }
  }
  return dataStrings
}

function payloadRootFromDetail(detail: unknown): Record<string, unknown> {
  const root =
    detail && typeof detail === 'object' && 'notification' in (detail as object)
      ? (detail as { notification?: unknown }).notification
      : detail
  return root && typeof root === 'object' ? (root as Record<string, unknown>) : {}
}

/**
 * Normalize Capacitor / FCM foreground push payloads into title, body, and optional deep-link URL.
 */
export function extractForegroundPushContent(detail: unknown): { title: string; body: string; url?: string } {
  const payload = payloadRootFromDetail(detail)
  let title = 'Notification'
  let body = ''

  if (typeof payload.title === 'string') title = payload.title
  if (typeof payload.body === 'string') body = payload.body
  if (typeof (payload as { subtitle?: string }).subtitle === 'string' && !body) {
    body = (payload as { subtitle: string }).subtitle
  }

  const dataStrings = collectDataStrings(payload)
  let url = extractPushUrl(payload)
  if (!url && dataStrings.url) url = dataStrings.url

  const dataTitle =
    dataStrings.title ||
    dataStrings.gcm_notification_title ||
    dataStrings['gcm.notification.title'] ||
    ''
  const dataBody =
    dataStrings.body ||
    dataStrings.gcm_notification_body ||
    dataStrings['gcm.notification.body'] ||
    ''

  if (!title || title.trim() === '') title = dataTitle || 'Notification'
  if (!body || body.trim() === '') body = dataBody || ''

  if (dataStrings.aps_alert && typeof dataStrings.aps_alert === 'string') {
    try {
      const aps = JSON.parse(dataStrings.aps_alert) as { title?: string; body?: string }
      if (typeof aps.title === 'string' && aps.title.trim() && title === 'Notification') title = aps.title
      if (typeof aps.body === 'string' && aps.body.trim() && !body) body = aps.body
    } catch {
      /* ignore */
    }
  }

  url = extractPushUrl({ ...payload, data: payload.data || dataStrings })

  return { title: title.trim(), body: body.trim(), url }
}

const GENERIC_TITLES = new Set(['notification', 'c.point notification', 'c-point notification', ''])

function isGenericTitle(t: string): boolean {
  return GENERIC_TITLES.has(t.trim().toLowerCase())
}

/** Canonical path for comparing SPA route vs push deep link (community feed variants). */
export function normalizePathForForegroundCompare(path: string): string {
  let p = path.split('?')[0].replace(/\/+$/, '') || '/'
  const reactFeed = /^\/community_feed_react\/(\d+)$/.exec(p)
  if (reactFeed) return `/community_feed/${reactFeed[1]}`
  const plainFeed = /^\/community_feed\/(\d+)$/.exec(p)
  if (plainFeed) return `/community_feed/${plainFeed[1]}`
  return p
}

function inferHeadlineSublineFromUrl(url: string): { headline: string; subline?: string } {
  const u = url.split('?')[0]
  const chat = /^\/user_chat\/chat\/([^/]+)/.exec(u)
  if (chat) {
    const who = decodeURIComponent(chat[1])
    return { headline: 'New message', subline: `From ${who}` }
  }
  const group = /^\/group_chat\/(\d+)/.exec(u)
  if (group) {
    return { headline: 'Group chat', subline: 'Open conversation' }
  }
  if (u.startsWith('/post/')) {
    return { headline: 'New activity', subline: 'Open post' }
  }
  if (/\/event\//.test(u) || u.includes('/calendar')) {
    return { headline: 'Event', subline: 'View in app' }
  }
  if (u.includes('/polls')) {
    return { headline: 'Poll', subline: 'Tap to vote or view' }
  }
  if (/community_feed/.test(u) || /community_feed_react/.test(u)) {
    return { headline: 'Community', subline: 'New activity in a community' }
  }
  if (u.startsWith('/profile/')) {
    const who = u.slice('/profile/'.length).replace(/\/$/, '')
    return { headline: 'Profile', subline: who ? `@${who}` : undefined }
  }
  if (u.startsWith('/followers')) {
    return { headline: 'Followers', subline: 'Tap to open follows' }
  }
  return { headline: 'C-Point', subline: 'Tap to open' }
}

/**
 * Copy + routing for the in-app foreground toast. Returns null when there is nothing useful to show.
 */
export function foregroundBannerFromPushDetail(detail: unknown): {
  headline: string
  subline?: string
  url?: string
} | null {
  const { title, body, url } = extractForegroundPushContent(detail)

  let headline = !isGenericTitle(title) ? title : ''
  let subline = body.trim() || undefined

  if (!headline && subline) {
    headline = subline
    subline = undefined
  }

  if (!headline && url) {
    const inferred = inferHeadlineSublineFromUrl(url)
    headline = inferred.headline
    subline = inferred.subline
  }

  if (isGenericTitle(headline) && subline) {
    headline = subline
    subline = undefined
  }

  if ((!headline || isGenericTitle(headline)) && !subline?.trim() && !url) {
    return null
  }

  if (isGenericTitle(headline) && !subline && url) {
    const inferred = inferHeadlineSublineFromUrl(url)
    headline = inferred.headline
    subline = inferred.subline
  }

  if (isGenericTitle(headline) && !subline && !url) {
    return null
  }

  return { headline: headline.trim() || 'C-Point', subline: subline?.trim() || undefined, url }
}

/** Same routing rules as PushInit.handleNotificationNavigation (keep in sync manually). */
export function navigateToPushUrl(navigate: NavigateFunction, url: string | undefined): void {
  if (!url) {
    navigate('/notifications')
    return
  }

  if (url.startsWith('/user_chat/chat/')) {
    navigate(url)
    return
  }

  if (url.startsWith('/profile/')) {
    navigate(url)
    return
  }

  if (url.startsWith('/event/') || url.includes('/calendar')) {
    navigate(url.replace('/calendar', '/calendar_react'))
    return
  }

  if (url.includes('/polls')) {
    navigate(url.includes('_react') ? url : url.replace('/polls', '/polls_react'))
    return
  }

  if (url.startsWith('/community_feed/')) {
    const id = url.replace('/community_feed/', '').replace(/\/$/, '')
    navigate(`/community_feed_react/${id}`)
    return
  }

  if (url.startsWith('/post/')) {
    navigate(url)
    return
  }

  if (url.startsWith('/followers')) {
    navigate(url)
    return
  }

  navigate(url)
}

/** Hide banner noise when we're already viewing the pushed screen (same pathname after normalizing). */
export function shouldSkipForegroundBannerDueToSameRoute(pathname: string, pushUrl?: string): boolean {
  if (!pushUrl || !pathname) return false
  const p = normalizePathForForegroundCompare(pathname)
  const u = normalizePathForForegroundCompare(pushUrl.trim())
  if (!u || u === '/') return false
  return p === u
}
