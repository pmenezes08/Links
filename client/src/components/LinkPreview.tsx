import { useState, useEffect, memo } from 'react'

export type LinkPreviewData = {
  title: string
  description: string
  image: string
  site_name: string
  domain: string
  type: string
  url: string
}

type Props = {
  url: string
  sent?: boolean
}

const _cache = new Map<string, LinkPreviewData | null>()
const _pending = new Map<string, Promise<LinkPreviewData | null>>()

async function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  const key = url.replace(/\/+$/, '')
  const cached = _cache.get(key)
  if (cached !== undefined) return cached

  const inflight = _pending.get(key)
  if (inflight) return inflight

  const p = (async () => {
    try {
      const resp = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
        credentials: 'include',
      })
      if (!resp.ok) { _cache.set(key, null); return null }
      const data = await resp.json()
      if (!data.success || !data.preview) { _cache.set(key, null); return null }
      _cache.set(key, data.preview)
      return data.preview as LinkPreviewData
    } catch {
      _cache.set(key, null)
      return null
    } finally {
      _pending.delete(key)
    }
  })()

  _pending.set(key, p)
  return p
}

const URL_REGEX = /https?:\/\/[^\s]+/gi

export function extractUrls(text: string): string[] {
  if (!text) return []
  const matches = text.match(URL_REGEX)
  if (!matches) return []
  const seen = new Set<string>()
  return matches.filter(u => {
    const k = u.replace(/\/+$/, '')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 3)
}

/** Rich link cards for feed/detail — omits hosts already shown via VideoEmbed. */
export function feedLinkPreviewUrls(text: string, videoEmbedUrl?: string | null): string[] {
  const urls = extractUrls(text)
  const ve = (videoEmbedUrl || '').toLowerCase()
  return urls.filter(u => {
    const lu = u.toLowerCase()
    if (ve && (lu.includes(ve.slice(0, 48)) || ve.includes(lu.slice(0, 48)))) return false
    if (
      lu.includes('youtube.com') ||
      lu.includes('youtu.be') ||
      lu.includes('vimeo.com') ||
      lu.includes('tiktok.com')
    ) {
      return false
    }
    return true
  })
}

function getDomainIcon(domain: string): string {
  if (domain.includes('youtube') || domain.includes('youtu.be')) return 'fa-brands fa-youtube'
  if (domain.includes('instagram')) return 'fa-brands fa-instagram'
  if (domain.includes('linkedin')) return 'fa-brands fa-linkedin'
  if (domain.includes('twitter') || domain.includes('x.com')) return 'fa-brands fa-x-twitter'
  if (domain.includes('tiktok')) return 'fa-brands fa-tiktok'
  if (domain.includes('facebook')) return 'fa-brands fa-facebook'
  if (domain.includes('github')) return 'fa-brands fa-github'
  if (domain.includes('reddit')) return 'fa-brands fa-reddit'
  if (domain.includes('spotify')) return 'fa-brands fa-spotify'
  if (domain.includes('medium')) return 'fa-brands fa-medium'
  return 'fa-solid fa-globe'
}

function getDomainColor(domain: string): string {
  if (domain.includes('youtube') || domain.includes('youtu.be')) return '#ff0000'
  if (domain.includes('instagram')) return '#e4405f'
  if (domain.includes('linkedin')) return '#0a66c2'
  if (domain.includes('twitter') || domain.includes('x.com')) return '#ffffff'
  if (domain.includes('tiktok')) return '#00f2ea'
  if (domain.includes('facebook')) return '#1877f2'
  if (domain.includes('github')) return '#ffffff'
  if (domain.includes('spotify')) return '#1db954'
  return '#4db6ac'
}

function LinkPreviewCard({ url, sent }: Props) {
  const [data, setData] = useState<LinkPreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setImgError(false)

    fetchPreview(url).then(result => {
      if (cancelled) return
      if (result) {
        setData(result)
      } else {
        setError(true)
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [url])

  if (error || (!loading && !data)) return null

  if (loading) {
    return (
      <div className="mt-1.5 rounded-xl overflow-hidden border border-white/10 bg-white/[0.04] animate-pulse">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="w-4 h-4 rounded bg-white/10" />
          <div className="flex-1 h-3 rounded bg-white/10" />
        </div>
      </div>
    )
  }

  if (!data) return null

  const domain = data.domain || ''
  const icon = getDomainIcon(domain)
  const color = getDomainColor(domain)
  const displayDomain = data.site_name || domain.replace(/^www\./, '')
  const hasImage = data.image && !imgError
  const isYouTube = domain.includes('youtube') || domain.includes('youtu.be')

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-1.5 rounded-xl overflow-hidden border border-white/10 hover:border-white/20 transition-colors no-underline"
      style={{ background: 'rgba(255,255,255,0.04)' }}
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      {hasImage && (
        <div className={`relative w-full ${isYouTube ? '' : 'max-h-40'} overflow-hidden bg-black/20`}>
          <img
            src={data.image}
            alt=""
            className={`w-full object-cover ${isYouTube ? 'aspect-video' : 'max-h-40'}`}
            loading="lazy"
            onError={() => setImgError(true)}
          />
          {isYouTube && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-14 h-10 rounded-xl bg-red-600/90 flex items-center justify-center shadow-lg">
                <i className="fa-solid fa-play text-white text-sm ml-0.5" />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <i className={`${icon} text-[11px]`} style={{ color }} />
          <span className="text-[11px] text-white/50 truncate">{displayDomain}</span>
        </div>
        {data.title && (
          <div className={`text-[13px] font-medium leading-snug line-clamp-2 ${sent ? 'text-white/90' : 'text-white/85'}`}>
            {data.title}
          </div>
        )}
        {data.description && (
          <div className="text-[12px] text-white/50 leading-snug mt-0.5 line-clamp-2">
            {data.description}
          </div>
        )}
      </div>
    </a>
  )
}

const LinkPreview = memo(LinkPreviewCard)
export default LinkPreview
