import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '../i18n'
import LocaleBootstrap from './LocaleBootstrap'

describe('LocaleBootstrap', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
  })

  it('applies the saved preferred_locale returned by the server', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        preferred_locale: 'pt-PT',
      }),
    } as Response)

    await i18n.changeLanguage('en')
    render(<LocaleBootstrap />)

    await waitFor(() => {
      expect(i18n.language).toBe('pt-PT')
    })
  })
})
