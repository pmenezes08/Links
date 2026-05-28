import { useEffect } from 'react'

const DEFAULT_MANIFEST = {
  name: 'C-Point',
  short_name: 'C-Point',
  start_url: '/premium_dashboard',
  scope: '/',
  display: 'standalone',
  background_color: '#000000',
  theme_color: '#000000',
  description: 'Community, chat, workouts, and events',
}

const ICON_192_PATH = '/static/icons/icon-192.png'
const ICON_512_PATH = '/static/icons/icon-512.png'
const LOGO_PATH = '/static/cpoint-logo.png'
const APPLE_TOUCH_ICON_PATH = '/static/apple-touch-icon.png'

function updateLink(rel: string, href: string, extra?: Record<string, string>){
  if (typeof document === 'undefined') return
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!link){
    link = document.createElement('link')
    link.rel = rel
    document.head.appendChild(link)
  }
  link.href = href
  if (extra){
    for (const [key, value] of Object.entries(extra)){
      if (value != null) link.setAttribute(key, value)
    }
  }
}

export default function BrandAssetsInit(){
  useEffect(() => {
    let manifestObjectUrl: string | null = null

    const syncBranding = () => {
      // Single bundled logo — no network fetch, so it can never fall back to a
      // broken-image glyph after caches/SW are wiped.
      updateLink('icon', LOGO_PATH, { type: 'image/png' })
      updateLink('shortcut icon', LOGO_PATH, { type: 'image/png' })
      updateLink('apple-touch-icon', APPLE_TOUCH_ICON_PATH)

      const icon192 = ICON_192_PATH
      const icon512 = ICON_512_PATH

      const manifestPayload = {
        ...DEFAULT_MANIFEST,
        icons: [
          { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      }

      const blob = new Blob([JSON.stringify(manifestPayload)], { type: 'application/manifest+json' })
      manifestObjectUrl = URL.createObjectURL(blob)
      updateLink('manifest', manifestObjectUrl)
    }

    syncBranding()

    return () => {
      if (manifestObjectUrl){
        URL.revokeObjectURL(manifestObjectUrl)
      }
    }
  }, [])

  return null
}
