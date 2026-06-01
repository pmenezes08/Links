import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

/**
 * Request-my-data modal.
 *
 * Pure UI: there is no self-serve endpoint that assembles the dump.
 * The user is guided to `privacy@c-point.co` with a prefilled body;
 * our DPO handles the request out-of-band within the SLA printed in
 * the modal and documented in Terms §7.3 / Privacy §7. This is
 * deliberate — a hand-rolled portal would land in the same inbox
 * anyway for MVP volumes, and the mailto avoids us building a
 * second auth layer for data requests.
 */

const PRIVACY_EMAIL = 'privacy@c-point.co'
const SLA_DAYS = 30

type Props = {
  open: boolean
  onClose: () => void
  username?: string
  accountEmail?: string
}

export default function RequestMyDataModal({ open, onClose, username, accountEmail }: Props) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const subject = t('account.privacy.request_data_modal.email_subject')
  const body = [
    t('account.privacy.request_data_modal.email_greeting'),
    '',
    t('account.privacy.request_data_modal.email_body'),
    '',
    t('account.privacy.request_data_modal.email_username', { username: username || t('account.privacy.request_data_modal.username_placeholder') }),
    t('account.privacy.request_data_modal.email_account_email', { email: accountEmail || t('account.privacy.request_data_modal.email_placeholder') }),
    '',
    t('account.privacy.request_data_modal.email_verify'),
    '',
    t('account.privacy.request_data_modal.email_thanks'),
  ].join('\n')

  const mailto = `mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('account.privacy.request_data_modal.title')}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-c-border bg-[#0f1214] p-5 text-c-text-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">{t('account.privacy.request_data_modal.title')}</h3>
            <p className="mt-1 text-sm text-c-text-tertiary">
              {t('account.privacy.request_data_modal.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-c-text-tertiary hover:bg-c-hover-bg hover:text-white"
            aria-label={t('common.close')}
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm">
            <section className="rounded-lg border border-c-border bg-c-hover-bg p-3">
            <h4 className="mb-2 text-sm font-semibold text-c-text-secondary">
              {t('account.privacy.request_data_modal.included_title')}
            </h4>
            <ul className="list-disc pl-5 text-c-text-secondary space-y-1">
              <li>{t('account.privacy.request_data_modal.included_posts')}</li>
              <li>{t('account.privacy.request_data_modal.included_profile')}</li>
              <li>{t('account.privacy.request_data_modal.included_metadata')}</li>
            </ul>
          </section>

            <section className="rounded-lg border border-c-border bg-c-hover-bg p-3">
            <h4 className="mb-2 text-sm font-semibold text-c-text-secondary">
              {t('account.privacy.request_data_modal.excluded_title')}
            </h4>
            <ul className="list-disc pl-5 text-c-text-secondary space-y-1">
              <li>{t('account.privacy.request_data_modal.excluded_members')}</li>
              <li>{t('account.privacy.request_data_modal.excluded_community')}</li>
            </ul>
            <p className="mt-2 text-xs text-c-text-tertiary">
              {t('account.privacy.request_data_modal.excluded_note')}
            </p>
          </section>

          <section className="rounded-lg border border-cpoint-turquoise/20 bg-cpoint-turquoise/5 p-3">
            <p className="text-c-text-secondary">
              {t('account.privacy.request_data_modal.sla_body', { days: SLA_DAYS })}
            </p>
          </section>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-c-border px-4 py-2 text-sm text-c-text-secondary hover:border-c-border"
          >
            {t('common.cancel')}
          </button>
          <a
            href={mailto}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black hover:bg-[#3ea69c]"
            onClick={() => {
              setTimeout(onClose, 0)
            }}
          >
            <i className="fa-solid fa-envelope"></i>
            {t('account.privacy.request_data_modal.email_cta', { email: PRIVACY_EMAIL })}
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}
