/**
 * Unit tests for the native store billing helpers.
 *
 * The load-bearing invariant: `canUseNativeStoreIap` must honor the KB
 * `iap_purchases_enabled` flag from `/api/iap/config`. When the flag is off
 * (or the config failed to load) every native purchase CTA has to degrade to
 * an informational state — never fall through to a live store purchase or a
 * web checkout link (App Store 3.1.1).
 */

import { describe, it, expect } from 'vitest'
import {
  canUseNativeStoreIap,
  nativeIapPurchasesEnabled,
  type IapConfig,
} from './mobileStoreBilling'

function makeConfig(enabled: boolean): IapConfig {
  return {
    success: true,
    iap_purchases_enabled: enabled,
    web_app_billing_url: 'https://app.c-point.co/subscription_plans',
    apple: {
      premium_product_id: 'cpoint_premium_monthly',
      community_product_ids: { paid_l1: 'cpoint_community_l1_monthly' },
      steve_product_id: 'cpoint_steve_community_monthly',
    },
    google: {
      premium_product_id: 'cpoint_premium_monthly',
      community_product_ids: { paid_l1: 'cpoint_community_l1_monthly' },
      steve_product_id: 'cpoint_steve_community_monthly',
    },
  }
}

describe('nativeIapPurchasesEnabled', () => {
  it('is false for a missing config', () => {
    expect(nativeIapPurchasesEnabled(null)).toBe(false)
    expect(nativeIapPurchasesEnabled(undefined)).toBe(false)
  })

  it('mirrors the iap_purchases_enabled flag', () => {
    expect(nativeIapPurchasesEnabled(makeConfig(false))).toBe(false)
    expect(nativeIapPurchasesEnabled(makeConfig(true))).toBe(true)
  })
})

describe('canUseNativeStoreIap', () => {
  it('allows checkout with provider + product id + purchases enabled', () => {
    expect(canUseNativeStoreIap('apple', makeConfig(true), 'cpoint_premium_monthly')).toBe(true)
    expect(canUseNativeStoreIap('google', makeConfig(true), 'cpoint_community_l1_monthly')).toBe(true)
  })

  it('blocks checkout when iap_purchases_enabled is off', () => {
    expect(canUseNativeStoreIap('apple', makeConfig(false), 'cpoint_premium_monthly')).toBe(false)
    expect(canUseNativeStoreIap('google', makeConfig(false), 'cpoint_community_l1_monthly')).toBe(false)
  })

  it('blocks checkout when the config never loaded', () => {
    expect(canUseNativeStoreIap('apple', null, 'cpoint_premium_monthly')).toBe(false)
    expect(canUseNativeStoreIap('apple', undefined, 'cpoint_premium_monthly')).toBe(false)
  })

  it('blocks checkout without a provider or product id', () => {
    expect(canUseNativeStoreIap(null, makeConfig(true), 'cpoint_premium_monthly')).toBe(false)
    expect(canUseNativeStoreIap('apple', makeConfig(true), '')).toBe(false)
    expect(canUseNativeStoreIap('apple', makeConfig(true), undefined)).toBe(false)
  })
})
