/**
 * Decide whether a chat poll should be a lightweight DELTA (since_id) request or a
 * FULL page sync. A delta only returns messages newer than the last id — so it never
 * carries metadata changes (reactions, edits) on rows already on screen. We therefore
 * force a full sync:
 *   - on the FIRST poll after opening a thread (`didFullSync` still false), and
 *   - on the periodic cadence (`pollTick % fullSyncEveryN === 0`).
 * Otherwise (we've synced once, there is a known last id, and it's not the periodic
 * tick) a delta is enough. This is what makes a peer's reaction appear ~1.5s after
 * open instead of waiting ~9s for the next periodic full sync.
 */
export function shouldDeltaPoll(
  didFullSync: boolean,
  lastKnownId: number,
  pollTick: number,
  fullSyncEveryN: number,
): boolean {
  return didFullSync && lastKnownId > 0 && pollTick % fullSyncEveryN !== 0
}

/**
 * A thread is HOT when messages are actively flowing (something was sent or
 * received within `windowMs`, or the peer is typing right now). Hot threads
 * poll at the fast cadence so an incoming reply appears sub-second instead of
 * waiting the idle interval; everything else keeps the idle cadence so a
 * backgrounded-but-open thread doesn't hammer the server.
 */
export function pollIsHot(
  now: number,
  lastActivityAt: number,
  peerTyping: boolean,
  windowMs: number,
): boolean {
  if (peerTyping) return true
  return lastActivityAt > 0 && now - lastActivityAt < windowMs
}
