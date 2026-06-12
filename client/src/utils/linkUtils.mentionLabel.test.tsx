import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { colorizeMentions, renderTextWithSourceLinks } from './linkUtils'

// Render-time name resolution for @mentions (Steve networking wrong-name
// guardrail): the name shown next to a handle comes from the caller's member
// map (DB truth), never from the surrounding model prose. Without a resolver
// the behavior must be byte-for-byte the legacy one.

const MEMBERS: Record<string, string> = {
  jh1987: 'Jonas Hofmann',
  solo_x: 'solo_x', // display name equals username
}
const label = (u: string) => MEMBERS[u.toLowerCase()] || null

describe('colorizeMentions mentionLabel resolution', () => {
  it('renders "Display Name (@username)" when the resolver knows the handle', () => {
    render(<div>{colorizeMentions(['meet @jh1987 today'], undefined, false, label)}</div>)
    expect(screen.getByText('Jonas Hofmann (@jh1987)')).toBeTruthy()
  })

  it('keeps plain @username when resolver returns nothing or the same name', () => {
    render(<div>{colorizeMentions(['ping @unknown_user and @solo_x'], undefined, false, label)}</div>)
    expect(screen.getByText('@unknown_user')).toBeTruthy()
    expect(screen.getByText('@solo_x')).toBeTruthy()
  })

  it('is unchanged without a resolver (every other surface)', () => {
    render(<div>{colorizeMentions(['hi @jh1987'])}</div>)
    expect(screen.getByText('@jh1987')).toBeTruthy()
    expect(screen.queryByText(/Jonas Hofmann/)).toBeNull()
  })
})

describe('renderTextWithSourceLinks threads mentionLabel through', () => {
  it('expands mentions in AI text while leaving raw text and links intact', () => {
    render(
      <MemoryRouter>
        <div>
          {renderTextWithSourceLinks(
            'Try @jh1987 — see https://example.com for context',
            false,
            undefined,
            undefined,
            false,
            label,
          )}
        </div>
      </MemoryRouter>,
    )
    expect(screen.getByText('Jonas Hofmann (@jh1987)')).toBeTruthy()
    expect(screen.getByText('https://example.com')).toBeTruthy()
  })
})
