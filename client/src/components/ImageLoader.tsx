import { useState } from 'react'
import { optimizeImage } from '../utils/imageOptimizer'

interface ImageLoaderProps {
  src: string
  alt: string
  className?: string
  onClick?: () => void
  style?: React.CSSProperties
  /** Reserve space while loading to prevent CLS. Defaults to 4/3 if not provided. */
  aspectRatio?: string
  /**
   * Width (CSS px) to request from the Cloudflare image resizer. Feed tiles render
   * at ~full content width, so 800 (resizer serves 2x via format=auto/DPR) is a sane
   * default that cuts bytes vs. the raw ~1920px original. No-op off the c-point.co zone.
   */
  targetWidth?: number
}

export default function ImageLoader({ src, alt, className = '', onClick, style, aspectRatio, targetWidth = 800 }: ImageLoaderProps) {
  const [loading, setLoading] = useState(true)
  const candidates: string[] = (() => {
    const p = (src || '').trim()
    const out: string[] = []
    if (!p) return out
    if (p.startsWith('http')) return [p]
    if (p.startsWith('/uploads')) out.push(p)
    if (p.startsWith('uploads/')) out.push('/' + p)
    if (p.startsWith('/static')) out.push(p)
    if (p.startsWith('static/')) out.push('/' + p)
    if (!p.startsWith('/uploads') && !p.startsWith('uploads/') && !p.startsWith('/static') && !p.startsWith('static/')){
      const nameOnly = p
      out.push(`/uploads/${nameOnly}`)
      out.push(`/static/${nameOnly}`)
      out.push(`/static/uploads/${nameOnly}`)
    }
    return Array.from(new Set(out))
  })()
  const [index, setIndex] = useState(0)
  const currentSrc = candidates[index] || ''
  // Route the resolved candidate through the Cloudflare resizer so weak-network
  // clients don't download the full ~1920px original for a small tile. Pass-through
  // for blob/data/gif/svg/off-zone URLs (see optimizeImage). On error we advance the
  // candidate index, which re-derives and re-wraps the next one.
  const displaySrc = optimizeImage(currentSrc, { width: targetWidth, quality: 85 })

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
  }

  const containerStyle: React.CSSProperties = {
    ...style,
    aspectRatio: aspectRatio ?? '4 / 3',
  }

  return (
    <div className={`relative overflow-hidden ${className}`} style={containerStyle} onClick={onClick}>
      {loading && (
        <div className="absolute inset-0 bg-c-hover-bg rounded-md animate-pulse" />
      )}

      <img
        src={displaySrc}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={handleLoad}
        onError={() => {
          if (index < candidates.length - 1){
            setIndex(index + 1)
            setLoading(true)
          } else {
            handleError()
          }
        }}
        loading="lazy"
      />
    </div>
  )
}
