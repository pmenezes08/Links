import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { GROUP_FULL_SYNC_EVERY_N_POLL, GROUP_POLL_INTERVAL_MS, nextPollBackoffMs } from './constants'
import {
  mergePolledGroupMessages,
  type GroupPollMessage,
} from '../utils/groupPollMergeMessages'
import { cacheMessages } from '../utils/offlineDb'

export interface UseGroupMessagePollOptions<T extends GroupPollMessage = GroupPollMessage> {
  groupId: string | undefined
  threadGenerationRef: MutableRefObject<number>
  activeGroupIdRef: MutableRefObject<string | undefined>
  lastMessageIdRef: MutableRefObject<number>
  skipNextPollsUntil: MutableRefObject<number>
  pollInFlightRef?: MutableRefObject<boolean>
  pollTickRef?: MutableRefObject<number>
  pendingDeletions: MutableRefObject<Set<number>>
  setServerMessages: Dispatch<SetStateAction<T[]>>
  setSteveIsTyping: Dispatch<SetStateAction<boolean>>
}

/**
 * Poll group messages with delta + periodic full sync for metadata (edits, reactions).
 * Reactions ride along on each message row (`msg.reaction`); the merge in
 * `mergePolledGroupMessages` already picks up reaction changes via the row
 * signature, so we do not need a separate reactions state map.
 */
export function useGroupMessagePoll<T extends GroupPollMessage = GroupPollMessage>({
  groupId,
  threadGenerationRef,
  activeGroupIdRef,
  lastMessageIdRef,
  skipNextPollsUntil,
  pollInFlightRef: pollInFlightExternal,
  pollTickRef: pollTickExternal,
  pendingDeletions,
  setServerMessages,
  setSteveIsTyping,
}: UseGroupMessagePollOptions) {
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInFlightLocal = useRef(false)
  const pollTickLocal = useRef(0)
  const pollInFlight = pollInFlightExternal ?? pollInFlightLocal
  const pollTickRef = pollTickExternal ?? pollTickLocal
  // Adaptive backoff: consecutive failures widen the effective poll gap (reset on success).
  const pollErrorCountRef = useRef(0)
  const nextPollAtRef = useRef(0)

  useEffect(() => {
    if (!groupId) return

    const updatePresence = () => {
      fetch(`/api/group_chat/${groupId}/presence`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {})
    }

    async function poll(pollTick: number) {
      if (!navigator.onLine) return
      const gen = threadGenerationRef.current
      const fetchGroupId = groupId
      if (fetchGroupId !== activeGroupIdRef.current) return
      if (Date.now() < skipNextPollsUntil.current) return
      if (Date.now() < nextPollAtRef.current) return // backing off after recent failures
      if (pollInFlight.current) return

      pollInFlight.current = true

      try {
        const useDelta =
          lastMessageIdRef.current > 0 &&
          pollTick % GROUP_FULL_SYNC_EVERY_N_POLL !== 0

        const url = useDelta
          ? `/api/group_chat/${groupId}/messages?limit=50&since_id=${lastMessageIdRef.current}`
          : `/api/group_chat/${groupId}/messages?limit=50`

        const response = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const data = await response.json()
        // Network round-trip succeeded — clear any backoff.
        pollErrorCountRef.current = 0
        nextPollAtRef.current = 0
        if (gen !== threadGenerationRef.current || fetchGroupId !== activeGroupIdRef.current) return

        if (data.success) {
          const newServerMessages = (data.messages as GroupPollMessage[]).filter(
            m => !pendingDeletions.current.has(m.id),
          )
          const isDelta = useDelta
          const typingNext = data.steve_is_typing === true
          setSteveIsTyping(prev => (prev === typingNext ? prev : typingNext))

          if (!(isDelta && newServerMessages.length === 0)) {
            if (!isDelta) {
              cacheMessages(`group:${groupId}`, newServerMessages)
            }

            setServerMessages(prev => {
              if (gen !== threadGenerationRef.current) return prev
              return mergePolledGroupMessages(prev, newServerMessages, {
                pendingDeletions: pendingDeletions.current,
                isDelta,
                silent: true,
              }) as T[]
            })
          }

          const newMaxId =
            newServerMessages.length > 0 ? Math.max(...newServerMessages.map(m => m.id)) : 0
          if (newMaxId > 0 && gen === threadGenerationRef.current) {
            lastMessageIdRef.current = Math.max(lastMessageIdRef.current, newMaxId)
          }
        }
      } catch (err) {
        console.error('Group polling error:', err)
        // Flaky-but-online ("lie-fi"): widen the gap so we stop hammering every 1.5s.
        pollErrorCountRef.current += 1
        nextPollAtRef.current = Date.now() + nextPollBackoffMs(pollErrorCountRef.current, GROUP_POLL_INTERVAL_MS)
      } finally {
        pollInFlight.current = false
      }
    }

    if (navigator.onLine) updatePresence()

    const tick = () => {
      pollTickRef.current += 1
      const pt = pollTickRef.current
      if (pt % 4 === 0) updatePresence()
      void poll(pt)
    }

    void poll(0)
    pollTimer.current = setInterval(tick, GROUP_POLL_INTERVAL_MS)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && !pollInFlight.current) {
        nextPollAtRef.current = 0 // returning to foreground: try again immediately
        void poll(0)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [
    groupId,
    threadGenerationRef,
    activeGroupIdRef,
    lastMessageIdRef,
    skipNextPollsUntil,
    pollInFlight,
    pollTickRef,
    pendingDeletions,
    setServerMessages,
    setSteveIsTyping,
  ])
}
