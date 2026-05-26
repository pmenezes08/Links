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
    expect(screen.getByRole('heading', { name: 'Welcome to C-Point' })).toBeInTheDocument()
  })
}

describe('OnboardingIntroGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows language step first, then welcome and Steve before starting onboarding', async () => {
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
      expect(screen.getByRole('heading', { name: 'Welcome to C-Point' })).toBeInTheDocument()
    })

    expect(screen.getByText(/the world is meant to be lived/i)).toBeInTheDocument()
    expect(screen.queryByText(/C-Point's heart and intelligence/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Meet Steve' })).toBeInTheDocument()
    expect(screen.getByText(/C-Point's heart and intelligence/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up your Profile' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('skips the language step when preferred_locale is already saved', async () => {
    const onStart = vi.fn()
    vi.stubGlobal('fetch', mockIntroFetches({ preferredLocale: 'en' }))

    render(<OnboardingIntroGate onStart={onStart} />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome to C-Point' })).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('heading', { name: /choose your preferred language/i }),
    ).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Read the manifesto' }))

    expect(screen.getByRole('heading', { name: 'The C-Point Manifesto' })).toBeInTheDocument()
    expect(screen.getByText(/No public feeds\. No self-promotion/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set up your Profile' }))
    expect(onStart).toHaveBeenCalledTimes(1)
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
      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', 'https://cdn.test/intro.mp4')
    })
  })
})
