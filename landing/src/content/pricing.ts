/**
 * Public pricing anchors for the community-owner landing page.
 *
 * Source of truth: backend/services/knowledge_base.py, `community-tiers`.
 * Keep this summary in sync when the KB prices, member caps, credit pool, or
 * trial terms change. Deliberately excludes KB fields marked `tbd`.
 */

export type CommunityPlan = {
  id: "free" | "paid_l1" | "paid_l2" | "paid_l3" | "enterprise";
  priceEurMonthly: number | null;
  maxMembers: number | null;
};

export const COMMUNITY_PLANS: readonly CommunityPlan[] = [
  { id: "free", priceEurMonthly: 0, maxMembers: 25 },
  { id: "paid_l1", priceEurMonthly: 49.99, maxMembers: 75 },
  { id: "paid_l2", priceEurMonthly: 99.99, maxMembers: 150 },
  { id: "paid_l3", priceEurMonthly: 189.99, maxMembers: 250 },
  { id: "enterprise", priceEurMonthly: null, maxMembers: null },
] as const;

export const COMMUNITY_TRIAL_DAYS = 14;

export const STEVE_COMMUNITY_PACKAGE = {
  priceEurMonthly: 49.99,
  monthlyCredits: 200,
  trialDays: 14,
  requiresPaidCommunity: true,
} as const;
