import type { ImagineStyle } from '../hooks/useImagineJobs'

type ImagineStyleModalProps = {
  isOpen: boolean
  onClose: () => void
  onSelect: (style: ImagineStyle) => void
  isSubmitting?: boolean
  nsfwAllowed?: boolean
}

const STYLE_OPTIONS: Array<{ key: ImagineStyle; label: string; description: string }> = [
  { key: 'normal', label: 'Normal', description: 'Subtle animation with gentle motion' },
  { key: 'fun', label: 'Fun', description: 'Playful colors and energetic movement' },
  { key: 'spicy', label: 'Spicy', description: 'Bold, dramatic motion and lighting' }
]

export function ImagineStyleModal({ isOpen, onClose, onSelect, isSubmitting, nsfwAllowed }: ImagineStyleModalProps) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={(e)=> e.currentTarget === e.target && !isSubmitting && onClose()}>
      <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#091013] p-5 shadow-[0_25px_60px_rgba(0,0,0,0.6)]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Animate this photo</h2>
            <p className="text-sm text-white/70 mt-1">Choose a style to transform the selected image into a short AI-generated video.</p>
          </div>
          <button className="shrink-0 w-9 h-9 rounded-full border border-white/15 text-white/70 hover:text-white hover:bg-white/10 transition" onClick={onClose} disabled={isSubmitting} aria-label="Close imagine modal">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="space-y-2">
          {STYLE_OPTIONS.map(option => (
            <button
              key={option.key}
              type="button"
              disabled={isSubmitting}
              className="w-full text-left px-4 py-3 rounded-xl border transition border-white/10 hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/10"
              onClick={() => onSelect(option.key)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-white text-sm">{option.label}</div>
                  <div className="text-xs text-white/60 mt-1">{option.description}</div>
                </div>
                {option.key === 'spicy' && !nsfwAllowed ? (
                  <span className="text-[11px] font-semibold text-[#ffad66] uppercase">Safe output</span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-4 text-xs text-white/50">
          Generation may take ~15 seconds. You’ll see the result automatically when it’s ready.
        </div>
        {isSubmitting && (
          <div className="mt-4 flex items-center gap-2 text-sm text-[#4db6ac]">
            <i className="fa-solid fa-spinner fa-spin" />
            <span>Preparing your imagine request…</span>
          </div>
        )}
      </div>
    </div>
  )
}

type ImagineOwnerModalProps = {
  isOpen: boolean
  onClose: () => void
  videoUrl?: string
  onReplace: () => void
  onAddAlongside: () => void
  isProcessing?: boolean
  error?: string | null
}

export function ImagineOwnerModal({ isOpen, onClose, videoUrl, onReplace, onAddAlongside, isProcessing, error }: ImagineOwnerModalProps) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={(e)=> e.currentTarget === e.target && !isProcessing && onClose()}>
      <div className="w-full max-w-[520px] rounded-2xl border border-white/10 bg-[#080d0f] p-5 shadow-[0_25px_60px_rgba(0,0,0,0.65)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Use this AI video?</h2>
          <button className="w-9 h-9 rounded-full border border-white/15 text-white/70 hover:text-white hover:bg-white/10 transition" onClick={onClose} disabled={isProcessing} aria-label="Close imagine review">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        {videoUrl ? (
          <div className="rounded-xl overflow-hidden border border-white/10 bg-black mb-4">
            <video src={videoUrl} controls className="w-full" playsInline loop muted poster={undefined} />
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60 mb-4">Video preview unavailable.</div>
        )}
        {error ? (
          <div className="mb-3 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</div>
        ) : null}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <button
            type="button"
            className="flex-1 rounded-full border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10 transition"
            onClick={onAddAlongside}
            disabled={isProcessing}
          >
            Add alongside original
          </button>
          <button
            type="button"
            className="flex-1 rounded-full bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:brightness-110 transition"
            onClick={onReplace}
            disabled={isProcessing}
          >
            Replace original photo
          </button>
        </div>
        {isProcessing && (
          <div className="mt-3 flex items-center gap-2 text-sm text-[#4db6ac]">
            <i className="fa-solid fa-spinner fa-spin" />
            <span>Applying your choice…</span>
          </div>
        )}
      </div>
    </div>
  )
}

