import { getOutboxEntries, updateOutboxStatus, removeFromOutbox, type OutboxEntry } from './offlineDb'

const MAX_RETRIES = 3
const MIN_ENTRY_AGE_MS = 8000

async function sendDm(entry: OutboxEntry): Promise<boolean> {
  const fd = new URLSearchParams({
    recipient_id: entry.recipient,
    message: entry.content,
    client_key: entry.clientKey,
  })
  const r = await fetch('/send_message', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fd,
  })
  const j = await r.json()
  return !!j?.success
}

async function sendGroup(entry: OutboxEntry): Promise<boolean> {
  const r = await fetch(`/api/group_chat/${entry.groupId}/send`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: entry.content, client_key: entry.clientKey }),
  })
  const j = await r.json()
  return !!j?.success
}

let draining = false

/** Flush pending offlineDb outbox entries; dispatches `outbox-drained` when any were processed. */
export async function drainOutbox(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const entries = await getOutboxEntries()
    const now = Date.now()
    const eligible = entries.filter(
      e =>
        e.status !== 'sending' &&
        (e.retries ?? 0) < MAX_RETRIES &&
        e.id != null &&
        now - (e.createdAt ?? 0) >= MIN_ENTRY_AGE_MS,
    )

    for (const entry of eligible) {
      const id = entry.id!
      await updateOutboxStatus(id, 'sending')
      try {
        const ok = entry.type === 'dm' ? await sendDm(entry) : await sendGroup(entry)
        if (ok) {
          await removeFromOutbox(id)
        } else {
          await updateOutboxStatus(id, 'failed', (entry.retries ?? 0) + 1)
        }
      } catch {
        await updateOutboxStatus(id, 'failed', (entry.retries ?? 0) + 1)
      }
    }

    if (eligible.length > 0) {
      window.dispatchEvent(new Event('outbox-drained'))
    }
  } catch {
    /* IDB unavailable */
  } finally {
    draining = false
  }
}
