import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ZoomableImage from '../components/ZoomableImage'
import type { MediaQuality } from './upload'

export type PendingMediaItem = {
  file: File
  previewUrl: string
  type: 'image' | 'video' | 'audio'
}

export type ChatMediaPreviewModalProps = {
  items: PendingMediaItem[]
  previewIndex: number
  onPreviewIndexChange: (index: number) => void
  onCancel: () => void
  onRemove: (index: number) => void
  onSend: () => void
  quality?: MediaQuality
  onQualityChange?: (quality: MediaQuality) => void
  /** True while picked files are still being read off the native bridge (no items yet). */
  loading?: boolean
}

export function ChatMediaPreviewModal({
  items,
  previewIndex,
  onPreviewIndexChange,
  onCancel,
  onRemove,
  onSend,
  quality = 'standard',
  onQualityChange,
  loading = false,
}: ChatMediaPreviewModalProps) {
  const { t } = useTranslation()
  if ((items.length === 0 && !loading) || typeof document === 'undefined') return null

  // Reading picked photos off the native bridge takes a moment; show a spinner so the
  // composer doesn't look frozen after the picker closes (looked like "send failed").
  if (items.length === 0) {
    return createPortal(
      <div className="theme-always-dark fixed inset-0 bg-black z-[10050] flex flex-col items-center justify-center gap-4">
        <i className="fa-solid fa-spinner fa-spin text-3xl text-cpoint-turquoise" />
        <div className="text-sm font-medium text-white/80">{t('chat.preparing_media')}</div>
      </div>,
      document.body,
    )
  }

  const current = items[previewIndex]
  const hasVideo = items.some(item => item.type === 'video')

  return createPortal(
    <div className="theme-always-dark fixed inset-0 bg-black z-[10050] flex flex-col" onClick={onCancel}>
      <div
        className="flex items-center justify-between px-4 py-3 bg-black/80"
        style={{ paddingTop: 'calc(var(--sat-px, 0px) + 12px)' }}
      >
        <button type="button" onClick={onCancel} className="text-white p-2 -ml-2">
          <i className="fa-solid fa-xmark text-xl" />
        </button>
        <span className="text-white font-medium">
          {items.length > 1 ? t('chat.media_preview_count', { current: previewIndex + 1, total: items.length }) : t('chat.media_preview_title')}
        </span>
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onRemove(previewIndex)
          }}
          className="text-white/60 p-2 -mr-2 hover:text-white"
        >
          <i className="fa-solid fa-trash text-sm" />
        </button>
      </div>

      <div
        className="flex-1 flex items-center justify-center overflow-hidden relative"
        onClick={e => e.stopPropagation()}
      >
        {items.length > 1 && previewIndex > 0 && (
          <button
            type="button"
            className="absolute left-2 z-10 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
            onClick={() => onPreviewIndexChange(previewIndex - 1)}
          >
            <i className="fa-solid fa-chevron-left" />
          </button>
        )}

        <div className="w-full h-full flex items-center justify-center" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
          {current?.type === 'video' ? (
            <video
              src={current.previewUrl}
              controls
              playsInline
              className="max-w-full max-h-full object-contain"
            />
          ) : current?.type === 'audio' ? (
            <audio src={current.previewUrl} controls className="w-full max-w-md" />
          ) : (
            <ZoomableImage
              src={current?.previewUrl || ''}
              alt="Preview"
              className="w-full h-full"
              onRequestClose={onCancel}
              disableTapToClose
            />
          )}
        </div>

        {items.length > 1 && previewIndex < items.length - 1 && (
          <button
            type="button"
            className="absolute right-2 z-10 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
            onClick={() => onPreviewIndexChange(previewIndex + 1)}
          >
            <i className="fa-solid fa-chevron-right" />
          </button>
        )}
      </div>

      {items.length > 1 && (
        <div className="flex justify-center gap-2 px-4 py-2 bg-black/80 overflow-x-auto">
          {items.map((item, i) => (
            <button
              type="button"
              key={i}
              onClick={e => {
                e.stopPropagation()
                onPreviewIndexChange(i)
              }}
              className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border-2 transition ${
                i === previewIndex ? 'border-cpoint-turquoise' : 'border-transparent opacity-60'
              }`}
            >
              {item.type === 'video' ? (
                <div className="w-full h-full bg-black/50 flex items-center justify-center">
                  <i className="fa-solid fa-video text-white/60 text-xs" />
                </div>
              ) : item.type === 'audio' ? (
                <div className="w-full h-full bg-black/50 flex items-center justify-center">
                  <i className="fa-solid fa-music text-white/60 text-xs" />
                </div>
              ) : (
                <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}

      {hasVideo && onQualityChange ? (
        <div className="px-4 py-3 bg-black/80 border-t border-white/10" onClick={e => e.stopPropagation()}>
          <div className="mx-auto max-w-sm rounded-full bg-white/10 p-1 flex">
            {(['standard', 'hd'] as MediaQuality[]).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => onQualityChange(option)}
                className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
                  quality === option ? 'bg-white text-black' : 'text-white/75 hover:text-white'
                }`}
              >
                {option === 'standard' ? t('chat.media_quality_standard') : t('chat.media_quality_hd')}
              </button>
            ))}
          </div>
          <div className="mt-2 text-center text-xs text-white/55">
            {quality === 'standard' ? t('chat.media_quality_standard_hint') : t('chat.media_quality_hd_hint')}
          </div>
        </div>
      ) : null}

      <div
        className="flex items-center justify-center gap-4 px-4 py-4 bg-black/80 flex-shrink-0"
        style={{ paddingBottom: 'calc(var(--sab-px, 0px) + 16px)' }}
      >
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onCancel()
          }}
          className="px-6 py-3 bg-white/10 text-white rounded-full font-medium hover:bg-white/20 transition touch-manipulation"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onSend()
          }}
          className="px-8 py-3 bg-cpoint-turquoise text-black rounded-full font-medium hover:brightness-95 transition flex items-center gap-2 touch-manipulation"
        >
          <i className="fa-solid fa-paper-plane" />
          {t('chat.send_media', { count: items.length })}
        </button>
      </div>
    </div>,
    document.body,
  )
}
