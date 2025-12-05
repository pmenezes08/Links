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
      className={`relative rounded-lg overflow-hidden inline-block ${className}`}
      onClick={onClick}
    >
      {/* Loading skeleton - minimal */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5 min-h-[80px] min-w-[80px]">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-center bg-white/5 min-h-[80px] min-w-[80px] p-4">
          <div className="flex flex-col items-center gap-1 text-white/40">
            <i className="fa-solid fa-image text-lg"></i>
            <div className="text-[10px]">Unavailable</div>
          </div>
        </div>
      )}

      {/* Actual image - auto size based on content */}
      <img
        src={displaySrc}
        alt={alt}
        className={`max-w-full max-h-64 rounded-lg transition-opacity duration-300 ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        style={{ 
          display: error ? 'none' : 'block',
        }}
      />

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