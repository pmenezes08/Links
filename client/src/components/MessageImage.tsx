import { useMemo, useState } from 'react'
import { optimizeMessagePhoto } from '../utils/imageOptimizer'

interface MessageImageProps {
  src: string
  alt: string
  onClick?: () => void
  className?: string
}

export default function MessageImage({ src, alt, onClick, className = '' }: MessageImageProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const normalizedSrc = useMemo(() => src?.split('?')[0]?.toLowerCase() || '', [src])
  const isGif = normalizedSrc.endsWith('.gif')
  
  // Apply Cloudflare optimization (skip for GIFs to preserve animation)
  const displaySrc = useMemo(() => {
    if (isGif) return src
    return optimizeMessagePhoto(src)
  }, [src, isGif])

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
  }

  return (
    <div 
      className={`relative rounded overflow-hidden inline-block ${className}`}
      onClick={onClick}
    >
      {/* Loading skeleton - minimal */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5 min-h-[100px] min-w-[100px]">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-center bg-white/5 min-h-[100px] min-w-[100px] p-4">
          <div className="flex flex-col items-center gap-1 text-white/40">
            <i className="fa-solid fa-image text-lg"></i>
            <div className="text-[10px]">Unavailable</div>
          </div>
        </div>
      )}

      {/* Actual image */}
      <img
        src={displaySrc}
        alt={alt}
        className={`max-w-full transition-opacity duration-300 ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        loading="eager"
        decoding="async"
        style={{ 
          display: error ? 'none' : 'block',
          maxHeight: '320px',
          imageOrientation: 'from-image',
        }}
      />

    </div>
  )
}