import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { triggerHaptic } from '../../utils/haptics'

type ConfirmRemoveSheetProps = {
  open: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Destructive confirm for the Reports queue — replaces window.confirm with
 * the app's bottom-sheet language (cf. settings/DangerZoneSheet, minus the
 * typed confirmation: removing one post is consequential, not catastrophic).
 */
export default function ConfirmRemoveSheet({ open, busy = false, onCancel, onConfirm }: ConfirmRemoveSheetProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (open) void triggerHaptic('medium')
  }, [open])

  const close = () => {
    if (busy) return
    void triggerHaptic('light')
    onCancel()
  }

  return (
    <div
      className={`fixed inset-0 z-[1300] flex items-end bg-black/60 transition-opacity duration-300 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onClick={close}
      aria-hidden={!open}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full rounded-t-[2rem] border border-red-300/15 bg-c-bg-elevated px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-3 text-c-text-primary shadow-[0_-28px_80px_rgba(0,0,0,0.72)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1 w-11 rounded-full bg-c-text-tertiary" />
        <h2 className="text-xl font-bold tracking-[-0.02em] text-c-text-primary">{t('owner.reports_remove_title')}</h2>
        <p className="mt-2 text-sm leading-6 text-c-text-secondary">{t('owner.reports_confirm_body')}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="rounded-2xl border border-c-border px-4 py-3 font-bold text-c-text-secondary active:bg-c-active-bg disabled:opacity-50"
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { void triggerHaptic('warning'); onConfirm() }}
            className="rounded-2xl bg-red-500 px-4 py-3 font-bold text-white active:opacity-80 disabled:opacity-50"
          >
            {t('owner.reports_action_remove')}
          </button>
        </div>
      </div>
    </div>
  )
}
