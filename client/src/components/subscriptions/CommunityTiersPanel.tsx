import { useTranslation } from 'react-i18next'
import { openExternalBillingUrl, providerLabel, type StoreProvider } from '../../utils/mobileStoreBilling'
import SettingsRow from '../settings/SettingsRow'
import { SettingsDivider, PanelCard } from '../settings/SettingsSection'
import SubscriptionLegalLinks from './SubscriptionLegalLinks'
import { formatEur } from './subscriptionFormatters'
import { SALES_EMAIL } from './subscriptionConstants'
import type { CommunityTierLevel, CommunityTierPayload } from './subscriptionTypes'

type CommunityTiersPanelProps = {
  payload: CommunityTierPayload
  storeProvider: StoreProvider | null
  storeProductIds: Record<string, string>
  iapDisabledOnNative?: boolean
  webBillingUrl?: string
  onPickTier: (tier: CommunityTierLevel) => void
  onOpenAddons: () => void
  pendingKey: string | null
  error?: string | null
}

function TierPickRow({
  tier,
  ctaLabel,
  storeProvider,
  storeProductAvailable,
  loading,
  onPick,
}: {
  tier: CommunityTierLevel
  ctaLabel: string
  storeProvider: StoreProvider | null
  storeProductAvailable: boolean
  loading: boolean
  onPick: () => void
}) {
  const { t } = useTranslation()
  const canPurchase = tier.purchasable || storeProductAvailable
  const disabled = !canPurchase || loading
  const label =
    storeProvider && storeProductAvailable
      ? t('subscriptions.subscribe_with_provider', { provider: providerLabel(storeProvider) })
      : ctaLabel
  const subtitle = [
    tier.max_members ? t('subscriptions.tier_members_up_to', { count: tier.max_members }) : t('subscriptions.price_tbd'),
    tier.media_gb ? t('subscriptions.tier_media_gb', { gb: tier.media_gb }) : null,
    `${formatEur(tier.price_eur)}${t('subscriptions.per_month')}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-c-text-primary">
          {t('subscriptions.tier_paid_label', { level: tier.level_label })}
        </div>
        <div className="mt-0.5 text-sm text-c-text-tertiary">{subtitle}</div>
      </div>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        aria-label={canPurchase ? label : t('subscriptions.coming_soon')}
        className={
          'shrink-0 rounded-2xl px-4 py-2 text-xs font-bold active:opacity-80 ' +
          (!canPurchase
            ? 'cursor-not-allowed border border-c-border bg-c-hover-bg text-c-text-tertiary'
            : loading
              ? 'cursor-wait bg-cpoint-turquoise/60 text-black'
              : 'bg-cpoint-turquoise text-black')
        }
      >
        {loading ? t('subscriptions.starting') : canPurchase ? label : t('subscriptions.coming_soon')}
      </button>
    </div>
  )
}

export default function CommunityTiersPanel({
  payload,
  storeProvider,
  storeProductIds,
  iapDisabledOnNative,
  webBillingUrl,
  onPickTier,
  onOpenAddons,
  pendingKey,
  error,
}: CommunityTiersPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <p className="text-sm text-c-text-tertiary">{t('subscriptions.modal_tier_billing_hint')}</p>

      {error ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {iapDisabledOnNative && webBillingUrl ? (
        <button
          type="button"
          onClick={() => openExternalBillingUrl(webBillingUrl)}
          className="block text-left text-sm text-cpoint-turquoise underline"
        >
          {t('subscriptions.open_web_billing', { url: webBillingUrl })}
        </button>
      ) : null}

      <PanelCard>
        {payload.tiers.map((tier, index) => (
          <div key={tier.tier_code}>
            {index > 0 ? <SettingsDivider /> : null}
            <TierPickRow
              tier={tier}
              ctaLabel={payload.cta_label}
              storeProvider={storeProvider}
              storeProductAvailable={!!storeProductIds[tier.tier_code]}
              loading={!!pendingKey && pendingKey.startsWith(`community_tier:${tier.tier_code}`)}
              onPick={() => onPickTier(tier)}
            />
          </div>
        ))}
        <SettingsDivider />
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-c-text-primary">{t('subscriptions.enterprise')}</div>
            <div className="mt-0.5 text-sm text-c-text-tertiary">
              {t('subscriptions.enterprise_members')} · {t('subscriptions.enterprise_custom_pricing')}
            </div>
          </div>
          <a
            href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t('subscriptions.mailto_enterprise_subject'))}`}
            className="shrink-0 rounded-2xl border border-cpoint-turquoise/40 px-4 py-2 text-xs font-bold text-cpoint-turquoise active:bg-cpoint-turquoise/10"
          >
            {t('subscriptions.contact_us')}
          </a>
        </div>
      </PanelCard>

      <SubscriptionLegalLinks />

      <PanelCard>
        <SettingsRow
          icon="fa-solid fa-puzzle-piece"
          title={t('subscriptions.addons_title')}
          subtitle={t('subscriptions.addons_subtitle')}
          onClick={onOpenAddons}
        />
      </PanelCard>
    </div>
  )
}
