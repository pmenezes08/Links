import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ActiveSubscriptionDeletePayload {
  community_id?: number
  tier?: string | null
  subscription_status?: string | null
  current_period_end?: string | null
  benefits_end_at?: string | null
}

export interface DeleteCommunityResult {
  success?: boolean
  activeSubscription?: boolean
  error?: string
  subscriptions?: ActiveSubscriptionDeletePayload[]
}

interface DeleteCommunityModalProps {
  open: boolean
  communityName: string
  onClose: () => void
  onSubmit: (confirmActiveSubscription: boolean) => Promise<DeleteCommunityResult>
}

export default function DeleteCommunityModal({
  open,
  communityName,
  onClose,
  onSubmit,
}: DeleteCommunityModalProps) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const [step, setStep] = useState<'confirm' | 'active_subscription'>('confirm')
  const [subscriptions, setSubscriptions] = useState<ActiveSubscriptionDeletePayload[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTyped('')
    setStep('confirm')
    setSubscriptions([])
    setLoading(false)
    setError(null)
  }, [open])

  const canSubmit = useMemo(() => typed.trim() === 'DELETE', [typed])

  if (!open) return null

  async function handleInitialDelete() {
    if (!canSubmit || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await onSubmit(false)
      if (result.success) return
      if (result.activeSubscription) {
        setSubscriptions(result.subscriptions || [])
        setStep('active_subscription')
        return
      }
      setError(result.error || t('communities.delete_failed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleActiveSubscriptionDelete() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await onSubmit(true)
      if (result.success) return
      setError(result.error || t('communities.delete_failed'))
    } finally {
      setLoading(false)
    }
  }

  const displayName = communityName || t('communities.delete_modal_this_community')

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/80 backdrop-blur sm:items-center sm:p-6">
      <div className="flex h-full w-full flex-col border-c-border bg-c-bg-app text-c-text-primary shadow-2xl sm:h-auto sm:max-w-lg sm:rounded-2xl sm:border">
        <div className="border-b border-c-border px-5 py-4">
          <div className="text-xs uppercase tracking-[0.22em] text-cpoint-turquoise">{t('communities.delete_modal_danger_zone')}</div>
          <h2 className="mt-2 text-xl font-semibold">
            {step === 'active_subscription' ? t('communities.delete_modal_active_subscription_title') : t('communities.delete_modal_title')}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {step === 'confirm' ? (
            <>
              <p className="text-sm leading-6 text-c-text-secondary">
                {t('communities.delete_modal_body', { name: displayName })}
              </p>
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-800 dark:text-red-100">
                {t('communities.delete_modal_type_delete_hint')}
              </div>
              <input
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={t('communities.delete_modal_type_delete_placeholder')}
                className="w-full rounded-xl border border-c-border bg-c-composer-input-bg px-4 py-3 text-[16px] text-c-text-primary outline-none transition placeholder:text-c-text-tertiary focus:border-cpoint-turquoise"
              />
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-c-text-secondary">
                {t('communities.delete_modal_active_subscription_body')}
              </p>
              <div className="space-y-2">
                {subscriptions.length > 0 ? subscriptions.map((subscription, index) => (
                  <div key={`${subscription.community_id || 'community'}-${index}`} className="rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 p-3 text-sm">
                    <div className="font-medium text-cpoint-turquoise">
                      {subscription.tier || t('communities.delete_modal_paid_tier')} · {subscription.subscription_status || 'active'}
                    </div>
                    {(subscription.benefits_end_at || subscription.current_period_end) && (
                      <div className="mt-1 text-xs text-c-text-secondary">
                        {t('communities.delete_modal_benefits_until', {
                          date: formatDate(subscription.benefits_end_at || subscription.current_period_end || ''),
                        })}
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 p-3 text-sm text-c-text-secondary">
                    {t('communities.delete_modal_cancel_at_period_end')}
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-c-border px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-full border border-c-border px-5 py-2.5 text-sm text-c-text-secondary transition hover:bg-c-hover-bg disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={step === 'active_subscription' ? handleActiveSubscriptionDelete : handleInitialDelete}
            disabled={loading || (step === 'confirm' && !canSubmit)}
            className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? t('communities.delete_modal_deleting')
              : step === 'active_subscription'
                ? t('communities.delete_modal_confirm_cancel')
                : t('communities.delete_modal_delete_community')}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDate(value: string) {
  if (!value) return ''
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? value.split(' ')[0] : date.toLocaleDateString()
}
