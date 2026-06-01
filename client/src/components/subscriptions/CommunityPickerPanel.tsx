import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openExternalBillingUrl } from '../../utils/mobileStoreBilling'
import { triggerHaptic } from '../../utils/haptics'
import i18n from '../../i18n'
import { PanelCard } from '../settings/SettingsSection'
import { formatEur, paidTierRank, tierLabel } from './subscriptionFormatters'
import type {
  ActiveSubscriptionsPayload,
  Community,
  CommunityTierLevel,
} from './subscriptionTypes'

function currentTierLabel(community: Community, active: ActiveSubscriptionsPayload | null) {
  const activeItem = active?.communities?.find(item => item.id === community.id)
  const tier = activeItem?.tier || community.tier
  if (!tier || tier === 'free') return null
  return i18n.t('subscriptions.current_tier', { tier: tierLabel(tier) })
}

type CommunityPickerPanelProps = {
  tier: CommunityTierLevel
  preselectedCommunityId: string
  activeSubscriptions: ActiveSubscriptionsPayload | null
  error?: string | null
  loading?: boolean
  mobileBillingNotice?: boolean
  webBillingUrl: string
  onChoose: (communityId: number) => void
  onCreate: () => void
}

export default function CommunityPickerPanel({
  tier,
  preselectedCommunityId,
  activeSubscriptions,
  error,
  loading,
  mobileBillingNotice,
  webBillingUrl,
  onChoose,
  onCreate,
}: CommunityPickerPanelProps) {
  const { t } = useTranslation()
  const [communities, setCommunities] = useState<Community[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const raw = preselectedCommunityId.trim()
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  })

  const activeByCommunity = useMemo(
    () => new Map((activeSubscriptions?.communities || []).map(item => [item.id, item])),
    [activeSubscriptions],
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/user_communities_hierarchical', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const data = await res.json()
        if (cancelled) return
        if (!data?.success) {
          throw new Error(data?.error || t('subscriptions.error_load_communities'))
        }
        const flat: Community[] = []
        const walk = (list: unknown[]) => {
          for (const raw of list || []) {
            const item = raw as Community & {
              children?: Community[]
              parent_community_id?: number | null
            }
            if (item && typeof item.id === 'number') flat.push(item)
            if (item && Array.isArray(item.children)) walk(item.children)
          }
        }
        walk(data.communities || [])
        const me = typeof data.username === 'string' ? data.username.trim().toLowerCase() : null
        const activeByCommunityLocal = new Map(
          (activeSubscriptions?.communities || []).map(item => [item.id, item]),
        )
        const owned = flat
          .filter(c => {
            const withParent = c as Community & { parent_community_id?: number | null }
            if (withParent.parent_community_id) return false
            if (me && c.creator_username && c.creator_username.trim().toLowerCase() === me) return true
            if (c.role && c.role.toLowerCase() === 'owner') return true
            return false
          })
          .filter(c => {
            const active = activeByCommunityLocal.get(c.id)
            return String(active?.tier || c.tier || '').toLowerCase() !== tier.tier_code
          })
        setCommunities(owned)
      } catch (err) {
        if (!cancelled) {
          setLoadErr(err instanceof Error ? err.message : t('subscriptions.error_load_communities'))
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeSubscriptions, tier.tier_code, t])

  const downgradeFlow = useMemo(() => {
    if (!communities?.length) return false
    const targetR = paidTierRank(tier.tier_code)
    return communities.some(c => {
      const row = activeByCommunity.get(c.id)
      return paidTierRank(row?.tier || c.tier) > targetR
    })
  }, [communities, activeByCommunity, tier.tier_code])

  return (
    <div className="space-y-4">
      <p className="text-sm text-c-text-tertiary">
        {downgradeFlow
          ? t('subscriptions.picker_downgrade_hint')
          : t('subscriptions.picker_upgrade_hint', {
              maxMembers: tier.max_members ?? '?',
              price: formatEur(tier.price_eur),
            })}
      </p>

      {loadErr ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadErr}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
          {mobileBillingNotice ? (
            <button
              type="button"
              onClick={() => openExternalBillingUrl(webBillingUrl)}
              className="mt-3 block text-left text-cpoint-turquoise underline"
            >
              {t('subscriptions.open_web_billing', { url: webBillingUrl })}
            </button>
          ) : null}
        </div>
      ) : null}

      {communities === null && !loadErr ? (
        <div className="text-sm text-c-text-tertiary">{t('subscriptions.picker_loading_communities')}</div>
      ) : null}

      {communities !== null && communities.length === 0 ? (
        <PanelCard>
          <div className="p-4 text-sm text-c-text-tertiary">
            {t('subscriptions.picker_no_eligible', { tier: tierLabel(tier.tier_code) })}
          </div>
        </PanelCard>
      ) : null}

      {communities && communities.length > 0 ? (
        <PanelCard>
          {communities.map((c, index) => {
            const row = activeByCommunity.get(c.id)
            const curRank = paidTierRank(row?.tier || c.tier)
            const targetRank = paidTierRank(tier.tier_code)
            const blockedHigher = curRank > targetRank && targetRank >= 1
            const checked = selectedId === c.id
            const tierHint = currentTierLabel(c, activeSubscriptions)
            return (
              <button
                key={c.id}
                type="button"
                disabled={blockedHigher}
                onClick={() => {
                  if (blockedHigher) return
                  void triggerHaptic('selection')
                  setSelectedId(c.id)
                }}
                className={
                  'flex w-full items-center justify-between px-4 py-4 text-left transition-colors active:bg-c-active-bg ' +
                  (index < communities.length - 1 ? 'border-b border-c-border ' : '') +
                  (blockedHigher ? 'cursor-not-allowed opacity-55 ' : '') +
                  (checked ? 'bg-cpoint-turquoise/[0.08] ' : '')
                }
              >
                <span className="min-w-0 flex-1 pr-3">
                  <span className="block text-base font-semibold text-c-text-primary">{c.name}</span>
                  {tierHint ? (
                    <span className="mt-0.5 block text-sm text-c-text-tertiary">{tierHint}</span>
                  ) : null}
                  {blockedHigher ? (
                    <span className="mt-1 block text-[11px] text-amber-200/80">
                      {t('subscriptions.picker_higher_tier_blocked')}
                    </span>
                  ) : null}
                </span>
                {checked ? <i className="fa-solid fa-check text-cpoint-turquoise" /> : null}
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
            ? 'bg-cpoint-turquoise text-black'
            : 'cursor-not-allowed border border-c-border bg-c-hover-bg text-c-text-tertiary')
        }
      >
        {loading ? t('subscriptions.starting_checkout') : t('subscriptions.continue_checkout')}
      </button>

      {communities !== null && communities.length === 0 ? (
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center rounded-2xl border border-c-border px-4 py-3 font-bold text-c-text-secondary active:bg-c-active-bg"
        >
          {t('subscriptions.create_community')}
        </button>
      ) : null}
    </div>
  )
}
