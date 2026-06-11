import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CPOINT_EASE_OUT } from '../../design/motion'

export type SteveSessionSummary = { id: number; created_at: string; first_message: string }

/**
 * Past Steve chats as a bottom sheet (same shell as MatchesSheet) —
 * replaces the old top-anchored inline dropdown and its undiscoverable
 * long-press delete. Tapping a row loads the session into the one Steve
 * surface; delete is an explicit per-row affordance with inline confirm.
 * Kept mounted (open prop) so the exit transition plays.
 */
export default function HistorySheet({
  open,
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onClose,
}: {
  open: boolean
  sessions: SteveSessionSummary[]
  activeSessionId: number | null
  onSelect: (sessionId: number) => void
  onDelete: (sessionId: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmingId(null)
      return
    }
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

  // Deleting the last session removes the trigger's reason to exist —
  // close so the member is not left staring at an empty sheet.
  useEffect(() => {
    if (open && sessions.length === 0) onClose()
  }, [open, sessions.length, onClose])

  return (
    <div
      className={`fixed inset-0 z-[90] flex items-end justify-center bg-black/60 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={e => { if (e.currentTarget === e.target) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={t('networking.history_sheet_title')}
    >
      <div
        className={`w-full max-w-xl max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-c-border bg-c-bg-elevated px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] transition-transform duration-[250ms] ${open ? 'translate-y-0' : 'translate-y-full'} sm:mb-4 sm:rounded-2xl sm:border`}
        style={{ transitionTimingFunction: CPOINT_EASE_OUT }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-c-text-tertiary/40" aria-hidden="true" />
        <div className="flex items-center justify-between pb-1">
          <h2 className="text-base font-semibold text-c-text-primary">{t('networking.history_sheet_title')}</h2>
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
          {sessions.map(s => (
            <div key={s.id} className={`flex min-h-[56px] items-center gap-1 ${s.id === activeSessionId ? 'bg-c-active-bg -mx-2 rounded-lg px-2' : ''}`}>
              {confirmingId === s.id ? (
                <div className="flex flex-1 items-center justify-between gap-2 py-2">
                  <span className="text-[11px] text-c-text-secondary">{t('networking.delete_confirm')}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setConfirmingId(null); onDelete(s.id) }}
                      className="rounded-md border border-red-500/40 bg-red-500/20 px-2.5 py-1 text-[11px] font-medium text-red-400 transition hover:bg-red-500/30"
                    >
                      {t('common.delete')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="rounded-md border border-c-border px-2.5 py-1 text-[11px] font-medium text-c-text-secondary transition hover:bg-c-hover-bg"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className="flex min-h-[56px] flex-1 flex-col justify-center gap-0.5 py-2 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-c-text-primary">
                        {s.first_message || t('networking.session_new_chat')}
                      </span>
                      {s.id === activeSessionId && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cpoint-turquoise" aria-hidden="true" />
                      )}
                    </span>
                    <span className="text-[11px] text-c-text-tertiary">
                      {new Date(s.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(s.id)}
                    aria-label={t('networking.delete_session')}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-c-text-tertiary transition hover:bg-c-hover-bg hover:text-red-400"
                  >
                    <i className="fa-regular fa-trash-can text-xs" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
