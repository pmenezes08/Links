/**
 * Characterization tests for `OnboardingChat.tsx`.
 *
 * These pin down the observable boot behavior of the three modes (fresh
 * without community, fresh invited, section_only) plus the SAFETY-CRITICAL
 * section-only sanitize rule for `/api/onboarding/state` saves, so the
 * stage-config extraction can be verified as behavior-preserving. Copy is
 * asserted against the real en catalog (same convention as
 * `onboardingChatHelpers.test.ts`); fetch is mocked per-test (same
 * convention as `SubscriptionPlans.test.tsx`).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

import OnboardingChat from './OnboardingChat'
import onboardingChatEn from '../locales/onboarding-chat/en.json'

type RecordedRequest = { url: string; method: string; body: unknown }

function installFetchMock(overrides: Record<string, unknown> = {}) {
  const requests: RecordedRequest[] = []
  const defaults: Record<string, unknown> = {
    '/api/onboarding/tier_hints': { success: true, hints: {} },
    '/api/onboarding/state': { success: true, state: null },
    '/api/profile_me': { success: true, profile: null },
    ...overrides,
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    let body: unknown = null
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    requests.push({ url, method: (init?.method || 'GET').toUpperCase(), body })
    const path = Object.keys(defaults).find(p => url.includes(p))
    const payload = path ? defaults[path] : { success: true }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, requests }
}

function baseProps() {
  return {
    firstName: 'Ana',
    lastName: 'Silva',
    username: 'ana',
    displayName: 'Ana Silva',
    communityName: null as string | null,
    hasCommunity: false,
    existingProfilePic: '',
    onComplete: vi.fn(),
    onCreateCommunity: vi.fn(),
    onGoToCommunity: vi.fn(),
    onExit: vi.fn(),
  }
}

// Steve replies are paced (up to ~1.2s incl. jitter) — wait generously;
// CI machines under parallel-suite load need extra headroom.
const STEVE_WAIT = { timeout: 8000 }

describe('OnboardingChat characterization', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('fresh mode without a community opens with the intent fork from the en catalog', async () => {
    installFetchMock()
    render(<OnboardingChat {...baseProps()} mode="fresh" />)

    await waitFor(() => {
      expect(screen.getByText(/I'm Steve\. Great to meet you\./)).toBeInTheDocument()
    }, STEVE_WAIT)
    // The intent question is interpolated into the intent_fork message.
    expect(screen.getByText(new RegExp(onboardingChatEn.copy.intent_question))).toBeInTheDocument()
    // Both fork options render.
    expect(screen.getByText(onboardingChatEn.options.intent_b2c)).toBeInTheDocument()
    expect(screen.getByText(onboardingChatEn.options.intent_b2b)).toBeInTheDocument()
  })

  it('fresh mode with a communityName opens with the invited welcome', async () => {
    installFetchMock()
    render(<OnboardingChat {...baseProps()} communityName="Acme Runners" hasCommunity mode="fresh" />)

    await waitFor(() => {
      expect(screen.getByText(/I see you were invited to Acme Runners/)).toBeInTheDocument()
    }, STEVE_WAIT)
    expect(screen.getByText(onboardingChatEn.options.lets_go)).toBeInTheDocument()
  })

  it("section_only mode targeting 'professional' opens with the professional section intro", async () => {
    installFetchMock({
      '/api/profile_me': {
        success: true,
        profile: {
          first_name: 'Ana',
          last_name: 'Silva',
          personal: {},
          professional: {},
        },
      },
    })
    render(<OnboardingChat {...baseProps()} mode="section_only" targetSection="professional" />)

    await waitFor(() => {
      expect(screen.getByText(/Let's build your Professional Identity/)).toBeInTheDocument()
    }, STEVE_WAIT)
    expect(screen.getByText(onboardingChatEn.options.start_professional_section)).toBeInTheDocument()
  })

  it("section_only save payload omits the sibling section's completion flag and blank answers", async () => {
    const { requests } = installFetchMock({
      '/api/profile_me': {
        success: true,
        profile: {
          first_name: 'Ana',
          last_name: 'Silva',
          personal: {},
          professional: {},
        },
      },
    })
    render(<OnboardingChat {...baseProps()} mode="section_only" targetSection="professional" />)

    const startBtn = await screen.findByText(
      onboardingChatEn.options.start_professional_section,
      undefined,
      STEVE_WAIT,
    )
    fireEvent.click(startBtn)

    await waitFor(() => {
      const saves = requests.filter(r => r.url.includes('/api/onboarding/state') && r.method === 'POST')
      expect(saves.length).toBeGreaterThan(0)
    }, STEVE_WAIT)

    const save = requests.filter(r => r.url.includes('/api/onboarding/state') && r.method === 'POST').pop()!
    const body = save.body as { stage: string; collected: Record<string, unknown> }
    expect(body.stage).toBe('professional')
    // The sibling (personal) section is locally faked as complete so the flow
    // skips it — that must never reach the server.
    expect('personalSectionComplete' in body.collected).toBe(false)
    // Blank personal answers are stripped so the merge can't blank saved ones.
    for (const key of ['talkAllDay', 'reachOut', 'journey', 'recommend']) {
      expect(key in body.collected).toBe(false)
    }
    // The target section's own flag still travels.
    expect(body.collected.professionalSectionComplete).toBe(false)
  })
})
