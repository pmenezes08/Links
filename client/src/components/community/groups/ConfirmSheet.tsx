import { useTranslation } from 'react-i18next'

/**
 * Minimal in-app confirm dialog for destructive group actions — replaces
 * window.confirm(). One destructive action, one cancel, nothing else.
 */
export default function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[120] bg-c-bg-overlay backdrop-blur flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={e => { if (e.currentTarget === e.target) onCancel() }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-c-border bg-c-bg-elevated p-4">
        <div className="text-sm font-semibold text-c-text-primary mb-1">{title}</div>
        <div className="text-xs text-c-text-tertiary leading-snug">{body}</div>
        <div className="flex items-center justify-end gap-2 pt-4">
          <button
            type="button"
            className="h-10 px-4 rounded-xl border border-c-border bg-c-bg-surface text-sm text-c-text-secondary hover:bg-c-hover-bg"
            onClick={onCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            className={`h-10 px-4 rounded-xl text-sm font-semibold disabled:opacity-50 ${
              destructive ? 'bg-red-500/90 text-white hover:bg-red-500' : 'bg-cpoint-turquoise text-black hover:brightness-110'
            }`}
            onClick={onConfirm}
          >
            {busy ? <i className="fa-solid fa-spinner fa-spin" aria-hidden /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
