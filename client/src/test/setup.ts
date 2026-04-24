/**
 * Global Vitest setup for client tests.
 *
 * Pulls in `@testing-library/jest-dom` so every test has the expressive
 * matchers (`toBeInTheDocument`, `toHaveTextContent`, …) without each
 * test importing them by hand. Also resets all mocks between tests so
 * state from one test can't bleed into the next.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
