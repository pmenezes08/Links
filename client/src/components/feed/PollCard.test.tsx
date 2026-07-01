import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import PollCard from './PollCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'feed.discuss_count') return `${values?.count} comments`
      if (key === 'feed.discuss') return 'Discuss'
      if (key === 'feed.vote_count') return `${values?.count} votes`
      return key
    },
  }),
}))

describe('PollCard', () => {
  const poll = {
    id: 7,
    question: 'Best city?',
    is_active: 1,
    total_votes: 2,
    user_vote: null,
    single_vote: true,
    options: [
      { id: 11, text: 'Lisbon', votes: 1, user_voted: false },
      { id: 12, text: 'Porto', votes: 1, user_voted: false },
    ],
  }

  it('votes without firing discussion navigation', () => {
    const onVote = vi.fn()
    const onDiscuss = vi.fn()
    render(<PollCard postId={42} poll={poll} onVote={onVote} onDiscuss={onDiscuss} />)

    fireEvent.click(screen.getByRole('button', { name: /Lisbon/i }))

    expect(onVote).toHaveBeenCalledWith(42, 7, 11, false)
    expect(onDiscuss).not.toHaveBeenCalled()
  })

  it('opens discussion from the dedicated affordance', () => {
    const onDiscuss = vi.fn()
    render(<PollCard postId={42} poll={poll} onDiscuss={onDiscuss} repliesCount={3} />)

    fireEvent.click(screen.getByRole('button', { name: /3 comments/i }))

    expect(onDiscuss).toHaveBeenCalledTimes(1)
  })
})
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import PollCard from './PollCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'feed.discuss_count') return `${values?.count} comments`
      if (key === 'feed.discuss') return 'Discuss'
      if (key === 'feed.vote_count') return `${values?.count} votes`
      return key
    },
  }),
}))

describe('PollCard', () => {
  const poll = {
    id: 7,
    question: 'Best city?',
    is_active: 1,
    total_votes: 2,
    user_vote: null,
    single_vote: true,
    options: [
      { id: 11, text: 'Lisbon', votes: 1, user_voted: false },
      { id: 12, text: 'Porto', votes: 1, user_voted: false },
    ],
  }

  it('votes without firing discussion navigation', () => {
    const onVote = vi.fn()
    const onDiscuss = vi.fn()
    render(
      <PollCard
        postId={42}
        poll={poll}
        onVote={onVote}
        onDiscuss={onDiscuss}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Lisbon/i }))

    expect(onVote).toHaveBeenCalledWith(42, 7, 11, false)
    expect(onDiscuss).not.toHaveBeenCalled()
  })

  it('opens discussion from the dedicated affordance', () => {
    const onDiscuss = vi.fn()
    render(<PollCard postId={42} poll={poll} onDiscuss={onDiscuss} repliesCount={3} />)

    fireEvent.click(screen.getByRole('button', { name: /3 comments/i }))

    expect(onDiscuss).toHaveBeenCalledTimes(1)
  })
})
