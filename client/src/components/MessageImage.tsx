import { useMemo, useState, useRef, useEffect } from 'react'
import { useGifPlayback } from '../hooks/useGifPlayback'
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
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null)
  const [imgKey, setImgKey] = useState(0)
  const imgRef = useRef<HTMLImageElement>(null)
  const normalizedSrc = useMemo(() => src?.split('?')[0]?.toLowerCase() || '', [src])
  const isGif = normalizedSrc.endsWith('.gif')
  const { isFrozen, stillSrc, replay, canReplay } = useGifPlayback(isGif ? src : null)
  
  // Apply Cloudflare optimization (skip for GIFs to preserve animation)
  const optimizedSrc = useMemo(() => {
    if (isGif) return src
    return optimizeMessagePhoto(src)
  }, [src, isGif])

  // Capture frozen frame from canvas when GIF should freeze
  useEffect(() => {
    if (!isGif) {
      setFrozenFrame(null)
      return
    }
    
    if (!isFrozen) {
      // Not frozen - clear any captured frame
      setFrozenFrame(null)
      return
    }
    
    // Use stillSrc if available (from GIF parsing)
    if (stillSrc) {
      setFrozenFrame(stillSrc)
      return
    }
    
    // Try to capture current frame from the img element
    const img = imgRef.current
    if (!img || !img.complete || img.naturalWidth === 0) {
      return
    }
    
    // Small delay to ensure we capture a frame
    const captureTimer = setTimeout(() => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0)
          const dataUrl = canvas.toDataURL('image/png')
          setFrozenFrame(dataUrl)
        }
      } catch (e) {
        // Canvas capture failed (CORS, etc.)
        // We'll show the GIF with a frozen overlay instead
        console.log('Could not capture GIF frame:', e)
      }
    }, 50)
    
    return () => clearTimeout(captureTimer)
  }, [isGif, isFrozen, stillSrc])

  // Determine what to display
  const showFrozenFrame = isGif && isFrozen && frozenFrame
  const displaySrc = showFrozenFrame ? frozenFrame : optimizedSrc

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
  }

  // When replaying, reset frozen frame and force img re-mount
  const handleReplay = () => {
    setFrozenFrame(null)
    setImgKey(prev => prev + 1) // Force re-mount to restart GIF animation
    replay()
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
        ref={imgRef}
        key={`${imgKey}-${showFrozenFrame ? 'frozen' : 'animated'}`}
        src={displaySrc}
        alt={alt}
        className={`max-w-full transition-opacity duration-300 ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        style={{ 
          display: error ? 'none' : 'block',
          maxHeight: '320px',
          imageOrientation: 'from-image',
        }}
      />

      {/* Frozen overlay - dims the GIF when frozen (even without captured frame) */}
      {isGif && isFrozen && !showFrozenFrame && (
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
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
            handleReplay()
          }}
        >
          Replay
        </button>
      )}
    </div>
  )
}