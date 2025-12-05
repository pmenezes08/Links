import { useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'

interface MessageVideoProps {
  src: string
  className?: string
}

export default function MessageVideo({ src, className = '' }: MessageVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const isNative = Capacitor.isNativePlatform()

  const handlePlayClick = () => {
    setShowOverlay(false)
    if (videoRef.current) {
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
        preload={isNative ? "auto" : "metadata"}
        src={src}
        onLoadedData={() => setIsLoading(false)}
      />
      
      {/* Minimal play button overlay */}
      {showOverlay && (
        <div 
          onClick={handlePlayClick}
          className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/10"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
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
