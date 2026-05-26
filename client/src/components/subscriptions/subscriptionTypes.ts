export interface PremiumPayload {
  sku: 'premium'
  name: string
  tagline: string
  price_eur: number | string | null
  early_price_eur?: number | string | null
  early_adoption_duration_months?: number | null
  billing_cycle: string
  currency: string
  features: string[]
  cta_label: string
  stripe_mode: 'test' | 'live'
  stripe_price_id: string
  purchasable: boolean
}

export interface CommunityTierLevel {
  tier_code: 'paid_l1' | 'paid_l2' | 'paid_l3'
  level_label: string
  price_eur: number | string | null
  max_members: number | null
  media_gb: number | null
  stripe_price_id: string
  purchasable: boolean
}

export interface CommunityTierPayload {
  sku: 'community_tier'
  name: string
  tagline: string
  billing_cycle: string
  currency: string
  tiers: CommunityTierLevel[]
  cta_label: string
  stripe_mode: 'test' | 'live'
}

export interface NetworkingComingSoonPayload {
  sku: 'networking_package'
  name: string
  tagline: string
  price_eur: number | string | null
  billing_cycle: string
  currency: string
  features: string[]
  purchasable: false
  coming_soon: true
  stripe_mode: 'test' | 'live'
  stripe_price_id: string
}

export interface StevePackagePayload {
  sku: 'steve_package'
  name: string
  tagline: string
  price_eur: number | string | null
  billing_cycle: string
  currency: string
  features?: string[]
  credit_pool?: number | null
  purchasable: boolean
  coming_soon?: boolean
  stripe_mode: 'test' | 'live'
  stripe_price_id: string
}

export interface PricingPayload {
  success: boolean
  stripe_mode: 'test' | 'live'
  show_stripe_test_banner?: boolean
  publishable_key_available: boolean
  sku: {
    premium: PremiumPayload
    community_tier: CommunityTierPayload
    steve_package: StevePackagePayload
    networking: NetworkingComingSoonPayload
  }
}

export interface Community {
  id: number
  name: string
  creator_username?: string
  role?: string
  tier?: string
}

export interface ActivePersonalSubscription {
  active: boolean
  subscription_active?: boolean
  needs_attention?: boolean
  renewal_date_status?: string
  subscription?: string
  subscription_status?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  benefits_end_at?: string | null
  is_special?: boolean
  subscription_provider?: string | null
}

export interface ActiveCommunitySubscription {
  id: number
  name: string
  tier?: string
  subscription_status?: string | null
  stripe_subscription_id?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  benefits_end_at?: string | null
  steve_package_subscription_active?: boolean
  needs_attention?: boolean
  renewal_date_status?: string
  tier_subscription_active?: boolean
  tier_subscription_live?: boolean
  steve_addon_eligible?: boolean
  steve_addon_reason?: string
  steve_addon_message?: string
  billing_provider?: string | null
}

export interface ActiveSubscriptionsPayload {
  success: boolean
  error?: string
  personal: ActivePersonalSubscription
  communities: ActiveCommunitySubscription[]
}

export type SubscriptionsPanelKey =
  | 'personalPlan'
  | 'communityTiers'
  | 'communityPicker'
  | 'addons'
  | 'stevePicker'

export const PENDING_CHECKOUT_KEY = 'cpoint_pending_subscription_checkout'
