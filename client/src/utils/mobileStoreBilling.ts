import { Capacitor } from '@capacitor/core'
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases'

export type StoreProvider = 'apple' | 'google'

export interface IapConfig {
  success: boolean
  iap_purchases_enabled: boolean
  web_app_billing_url: string
  apple: {
    premium_product_id: string
    community_product_ids: Record<string, string>
  }
  google: {
    premium_product_id: string
    community_product_ids: Record<string, string>
  }
}

export function currentStoreProvider(): StoreProvider | null {
  if (!Capacitor.isNativePlatform()) return null
  const platform = Capacitor.getPlatform()
  if (platform === 'ios') return 'apple'
  if (platform === 'android') return 'google'
  return null
}

export function providerLabel(provider: StoreProvider | string | null | undefined): string {
  if (provider === 'apple') return 'App Store'
  if (provider === 'google') return 'Google Play'
  if (provider === 'stripe') return 'Web billing'
  return 'Billing'
}

export function providerBadge(provider: StoreProvider | 'stripe' | string | null | undefined): string {
  if (provider === 'apple') return 'App Store'
  if (provider === 'google') return 'Google Play'
  return 'Web billing'
}

/** True when KB allows production IAP grants and native subscribe CTAs should be active. */
export function nativeIapPurchasesEnabled(config: IapConfig | null | undefined): boolean {
  return !!config?.iap_purchases_enabled
}

/** Native store IAP product flow is available (platform + product id + KB flag). */
export function canUseNativeStoreIap(
  provider: StoreProvider | null,
  config: IapConfig | null | undefined,
  productId: string | undefined | null,
): boolean {
  if (!provider || !productId) return false
  return nativeIapPurchasesEnabled(config)
}

export async function loadIapConfig(): Promise<IapConfig | null> {
  const res = await fetch('/api/iap/config', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.success) return null
  return data as IapConfig
}

export async function purchaseStoreSubscription(input: {
  provider: StoreProvider
  productId: string
  communityId?: number
}): Promise<void> {
  const support = await NativePurchases.isBillingSupported()
  if (!support.isBillingSupported) {
    throw new Error('In-app purchases are not available on this device.')
  }
  const tx = await NativePurchases.purchaseProduct({
    productIdentifier: input.productId,
    productType: PURCHASE_TYPE.SUBS,
  })
  const transaction = tx as { transactionId?: string; environment?: string; signedPayload?: string }
  const purchaseKey = transaction.transactionId || input.productId
  const res = await fetch(`/api/iap/${input.provider}/confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      product_id: input.productId,
      purchase_key: purchaseKey,
      community_id: input.communityId,
      environment: transaction.environment,
      signed_payload: transaction.signedPayload,
    }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || data?.reason || 'Unable to confirm purchase.')
  }
}

export async function restoreStorePurchases(
  provider: StoreProvider,
  config: IapConfig,
): Promise<number> {
  const restored = await NativePurchases.restorePurchases()
  const providerConfig = config[provider]
  const productIds = new Set<string>([
    providerConfig.premium_product_id,
    ...Object.values(providerConfig.community_product_ids || {}),
  ].filter(Boolean))
  const activeIds = (restored.customerInfo?.activeSubscriptions || [])
    .map((id) => String(id))
    .filter((id) => productIds.has(id))

  let count = 0
  for (const productId of activeIds) {
    const res = await fetch(`/api/iap/${provider}/restore`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        product_id: productId,
        purchase_key: productId,
      }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.success) count += 1
  }
  return count
}

export function openExternalBillingUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
