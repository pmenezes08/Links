/**
 * Pure merge of polled group server rows into local message state.
 */

import { retainMessagesIfUnchanged } from './dmPollMerge'

export const GROUP_SEND_CONFIRM_TIMEOUT_MS = 30000

export type GroupPollMessage = {
  id: number
  sender: string
  text: string | null
  image: string | null
  voice: string | null
  video?: string | null
  media_paths?: string[] | null
  client_key?: string | null
  audio_duration_seconds?: number
  audio_summary?: string | null
  created_at: string
  profile_picture: string | null
  replySnippet?: string
  replySender?: string
  is_edited?: boolean
  reaction?: string | null
  isOptimistic?: boolean
  clientKey?: string
}

export function groupMessagePollSignature(
  m: GroupPollMessage & { isOptimistic?: boolean; clientKey?: string },
): string {
  const mediaPaths = m.media_paths?.join('\u001e') ?? ''
  return [
    m.id,
    m.sender,
    m.text ?? '',
    m.reaction ?? '',
    m.is_edited ? 1 : 0,
    m.image ?? '',
    m.video ?? '',
    m.voice ?? '',
    mediaPaths,
    m.isOptimistic ? 1 : 0,
    m.client_key ?? m.clientKey ?? '',
  ].join('\u001f')
}

export function mergeGroupReactionsFromMessages(
  prev: Record<number, string>,
  msgs: GroupPollMessage[],
): Record<number, string> {
  let changed = false
  const next: Record<number, string> = { ...prev }
  for (const msg of msgs) {
    const id = msg.id
    if (!id || id <= 0) continue
    const n = msg.reaction || null
    const p = prev[id] === undefined ? null : prev[id]
    if (p !== n) {
      changed = true
      if (n) next[id] = n
      else delete next[id]
    }
  }
  return changed ? next : prev
}

export function isConfirmedGroupMessage(
  serverMessage: GroupPollMessage,
  optimisticMessage: GroupPollMessage & { clientKey?: string },
): boolean {
  const serverClientKey = (serverMessage.client_key || '').trim()
  const optimisticClientKey = (optimisticMessage.clientKey || '').trim()

  if (serverClientKey && optimisticClientKey && serverClientKey === optimisticClientKey) {
    return true
  }

  return (
    serverMessage.sender === optimisticMessage.sender &&
    serverMessage.text === optimisticMessage.text &&
    Math.abs(
      new Date(serverMessage.created_at).getTime() -
        new Date(optimisticMessage.created_at).getTime(),
    ) < GROUP_SEND_CONFIRM_TIMEOUT_MS
  )
}

export interface GroupPollMergeContext {
  pendingDeletions: Set<number>
  isDelta: boolean
  silent: boolean
}

export function mergePolledGroupMessages(
  prev: GroupPollMessage[],
  newServerMessages: GroupPollMessage[],
  ctx: GroupPollMergeContext,
): GroupPollMessage[] {
  const { pendingDeletions, isDelta, silent } = ctx
  const filtered = newServerMessages.filter(m => !pendingDeletions.has(m.id))

  if (isDelta && filtered.length === 0) {
    return prev
  }

  if (isDelta) {
    const optimistic = prev.filter(m => m.isOptimistic)
    const prevServer = prev.filter(m => !m.isOptimistic)
    const byId = new Map<number, GroupPollMessage>()
    for (const m of prevServer) {
      if (m.id > 0) byId.set(m.id, m)
    }
    for (const nm of filtered) {
      if (pendingDeletions.has(nm.id)) continue
      byId.set(nm.id, nm)
    }
    const merged = Array.from(byId.values()).sort((a, b) => a.id - b.id)
    const unconfirmedOptimistic = optimistic.filter(
      opt => !merged.some(nm => isConfirmedGroupMessage(nm, opt)),
    )
    const next = [...merged, ...unconfirmedOptimistic]
    return retainMessagesIfUnchanged(prev, next, groupMessagePollSignature)
  }

  const optimistic = prev.filter(m => m.isOptimistic)
  const prevServer = prev.filter(m => !m.isOptimistic)

  if (silent) {
    const minNewId = filtered.length > 0 ? Math.min(...filtered.map(m => m.id)) : Infinity
    const mergedIds = [
      ...prevServer.filter(m => m.id < minNewId),
      ...filtered,
    ]
      .map(m => m.id)
      .join(',')
    const currentIds = prevServer.map(m => m.id).join(',')
    if (mergedIds === currentIds) {
      const changed = filtered.some(nm => {
        const pm = prevServer.find(p => p.id === nm.id)
        return (
          pm &&
          (pm.text !== nm.text ||
            pm.is_edited !== nm.is_edited ||
            (pm.reaction ?? null) !== (nm.reaction ?? null))
        )
      })
      if (!changed) {
        const unconfirmed = optimistic.filter(
          opt => !filtered.some(nm => isConfirmedGroupMessage(nm, opt)),
        )
        if (unconfirmed.length !== optimistic.length) {
          return [...prevServer, ...unconfirmed]
        }
        return prev
      }
    }
  }

  const minNewId = filtered.length > 0 ? Math.min(...filtered.map(m => m.id)) : Infinity
  const olderMessages = silent
    ? prevServer.filter(m => m.id < minNewId && !filtered.some(n => n.id === m.id))
    : []
  const unconfirmedOptimistic = optimistic.filter(
    opt => !filtered.some(nm => isConfirmedGroupMessage(nm, opt)),
  )
  return [...olderMessages, ...filtered, ...unconfirmedOptimistic]
}
