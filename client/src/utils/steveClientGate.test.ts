import { describe, expect, it } from 'vitest'
import type { EntitlementsSnapshot } from '../hooks/useEntitlements'
import {
  buildClientPremiumRequiredError,
  isSteveDmPeer,
  mentionsSteve,
  shouldClientBlockSteveIntent,
} from './steveClientGate'

function ent(partial: Partial<EntitlementsSnapshot> & { can_use_steve: boolean }): EntitlementsSnapshot {
  return partial as EntitlementsSnapshot
}

describe('steveClientGate', () => {
  it('mentionsSteve detects word boundary', () => {
    expect(mentionsSteve('@Steve hi')).toBe(true)
    expect(mentionsSteve('hey @steve')).toBe(true)
    expect(mentionsSteve('  @steve  ')).toBe(true)
    expect(mentionsSteve('hello')).toBe(false)
    expect(mentionsSteve('@steven')).toBe(false)
  })

  it('isSteveDmPeer', () => {
    expect(isSteveDmPeer('Steve')).toBe(true)
    expect(isSteveDmPeer('steve')).toBe(true)
    expect(isSteveDmPeer('bob')).toBe(false)
  })

  it('buildClientPremiumRequiredError shape', () => {
    const err = buildClientPremiumRequiredError()
    expect(err.success).toBe(false)
    expect(err.error).toBe('entitlements_error')
    expect(err.reason).toBe('premium_required')
    expect(err.cta.url).toBe('/subscription_plans?mode=choose')
    expect(err.usage.monthly_steve_used).toBeNull()
  })

  it('shouldClientBlockSteveIntent: enforcement off never blocks', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: false,
        loading: false,
        entitlements: ent({ can_use_steve: false }),
        isSteveDm: true,
        text: '',
      }),
    ).toBe(false)
  })

  it('shouldClientBlockSteveIntent: loading blocks steve intent', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: true,
        loading: true,
        entitlements: ent({ can_use_steve: true }),
        isSteveDm: true,
        text: '',
      }),
    ).toBe(true)
  })

  it('shouldClientBlockSteveIntent: no intent never blocks', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: true,
        loading: false,
        entitlements: ent({ can_use_steve: false }),
        isSteveDm: false,
        text: 'hello',
      }),
    ).toBe(false)
  })

  it('shouldClientBlockSteveIntent: Steve DM without entitlement', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: true,
        loading: false,
        entitlements: ent({ can_use_steve: false }),
        isSteveDm: true,
        text: '',
      }),
    ).toBe(true)
  })

  it('shouldClientBlockSteveIntent: @Steve text without entitlement', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: true,
        loading: false,
        entitlements: ent({ can_use_steve: false }),
        isSteveDm: false,
        text: '@steve help',
      }),
    ).toBe(true)
  })

  it('shouldClientBlockSteveIntent: community @Steve mention defers to backend pool gate', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: true,
        loading: false,
        entitlements: ent({ can_use_steve: false }),
        isSteveDm: false,
        hasCommunityContext: true,
        text: '@steve help',
      }),
    ).toBe(false)
  })

  it('shouldClientBlockSteveIntent: premium allows Steve DM', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: true,
        loading: false,
        entitlements: ent({ can_use_steve: true }),
        isSteveDm: true,
        text: '',
      }),
    ).toBe(false)
  })

  it('shouldClientBlockSteveIntent: null entitlements blocks intent', () => {
    expect(
      shouldClientBlockSteveIntent({
        enforcement_enabled: true,
        loading: false,
        entitlements: null,
        isSteveDm: false,
        text: '@Steve',
      }),
    ).toBe(true)
  })
})
