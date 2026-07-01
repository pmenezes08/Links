import { useCallback } from 'react'
import { handleBasicProfileRequired } from '../utils/basicProfileGate'
import { triggerHaptic } from '../utils/haptics'

export type PollOption = {
  id: number
  text?: string
  option_text?: string
  votes: number
  user_voted?: boolean
}

export type Poll = {
  id: number
  question: string
  is_active: number | boolean | string
  options: PollOption[]
  user_vote?: number | null
  total_votes?: number
  single_vote?: boolean | number | string
  expires_at?: string | null
  group_poll?: boolean
}

type VoteArgs = {
  pollId: number
  optionId: number
  isGroupPoll?: boolean
  onOptimistic: () => void
  onReconcile: (rows: Array<any>) => void
  onRejected?: () => void
}

type Options = {
  onBasicProfileRequired?: () => void
  onSuccess?: () => void
}

export function isSingleVotePoll(poll: Pick<Poll, 'single_vote'>): boolean {
  const raw = poll.single_vote
  return !(raw === false || raw === 0 || raw === '0' || raw === 'false')
}

export function isPollClosed(poll: Pick<Poll, 'is_active' | 'expires_at'>): boolean {
  if (poll.is_active === 0 || poll.is_active === false || poll.is_active === '0') return true
  try {
    const raw = poll.expires_at
    if (!raw) return false
    const d = new Date(raw)
    return !Number.isNaN(d.getTime()) && Date.now() >= d.getTime()
  } catch {
    return false
  }
}

export function applyOptimisticPollVote<T extends Poll>(poll: T, optionId: number): T {
  const clicked = poll.options.find(opt => opt.id === optionId)
  const hasVotedOnThisOption = !!clicked?.user_voted
  const isSingle = isSingleVotePoll(poll)
  const options = poll.options.map(opt => {
    if (opt.id === optionId) {
      return {
        ...opt,
        votes: hasVotedOnThisOption ? Math.max(0, (opt.votes || 0) - 1) : (opt.votes || 0) + 1,
        user_voted: !hasVotedOnThisOption,
      }
    }
    if (isSingle && opt.user_voted) {
      return { ...opt, votes: Math.max(0, (opt.votes || 0) - 1), user_voted: false }
    }
    return opt
  })
  const totalVotes = options.reduce((sum, opt) => sum + (opt.votes || 0), 0)
  return {
    ...poll,
    options,
    user_vote: isSingle ? (hasVotedOnThisOption ? null : optionId) : poll.user_vote,
    total_votes: totalVotes,
  }
}

export function reconcilePollResults<T extends Poll>(poll: T, rows: Array<any>): T {
  if (!Array.isArray(rows) || rows.length === 0) return poll
  const options = poll.options.map(opt => {
    const row = rows.find(item => item.id === opt.id)
    return row
      ? {
          ...opt,
          votes: Number(row.votes || 0),
          user_voted: !!row.user_voted,
        }
      : opt
  })
  const totalVotes = rows[0]?.total_votes ?? options.reduce((sum, opt) => sum + (opt.votes || 0), 0)
  const userVote = typeof rows[0]?.user_vote !== 'undefined' ? (rows[0].user_vote || null) : poll.user_vote
  return {
    ...poll,
    options,
    user_vote: userVote,
    total_votes: Number(totalVotes || 0),
  }
}

export function usePollVote(options: Options = {}) {
  return useCallback(
    async ({ pollId, optionId, isGroupPoll = false, onOptimistic, onReconcile, onRejected }: VoteArgs) => {
      void triggerHaptic('selection')
      onOptimistic()
      try {
        const endpoint = isGroupPoll ? '/api/group_poll_vote' : '/vote_poll'
        const body = isGroupPoll
          ? { group_poll_id: pollId, option_id: optionId }
          : { poll_id: pollId, option_id: optionId }
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => null)
        if (handleBasicProfileRequired(json)) {
          options.onBasicProfileRequired?.()
          return
        }
        if (!json?.success) {
          onRejected?.()
          return
        }
        options.onSuccess?.()
        if (Array.isArray(json.poll_results)) {
          onReconcile(json.poll_results)
        }
      } catch {
        onRejected?.()
      }
    },
    [options],
  )
}
