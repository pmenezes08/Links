import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { triggerHaptic } from '../../utils/haptics'
import { PanelCard } from '../settings/SettingsSection'
import { tierLabel } from './subscriptionFormatters'
import type { ActiveCommunitySubscription, ActiveSubscriptionsPayload } from './subscriptionTypes'

type StevePickerPanelProps = {
  activeSubscriptions: ActiveSubscriptionsPayload | null
  preselectedCommunityId: string
  error?: string | null
  loading?: boolean
  onChoose: (communityId: number) => void
  onCreate: () => void
}

export default function StevePickerPanel({
  activeSubscriptions,
  preselectedCommunityId,
  error,
  loading,
  onChoose,
  onCreate,
}: StevePickerPanelProps) {
  const { t } = useTranslation()
  const [fullRows, setFullRows] = useState<ActiveCommunitySubscription[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const focusId = useMemo(() => {
    const raw = preselectedCommunityId.trim()
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }, [preselectedCommunityId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (activeSubscriptions?.success && Array.isArray(activeSubscriptions.communities)) {
        if (!cancelled) {
          setFullRows(activeSubscriptions.communities)
          setLoadErr(null)
        }
        return
      }
      try {
        const res = await fetch('/api/me/subscriptions', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const data: ActiveSubscriptionsPayload = await res.json()
        if (cancelled) return
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || t('subscriptions.error_load_subscriptions'))
        }
        setFullRows(data.communities || [])
      } catch (err) {
        if (!cancelled) {
          setLoadErr(err instanceof Error ? err.message : t('subscriptions.error_load_subscriptions'))
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeSubscriptions, t])

  const focusRow = useMemo(() => {
    if (!focusId || !fullRows) return null
    return fullRows.find(c => c.id === focusId) ?? null
  }, [focusId, fullRows])

  const eligibleList = useMemo(() => (fullRows || []).filter(c => c.steve_addon_eligible), [fullRows])

  useEffect(() => {
    if (focusRow) {
      setSelectedId(focusRow.steve_addon_eligible ? focusRow.id : null)
    }
  }, [focusRow])

  const showList = !focusRow

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/45">{t('subscriptions.steve_eligibility_hint')}</p>

      {loadErr ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadErr}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {focusRow && !focusRow.steve_addon_eligible ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
          {focusRow.steve_addon_message || t('subscriptions.steve_not_eligible')}
        </div>
      ) : null}

      {fullRows === null && !loadErr ? (
        <div className="text-sm text-white/50">{t('subscriptions.steve_loading_subscriptions')}</div>
      ) : null}

      {fullRows !== null && showList && eligibleList.length === 0 ? (
        <PanelCard>
          <div className="p-4 text-sm text-white/60">{t('subscriptions.steve_no_eligible')}</div>
        </PanelCard>
      ) : null}

      {showList && eligibleList.length > 0 ? (
        <PanelCard>
          {eligibleList.map((c, index) => {
            const checked = selectedId === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  void triggerHaptic('selection')
                  setSelectedId(c.id)
                }}
                className={
                  'flex w-full items-center justify-between px-4 py-4 text-left transition-colors active:bg-white/[0.08] ' +
                  (index < eligibleList.length - 1 ? 'border-b border-white/[0.055] ' : '') +
                  (checked ? 'bg-[#4db6ac]/[0.08] ' : '')
                }
              >
                <span className="min-w-0 flex-1 pr-3">
                  <span className="block text-base font-semibold text-white">{c.name}</span>
                  {c.tier && c.tier !== 'free' ? (
                    <span className="mt-0.5 block text-sm text-white/40">
                      {t('subscriptions.current_tier', { tier: tierLabel(c.tier) })}
                    </span>
                  ) : null}
                </span>
                {checked ? <i className="fa-solid fa-check text-[#4db6ac]" /> : null}
              </button>
            )
          })}
        </PanelCard>
      ) : null}

      <button
        type="button"
        disabled={!selectedId || loading}
        onClick={() => selectedId && onChoose(selectedId)}
        className={
          'flex w-full items-center justify-center rounded-2xl px-4 py-3 font-bold active:opacity-80 ' +
          (selectedId && !loading
            ? 'bg-[#4db6ac] text-black'
            : 'cursor-not-allowed border border-white/15 bg-white/5 text-white/40')
        }
      >
        {loading ? t('subscriptions.starting_checkout') : t('subscriptions.continue_checkout')}
      </button>

      {focusId == null && fullRows !== null && eligibleList.length === 0 ? (
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center rounded-2xl border border-white/10 px-4 py-3 font-bold text-white/75 active:bg-white/10"
        >
          {t('subscriptions.create_community')}
        </button>
      ) : null}
    </div>
  )
}
