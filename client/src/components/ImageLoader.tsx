import { useState, useEffect } from 'react'

interface ImageLoaderProps {
  src: string
  alt: string
  className?: string
  onClick?: () => void
  style?: React.CSSProperties
}

export default function ImageLoader({ src, alt, className = '', onClick, style }: ImageLoaderProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    const t = setTimeout(() => {
      if (loading) { setLoading(false); setError(true) }
    }, 6000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
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

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 bg-white/5 rounded-md flex items-center justify-center border border-white/10">
          <div className="flex flex-col items-center gap-2">
            <i className="fa-solid fa-image text-white/30 text-2xl"></i>
            <div className="text-xs text-white/40">Failed to load</div>
          </div>
        </div>
      )}

      {/* Actual image */}
      <img
        src={src}
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