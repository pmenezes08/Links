import { useMemo, useState } from 'react'
import { useGifPlayback } from '../hooks/useGifPlayback'

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
  const { isFrozen, stillSrc, replay, canReplay } = useGifPlayback(isGif ? src : null)
  const displaySrc = isGif && isFrozen && stillSrc ? stillSrc : src

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
  }

  return (
    <div 
      className={`relative rounded-3xl overflow-hidden bg-black/25 shadow-[0_15px_45px_rgba(0,0,0,0.55)] ${className}`}
      style={{ minHeight: '120px' }}
      onClick={onClick}
    >
      {/* Loading skeleton */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            {/* Animated loading bars */}
            <div className="flex gap-1">
              <div className="w-1 h-8 bg-white/20 rounded animate-pulse" style={{ animationDelay: '0ms' }}></div>
              <div className="w-1 h-6 bg-white/20 rounded animate-pulse" style={{ animationDelay: '150ms' }}></div>
              <div className="w-1 h-10 bg-white/20 rounded animate-pulse" style={{ animationDelay: '300ms' }}></div>
              <div className="w-1 h-4 bg-white/20 rounded animate-pulse" style={{ animationDelay: '450ms' }}></div>
              <div className="w-1 h-7 bg-white/20 rounded animate-pulse" style={{ animationDelay: '600ms' }}></div>
            </div>
            <div className="text-xs text-white/50">Loading photo...</div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5">
          <div className="flex flex-col items-center gap-2 text-white/40">
            <i className="fa-solid fa-image text-2xl"></i>
            <div className="text-xs">Photo unavailable</div>
            <button 
              className="text-xs text-[#4db6ac] hover:text-[#45a99c] transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                setError(false)
                setLoading(true)
                // Force reload by adding timestamp
                const img = new Image()
                img.onload = handleLoad
                img.onerror = handleError
                img.src = src + '?t=' + Date.now()
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Actual image */}
      <img
        src={displaySrc}
        alt={alt}
        className={`w-full h-full object-contain transition-all duration-500 ${
          loading ? 'opacity-0 scale-105' : 'opacity-100 scale-100'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        style={{ 
          display: error ? 'none' : 'block',
          transition: 'opacity 0.5s ease-in-out, transform 0.5s ease-in-out',
          imageOrientation: 'from-image' as any,
        }}
      />

      {/* Loading progress indicator */}
      {loading && !error && (
        <div className="absolute bottom-2 left-2 right-2">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-[#4db6ac] rounded-full animate-pulse"></div>
          </div>
        </div>
      )}

      {isGif && isFrozen && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-black/65 text-[10px] tracking-[0.2em] text-white/80 uppercase">
          GIF paused
        </div>
      )}

      {isGif && isFrozen && canReplay && (
        <button
          type="button"
          className="absolute bottom-2 right-2 px-3 py-1.5 rounded-full bg-white/90 text-xs font-semibold text-black hover:bg-white transition"
          onClick={(event) => {
            event.stopPropagation()
            replay()
          }}
        >
          Replay
        </button>
      )}
    </div>
  )
}