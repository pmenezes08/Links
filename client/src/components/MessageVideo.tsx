import { useRef, useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'

interface MessageVideoProps {
  src: string
  className?: string
}

export default function MessageVideo({ src, className = '' }: MessageVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const isNative = Capacitor.isNativePlatform()

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleCanPlay = () => {
      setIsLoading(false)
    }

    const handleProgress = () => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1)
        const duration = video.duration
        if (duration > 0) {
          setLoadProgress(Math.round((bufferedEnd / duration) * 100))
        }
      }
    }

    const handleLoadedData = () => {
      setIsLoading(false)
    }

    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('progress', handleProgress)
    video.addEventListener('loadeddata', handleLoadedData)

    return () => {
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('progress', handleProgress)
      video.removeEventListener('loadeddata', handleLoadedData)
    }
  }, [src])

  const handlePlayClick = () => {
    setShowOverlay(false)
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay blocked - user can use controls
      })
    }
  }

  return (
    <div className={`relative rounded-xl overflow-hidden bg-black ${className}`} style={{ minHeight: '120px' }}>
      {/* Play button overlay - positioned over video */}
      {showOverlay && (
        <div 
          className="absolute top-0 left-0 right-0 bottom-0 z-10 cursor-pointer bg-black/30"
          onClick={handlePlayClick}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Loading indicator */}
          {isLoading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full border-3 border-white/30 border-t-white animate-spin" />
              <div className="text-white/80 text-xs">
                {loadProgress > 0 ? `Loading ${loadProgress}%` : 'Loading...'}
              </div>
            </div>
          ) : (
            <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <i className="fa-solid fa-play text-black text-xl ml-1" />
            </div>
          )}
        </div>
      )}

      <video
        ref={videoRef}
        className="w-full"
        controls
        playsInline
        preload={isNative ? "auto" : "metadata"}
        src={src}
      />
    </div>
  )
}
