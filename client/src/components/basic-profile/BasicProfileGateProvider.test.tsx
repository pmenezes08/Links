import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { UserProfileContext } from '../../contexts/UserProfileContext'
import {
  BASIC_PROFILE_COMPLETED_EVENT,
  BASIC_PROFILE_GATE_EVENT,
  type BasicProfileStatus,
} from '../../utils/basicProfileGate'
import BasicProfileGateProvider from './BasicProfileGateProvider'

function renderGate(profile: Record<string, unknown> | null = null, refresh = vi.fn(async () => profile)) {
  render(
    <MemoryRouter>
      <UserProfileContext.Provider
        value={{
          profile,
          setProfile: vi.fn(),
          applyProfileFromServer: vi.fn(),
          loading: false,
          error: null,
          refresh,
        }}
      >
        <BasicProfileGateProvider />
      </UserProfileContext.Provider>
    </MemoryRouter>,
  )
  return { refresh }
}

function dispatchGate(status?: Partial<BasicProfileStatus>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(BASIC_PROFILE_GATE_EVENT, {
        detail: {
          status: {
            complete: false,
            missing_fields: ['first_name', 'last_name', 'profile_picture'],
            required_fields: ['first_name', 'last_name', 'profile_picture'],
            profile: {
              first_name: '',
              last_name: '',
              profile_picture: null,
            },
            ...status,
          },
        },
      }),
    )
  })
}

describe('BasicProfileGateProvider', () => {
  it('opens only when the participation gate event is dispatched', async () => {
    renderGate()

    expect(screen.queryByRole('dialog', { name: /add your name and photo/i })).not.toBeInTheDocument()

    dispatchGate()

    expect(await screen.findByRole('dialog', { name: /add your name and photo/i })).toBeInTheDocument()
    expect(
      screen.getByText(/to post, reply, react, invite, or message/i),
    ).toBeInTheDocument()
  })

  it('saves the basic profile and announces completion', async () => {
    const refresh = vi.fn(async () => ({
      username: 'profile_user',
      first_name: 'Ada',
      last_name: 'Lovelace',
      profile_picture: 'uploads/profile_user.jpg',
    }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        basic_profile: {
          complete: true,
          missing_fields: [],
          required_fields: ['first_name', 'last_name', 'profile_picture'],
          profile: {
            first_name: 'Ada',
            last_name: 'Lovelace',
            profile_picture: 'uploads/profile_user.jpg',
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onComplete = vi.fn()
    window.addEventListener(BASIC_PROFILE_COMPLETED_EVENT, onComplete)

    renderGate({ username: 'profile_user', profile_picture: 'uploads/profile_user.jpg' }, refresh)
    dispatchGate({
      profile: {
        first_name: '',
        last_name: '',
        profile_picture: 'uploads/profile_user.jpg',
      },
    })

    fireEvent.change(await screen.findByLabelText(/first name/i), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: /save and participate/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me/basic_profile', expect.any(Object)))
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: /add your name and photo/i })).not.toBeInTheDocument()

    window.removeEventListener(BASIC_PROFILE_COMPLETED_EVENT, onComplete)
  })
})
