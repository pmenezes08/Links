import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import OnboardingIntroGate from './OnboardingIntroGate'

function mockIntroFetches(options?: { preferredLocale?: string | null }) {
  const preferred = options?.preferredLocale ?? null
  return vi.fn((url: string | URL, init?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/me/locale')) {
      if (init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, preferred_locale: preferred }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, preferred_locale: preferred }),
      })
    }
    if (path.includes('/api/public/onboarding_welcome_video')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, video_url: null }),
      })
    }
    if (path.includes('/api/onboarding/defer_profile')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, profileDeferUntil: '2026-06-08T12:00:00Z' }),
      })
    }
    return Promise.resolve({ ok: false, json: async () => ({}) })
  })
}

async function advancePastLanguageIfNeeded() {
  const languageHeading = screen.queryByRole('heading', {
    name: /choose your preferred language/i,
  })
  if (!languageHeading) return
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Confirm your age' })).toBeInTheDocument()
  })
}

describe('OnboardingIntroGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  async function completeAgeGate() {
    fireEvent.change(screen.getByRole('textbox', { name: /^date of birth$/i }), { target: { value: '05/06/1990' } })
    fireEvent.click(screen.getByLabelText(/I confirm that I am 18 or older/i))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome to C-Point' })).toBeInTheDocument()
    })
  }

  it('shows language step first, then age, welcome and profile setup before starting onboarding', async () => {
    const onStart = vi.fn()
    vi.stubGlobal('fetch', mockIntroFetches({ preferredLocale: null }))

    render(<OnboardingIntroGate onStart={onStart} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /choose your preferred language/i }),
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm your age' })).toBeInTheDocument()
    })
    expect(screen.getByText(/used for age verification/i)).toBeInTheDocument()
    await completeAgeGate()

    expect(screen.getByText(/the world is meant to be lived/i)).toBeInTheDocument()
    expect(screen.queryByText(/C-Point's heart and intelligence/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Build Your Profile' })).toBeInTheDocument()
    expect(screen.getByText(/private communities where people should know who they are talking to/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up your Profile' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('skips the language step when preferred_locale is already saved', async () => {
    const onStart = vi.fn()
    vi.stubGlobal('fetch', mockIntroFetches({ preferredLocale: 'en' }))

    render(<OnboardingIntroGate onStart={onStart} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm your age' })).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('heading', { name: /choose your preferred language/i }),
    ).not.toBeInTheDocument()
  })

  it('accepts compact DDMMYYYY dates from mobile numeric keyboards', async () => {
    vi.stubGlobal('fetch', mockIntroFetches({ preferredLocale: 'en' }))

    render(<OnboardingIntroGate onStart={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm your age' })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByRole('textbox', { name: /^date of birth$/i }), { target: { value: '08101988' } })
    fireEvent.click(screen.getByLabelText(/I confirm that I am 18 or older/i))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome to C-Point' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/valid date of birth/i)).not.toBeInTheDocument()
  })

  it('opens the manifesto modal and can start onboarding from it', async () => {
    const onStart = vi.fn()
    vi.stubGlobal('fetch', mockIntroFetches({ preferredLocale: null }))

    render(<OnboardingIntroGate onStart={onStart} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /choose your preferred language/i }),
      ).toBeInTheDocument()
    })
    await advancePastLanguageIfNeeded()
    if (screen.queryByRole('heading', { name: 'Confirm your age' })) {
      await completeAgeGate()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Read the manifesto' }))

    expect(screen.getByRole('heading', { name: 'The C-Point Manifesto' })).toBeInTheDocument()
    expect(screen.getByText(/No public feeds\. No self-promotion/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set up your Profile' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('lets users defer profile setup with a 3-day confirmation', async () => {
    const fetchMock = mockIntroFetches({ preferredLocale: null })
    vi.stubGlobal('fetch', fetchMock)
    const replaceMock = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace: replaceMock })

    render(<OnboardingIntroGate onStart={vi.fn()} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /choose your preferred language/i }),
      ).toBeInTheDocument()
    })
    await advancePastLanguageIfNeeded()
    await completeAgeGate()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(screen.getByRole('button', { name: 'Set up my profile later' }))
    expect(screen.getByRole('heading', { name: 'Finish within 3 days' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set up later' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/onboarding/defer_profile',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        }),
      )
      expect(replaceMock).toHaveBeenCalledWith('/premium_dashboard')
    })
  })

  it('renders the configured video when one is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const path = String(url)
        if (path.includes('/api/me/locale')) {
          if (init?.method === 'PATCH') {
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) })
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, preferred_locale: 'en' }),
          })
        }
        if (path.includes('/api/public/onboarding_welcome_video')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, video_url: 'https://cdn.test/intro.mp4' }),
          })
        }
        return Promise.resolve({ ok: false, json: async () => ({}) })
      }),
    )

    const { container } = render(<OnboardingIntroGate onStart={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm your age' })).toBeInTheDocument()
    })
    await completeAgeGate()

    await waitFor(() => {
      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', 'https://cdn.test/intro.mp4')
    })
  })
})
