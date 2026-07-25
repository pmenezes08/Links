import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CreateGroupSheet from './CreateGroupSheet'
import type { CommunityNode } from './types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts?.path ? `${key}:${opts.path}` : key) }),
}))

/** TAP-shaped tree: root -> sub -> two nested communities. */
const TREE: CommunityNode = {
  id: 1,
  name: 'TAP Air Portugal',
  children: [
    {
      id: 2,
      name: 'Pessoal Navegante',
      parent_community_id: 1,
      children: [
        { id: 3, name: 'PNT', parent_community_id: 2 },
        { id: 4, name: 'PNC', parent_community_id: 2 },
      ],
    },
  ],
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof CreateGroupSheet>> = {}) {
  const onCreated = vi.fn()
  render(
    <CreateGroupSheet
      open
      onClose={() => {}}
      tree={TREE}
      defaultTargetId={1}
      keyboardInset={0}
      steveAllowed={() => false}
      steveAddonUrl={() => '/subscription_plans'}
      onCreated={onCreated}
      onToast={() => {}}
      {...overrides}
    />,
  )
  return { onCreated }
}

describe('CreateGroupSheet location picker', () => {
  it('offers every community in the tree, at any nesting depth', () => {
    renderSheet()
    // Open the picker (button shows the current target's name).
    fireEvent.click(screen.getByRole('button', { name: 'TAP Air Portugal' }))
    const options = screen.getAllByRole('option').map(o => o.textContent?.trim())
    // Depth 0, depth 1, and BOTH depth-2 nodes must be selectable —
    // groups belong wherever the owner puts them.
    expect(options).toEqual(['TAP Air Portugal', 'Pessoal Navegante', 'PNT', 'PNC'])
  })

  it('selecting a nested community shows its full path', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'TAP Air Portugal' }))
    fireEvent.click(screen.getByRole('option', { name: 'PNC' }))
    expect(
      screen.getByText('communities.group_will_live_in:TAP Air Portugal › Pessoal Navegante › PNC'),
    ).toBeTruthy()
  })

  it('posts the nested community id, not the root', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true, group_id: 99 }) })
    vi.stubGlobal('fetch', fetchMock)
    const { onCreated } = renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'TAP Air Portugal' }))
    fireEvent.click(screen.getByRole('option', { name: 'PNT' }))
    fireEvent.change(screen.getByPlaceholderText('communities.group_name_placeholder'), {
      target: { value: 'Escalas' },
    })
    fireEvent.click(screen.getByText('communities.create'))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(99))
    const body = String(fetchMock.mock.calls[0][1].body)
    expect(body).toContain('community_id=3')
    vi.unstubAllGlobals()
  })
})
