import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import OnboardingIntroGate from './OnboardingIntroGate'

describe('OnboardingIntroGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the welcome milestone, then shows Steve before starting onboarding', async () => {
    const onStart = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ success: true, video_url: null }),
      }),
    )

    render(<OnboardingIntroGate onStart={onStart} />)

    expect(screen.getByRole('img', { name: 'C-Point' })).toHaveAttribute('src', '/api/public/logo')
    expect(screen.getByRole('heading', { name: 'Welcome to C-Point' })).toBeInTheDocument()
    expect(screen.getByText(/the world is meant to be lived/i)).toBeInTheDocument()
    expect(screen.queryByText(/C-Point's heart and intelligence/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Meet Steve' })).toBeInTheDocument()
    expect(screen.getByText(/C-Point's heart and intelligence/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start onboarding' }))
    expect(onStart).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/public/onboarding_welcome_video',
        expect.objectContaining({ cache: 'no-store' }),
      )
    })
  })

  it('opens the manifesto modal and can start onboarding from it', () => {
    const onStart = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ success: true, video_url: null }),
      }),
    )

    render(<OnboardingIntroGate onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read the manifesto' }))

    expect(screen.getByRole('heading', { name: 'The C-Point Manifesto' })).toBeInTheDocument()
    expect(screen.getByText(/No public feeds\. No self-promotion/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start onboarding' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('renders the configured video when one is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ success: true, video_url: 'https://cdn.test/intro.mp4' }),
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
