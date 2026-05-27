import type { ReactNode } from 'react'
import ZoomableImage from '../components/ZoomableImage'
import { useImmersiveStatusBar } from '../hooks/useNativeStatusBar'

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)($|\?)/i.test(url) || url.includes('.mp4') || url.includes('.mov') || url.includes('.webm')
}

export type ChatMediaViewerState = {
  urls: string[]
  index: number
}

export type ChatMediaViewerModalProps = {
  viewer: ChatMediaViewerState | null
  onClose: () => void
  onIndexChange: (index: number) => void
  footer?: ReactNode
  thumbStrip?: 'border' | 'dots'
}

export function ChatMediaViewerModal({
  viewer,
  onClose,
  onIndexChange,
  footer,
  thumbStrip = 'border',
}: ChatMediaViewerModalProps) {
  useImmersiveStatusBar(!!viewer)

  if (!viewer) return null

  const { urls, index } = viewer
  const currentUrl = urls[index]

  return (
    <div className="fixed inset-0 bg-black z-[9999] flex flex-col" onClick={onClose}>
      <div
        className="flex items-center justify-between px-4 py-3 bg-black/80"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <button type="button" onClick={onClose} className="text-white p-2 -ml-2">
          <i className="fa-solid fa-arrow-left text-lg" />
        </button>
        <span className="text-white font-medium">
          {urls.length > 1 ? `${index + 1} of ${urls.length}` : 'Media'}
        </span>
        <div className="w-10" />
      </div>

      <div
        className="flex-1 flex items-center justify-center overflow-hidden relative"
        onClick={e => e.stopPropagation()}
      >
        {urls.length > 1 && index > 0 && (
          <button
            type="button"
            className="absolute left-2 z-10 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
            onClick={() => onIndexChange(index - 1)}
          >
            <i className="fa-solid fa-chevron-left" />
          </button>
        )}

        <div className="w-full h-full flex items-center justify-center" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
          {isVideoUrl(currentUrl || '') ? (
            <video
              src={currentUrl}
              controls
              playsInline
              autoPlay
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <ZoomableImage
              src={currentUrl}
              alt="Media"
              className="w-full h-full"
              onRequestClose={onClose}
              disableTapToClose
            />
          )}
        </div>

        {urls.length > 1 && index < urls.length - 1 && (
          <button
            type="button"
            className="absolute right-2 z-10 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
            onClick={() => onIndexChange(index + 1)}
          >
            <i className="fa-solid fa-chevron-right" />
          </button>
        )}
      </div>

      {urls.length > 1 && thumbStrip === 'border' && (
        <div
          className="flex justify-center gap-2 px-4 py-3 bg-black/80 overflow-x-auto"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          {urls.map((url, i) => (
            <button
              type="button"
              key={i}
              onClick={e => {
                e.stopPropagation()
                onIndexChange(i)
              }}
              className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border-2 transition ${
                i === index ? 'border-[#4db6ac]' : 'border-transparent opacity-60'
              }`}
            >
              {isVideoUrl(url) ? (
                <div className="w-full h-full bg-black/50 flex items-center justify-center">
                  <i className="fa-solid fa-video text-white/60 text-xs" />
                </div>
              ) : (
                <img src={url} alt="" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}

      {urls.length > 1 && thumbStrip === 'dots' && (
        <div
          className="flex justify-center gap-2 py-3 bg-black/80"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          {urls.map((_, i) => (
            <button
              type="button"
              key={i}
              onClick={e => {
                e.stopPropagation()
                onIndexChange(i)
              }}
              className={`w-2 h-2 rounded-full transition ${
                i === index ? 'bg-[#4db6ac]' : 'bg-white/30'
              }`}
            />
          ))}
        </div>
      )}

      {footer}
    </div>
  )
}
