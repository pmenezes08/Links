import { useTranslation } from 'react-i18next'
import { providerLabel, type StoreProvider } from '../../utils/mobileStoreBilling'
import { PanelCard } from '../settings/SettingsSection'
import SubscriptionLegalLinks from './SubscriptionLegalLinks'
import { formatEur } from './subscriptionFormatters'
import type { PremiumPayload } from './subscriptionTypes'

type PersonalPlanPanelProps = {
  payload: PremiumPayload
  onSubscribe: () => void
  loading: boolean
  storeProvider: StoreProvider | null
  /** Provider of the user's existing personal subscription (stripe/apple/google), if any. */
  personalBillingProvider?: string | null
  onRestore: () => void
  restoreLoading: boolean
}

export default function PersonalPlanPanel({
  payload,
  onSubscribe,
  loading,
  storeProvider,
  personalBillingProvider,
  onRestore,
  restoreLoading,
}: PersonalPlanPanelProps) {
  const { t } = useTranslation()
  // `cpoint_premium_monthly` is removed from sale in the app stores
  // (July 2026): on native this panel is manage/restore only — no live
  // purchase CTA and no external checkout link (App Store 3.1.1).
  const isNative = storeProvider != null
  const disabled = !payload.purchasable || loading || restoreLoading
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
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-c-text-tertiary">
            {t('subscriptions.card_personal')}
          </div>
          <div className="mt-2 text-xl font-bold text-c-text-primary">{payload.name}</div>
          <p className="mt-2 text-sm text-c-text-tertiary">{payload.tagline}</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-c-text-primary">{formatEur(payload.price_eur)}</span>
            <span className="text-sm text-c-text-tertiary">{t('subscriptions.per_month')}</span>
          </div>
          {showEarlyOffer ? (
            <p className="mt-2 text-sm font-medium text-cpoint-turquoise">
              {t('subscriptions.early_offer', {
                price: formatEur(payload.early_price_eur),
                months: earlyMonths,
              })}
            </p>
          ) : null}
        </div>
      </PanelCard>

      {payload.features.length > 0 ? (
        <PanelCard>
          <ul className="divide-y divide-c-border">
            {payload.features.slice(0, 5).map(feature => (
              <li key={feature} className="flex items-start gap-3 px-4 py-3 text-sm text-c-text-secondary">
                <i className="fa-solid fa-check mt-0.5 text-xs text-cpoint-turquoise" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </PanelCard>
      ) : null}

      <SubscriptionLegalLinks />

      {!isNative ? (
        <button
          type="button"
          onClick={onSubscribe}
          disabled={disabled}
          className={
            'flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold active:opacity-80 ' +
            (disabled
              ? 'cursor-not-allowed border border-c-border bg-c-hover-bg text-c-text-tertiary'
              : 'bg-cpoint-turquoise text-black')
          }
        >
          {loading ? t('subscriptions.starting_checkout') : payload.cta_label}
        </button>
      ) : (
        // Informational only — plain text, no tappable external checkout link.
        <p className="text-xs text-c-text-tertiary">
          {personalBillingProvider === 'stripe'
            ? t('subscriptions.premium_native_managed_web')
            : t('subscriptions.premium_native_unavailable')}
        </p>
      )}

      {storeProvider ? (
        <button
          type="button"
          onClick={onRestore}
          disabled={restoreLoading}
          className="w-full text-center text-xs font-semibold text-cpoint-turquoise active:opacity-70 disabled:text-c-text-tertiary"
        >
          {restoreLoading
            ? t('subscriptions.restoring')
            : t('subscriptions.restore_purchases', { provider: providerLabel(storeProvider) })}
        </button>
      ) : null}

      {!isNative && !payload.purchasable ? (
        <p className="text-xs text-c-text-tertiary">{t('subscriptions.stripe_price_pending')}</p>
      ) : null}
    </div>
  )
}
