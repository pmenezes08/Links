import { useEffect, useRef, useState } from 'react'

interface MessageVideoProps {
  src: string
  className?: string
}

export default function MessageVideo({ src, className = '' }: MessageVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Generate thumbnail from first frame
  useEffect(() => {
    if (!src) return

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    const handleLoadedData = () => {
      // Seek to 0.1 second to get a frame (some videos have black first frame)
      video.currentTime = 0.1
    }

    const handleSeeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
          setThumbnail(dataUrl)
        }
      } catch (e) {
        // CORS or other error - thumbnail generation failed silently
      }
      setLoading(false)
      video.remove()
    }

    const handleError = () => {
      setLoading(false)
      setError(true)
      video.remove()
    }

    video.addEventListener('loadeddata', handleLoadedData)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('error', handleError)

    video.src = src

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
      video.remove()
    }
  }, [src])

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.play()
      setIsPlaying(true)
    }
  }

  const handleVideoPlay = () => {
    setIsPlaying(true)
  }

  const handleVideoPause = () => {
    setIsPlaying(false)
  }

  const handleVideoEnded = () => {
    setIsPlaying(false)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
    }
  }

  return (
    <div className={`relative rounded-xl overflow-hidden ${className}`}>
      {/* Thumbnail overlay when paused */}
      {!isPlaying && thumbnail && (
        <div 
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={handlePlay}
        >
          <img 
            src={thumbnail} 
            alt="Video preview" 
            className="w-full h-full object-cover"
          />
          {/* Play button overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white hover:scale-105 transition-all">
              <i className="fa-solid fa-play text-black text-xl ml-1" />
            </div>
          </div>
          {/* Duration badge (if available) */}
          {videoRef.current && videoRef.current.duration > 0 && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-xs">
              {formatDuration(videoRef.current.duration)}
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && !thumbnail && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
            <div className="text-xs text-white/60">Loading video...</div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="flex flex-col items-center gap-2 text-white/60">
            <i className="fa-solid fa-video-slash text-2xl" />
            <div className="text-xs">Video unavailable</div>
          </div>
        </div>
      )}

      {/* Actual video element */}
      <video
        ref={videoRef}
        className="w-full max-h-64"
        controls={isPlaying}
        playsInline
        preload="metadata"
        src={src}
        onPlay={handleVideoPlay}
        onPause={handleVideoPause}
        onEnded={handleVideoEnded}
        onLoadedMetadata={() => setLoading(false)}
        onError={() => setError(true)}
      />
    </div>
  )
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
