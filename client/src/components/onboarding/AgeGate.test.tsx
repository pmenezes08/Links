import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import AgeGateController, { AgeGate } from './AgeGate'

describe('AgeGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('accepts compact DDMMYYYY dates and records the 18+ confirmation server-side', async () => {
    const onConfirmed = vi.fn()
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true, status: 'confirmed' }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<AgeGate onConfirmed={onConfirmed} />)

    fireEvent.change(screen.getByRole('textbox', { name: /^date of birth$/i }), {
      target: { value: '08101988' },
    })
    fireEvent.click(screen.getByLabelText(/I confirm that I am 18 or older/i))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me/age-confirmation',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ confirmed: true }),
        }),
      )
      expect(onConfirmed).toHaveBeenCalledTimes(1)
    })
    expect(localStorage.getItem('cpoint:age_gate_confirmed_at')).toBeTruthy()
  })

  it('blocks under-18 declarations with the underage modal and never calls the API', async () => {
    const onConfirmed = vi.fn()
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ success: true }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<AgeGate onConfirmed={onConfirmed} />)

    const recentYear = new Date().getFullYear() - 15
    fireEvent.change(screen.getByRole('textbox', { name: /^date of birth$/i }), {
      target: { value: `01/01/${recentYear}` },
    })
    fireEvent.click(screen.getByLabelText(/I confirm that I am 18 or older/i))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'C-Point is for adults 18 and over' }),
      ).toBeInTheDocument()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('controller shows the gate only when the server status is pending', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true, status: 'pending', age_confirmed_at: null }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<AgeGateController username="tester" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm your age' })).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/age-gate',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('controller stays hidden for confirmed accounts and caches the skip', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true, status: 'confirmed', age_confirmed_at: '2026-06-01T00:00:00Z' }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<AgeGateController username="tester" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(screen.queryByRole('heading', { name: 'Confirm your age' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(localStorage.getItem('cpoint:age_gate_confirmed_at')).toBeTruthy()
    })
  })
})
