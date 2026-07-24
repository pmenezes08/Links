import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'

import JoinByHandlePanel, { JOIN_REQUEST_MESSAGE_MAX_LEN } from './JoinByHandlePanel'

function community(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Runners Club',
    handle: 'runners-club',
    description: '',
    member_bucket: '<10',
    already_member: false,
    request_status: null,
    message_required: false,
    ...overrides,
  }
}

function stubFetch(found: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      calls.push({ url: href, init })
      if (href.includes('/api/community/by_handle/')) {
        return { json: async () => ({ success: true, community: found }) }
      }
      return { json: async () => ({ success: true, request_status: 'pending' }) }
    }),
  )
  return calls
}

async function findCommunity() {
  fireEvent.change(screen.getByPlaceholderText('handle'), { target: { value: 'runners-club' } })
  await act(async () => {
    vi.advanceTimersByTime(500)
  })
  await screen.findByText('Runners Club')
}

describe('JoinByHandlePanel join message', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  function renderPanel() {
    return render(
      <MemoryRouter>
        <JoinByHandlePanel />
      </MemoryRouter>,
    )
  }

  it('sends an optional message with the request', async () => {
    const calls = stubFetch(community())
    renderPanel()
    await findCommunity()

    fireEvent.change(screen.getByPlaceholderText(/add a message/i), {
      target: { value: 'Hi, I run the local chapter' },
    })
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }))

    await waitFor(() => {
      const post = calls.find(c => c.url.includes('/join_requests') && c.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String(post!.init!.body))).toEqual({ message: 'Hi, I run the local chapter' })
    })
    await screen.findByText(/request sent/i)
  })

  it('omits the message field when left empty and optional', async () => {
    const calls = stubFetch(community())
    renderPanel()
    await findCommunity()

    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }))
    await waitFor(() => {
      const post = calls.find(c => c.url.includes('/join_requests') && c.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String(post!.init!.body))).toEqual({})
    })
  })

  it('blocks sending until a message is written when the community requires one', async () => {
    const calls = stubFetch(community({ message_required: true }))
    renderPanel()
    await findCommunity()

    const button = screen.getByRole('button', { name: /ask to join/i })
    expect(button).toBeDisabled()
    expect(screen.getByText(/asks for a short message/i)).toBeInTheDocument()
    expect(calls.filter(c => c.init?.method === 'POST')).toHaveLength(0)

    fireEvent.change(screen.getByPlaceholderText(/why do you want to join/i), {
      target: { value: 'Because I love running' },
    })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    await waitFor(() => {
      const post = calls.find(c => c.url.includes('/join_requests') && c.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String(post!.init!.body))).toEqual({ message: 'Because I love running' })
    })
  })

  it('shows the owner-written question and sends the answer', async () => {
    const calls = stubFetch(
      community({ message_required: true, join_prompt: 'Who invited you?' }),
    )
    renderPanel()
    await findCommunity()

    expect(screen.getByText('Who invited you?')).toBeInTheDocument()
    const box = screen.getByPlaceholderText(/your answer/i)
    fireEvent.change(box, { target: { value: 'Maria from HR' } })
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }))

    await waitFor(() => {
      const post = calls.find(c => c.url.includes('/join_requests') && c.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String(post!.init!.body))).toEqual({ message: 'Maria from HR' })
    })
  })

  it('caps the message at 140 characters with a live counter', async () => {
    stubFetch(community())
    renderPanel()
    await findCommunity()

    const box = screen.getByPlaceholderText(/add a message/i) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'y'.repeat(200) } })
    expect(box.value).toHaveLength(JOIN_REQUEST_MESSAGE_MAX_LEN)
    expect(
      screen.getByText(`${JOIN_REQUEST_MESSAGE_MAX_LEN}/${JOIN_REQUEST_MESSAGE_MAX_LEN}`),
    ).toBeInTheDocument()
  })
})
