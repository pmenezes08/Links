import { useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'

interface MessageVideoProps {
  src: string
  className?: string
}

export default function MessageVideo({ src, className = '' }: MessageVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showOverlay, setShowOverlay] = useState(true)
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
    <div className={`relative rounded-xl overflow-hidden bg-black ${className}`}>
      {/* Video element first - this determines the container size */}
      <video
        ref={videoRef}
        className="w-full block"
        controls
        playsInline
        preload={isNative ? "auto" : "metadata"}
        src={src}
      />
      
      {/* Play button overlay - only show when video dimensions are known */}
      {showOverlay && (
        <div 
          onClick={handlePlayClick}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
            cursor: 'pointer',
            backgroundColor: 'rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div 
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <i className="fa-solid fa-play text-black text-xl" style={{ marginLeft: 4 }} />
          </div>
        </div>
      )}
    </div>
  )
}
