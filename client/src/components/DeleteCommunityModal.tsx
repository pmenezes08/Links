import { useEffect, useMemo, useState } from 'react'

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
      setError(result.error || 'Failed to delete community')
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
      setError(result.error || 'Failed to delete community')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/80 backdrop-blur sm:items-center sm:p-6">
      <div className="flex h-full w-full flex-col border-white/10 bg-black text-white shadow-2xl sm:h-auto sm:max-w-lg sm:rounded-2xl sm:border">
        <div className="border-b border-white/10 px-5 py-4">
          <div className="text-xs uppercase tracking-[0.22em] text-cpoint-turquoise">Danger Zone</div>
          <h2 className="mt-2 text-xl font-semibold">
            {step === 'active_subscription' ? 'Active subscription detected' : 'Delete community'}
          </h2>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {step === 'confirm' ? (
            <>
              <p className="text-sm leading-6 text-white/70">
                This will permanently delete <span className="font-semibold text-white">{communityName || 'this community'}</span>,
                including posts, messages, members, and community data. This action cannot be undone.
              </p>
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                Type <span className="font-semibold text-white">DELETE</span> to confirm this destructive action.
              </div>
              <input
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Type DELETE"
                className="w-full rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-[16px] text-white outline-none transition placeholder:text-white/30 focus:border-cpoint-turquoise"
              />
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-white/70">
                This community has an active subscription. If you delete it, the subscription will be scheduled to cancel
                automatically and benefits will remain active until the end of the current billing period.
              </p>
              <div className="space-y-2">
                {subscriptions.length > 0 ? subscriptions.map((subscription, index) => (
                  <div key={`${subscription.community_id || 'community'}-${index}`} className="rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 p-3 text-sm">
                    <div className="font-medium text-cpoint-turquoise">
                      {subscription.tier || 'Paid tier'} · {subscription.subscription_status || 'active'}
                    </div>
                    {(subscription.benefits_end_at || subscription.current_period_end) && (
                      <div className="mt-1 text-xs text-white/65">
                        Benefits active until {formatDate(subscription.benefits_end_at || subscription.current_period_end || '')}
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 p-3 text-sm text-white/70">
                    The subscription will be cancelled at the end of the current billing period.
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-white/75 transition hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={step === 'active_subscription' ? handleActiveSubscriptionDelete : handleInitialDelete}
            disabled={loading || (step === 'confirm' && !canSubmit)}
            className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? 'Deleting...'
              : step === 'active_subscription'
                ? 'Confirm and cancel subscription'
                : 'Delete community'}
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
