import { useEffect, useRef, useState } from 'react'

type LazyVideoProps = {
  src: string
  className?: string
  poster?: string
  controls?: boolean
  playsInline?: boolean
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
}

export default function LazyVideo({
  src,
  className = '',
  poster,
  controls = true,
  playsInline = true,
  autoPlay = false,
  muted = false,
  loop = false,
}: LazyVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setShouldLoad(false)
    setHasError(false)
    setIsLoading(true)

    const node = videoRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setShouldLoad(true)
            observer.disconnect()
          }
        })
      },
      { rootMargin: '200px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [src])

  useEffect(() => {
    const node = videoRef.current
    if (!node) return
    if (!shouldLoad) {
      node.pause()
      node.removeAttribute('src')
      node.load()
    }
  }, [shouldLoad])

  return (
    <div className="relative">
      <video
        ref={videoRef}
        className={className}
        controls={controls}
        playsInline={playsInline}
        preload={shouldLoad ? 'metadata' : 'none'}
        poster={poster}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        src={shouldLoad ? src : undefined}
        onError={() => { setHasError(true); setIsLoading(false) }}
        onLoadedData={() => { setHasError(false); setIsLoading(false) }}
        onLoadedMetadata={() => setIsLoading(false)}
      />
      {/* Loading spinner while video metadata/first frame loads */}
      {shouldLoad && isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
        </div>
      )}
      {!shouldLoad && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-[11px] text-white/80">
          Scroll to load video
        </div>
      )}
      {hasError && shouldLoad && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center text-xs text-white px-3">
          <span>Unable to load this video.</span>
          <a href={src} target="_blank" rel="noopener noreferrer" className="text-[#4db6ac] underline">
            Open in new tab
          </a>
        </div>
      )}
    </div>
  )
}
