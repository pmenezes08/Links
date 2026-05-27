import { useTranslation } from 'react-i18next'

export type ChatSelectionBarProps = {
  selectedCount: number
  onCancel: () => void
  onDelete: () => void
  deleteDisabled?: boolean
  /** When set, bar is fixed to viewport bottom (DM). Omit for in-composer placement (group). */
  fixed?: boolean
}

export function ChatSelectionBar({
  selectedCount,
  onCancel,
  onDelete,
  deleteDisabled = false,
  fixed = true,
}: ChatSelectionBarProps) {
  const { t } = useTranslation()

  const inner = (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 ${
        fixed ? 'pb-[max(12px,env(safe-area-inset-bottom))]' : ''
      }`}
    >
      <button
        type="button"
        className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
        onClick={onCancel}
      >
        <i className="fa-solid fa-xmark text-lg" />
        <span className="text-sm">{t('chat.cancel')}</span>
      </button>

      <div className="text-white/80 text-sm font-medium">
        {selectedCount} selected
      </div>

      <button
        type="button"
        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
          selectedCount > 0 && !deleteDisabled
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-white/5 text-white/30'
        }`}
        onClick={onDelete}
        disabled={selectedCount === 0 || deleteDisabled}
      >
        <i className="fa-solid fa-trash text-sm" />
        <span className="text-sm">{t('chat.delete')}</span>
      </button>
    </div>
  )

  if (!fixed) {
    return (
      <div
        className="w-full rounded-[16px]"
        style={{
          background: '#0a0a0c',
          paddingLeft: 'max(10px, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
        }}
      >
        {inner}
      </div>
    )
  }

  return (
    <div
      className="fixed left-0 right-0 z-[1001] bg-[#1a1a1a]/95 backdrop-blur-md border-t border-white/10"
      style={{ bottom: 0 }}
    >
      {inner}
    </div>
  )
}
