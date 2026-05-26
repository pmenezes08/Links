import { useTranslation } from 'react-i18next'
import { openExternalBillingUrl, providerLabel, type StoreProvider } from '../../utils/mobileStoreBilling'
import { PanelCard } from '../settings/SettingsSection'
import SubscriptionLegalLinks from './SubscriptionLegalLinks'
import { formatEur } from './subscriptionFormatters'
import type { PremiumPayload } from './subscriptionTypes'

type PersonalPlanPanelProps = {
  payload: PremiumPayload
  onSubscribe: () => void
  loading: boolean
  storeProvider: StoreProvider | null
  storeProductAvailable: boolean
  iapDisabledOnNative?: boolean
  iapProductionGrantsEnabled?: boolean
  webBillingUrl?: string
  onRestore: () => void
  restoreLoading: boolean
}

export default function PersonalPlanPanel({
  payload,
  onSubscribe,
  loading,
  storeProvider,
  storeProductAvailable,
  iapDisabledOnNative,
  iapProductionGrantsEnabled,
  webBillingUrl,
  onRestore,
  restoreLoading,
}: PersonalPlanPanelProps) {
  const { t } = useTranslation()
  const disabled =
    (!payload.purchasable && !storeProductAvailable)
    || loading
    || restoreLoading
    || !!iapDisabledOnNative
  const ctaLabel =
    storeProvider && storeProductAvailable
      ? t('subscriptions.subscribe_with_provider', { provider: providerLabel(storeProvider) })
      : payload.cta_label
  const earlyMonths = payload.early_adoption_duration_months ?? 3
  const standardNum = Number(payload.price_eur)
  const earlyNum = Number(payload.early_price_eur)
  const showEarlyOffer =
    payload.early_price_eur != null
    && payload.early_price_eur !== ''
    && Number.isFinite(earlyNum)
    && earlyNum > 0
    && (!Number.isFinite(standardNum) || earlyNum !== standardNum)

  return (
    <div className="space-y-4">
      <PanelCard>
        <div className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/28">
            {t('subscriptions.card_personal')}
          </div>
          <div className="mt-2 text-xl font-bold text-white">{payload.name}</div>
          <p className="mt-2 text-sm text-white/45">{payload.tagline}</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{formatEur(payload.price_eur)}</span>
            <span className="text-sm text-white/45">{t('subscriptions.per_month')}</span>
          </div>
          {showEarlyOffer ? (
            <p className="mt-2 text-sm font-medium text-[#4db6ac]">
              {t('subscriptions.early_offer', {
                price: formatEur(payload.early_price_eur),
                months: earlyMonths,
              })}
            </p>
          ) : null}
          {storeProvider && showEarlyOffer ? (
            <p className="mt-1 text-xs text-white/45">{t('subscriptions.early_offer_checkout_hint')}</p>
          ) : null}
        </div>
      </PanelCard>

      {payload.features.length > 0 ? (
        <PanelCard>
          <ul className="divide-y divide-white/[0.055]">
            {payload.features.slice(0, 5).map(feature => (
              <li key={feature} className="flex items-start gap-3 px-4 py-3 text-sm text-white/80">
                <i className="fa-solid fa-check mt-0.5 text-xs text-[#4db6ac]" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </PanelCard>
      ) : null}

      <SubscriptionLegalLinks />

      <button
        type="button"
        onClick={onSubscribe}
        disabled={disabled}
        className={
          'flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold active:opacity-80 ' +
          (disabled
            ? 'cursor-not-allowed border border-white/15 bg-white/5 text-white/40'
            : 'bg-[#4db6ac] text-black')
        }
      >
        {loading ? t('subscriptions.starting_checkout') : ctaLabel}
      </button>

      {storeProvider && storeProductAvailable ? (
        <button
          type="button"
          onClick={onRestore}
          disabled={restoreLoading}
          className="w-full text-center text-xs font-semibold text-[#4db6ac] active:opacity-70 disabled:text-white/35"
        >
          {restoreLoading
            ? t('subscriptions.restoring')
            : t('subscriptions.restore_purchases', { provider: providerLabel(storeProvider) })}
        </button>
      ) : null}

      {iapDisabledOnNative && webBillingUrl ? (
        <button
          type="button"
          onClick={() => openExternalBillingUrl(webBillingUrl)}
          className="block w-full text-left text-xs text-[#4db6ac] underline"
        >
          {t('subscriptions.open_web_billing', { url: webBillingUrl })}
        </button>
      ) : null}

      {storeProvider && storeProductAvailable && iapProductionGrantsEnabled === false && !iapDisabledOnNative ? (
        <p className="text-xs text-white/45">{t('subscriptions.iap_sandbox_review_notice')}</p>
      ) : null}

      {!payload.purchasable && !iapDisabledOnNative ? (
        <p className="text-xs text-white/40">
          {storeProductAvailable
            ? t('subscriptions.store_billing_available', { provider: providerLabel(storeProvider!) })
            : t('subscriptions.stripe_price_pending')}
        </p>
      ) : null}
    </div>
  )
}
