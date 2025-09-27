import { useState } from 'react'

interface ImageLoaderProps {
  src: string
  alt: string
  className?: string
  onClick?: () => void
  style?: React.CSSProperties
}

export default function ImageLoader({ src, alt, className = '', onClick, style }: ImageLoaderProps) {
  const [loading, setLoading] = useState(true)
  const resolved = (() => {
    const p = (src || '').trim()
    if (!p) return p
    if (p.startsWith('http')) return p
    if (p.startsWith('/uploads') || p.startsWith('uploads/')) return p.startsWith('/') ? p : `/${p}`
    if (p.startsWith('/static') || p.startsWith('static/')) return p.startsWith('/') ? p : `/${p}`
    // Fallback: assume uploads for legacy
    return `/uploads/${p}`
  })()

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
  }

  return (
    <div className={`relative ${className}`} style={style} onClick={onClick}>
      {/* Loading skeleton */}
      {loading && (
        <div className="absolute inset-0 bg-white/10 rounded-md flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
            <div className="text-xs text-white/50">Loading...</div>
          </div>
        </div>
      )}

      {/* Error state removed per request */}

      {/* Actual image */}
      <img
        src={resolved}
        alt={alt}
        className={`transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'} ${className}`}
        style={style}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
      />
    </div>
  )
}