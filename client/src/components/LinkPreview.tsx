import { useState, useEffect, memo } from 'react'
import { Capacitor } from '@capacitor/core'
import type { VideoEmbed } from '../utils/videoEmbed'
import { extractVideoEmbed } from '../utils/videoEmbed'
import { openExternalNativeLink } from '../utils/openExternalInApp'

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

/**
 * Preview cache. Successful results are cached for the lifetime of the page.
 * Negative results (server error / no preview / timeout) are cached only briefly
 * so a transient failure doesn't permanently hide the card for the session.
 */
const _cache = new Map<string, LinkPreviewData>()
const _negativeCache = new Map<string, number>()
const _pending = new Map<string, Promise<LinkPreviewData | null>>()
const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000
const PREVIEW_FETCH_TIMEOUT_MS = 8000

async function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  const key = url.replace(/\/+$/, '')

  const hit = _cache.get(key)
  if (hit) return hit

  const negTs = _negativeCache.get(key)
  if (negTs && Date.now() - negTs < NEGATIVE_CACHE_TTL_MS) return null
  if (negTs) _negativeCache.delete(key)

  const inflight = _pending.get(key)
  if (inflight) return inflight

  const p = (async () => {
    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), PREVIEW_FETCH_TIMEOUT_MS)
    try {
      const resp = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
        credentials: 'include',
        signal: ctrl.signal,
      })
      if (!resp.ok) { _negativeCache.set(key, Date.now()); return null }
      const data = await resp.json()
      if (!data.success || !data.preview) { _negativeCache.set(key, Date.now()); return null }
      _cache.set(key, data.preview)
      return data.preview as LinkPreviewData
    } catch {
      _negativeCache.set(key, Date.now())
      return null
    } finally {
      clearTimeout(timeoutId)
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

/**
 * Remove URL strings from message/post text when those URLs are shown as link preview cards.
 * Pass the same URL list returned by `extractUrls` (or a superset you render as cards).
 */
export function stripExtractedUrlsFromText(text: string, urls: string[]): string {
  if (!text || !urls.length) return text
  let t = text
  for (const u of urls) {
    if (!u.trim()) continue
    const escaped = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(escaped, 'gi'), '')
  }
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/** Rich link cards for feed/detail — omits hosts already shown via VideoEmbed. */
export function feedLinkPreviewUrls(text: string, videoEmbedUrl?: string | null): string[] {
  const urls = extractUrls(text)
  const ve = (videoEmbedUrl || '').toLowerCase()
  return urls.filter(u => {
    const lu = u.toLowerCase()
    if (ve && (lu.includes(ve.slice(0, 48)) || ve.includes(lu.slice(0, 48)))) return false
    // Only hide video-platform URLs from cards when an inline embed is already rendered.
    if (ve) {
      if (
        lu.includes('youtube.com') ||
        lu.includes('youtu.be') ||
        lu.includes('music.youtube') ||
        lu.includes('vimeo.com') ||
        lu.includes('tiktok.com')
      ) {
        return false
      }
    }
    return true
  })
}

/** Parse `link_urls` from API (JSON string, array, or null). */
export function parseLinkUrlsField(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.filter((u): u is string => typeof u === 'string').map(s => s.trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return []
    try {
      const parsed = JSON.parse(t)
      if (Array.isArray(parsed)) {
        return parsed.filter((u): u is string => typeof u === 'string').map(s => s.trim()).filter(Boolean)
      }
    } catch {
      if (t.startsWith('http')) return [t]
    }
  }
  return []
}

function storedUrlCoveredByVideoEmbed(u: string, ve: VideoEmbed): boolean {
  const hit = extractVideoEmbed(u)
  return hit !== null && hit.type === ve.type && hit.videoId === ve.videoId
}

/**
 * Link preview cards: stored `link_urls` (caption posts) plus legacy URLs embedded in `content`.
 * When `videoEmbed` is set, matching URLs are omitted (inline player handles them).
 */
export function feedPostLinkPreviewUrls(
  content: string,
  linkUrls: unknown,
  videoEmbed?: VideoEmbed | null
): string[] {
  const embedUrl = videoEmbed?.embedUrl ?? null
  const fromStored = parseLinkUrlsField(linkUrls).filter(
    u => !videoEmbed || !storedUrlCoveredByVideoEmbed(u, videoEmbed),
  )
  const fromBody = feedLinkPreviewUrls(content, embedUrl)
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of [...fromStored, ...fromBody]) {
    const k = u.replace(/\/+$/, '')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(u)
  }
  return out.slice(0, 5)
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

  // Prefer the canonical URL returned by the backend (og:url or post-redirect)
  // over the raw URL the user shared. This matters for Instagram: shares often
  // come as /share/p/<opaque-id>/, which the Instagram app can't resolve and
  // falls back to the home feed. og:url gives us /p/<shortcode>/ which routes
  // correctly via Universal Links.
  const openUrl = (data && data.url) || url

  // Failure fallback: the backend couldn't produce a preview (X shell, login
  // wall, rate limit, etc.). Render a minimal host+URL card so the bubble is
  // never empty — the message's URL has already been stripped from the text
  // in MessageBubble assuming a card would render.
  if (error || !data) {
    let fallbackDomain = ''
    try { fallbackDomain = new URL(url).hostname.replace(/^www\./, '') }
    catch { fallbackDomain = url }
    const fIcon = getDomainIcon(fallbackDomain)
    const fColor = getDomainColor(fallbackDomain)
    return (
      <a
        href={openUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block mt-1.5 rounded-xl overflow-hidden border border-white/10 hover:border-white/20 transition-colors no-underline"
        style={{ background: 'rgba(255,255,255,0.04)' }}
        onClick={(e) => {
          e.stopPropagation()
          if (Capacitor.isNativePlatform()) {
            e.preventDefault()
            void openExternalNativeLink(openUrl)
          }
        }}
      >
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <i className={`${fIcon} text-[11px]`} style={{ color: fColor }} />
            <span className="text-[11px] text-white/50 truncate">{fallbackDomain || 'Link'}</span>
          </div>
          <div className={`text-[12px] ${sent ? 'text-white/80' : 'text-white/70'} break-all line-clamp-2`}>
            {url}
          </div>
        </div>
      </a>
    )
  }

  const domain = data.domain || ''
  const icon = getDomainIcon(domain)
  const color = getDomainColor(domain)
  const displayDomain = data.site_name || domain.replace(/^www\./, '')
  const hasImage = data.image && !imgError
  const isYouTube = domain.includes('youtube') || domain.includes('youtu.be')

  return (
    <a
      href={openUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-1.5 rounded-xl overflow-hidden border border-white/10 hover:border-white/20 transition-colors no-underline"
      style={{ background: 'rgba(255,255,255,0.04)' }}
      onClick={(e) => {
        e.stopPropagation()
        if (Capacitor.isNativePlatform()) {
          e.preventDefault()
          void openExternalNativeLink(openUrl)
        }
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
