import { useEffect } from 'react'

type GetLogoResponse = {
  success?: boolean
  logo_path?: string | null
  updated_at?: string | number | null
}

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
const LOGO_FALLBACK = '/static/logo.png'
const APPLE_TOUCH_ICON_PATH = '/apple-touch-icon.png'

function resolveStaticPath(path: string | null | undefined){
  if (!path) return LOGO_FALLBACK
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/')) return path
  return `/static/${path.replace(/^static\//, '')}`
}

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

    const syncBranding = async () => {
      const cacheBust = Date.now().toString()
      let logoUrl = `${LOGO_FALLBACK}?v=${cacheBust}`

      try{
        const response = await fetch('/get_logo', { credentials: 'include' })
        if (response.ok){
          const data = await response.json().catch(() => null) as GetLogoResponse | null
          if (data?.success && data.logo_path){
            const resolved = resolveStaticPath(data.logo_path)
            const versionHint = data.updated_at ? String(data.updated_at) : cacheBust
            logoUrl = `${resolved}?v=${versionHint}`
          }
        }
      }catch{
        // ignore network/logo fetch errors
      }

      // Update favicon variants
      updateLink('icon', logoUrl, { type: 'image/png' })
      updateLink('shortcut icon', logoUrl, { type: 'image/png' })
      updateLink('apple-touch-icon', `${APPLE_TOUCH_ICON_PATH}?v=${cacheBust}`)

      const icon192 = `${ICON_192_PATH}?v=${cacheBust}`
      const icon512 = `${ICON_512_PATH}?v=${cacheBust}`

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
