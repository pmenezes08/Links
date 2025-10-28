import { useState } from 'react'

interface MessageImageProps {
  src: string
  alt: string
  onClick?: () => void
  className?: string
}

export default function MessageImage({ src, alt, onClick, className = '' }: MessageImageProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
  }

  return (
    <div 
      className={`relative bg-black rounded-md overflow-hidden ${className}`}
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
        src={src}
        alt={alt}
        className={`w-full h-full object-contain transition-all duration-500 ${
          loading ? 'opacity-0 scale-105' : 'opacity-100 scale-100'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        style={{ 
          display: error ? 'none' : 'block',
          transition: 'opacity 0.5s ease-in-out, transform 0.5s ease-in-out'
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
    </div>
  )
}