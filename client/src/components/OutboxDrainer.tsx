import { useEffect, useRef } from 'react'
import { useNetwork } from '../contexts/NetworkContext'
import { getOutboxEntries, updateOutboxStatus, removeFromOutbox, type OutboxEntry } from '../utils/offlineDb'

const MAX_RETRIES = 3

async function sendDm(entry: OutboxEntry): Promise<boolean> {
  const fd = new URLSearchParams({ recipient_id: entry.recipient, message: entry.content, client_key: entry.clientKey })
  const r = await fetch('/send_message', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
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

export default function OutboxDrainer() {
  const { justReconnected } = useNetwork()
  const drainingRef = useRef(false)

  useEffect(() => {
    if (!justReconnected || drainingRef.current) return
    drainingRef.current = true

    ;(async () => {
      try {
        const entries = await getOutboxEntries()
        const eligible = entries.filter(e => e.status !== 'sending' && (e.retries ?? 0) < MAX_RETRIES && e.id != null)

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
      } catch { /* IDB unavailable */ }
      drainingRef.current = false
    })()
  }, [justReconnected])

  return null
}
