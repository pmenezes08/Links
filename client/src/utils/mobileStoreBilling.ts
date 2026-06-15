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
    steve_product_id?: string
  }
  google: {
    premium_product_id: string
    community_product_ids: Record<string, string>
    steve_product_id?: string
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
  if (provider === 'google' && Capacitor.getPlatform() === 'ios') return 'store billing'
  if (provider === 'google') return 'Google Play'
  if (provider === 'stripe') return 'Web billing'
  return 'Billing'
}

export function providerBadge(provider: StoreProvider | 'stripe' | string | null | undefined): string {
  if (provider === 'apple') return 'App Store'
  if (provider === 'google' && Capacitor.getPlatform() === 'ios') return 'Store billing'
  if (provider === 'google') return 'Google Play'
  return 'Web billing'
}

/** True when KB allows production IAP grants and native subscribe CTAs should be active. */
export function nativeIapPurchasesEnabled(config: IapConfig | null | undefined): boolean {
  return !!config?.iap_purchases_enabled
}

/** Native store IAP checkout can start (platform + configured product id). */
export function canUseNativeStoreIap(
  provider: StoreProvider | null,
  _config: IapConfig | null | undefined,
  productId: string | undefined | null,
): boolean {
  return !!(provider && productId)
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

/** Restore outcome the subscriptions UI maps to copy — never a raw backend code. */
export type RestoreReason = 'restored' | 'no_purchase' | 'account_mismatch' | 'transient'
export interface RestoreOutcome {
  count: number
  reason: RestoreReason
}

interface StoreEntitlement {
  transactionId: string
  productId: string
  jwsRepresentation?: string
  originalTransactionId?: string
}

// `getCurrentEntitlements` is added to the native plugin via a patch-package
// patch (client/patches/@capgo+native-purchases+6.0.42.patch). Cast so the web
// build type-checks even if the postinstall hook is skipped — the method only
// runs on a native iOS/Android build where the patch is compiled in.
const NativePurchasesExt = NativePurchases as typeof NativePurchases & {
  getCurrentEntitlements?: () => Promise<{ entitlements: StoreEntitlement[] }>
}

function mapRestoreReason(raw: unknown): RestoreReason {
  if (raw === 'account_mismatch' || raw === 'no_purchase' || raw === 'transient') return raw
  return 'transient'
}

export async function restoreStorePurchases(
  provider: StoreProvider,
  config: IapConfig,
): Promise<RestoreOutcome> {
  // 1) Refresh StoreKit so currentEntitlements reflects this store account.
  await NativePurchases.restorePurchases().catch(() => undefined)

  // 2) Read the verified active entitlements (real transaction id + signed JWS).
  const providerConfig = config[provider]
  const known = new Set<string>(
    [
      providerConfig.premium_product_id,
      providerConfig.steve_product_id || '',
      ...Object.values(providerConfig.community_product_ids || {}),
    ].filter(Boolean),
  )
  let entitlements: StoreEntitlement[] = []
  try {
    const res = await NativePurchasesExt.getCurrentEntitlements?.()
    entitlements = (res?.entitlements || []).filter((e) => e && known.has(e.productId))
  } catch {
    entitlements = []
  }
  if (entitlements.length === 0) return { count: 0, reason: 'no_purchase' }

  // 3) Hand the verified transactions to the backend for re-linking + grant.
  const transactions = entitlements.map((e) => ({
    product_id: e.productId,
    purchase_key: e.transactionId,
    signed_payload: e.jwsRepresentation,
  }))
  const res = await fetch(`/api/iap/${provider}/restore`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ transactions }),
  })
  const data = await res.json().catch(() => null)
  if (res.ok && data?.success) {
    return { count: Number(data.restored_count || transactions.length), reason: 'restored' }
  }
  return { count: 0, reason: mapRestoreReason(data?.reason) }
}

export function openExternalBillingUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
