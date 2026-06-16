import { useMemo, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { optimizeMessagePhoto } from '../utils/imageOptimizer'
import { getImageDims, recordImageDims } from '../utils/imageDimsCache'

interface MessageImageProps {
  src: string
  alt: string
  onClick?: () => void
  className?: string
  /** Fill a fixed-aspect parent (e.g. media grid tile); drops bubble max-height and uses cover */
  tile?: boolean
  /** Server-known intrinsic dimensions (reserve height on the very FIRST view, incl. the receiver's). */
  width?: number
  height?: number
}

export default function MessageImage({ src, alt, onClick, className = '', tile = false, width, height }: MessageImageProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryWithOriginal, setRetryWithOriginal] = useState(false)
  const [errorCount, setErrorCount] = useState(0)
  const normalizedSrc = useMemo(() => src?.split('?')[0]?.toLowerCase() || '', [src])
  const isGif = normalizedSrc.endsWith('.gif')

  // Apply Cloudflare optimization (skip for GIFs). Retry with original on error. errorCount remounts img on hard failures (iOS broken-icon case).
  const displaySrc = useMemo(() => {
    if (isGif || retryWithOriginal) return src
    return optimizeMessagePhoto(src)
  }, [src, isGif, retryWithOriginal])

  // Reserve the row's height before the image decodes, using dimensions measured on a
  // previous view (cached by URL). This stops the collapse-then-grow reflow that, under
  // the inverted message list, reads as bubbles overlapping and settling after a moment.
  // First-ever view of a new image is unreserved (one settle), then cached for next time.
  // Prefer server-known dims (reserve on first view, including the receiver's); otherwise
  // fall back to dims measured on a previous view (cached by URL).
  const propDims = !tile && width && height && width > 0 && height > 0 ? ([width, height] as [number, number]) : null
  const cachedDims = useMemo(() => (tile ? null : getImageDims(src)), [src, tile])
  const dims = propDims ?? cachedDims
  const reserved = !tile && !!dims

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    setLoading(false)
    if (!tile) {
      const img = e.currentTarget
      if (img.naturalWidth && img.naturalHeight) recordImageDims(src, img.naturalWidth, img.naturalHeight)
    }
  }

  const handleError = () => {
    setLoading(false)
    if (!retryWithOriginal) {
      setRetryWithOriginal(true)
    } else {
      setErrorCount((prev) => prev + 1)
      setError(true)
    }
  }

  const rootLayout = tile ? 'block w-full h-full min-h-0' : reserved ? 'block w-full' : 'inline-block'
  const rootStyle: CSSProperties | undefined = reserved
    ? { aspectRatio: `${dims![0]} / ${dims![1]}`, maxHeight: '320px' }
    : undefined
  // A reserved box already holds height, so the spinner/error overlay needn't impose a min size.
  const overlaySize = tile || reserved ? '' : 'min-h-[100px] min-w-[100px]'

  return (
    <div
      className={`relative rounded overflow-hidden ${rootLayout} ${className}`}
      style={rootStyle}
      onClick={onClick}
    >
      {loading && !error && (
        <div className={`absolute inset-0 flex items-center justify-center bg-white/5 ${overlaySize}`}>
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className={`absolute inset-0 flex items-center justify-center bg-white/5 p-4 z-10 ${overlaySize}`}>
          <div className="flex flex-col items-center gap-1 text-c-text-tertiary">
            <i className="fa-solid fa-image text-lg"></i>
            <div className="text-[10px]">{t('chat.media_deleted')}</div>
          </div>
        </div>
      )}

      <img
        key={`preview-${normalizedSrc}-${errorCount}`}
        src={displaySrc}
        alt={alt}
        className={`transition-opacity duration-300 ${
          tile ? 'h-full w-full object-cover' : reserved ? 'w-full h-full object-contain' : 'max-w-full'
        } ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        decoding="async"
        style={{
          display: error ? 'none' : 'block',
          ...(tile
            ? { height: '100%', width: '100%', objectFit: 'cover' as const }
            : reserved
              ? { width: '100%', height: '100%', objectFit: 'contain' as const, imageOrientation: 'from-image' }
              : { maxHeight: '320px', imageOrientation: 'from-image' }),
        }}
      />
    </div>
  )
}
