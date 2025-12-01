import { useRef, useState } from 'react'

interface MessageVideoProps {
  src: string
  className?: string
}

export default function MessageVideo({ src, className = '' }: MessageVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.play()
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
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration)
    }
  }

  return (
    <div className={`relative rounded-xl overflow-hidden bg-black ${className}`}>
      {/* Play button overlay - show when not playing */}
      {!isPlaying && (
        <div 
          className="absolute inset-0 z-10 cursor-pointer flex items-center justify-center"
          onClick={handlePlay}
        >
          {/* Semi-transparent overlay */}
          <div className="absolute inset-0 bg-black/30" />
          
          {/* Play button */}
          <div className="relative w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white hover:scale-105 transition-all">
            <i className="fa-solid fa-play text-black text-xl ml-1" />
          </div>
          
          {/* Duration badge */}
          {duration && duration > 0 && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-xs">
              {formatDuration(duration)}
            </div>
          )}
        </div>
      )}

      {/* Video element - always has controls for accessibility */}
      <video
        ref={videoRef}
        className="w-full"
        controls
        playsInline
        preload="metadata"
        src={src}
        onPlay={handleVideoPlay}
        onPause={handleVideoPause}
        onEnded={handleVideoEnded}
        onLoadedMetadata={handleLoadedMetadata}
        style={{ 
          // Hide controls visually when showing play overlay, but keep them accessible
          opacity: isPlaying ? 1 : 0.999 
        }}
      />
    </div>
  )
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
