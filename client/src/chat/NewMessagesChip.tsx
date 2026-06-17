import { useTranslation } from 'react-i18next'
import { chatHapticTap } from './chatHaptics'

export type NewMessagesChipProps = {
  count: number
  bottom: string
  onClick: () => void
}

export function NewMessagesChip({ count, bottom, onClick }: NewMessagesChipProps) {
  const { t } = useTranslation()
  if (count <= 0) return null

  const label =
    count === 1
      ? t('chat.new_message', { defaultValue: '1 new message' })
      : t('chat.new_messages', { count, defaultValue: `${count} new messages` })

  return (
    <button
      type="button"
      className="fixed z-[999] left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-cpoint-turquoise text-black text-sm font-medium shadow-lg border border-cpoint-turquoise/80 hover:brightness-110 transition-all active:scale-95"
      style={{ bottom }}
      onClick={() => { chatHapticTap(); onClick() }}
      aria-label={label}
    >
      <i className="fa-solid fa-arrow-down text-xs" />
      <span>{label}</span>
    </button>
  )
}
