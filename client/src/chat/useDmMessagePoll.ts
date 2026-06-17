import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { getAllMessageReactions } from './utils'
import { DM_FULL_SYNC_EVERY_N_POLL, DM_POLL_INTERVAL_MS, nextPollBackoffMs } from './constants'
import { shouldDeltaPoll } from './pollSync'
import { mergePolledDmMessages, type DmIdBridge } from '../utils/dmPollMergeMessages'
import type { MessageMeta } from './utils'
import { cacheMessages } from '../utils/offlineDb'

export interface UseDmMessagePollOptions<T extends object> {
  username: string | undefined
  otherUserId: number | string
  dmOfflineKey: string | null
  threadGenerationRef: MutableRefObject<number>
  resolvedPeerRef: MutableRefObject<{ username: string; userId: number } | null>
  lastKnownMessageIdRef: MutableRefObject<number>
  skipNextPollsUntil: MutableRefObject<number>
  pollInFlightRef?: MutableRefObject<boolean>
  pollCountRef?: MutableRefObject<number>
  idBridgeRef: MutableRefObject<DmIdBridge>
  recentOptimisticRef: MutableRefObject<Map<string, { message: T; timestamp: number }>>
  pendingDeletions: MutableRefObject<Set<number | string>>
  metaRef: MutableRefObject<Record<string, MessageMeta>>
  setMessages: Dispatch<SetStateAction<T[]>>
  setSteveIsTyping: (typing: boolean) => void
  setTyping: (typing: boolean) => void
}

/**
 * Poll /get_messages with delta + periodic full sync for metadata (reactions, edits).
 */
export function useDmMessagePoll<T extends object>({
  username,
  otherUserId,
  dmOfflineKey,
  threadGenerationRef,
  resolvedPeerRef,
  lastKnownMessageIdRef,
  skipNextPollsUntil,
  pollInFlightRef: pollInFlightExternal,
  pollCountRef: pollCountExternal,
  idBridgeRef,
  recentOptimisticRef,
  pendingDeletions,
  metaRef,
  setMessages,
  setSteveIsTyping,
  setTyping,
}: UseDmMessagePollOptions<T>) {
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInFlightLocal = useRef(false)
  const pollCountLocal = useRef(0)
  const pollInFlight = pollInFlightExternal ?? pollInFlightLocal
  const pollCountRef = pollCountExternal ?? pollCountLocal
  // Adaptive backoff: consecutive failures widen the effective poll gap (reset on success).
  const pollErrorCountRef = useRef(0)
  const nextPollAtRef = useRef(0)

  useEffect(() => {
    if (!username || !otherUserId) return
    const peer = resolvedPeerRef.current
    if (!peer || peer.username !== username || peer.userId !== otherUserId) return

    // The first poll after opening a thread must be a FULL sync (no since_id) so a
    // peer's reaction/edit on an already-loaded message reconciles immediately instead
    // of waiting for the periodic full sync (~9s). Resets per thread open (closure) and
    // on return-to-foreground.
    let didFullSync = false

    async function poll() {
      if (!navigator.onLine) return
      const gen = threadGenerationRef.current
      const pollPeer = resolvedPeerRef.current
      if (!pollPeer || pollPeer.username !== username || pollPeer.userId !== otherUserId) return
      if (Date.now() < skipNextPollsUntil.current) return
      if (Date.now() < nextPollAtRef.current) return // backing off after recent failures
      if (pollInFlight.current) return

      pollInFlight.current = true
      pollCountRef.current += 1
      const pollTick = pollCountRef.current

      try {
        try {
          const useDelta = shouldDeltaPoll(
            didFullSync,
            lastKnownMessageIdRef.current,
            pollTick,
            DM_FULL_SYNC_EVERY_N_POLL,
          )

          const fd = new URLSearchParams({ other_user_id: String(otherUserId) })
          if (useDelta) {
            fd.append('since_id', String(lastKnownMessageIdRef.current))
          }

          const r = await fetch('/get_messages', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: fd,
          })
          const j = await r.json()
          // Network round-trip succeeded — clear any backoff.
          pollErrorCountRef.current = 0
          nextPollAtRef.current = 0
          if (gen !== threadGenerationRef.current) return
          setSteveIsTyping(Boolean(j?.steve_is_typing))
          if (j?.success && !useDelta) didFullSync = true // a full page has now landed

          if (j?.success && Array.isArray(j.messages)) {
            let maxId = lastKnownMessageIdRef.current
            j.messages.forEach((m: { id?: number | string }) => {
              const msgId = typeof m.id === 'number' ? m.id : parseInt(String(m.id), 10)
              if (!Number.isNaN(msgId) && msgId > maxId) maxId = msgId
            })
            if (gen === threadGenerationRef.current) {
              lastKnownMessageIdRef.current = maxId
            }

            if (username && dmOfflineKey && gen === threadGenerationRef.current) {
              cacheMessages(dmOfflineKey, j.messages)
            }

            const storedReactions = username ? getAllMessageReactions(username) : {}

            setMessages(prev => {
              if (gen !== threadGenerationRef.current) return prev
              return mergePolledDmMessages(prev, j.messages, {
                username: username!,
                metaRef: metaRef.current,
                idBridge: idBridgeRef.current,
                recentOptimistic: recentOptimisticRef.current,
                pendingDeletions: pendingDeletions.current,
                storedReactions,
              })
            })
          }
        } catch (e) {
          console.error('Polling error:', e)
          // Flaky-but-online ("lie-fi"): widen the gap so we stop hammering every 1.5s.
          pollErrorCountRef.current += 1
          nextPollAtRef.current = Date.now() + nextPollBackoffMs(pollErrorCountRef.current)
        }

        // Presence/typing are auxiliary — fire-and-forget (no await) so a slow typing/active_chat
        // request on a weak network never holds pollInFlight and delays the next message poll.
        // (The group poll hook already drives presence off its critical path the same way.)
        if (pollTick % 5 === 0 && username) {
          fetch(`/api/typing?peer=${encodeURIComponent(username)}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          })
            .then(t => t.json())
            .then(tj => { if (gen === threadGenerationRef.current) setTyping(!!tj?.is_typing) })
            .catch(() => { /* ignore */ })
        }

        if (pollTick % 4 === 0 && username) {
          fetch('/api/active_chat', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peer: username }),
          }).catch(() => { /* ignore */ })
        }
      } finally {
        pollInFlight.current = false
      }
    }

    void poll()
    pollTimer.current = setInterval(poll, DM_POLL_INTERVAL_MS)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        nextPollAtRef.current = 0 // returning to foreground: try again immediately
        didFullSync = false // and re-sync reactions/edits, not just new messages
        void poll()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [
    username,
    otherUserId,
    dmOfflineKey,
    threadGenerationRef,
    resolvedPeerRef,
    lastKnownMessageIdRef,
    skipNextPollsUntil,
    pollInFlight,
    pollCountRef,
    idBridgeRef,
    recentOptimisticRef,
    pendingDeletions,
    metaRef,
    setMessages,
    setSteveIsTyping,
    setTyping,
  ])
}
