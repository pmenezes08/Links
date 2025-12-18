import { useMemo, useState, useRef, useEffect } from 'react'
import { useGifPlayback } from '../hooks/useGifPlayback'
import { optimizeMessagePhoto } from '../utils/imageOptimizer'

interface MessageImageProps {
  src: string
  alt: string
  onClick?: () => void
  className?: string
}

// Extract Giphy static URL from animated URL
// Giphy URLs: https://media.giphy.com/media/{id}/giphy.gif -> https://media.giphy.com/media/{id}/giphy_s.gif
// Also handles: https://media0.giphy.com/media/{id}/giphy.gif and similar CDN variants
function getGiphyStaticUrl(gifUrl: string): string | null {
  if (!gifUrl) return null
  
  // Match various Giphy URL patterns
  const giphyPatterns = [
    /^(https?:\/\/media\d?\.giphy\.com\/media\/[^/]+\/)giphy\.gif/i,
    /^(https?:\/\/media\d?\.giphy\.com\/media\/[^/]+\/)(\d+)\.gif/i,
    /^(https?:\/\/i\.giphy\.com\/)([^/]+)\.gif/i,
  ]
  
  for (const pattern of giphyPatterns) {
    const match = gifUrl.match(pattern)
    if (match) {
      // For standard giphy.gif URLs, use giphy_s.gif (static)
      if (pattern === giphyPatterns[0]) {
        return match[1] + 'giphy_s.gif'
      }
      // For numbered URLs like 200.gif, use 200_s.gif
      if (pattern === giphyPatterns[1]) {
        return match[1] + match[2] + '_s.gif'
      }
      // For i.giphy.com URLs
      if (pattern === giphyPatterns[2]) {
        return `https://media.giphy.com/media/${match[2]}/giphy_s.gif`
      }
    }
  }
  
  return null
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
  
  // Get Giphy static URL as fallback
  const giphyStaticUrl = useMemo(() => getGiphyStaticUrl(src), [src])
  
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
    
    // Use Giphy static URL if available
    if (giphyStaticUrl) {
      setFrozenFrame(giphyStaticUrl)
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
        // Canvas capture failed (CORS, etc.) - frozenFrame stays null
        // GIF will continue playing but we'll show the pause overlay
        console.log('Could not capture GIF frame (CORS):', e)
      }
    }, 50)
    
    return () => clearTimeout(captureTimer)
  }, [isGif, isFrozen, stillSrc, giphyStaticUrl])

  // Determine what to display
  const hasFrozenFrame = Boolean(frozenFrame)
  
  const displaySrc = useMemo(() => {
    if (!isGif) return optimizedSrc
    if (isFrozen && frozenFrame) return frozenFrame
    // If frozen but no frame available, keep showing the GIF (it will animate but better than blank)
    return optimizedSrc
  }, [isGif, isFrozen, frozenFrame, optimizedSrc])

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
        key={`${imgKey}-${hasFrozenFrame ? 'frozen' : 'animated'}`}
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