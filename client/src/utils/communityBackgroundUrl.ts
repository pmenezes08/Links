/** Resolve community background_path from API to a browser-loadable URL. */
export function resolveCommunityBackgroundUrl(path: string | null | undefined): string {
  const p = String(path || '').trim()
  if (!p) return ''
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  if (p.startsWith('/uploads') || p.startsWith('uploads/')) return p.startsWith('/') ? p : `/${p}`
  if (p.startsWith('/static')) return p
  if (p.startsWith('static/')) return `/${p}`
  const fname = p.split('/').slice(-1)[0]
  return `/static/community_backgrounds/${fname}`
}
