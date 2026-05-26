import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsRow from '../settings/SettingsRow'
import { SettingsDivider, SettingsSection, PanelCard } from '../settings/SettingsSection'
import { providerBadge } from '../../utils/mobileStoreBilling'
import {
  communityStripeHealthy,
  benefitsCopy,
  communitySubtitleCommunity,
  formatEur,
  hubPriceSubtitle,
  renewalCopy,
  tierLabel,
} from './subscriptionFormatters'
import { SALES_EMAIL } from './subscriptionConstants'
import type {
  ActiveSubscriptionsPayload,
  CommunityTierPayload,
  PremiumPayload,
  SubscriptionsPanelKey,
} from './subscriptionTypes'

type SubscriptionsHomeProps = {
  premium: PremiumPayload
  communityTier: CommunityTierPayload
  active: ActiveSubscriptionsPayload | null
  activePanel: SubscriptionsPanelKey | null
  showTestBanner: boolean
  ownerIntroFeedReturnId: number | null
  onOpenPanel: (panel: SubscriptionsPanelKey) => void
  onManagePersonal: () => void
  onManageCommunity: (communityId: number) => void
  onOwnerIntroContinue: () => void
}

export default function SubscriptionsHome({
  premium,
  communityTier,
  active,
  activePanel,
  showTestBanner,
  ownerIntroFeedReturnId,
  onOpenPanel,
  onManagePersonal,
  onManageCommunity,
  onOwnerIntroContinue,
}: SubscriptionsHomeProps) {
  const { t } = useTranslation()

  const personal = active?.personal
  const communities = active?.communities || []
  const personalSpecial = !!personal?.is_special
  const personalHealthy = personalSpecial || !!(personal?.subscription_active ?? personal?.active)
  const personalNeedsAttention = !!personal?.needs_attention && !personalSpecial
  const healthyCommunities = communities.filter(c => communityStripeHealthy(c))
  const needsCommunities = communities.filter(c => !communityStripeHealthy(c))

  const yourPlanRows = useMemo(() => {
    const rows: Array<{
      key: string
      icon: string
      title: string
      subtitle: string
      danger?: boolean
      badge?: ReactNode
      onClick: () => void
    }> = []

    if (personalHealthy) {
      rows.push({
        key: 'personal-active',
        icon: 'fa-solid fa-crown',
        title: personal?.is_special
          ? t('subscriptions.special_premium_title')
          : t('subscriptions.premium_membership_title'),
        subtitle: personal?.cancel_at_period_end
          ? benefitsCopy(personal.benefits_end_at || personal.current_period_end)
          : renewalCopy(personal?.current_period_end),
        badge: personal?.subscription_provider ? (
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/60">
            {providerBadge(personal.subscription_provider)}
          </span>
        ) : null,
        onClick: onManagePersonal,
      })
    }

    if (personalNeedsAttention) {
      rows.push({
        key: 'personal-attention',
        icon: 'fa-solid fa-triangle-exclamation',
        title: t('subscriptions.premium_membership_title'),
        subtitle:
          personal?.subscription_status === 'past_due'
            ? t('subscriptions.personal_past_due')
            : t('subscriptions.personal_billing_attention'),
        danger: true,
        onClick: onManagePersonal,
      })
    }

    for (const community of healthyCommunities) {
      rows.push({
        key: `community-${community.id}`,
        icon: 'fa-solid fa-people-group',
        title: community.name,
        subtitle: communitySubtitleCommunity(community),
        badge: (
          <span className="rounded-full bg-[#4db6ac]/12 px-3 py-1 text-xs font-bold text-[#4db6ac]">
            {tierLabel(community.tier || community.subscription_status)}
          </span>
        ),
        onClick: () => onManageCommunity(community.id),
      })
    }

    for (const community of needsCommunities) {
      rows.push({
        key: `community-need-${community.id}`,
        icon: 'fa-solid fa-triangle-exclamation',
        title: community.name,
        subtitle: community.steve_addon_message || communitySubtitleCommunity(community),
        danger: true,
        badge: (
          <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200/90">
            {tierLabel(community.tier || community.subscription_status)}
          </span>
        ),
        onClick: () => onManageCommunity(community.id),
      })
    }

    return rows
  }, [
    healthyCommunities,
    needsCommunities,
    onManageCommunity,
    onManagePersonal,
    personal,
    personalHealthy,
    personalNeedsAttention,
    t,
  ])

  const communityFromPrice = useMemo(() => {
    const prices = communityTier.tiers.map(tier => Number(tier.price_eur)).filter(n => !Number.isNaN(n))
    if (!prices.length) return t('subscriptions.price_tbd')
    return t('subscriptions.hub_from_price', { price: formatEur(Math.min(...prices)) })
  }, [communityTier.tiers, t])

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-5 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-4">
      <h1 className="text-center text-xl font-bold tracking-[-0.02em] text-white">
        {t('subscriptions.hub_title')}
      </h1>

      {showTestBanner ? (
        <p className="mt-4 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300/80">
          {t('subscriptions.test_mode_banner')}
        </p>
      ) : null}

      {ownerIntroFeedReturnId != null ? (
        <PanelCard>
          <div className="p-4">
            <p className="text-sm text-white/75">{t('subscriptions.owner_intro_body')}</p>
            <button
              type="button"
              onClick={onOwnerIntroContinue}
              className="mt-3 flex w-full items-center justify-center rounded-2xl bg-[#4db6ac] px-4 py-3 font-bold text-black active:opacity-80"
            >
              {t('subscriptions.owner_intro_cta')}
            </button>
          </div>
        </PanelCard>
      ) : null}

      <div className={`space-y-7 ${ownerIntroFeedReturnId != null ? 'mt-6' : 'mt-9'}`}>
        {yourPlanRows.length > 0 ? (
          <SettingsSection title={t('subscriptions.section_your_plans')}>
            {yourPlanRows.map((row, index) => (
              <div key={row.key}>
                {index > 0 ? <SettingsDivider /> : null}
                <SettingsRow
                  icon={row.icon}
                  title={row.title}
                  subtitle={row.subtitle}
                  badge={row.badge}
                  danger={row.danger}
                  active={false}
                  onClick={row.onClick}
                />
              </div>
            ))}
          </SettingsSection>
        ) : null}

        <SettingsSection title={t('subscriptions.section_get_plan')}>
          <SettingsRow
            icon="fa-solid fa-crown"
            title={premium.name}
            subtitle={hubPriceSubtitle(premium.price_eur)}
            active={activePanel === 'personalPlan'}
            onClick={() => onOpenPanel('personalPlan')}
          />
          <SettingsDivider />
          <SettingsRow
            icon="fa-solid fa-people-group"
            title={communityTier.name}
            subtitle={communityFromPrice}
            active={activePanel === 'communityTiers' || activePanel === 'communityPicker'}
            onClick={() => onOpenPanel('communityTiers')}
          />
          <SettingsDivider />
          <SettingsRow
            icon="fa-solid fa-robot"
            title={t('subscriptions.addons_title')}
            subtitle={t('subscriptions.addons_subtitle')}
            active={activePanel === 'addons' || activePanel === 'stevePicker'}
            onClick={() => onOpenPanel('addons')}
          />
        </SettingsSection>

        <SettingsSection title={t('subscriptions.section_help')}>
          <a
            href={`mailto:${SALES_EMAIL}`}
            className="group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors active:bg-white/[0.08]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/[0.05] text-white/75">
              <i className="fa-solid fa-envelope text-sm" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-white">
                {t('subscriptions.hub_contact_sales')}
              </span>
              <span className="mt-0.5 block truncate text-sm text-white/45">{SALES_EMAIL}</span>
            </span>
            <i className="fa-solid fa-chevron-right text-xs text-white/22" />
          </a>
        </SettingsSection>
      </div>
    </div>
  )
}
