import { useState, useEffect, useRef } from 'react'
import ImageLoader from './ImageLoader'

type CarouselItem = {
  type: 'original' | 'ai_video'
  image_path?: string | null
  image_url?: string | null
  video_path?: string | null
  video_url?: string | null
  created_by?: string | null
  style?: string | null
}

type VideoCarouselProps = {
  items: CarouselItem[]
  className?: string
  onPreviewImage?: (src: string) => void
}

export default function VideoCarousel({ items, className = '', onPreviewImage }: VideoCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [translateX, setTranslateX] = useState(0)
  const carouselRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoSeekedRef = useRef<Set<number>>(new Set())

  // Reset to first item when items change
  useEffect(() => {
    setCurrentIndex(0)
    setTranslateX(0)
    videoSeekedRef.current.clear()
  }, [items.length])

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true)
    setStartX(e.touches[0].clientX)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const currentX = e.touches[0].clientX
    const diff = startX - currentX
    setTranslateX(-currentIndex * 100 + (diff / (containerRef.current?.clientWidth || 1)) * 100)
  }

  const handleTouchEnd = () => {
    if (!isDragging) return
    setIsDragging(false)

    const threshold = 50 // pixels
    const moved = translateX + currentIndex * 100

    if (Math.abs(moved) > threshold) {
      if (moved > 0 && currentIndex < items.length - 1) {
        setCurrentIndex(currentIndex + 1)
      } else if (moved < 0 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1)
      }
    }
    
    setTranslateX(0)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setStartX(e.clientX)
    e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    const currentX = e.clientX
    const diff = startX - currentX
    setTranslateX(-currentIndex * 100 + (diff / (containerRef.current?.clientWidth || 1)) * 100)
  }

  const handleMouseUp = () => {
    if (!isDragging) return
    setIsDragging(false)

    const threshold = 50
    const moved = translateX + currentIndex * 100

    if (Math.abs(moved) > threshold) {
      if (moved > 0 && currentIndex < items.length - 1) {
        setCurrentIndex(currentIndex + 1)
      } else if (moved < 0 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1)
      }
    }
    
    setTranslateX(0)
  }

  const goToSlide = (index: number) => {
    if (index >= 0 && index < items.length) {
      setCurrentIndex(index)
      setTranslateX(0)
    }
  }

  const nextSlide = () => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setTranslateX(0)
    }
  }

  const prevSlide = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setTranslateX(0)
    }
  }

  if (!items || items.length === 0) return null

  const normalizePath = (path?: string | null) => {
    if (!path) return ''
    // If already a full URL, return as-is
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    // If already starts with /, return as-is
    if (path.startsWith('/uploads') || path.startsWith('/static')) return path
    // Otherwise, prepend /uploads/
    return path.startsWith('uploads') ? `/${path}` : `/uploads/${path}`
  }

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Carousel Container */}
      <div
        ref={carouselRef}
        className="relative overflow-hidden rounded-xl border border-white/10"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ touchAction: 'pan-y pinch-zoom', willChange: 'transform' }}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(${-currentIndex * 100 + translateX}%)`,
            width: `${items.length * 100}%`,
            willChange: 'transform'
          }}
        >
          {items.map((item, index) => (
            <div
              key={index}
              className="relative flex-shrink-0 w-full"
              style={{ width: `${100 / items.length}%`, minHeight: '200px' }}
            >
              {item.type === 'original' && item.image_url && (
                <div className="relative w-full">
                  <ImageLoader
                    src={item.image_url}
                    alt="Original photo"
                    className="block w-full max-h-[520px] object-contain rounded-xl cursor-zoom-in"
                    onClick={() => onPreviewImage && onPreviewImage(item.image_url!)}
                  />
                </div>
              )}
              {item.type === 'ai_video' && item.video_url && (
                <div className="relative w-full">
                  {/* Generated by tag */}
                  {item.created_by && (
                    <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm border border-white/20 text-xs text-white flex items-center gap-1">
                      <i className="fa-solid fa-wand-magic-sparkles text-[#4db6ac]" />
                      <span>Generated by</span>
                      <span className="font-semibold text-[#4db6ac]">@{item.created_by}</span>
                    </div>
                  )}
                  <video
                    key={`${item.video_url}-${index}`}
                    src={item.video_path ? normalizePath(item.video_path) : (item.video_url || '')}
                    className="w-full max-h-[520px] rounded border border-white/10 bg-black"
                    controls
                    playsInline
                    loop
                    style={{ transform: 'translateZ(0)' }}
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget as HTMLVideoElement
                      console.log('[Carousel] Video metadata - dimensions:', video.videoWidth, 'x', video.videoHeight)
                      console.log('[Carousel] Video readyState:', video.readyState)
                      console.log('[Carousel] Video src:', video.src)
                      // Ensure video shows first frame when metadata loads
                      try {
                        video.currentTime = 0
                        console.log('[Carousel] Set currentTime to 0 in metadata')
                      } catch (err) {
                        console.warn('[Carousel] Failed to set currentTime in metadata:', err)
                      }
                    }}
                    onError={(e) => {
                      const video = e.currentTarget as HTMLVideoElement
                      console.error('[Carousel] Video error:', video.error, 'src:', video.src)
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Dots */}
      {items.length > 1 && (
        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 z-20 flex items-center gap-2 px-2 py-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/20">
          {items.map((_, index) => (
            <button
              key={index}
              type="button"
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentIndex
                  ? 'bg-[#4db6ac] w-6'
                  : 'bg-white/40 hover:bg-white/60'
              }`}
              onClick={() => goToSlide(index)}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Navigation Arrows */}
      {items.length > 1 && (
        <>
          {currentIndex > 0 && (
            <button
              type="button"
              className="absolute left-2 top-1/2 transform -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/70 backdrop-blur-sm border border-white/20 text-white hover:bg-black/90 flex items-center justify-center transition-all"
              onClick={prevSlide}
              aria-label="Previous slide"
            >
              <i className="fa-solid fa-chevron-left" />
            </button>
          )}
          {currentIndex < items.length - 1 && (
            <button
              type="button"
              className="absolute right-2 top-1/2 transform -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/70 backdrop-blur-sm border border-white/20 text-white hover:bg-black/90 flex items-center justify-center transition-all"
              onClick={nextSlide}
              aria-label="Next slide"
            >
              <i className="fa-solid fa-chevron-right" />
            </button>
          )}
        </>
      )}

      {/* Slide Indicator */}
      {items.length > 1 && (
        <div className="absolute top-2 right-2 z-20 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm border border-white/20 text-xs text-white/80">
          {currentIndex + 1} / {items.length}
        </div>
      )}
    </div>
  )
}
