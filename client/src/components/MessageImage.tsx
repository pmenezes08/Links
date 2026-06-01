import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { optimizeMessagePhoto } from '../utils/imageOptimizer'

interface MessageImageProps {
  src: string
  alt: string
  onClick?: () => void
  className?: string
  /** Fill a fixed-aspect parent (e.g. media grid tile); drops bubble max-height and uses cover */
  tile?: boolean
}

export default function MessageImage({ src, alt, onClick, className = '', tile = false }: MessageImageProps) {
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

  const handleLoad = () => {
    setLoading(false)
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

  const rootLayout = tile ? 'block w-full h-full min-h-0' : 'inline-block'

  return (
    <div
      className={`relative rounded overflow-hidden ${rootLayout} ${className}`}
      onClick={onClick}
    >
      {loading && !error && (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-white/5 ${tile ? '' : 'min-h-[100px] min-w-[100px]'}`}
        >
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-white/5 p-4 z-10 ${tile ? '' : 'min-h-[100px] min-w-[100px]'}`}
        >
          <div className="flex flex-col items-center gap-1 text-white/40">
            <i className="fa-solid fa-image text-lg"></i>
            <div className="text-[10px]">{t('chat.media_deleted')}</div>
          </div>
        </div>
      )}

      <img
        key={`preview-${normalizedSrc}-${errorCount}`}
        src={displaySrc}
        alt={alt}
        className={`max-w-full transition-opacity duration-300 ${tile ? 'h-full w-full object-cover' : ''} ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        decoding="async"
        style={{
          display: error ? 'none' : 'block',
          ...(tile
            ? { height: '100%', width: '100%', objectFit: 'cover' as const }
            : { maxHeight: '320px', imageOrientation: 'from-image' }),
        }}
      />
    </div>
  )
}
