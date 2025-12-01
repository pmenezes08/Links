import { useRef, useState } from 'react'

interface MessageVideoProps {
  src: string
  className?: string
}

export default function MessageVideo({ src, className = '' }: MessageVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showOverlay, setShowOverlay] = useState(true)

  const handlePlayClick = () => {
    setShowOverlay(false)
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay blocked - user can use controls
      })
    }
  }

  return (
    <div className={`relative rounded-xl overflow-hidden bg-black ${className}`}>
      {/* Play button overlay */}
      {showOverlay && (
        <div 
          className="absolute inset-0 z-10 cursor-pointer flex items-center justify-center bg-black/20"
          onClick={handlePlayClick}
        >
          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <i className="fa-solid fa-play text-black text-xl ml-1" />
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        className="w-full"
        controls
        playsInline
        preload="metadata"
        src={src}
      />
    </div>
  )
}
