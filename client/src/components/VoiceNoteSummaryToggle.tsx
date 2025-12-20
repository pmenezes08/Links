/**
 * Toggle component for enabling AI summary on voice notes
 * Only shown to premium users
 */

interface VoiceNoteSummaryToggleProps {
  enabled: boolean
  onToggle: () => void
  isPremium: boolean
  compact?: boolean
}

export default function VoiceNoteSummaryToggle({
  enabled,
  onToggle,
  isPremium,
  compact = false
}: VoiceNoteSummaryToggleProps) {
  if (!isPremium) return null

  if (compact) {
    return (
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onToggle()
        }}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium transition-all active:scale-95 ${
          enabled
            ? 'bg-[#4db6ac]/20 text-[#4db6ac] border border-[#4db6ac]/30'
            : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
        }`}
        title={enabled ? 'AI summary enabled' : 'Enable AI summary'}
        style={{ touchAction: 'manipulation' }}
      >
        <i className={`fa-solid fa-wand-magic-sparkles text-[9px] pointer-events-none ${enabled ? 'text-[#4db6ac]' : 'text-white/40'}`} />
        <span className="pointer-events-none">AI</span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg border border-white/10">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onToggle()
        }}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled ? 'bg-[#4db6ac]' : 'bg-white/20'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="flex items-center gap-1.5">
        <i className={`fa-solid fa-wand-magic-sparkles text-xs ${enabled ? 'text-[#4db6ac]' : 'text-white/40'}`} />
        <span className="text-xs text-white/70">AI Summary</span>
      </div>
    </div>
  )
}
