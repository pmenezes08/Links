import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { providerLabel, type StoreProvider } from '../../utils/mobileStoreBilling'
import { PanelCard, SettingsDivider } from '../settings/SettingsSection'
import SubscriptionLegalLinks from './SubscriptionLegalLinks'
import { formatEur, priceIsKnown } from './subscriptionFormatters'
import { SALES_EMAIL } from './subscriptionConstants'
import type { NetworkingComingSoonPayload, StevePackagePayload } from './subscriptionTypes'

type AddonsPanelProps = {
  steve: StevePackagePayload
  networking: NetworkingComingSoonPayload
  storeProvider: StoreProvider | null
  steveNativePurchasable: boolean
  onOpenStevePicker: () => void
  steveCheckoutLoading: boolean
}

function AddonDetailRow({
  name,
  tagline,
  price,
  badge,
  action,
}: {
  name: string
  tagline: string
  price: string
  badge: string
  action: ReactNode
}) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-c-text-primary">{name}</div>
          <p className="mt-0.5 text-sm text-c-text-tertiary">{tagline}</p>
          <p className="mt-2 text-sm font-medium text-c-text-secondary">{price}</p>
        </div>
        <span className="shrink-0 rounded-full border border-c-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-c-text-tertiary">
          {badge}
        </span>
      </div>
      <div className="mt-4">{action}</div>
    </div>
  )
}

export default function AddonsPanel({
  steve,
  networking,
  storeProvider,
  steveNativePurchasable,
  onOpenStevePicker,
  steveCheckoutLoading,
}: AddonsPanelProps) {
  const { t } = useTranslation()
  const steveComingSoon = storeProvider ? !steveNativePurchasable : !steve.purchasable || steve.coming_soon

  return (
    <div className="space-y-4">
      <p className="text-sm text-c-text-tertiary">{t('subscriptions.addons_optional')}</p>

      <PanelCard>
        {/* Steve gets a full pitch card (benefits from the i18n catalogs, not
            the payload's English `features`) — the name stays the untranslated
            proper noun "Steve Community Package" from the KB payload. */}
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-c-text-primary">{steve.name}</div>
              <p className="mt-0.5 text-sm text-c-text-tertiary">
                {t('subscriptions.steve_addon_one_liner')}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-c-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-c-text-tertiary">
              {steveComingSoon ? t('subscriptions.coming_soon') : t('subscriptions.live')}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {[
              t('subscriptions.steve_addon_benefit_1'),
              t('subscriptions.steve_addon_benefit_2'),
              t('subscriptions.steve_addon_benefit_3'),
              t('subscriptions.steve_addon_benefit_4'),
            ].map(benefit => (
              <li key={benefit} className="flex items-start gap-2.5 text-sm text-c-text-secondary">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cpoint-turquoise" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-c-text-secondary">
              {`${formatEur(steve.price_eur)}${priceIsKnown(steve.price_eur) ? t('subscriptions.per_month') : ''}`}
            </p>
            <span className="rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-2.5 py-0.5 text-[11px] font-semibold text-cpoint-turquoise">
              {t('subscriptions.steve_trial_pill')}
            </span>
          </div>
          {typeof steve.credit_pool === 'number' && steve.credit_pool > 0 ? (
            <p className="mt-1 text-xs text-c-text-tertiary">
              {t('subscriptions.steve_credit_pool', { count: steve.credit_pool })}
            </p>
          ) : null}
          <div className="mt-4">
            {steveComingSoon ? (
              <a
                href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t('subscriptions.mailto_notify_steve'))}`}
                className="flex w-full items-center justify-center rounded-2xl border border-c-border px-4 py-3 text-sm font-bold text-c-text-primary active:bg-c-active-bg"
              >
                {t('subscriptions.notify_me')}
              </a>
            ) : (
              <button
                type="button"
                disabled={steveCheckoutLoading}
                onClick={onOpenStevePicker}
                className={
                  'flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold active:opacity-80 ' +
                  (steveCheckoutLoading
                    ? 'cursor-wait bg-cpoint-turquoise/60 text-black'
                    : 'bg-cpoint-turquoise text-black')
                }
              >
                {steveCheckoutLoading
                  ? t('subscriptions.starting_checkout')
                  : storeProvider && steveNativePurchasable
                    ? t('subscriptions.subscribe_with_provider', {
                        provider: providerLabel(storeProvider),
                      })
                    : t('subscriptions.steve_addon_cta')}
              </button>
            )}
          </div>
        </div>
        <SettingsDivider />
        <AddonDetailRow
          name={networking.name}
          tagline={networking.tagline}
          price={`${formatEur(networking.price_eur)}${priceIsKnown(networking.price_eur) ? t('subscriptions.per_month') : ''}`}
          badge={t('subscriptions.coming_soon')}
          action={
            <a
              href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t('subscriptions.mailto_notify_networking'))}`}
              className="flex w-full items-center justify-center rounded-2xl border border-c-border px-4 py-3 text-sm font-bold text-c-text-primary active:bg-c-active-bg"
            >
              {t('subscriptions.notify_me')}
            </a>
          }
        />
      </PanelCard>

      <SubscriptionLegalLinks />
    </div>
  )
}
