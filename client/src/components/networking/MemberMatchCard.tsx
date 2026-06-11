import { useTranslation } from 'react-i18next'
import Avatar from '../Avatar'

export type MatchCardMember = {
  username: string
  display_name?: string | null
  profile_picture?: string | null
  role?: string | null
  company?: string | null
  city?: string | null
  country?: string | null
}

/**
 * Member row inside the "Introductions" sheet — avatar, identity line,
 * per-member feedback, and a direct "Message" CTA. Rendered as list rows
 * (the sheet's divide-y provides separation); calm by design, no
 * entrance animation.
 */
export default function MemberMatchCard({
  username,
  member,
  feedback,
  onFeedback,
  onOpen,
  onMessage,
}: {
  username: string
  member?: MatchCardMember | null
  feedback?: 'up' | 'down'
  onFeedback: (value: 'up' | 'down') => void
  onOpen: () => void
  onMessage: () => void
}) {
  const { t } = useTranslation()
  const displayName = member?.display_name || username
  const identityLine =
    member?.role && member?.company
      ? `${member.role} · ${member.company}`
      : member?.role || member?.company || `@${username}`

  return (
    <div className="py-2.5">
    <div className="flex items-center gap-2.5">
      <button type="button" onClick={onOpen} aria-label={displayName} className="shrink-0">
        <Avatar username={username} url={member?.profile_picture || undefined} size={40} />
      </button>
      <button type="button" onClick={onOpen} className="min-h-[44px] flex-1 min-w-0 text-left">
        <div className="truncate text-sm font-semibold text-c-text-primary">{displayName}</div>
        <div className="truncate text-[11px] text-c-text-tertiary">{identityLine}</div>
      </button>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => onFeedback('up')}
          className={`flex h-10 w-8 items-center justify-center rounded transition ${feedback === 'up' ? 'text-cpoint-turquoise' : 'text-c-text-disabled hover:text-c-text-tertiary'}`}
          title={t('networking.feedback_good')}
          aria-label={t('networking.feedback_good')}
        >
          <i className="fa-solid fa-thumbs-up text-[11px]" />
        </button>
        <button
          type="button"
          onClick={() => onFeedback('down')}
          className={`flex h-10 w-8 items-center justify-center rounded transition ${feedback === 'down' ? 'text-red-400/80' : 'text-c-text-disabled hover:text-c-text-tertiary'}`}
          title={t('networking.feedback_not_relevant')}
          aria-label={t('networking.feedback_not_relevant')}
        >
          <i className="fa-solid fa-thumbs-down text-[11px]" />
        </button>
      </div>
      <button
        type="button"
        onClick={onMessage}
        className="min-h-[44px] shrink-0 rounded-full bg-cpoint-turquoise px-3.5 text-xs font-semibold text-black transition hover:brightness-110"
      >
        {t('networking.message')}
      </button>
    </div>
    {feedback === 'down' && (
      <p className="mt-1.5 pl-[52px] text-[11px] text-c-text-tertiary">{t('networking.matches_down_ack')}</p>
    )}
    </div>
  )
}
