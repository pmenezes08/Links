import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { GROUP_FULL_SYNC_EVERY_N_POLL, GROUP_POLL_INTERVAL_MS } from './constants'
import {
  mergeGroupReactionsFromMessages,
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
  setReactions: Dispatch<SetStateAction<Record<number, string>>>
  setSteveIsTyping: Dispatch<SetStateAction<boolean>>
}

/**
 * Poll group messages with delta + periodic full sync for metadata (reactions, edits).
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
  setReactions,
  setSteveIsTyping,
}: UseGroupMessagePollOptions) {
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInFlightLocal = useRef(false)
  const pollTickLocal = useRef(0)
  const pollInFlight = pollInFlightExternal ?? pollInFlightLocal
  const pollTickRef = pollTickExternal ?? pollTickLocal

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

            setReactions(prev =>
              mergeGroupReactionsFromMessages(prev, newServerMessages),
            )
          }

          const newMaxId =
            newServerMessages.length > 0 ? Math.max(...newServerMessages.map(m => m.id)) : 0
          if (newMaxId > 0 && gen === threadGenerationRef.current) {
            lastMessageIdRef.current = Math.max(lastMessageIdRef.current, newMaxId)
          }
        }
      } catch (err) {
        console.error('Group polling error:', err)
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
    setReactions,
    setSteveIsTyping,
  ])
}
