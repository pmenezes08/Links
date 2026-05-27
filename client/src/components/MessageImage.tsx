import { useLayoutEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { optimizeMessagePhoto } from '../utils/imageOptimizer'
import {
  MESSAGE_IMAGE_DEFAULT_ASPECT_RATIO,
  probeMessageImageAspectRatio,
  readCachedMessageImageAspectRatio,
  writeCachedMessageImageAspectRatio,
} from './messageImageAspect'

interface MessageImageProps {
  src: string
  alt: string
  onClick?: () => void
  className?: string
  /** Fill a fixed-aspect parent (e.g. media grid tile); drops bubble max-height and uses cover */
  tile?: boolean
  /** Cap reserved height for bubble images (matches legacy max-h-64). */
  maxHeightPx?: number
}

export default function MessageImage({
  src,
  alt,
  onClick,
  className = '',
  tile = false,
  maxHeightPx = 320,
}: MessageImageProps) {
  const normalizedSrc = useMemo(() => src?.split('?')[0]?.toLowerCase() || '', [src])
  const isGif = normalizedSrc.endsWith('.gif')

  const cachedAspectRatio = useMemo(() => readCachedMessageImageAspectRatio(src), [src])

  const [loading, setLoading] = useState(() => cachedAspectRatio === undefined)
  const [error, setError] = useState(false)
  const [retryWithOriginal, setRetryWithOriginal] = useState(false)
  const [errorCount, setErrorCount] = useState(0)
  const [aspectRatio, setAspectRatio] = useState(
    () => cachedAspectRatio ?? MESSAGE_IMAGE_DEFAULT_ASPECT_RATIO,
  )

  const displaySrc = useMemo(() => {
    if (isGif || retryWithOriginal) return src
    return optimizeMessagePhoto(src)
  }, [src, isGif, retryWithOriginal])

  useLayoutEffect(() => {
    if (tile) return

    const cached = readCachedMessageImageAspectRatio(src)
    if (cached !== undefined) {
      setAspectRatio(cached)
      setLoading(false)
      return
    }

    setAspectRatio(MESSAGE_IMAGE_DEFAULT_ASPECT_RATIO)
    setLoading(true)

    const controller = new AbortController()
    void probeMessageImageAspectRatio(displaySrc, {
      cacheSrc: src,
      signal: controller.signal,
    }).then(ratio => {
      if (ratio === undefined) return
      setAspectRatio(ratio)
      setLoading(false)
    })

    return () => controller.abort()
  }, [src, displaySrc, tile])

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    const ratio = writeCachedMessageImageAspectRatio(src, img.naturalWidth, img.naturalHeight)
    setAspectRatio(ratio)
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
    if (!retryWithOriginal) {
      setRetryWithOriginal(true)
    } else {
      setErrorCount(prev => prev + 1)
      setError(true)
    }
  }

  const rootLayout = tile ? 'block w-full h-full min-h-0' : 'block w-full max-w-full'

  const reservedBoxStyle = tile
    ? undefined
    : ({
        aspectRatio: `${aspectRatio}`,
        maxHeight: maxHeightPx,
      } as const)

  return (
    <div
      className={`relative overflow-hidden ${rootLayout} ${className}`}
      style={reservedBoxStyle}
      onClick={onClick}
    >
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5 p-4 z-10">
          <div className="flex flex-col items-center gap-1 text-white/40">
            <i className="fa-solid fa-image text-lg" />
            <div className="text-[10px]">Unavailable</div>
          </div>
        </div>
      )}

      <img
        key={`preview-${normalizedSrc}-${errorCount}`}
        src={displaySrc}
        alt={alt}
        className={`transition-opacity duration-300 ${
          tile ? 'h-full w-full object-cover' : 'absolute inset-0 h-full w-full object-contain'
        } ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        decoding="async"
        style={{
          display: error ? 'none' : 'block',
          ...(tile ? {} : { imageOrientation: 'from-image' as const }),
        }}
      />
    </div>
  )
}
