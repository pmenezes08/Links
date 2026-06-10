import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Boot the bundled i18n catalogs — Success.tsx only imports useTranslation,
// so without this the page renders raw keys in the test environment.
import '../i18n'

import Success from './Success'
import { HeaderContext } from '../contexts/HeaderContext'

function renderSuccess() {
  const header = { setTitle: vi.fn(), setHeaderHidden: vi.fn() }
  return render(
    <MemoryRouter initialEntries={['/success?session_id=cs_test_123']}>
      <HeaderContext.Provider value={header}>
        <Routes>
          <Route path="/success" element={<Success />} />
        </Routes>
      </HeaderContext.Provider>
    </MemoryRouter>,
  )
}

describe('Success page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        sku: 'community_tier',
        status: 'active',
        community_id: 42,
        community_name: 'Jola de Domingo',
        tier_label: 'Paid L1',
        billing_state: { stripe_customer_id: 'cus_123' },
      }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders community-specific success after checkout status syncs', async () => {
    renderSuccess()

    // The transient "Payment received." headline races i18n bootstrap and
    // the (mocked) status fetch, so assert the settled state only.
    await waitFor(() => {
      expect(screen.getByText('Paid L1 is active.')).toBeInTheDocument()
    })
    expect(screen.getByText(/Jola de Domingo subscription has been activated/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /manage community/i })).toBeInTheDocument()
  })
})
