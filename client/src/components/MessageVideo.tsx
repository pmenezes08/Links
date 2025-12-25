import { useRef, useState, useEffect, useMemo } from 'react'

interface MessageVideoProps {
  src: string
  className?: string
}

export default function MessageVideo({ src, className = '' }: MessageVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [hasFrame, setHasFrame] = useState(false)

  // Add timestamp to force browser to load first frame
  // This is a common technique to show video thumbnail
  const videoSrc = useMemo(() => {
    if (!src) return ''
    // Don't add timestamp if already present or if it's a blob URL
    if (src.includes('#t=') || src.startsWith('blob:')) return src
    return `${src}#t=0.001`
  }, [src])

  // Ensure first frame is displayed when metadata loads
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedMetadata = () => {
      // Seek to beginning to ensure first frame is rendered
      if (video.currentTime === 0) {
        video.currentTime = 0.001
      }
    }

    const handleSeeked = () => {
      // First frame is now visible
      setHasFrame(true)
      setIsLoading(false)
    }

    const handleLoadedData = () => {
      setHasFrame(true)
      setIsLoading(false)
    }

    const handleError = () => {
      // Still hide loading on error
      setIsLoading(false)
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('loadeddata', handleLoadedData)
    video.addEventListener('error', handleError)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('loadeddata', handleLoadedData)
      video.removeEventListener('error', handleError)
    }
  }, [videoSrc])

  const handlePlayClick = () => {
    setShowOverlay(false)
    if (videoRef.current) {
      // Reset to beginning before playing
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {
        // Autoplay blocked - user can use controls
      })
    }
  }

  return (
    <div className={`relative inline-block rounded overflow-hidden ${className}`}>
      {/* Video element */}
      <video
        ref={videoRef}
        className="max-w-full"
        style={{ maxHeight: '320px' }}
        controls={!showOverlay}
        playsInline
        preload="auto"
        muted={showOverlay}
        src={videoSrc}
      />
      
      {/* Play button overlay - only shown when video has loaded */}
      {showOverlay && (
        <div 
          onClick={handlePlayClick}
          className={`absolute inset-0 flex items-center justify-center cursor-pointer transition-colors ${
            hasFrame ? 'bg-black/20' : 'bg-black/60'
          }`}
        >
          {isLoading ? (
            <div className="w-6 h-6 border-2 border-white/40 border-t-white/90 rounded-full animate-spin" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <i className="fa-solid fa-play text-black text-base ml-0.5" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
