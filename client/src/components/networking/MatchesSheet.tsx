import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import MemberMatchCard, { type MatchCardMember } from './MemberMatchCard'
import { CPOINT_EASE_OUT } from '../../design/motion'

/**
 * "Introductions" bottom sheet — Steve's recommended members live here,
 * one tap away from the chat instead of inline in the message flow.
 * Kept mounted (open prop) so the exit transition plays; dismiss via
 * backdrop, the close button, or Escape.
 */
export default function MatchesSheet({
  open,
  usernames,
  memberByName,
  feedback,
  onFeedback,
  onOpenProfile,
  onMessage,
  onClose,
}: {
  open: boolean
  usernames: string[]
  memberByName: Record<string, MatchCardMember>
  feedback: Record<string, { feedback: 'up' | 'down' }>
  onFeedback: (username: string, value: 'up' | 'down') => void
  onOpenProfile: (username: string) => void
  onMessage: (username: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  return (
    <div
      className={`fixed inset-0 z-[90] flex items-end justify-center bg-black/60 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={e => { if (e.currentTarget === e.target) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={t('networking.matches_sheet_title')}
    >
      <div
        className={`w-full max-w-xl max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-c-border bg-c-bg-elevated px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] transition-transform duration-[250ms] ${open ? 'translate-y-0' : 'translate-y-full'} sm:mb-4 sm:rounded-2xl sm:border`}
        style={{ transitionTimingFunction: CPOINT_EASE_OUT }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-c-text-tertiary/40" aria-hidden="true" />
        <div className="flex items-center justify-between pb-1">
          <div>
            <h2 className="text-base font-semibold text-c-text-primary">{t('networking.matches_sheet_title')}</h2>
            <p className="text-[11px] text-c-text-tertiary">{t('networking.matches_sheet_context')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-11 w-11 items-center justify-center rounded-full text-c-text-secondary transition hover:bg-c-hover-bg"
          >
            <i className="fa-solid fa-xmark text-sm" />
          </button>
        </div>
        <div className="divide-y divide-c-border-subtle">
          {usernames.map(username => (
            <MemberMatchCard
              key={username}
              username={username}
              member={memberByName[username.toLowerCase()]}
              feedback={feedback[username]?.feedback}
              onFeedback={value => onFeedback(username, value)}
              onOpen={() => onOpenProfile(username)}
              onMessage={() => onMessage(username)}
            />
          ))}
        </div>
        <p className="pt-3 text-[11px] text-c-text-tertiary">{t('networking.matches_sheet_footer')}</p>
      </div>
    </div>
  )
}
