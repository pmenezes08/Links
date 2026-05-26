/**
 * Pure merge of polled DM server rows into local message state.
 */

import {
  ensureNormalizedTime,
  getMessageTimestamp,
  readMessageMeta,
  type MessageMeta,
} from '../chat/utils'
import {
  mergeDocumentFields,
  messagePollSignature,
  retainMessagesIfUnchanged,
  shouldRetainOptimisticDuringUpload,
  tryMatchDocumentOptimistic,
} from './dmPollMerge'

export interface DmIdBridge {
  tempToServer: Map<string, string | number>
  serverToTemp: Map<string | number, string>
}

export interface DmPollMergeContext<T extends object> {
  username: string
  metaRef: Record<string, MessageMeta>
  idBridge: DmIdBridge
  recentOptimistic: Map<string, { message: T; timestamp: number }>
  pendingDeletions: Set<number | string>
  storedReactions: Record<string, string>
}

export function mergePolledDmMessages<T extends object>(
  prev: T[],
  serverMessages: any[],
  ctx: DmPollMergeContext<T>,
): T[] {
  const { username, metaRef, idBridge, recentOptimistic, pendingDeletions, storedReactions } = ctx

  const messagesByKey = new Map<string, T>()
  prev.forEach(m => {
    const key = String((m as { clientKey?: string | number; id?: string | number }).clientKey || (m as { id?: string | number }).id)
    messagesByKey.set(key, m)
  })

  recentOptimistic.forEach((entry, key) => {
    if (!messagesByKey.has(key)) {
      messagesByKey.set(key, entry.message)
    }
  })

  serverMessages.forEach((m: any) => {
    if (pendingDeletions.has(m.id)) return

    let messageText = m.text
    let replySnippet: string | undefined
    let storyReply: { id: string; mediaType: string; mediaPath: string } | undefined

    const storyReplyMatch = messageText?.match(/^\[STORY_REPLY:([^:]+):([^:]+):([^\]]*)\][\r\n\s]*(.*)$/s)
    if (storyReplyMatch) {
      storyReply = {
        id: storyReplyMatch[1],
        mediaType: storyReplyMatch[2],
        mediaPath: storyReplyMatch[3],
      }
      messageText = storyReplyMatch[4]
    } else {
      const replyMatch = messageText?.match(/^\[REPLY:([^:]+):([^\]]+)\][\r\n\s]*(.*)$/s)
      if (replyMatch) {
        replySnippet = replyMatch[2]
        messageText = replyMatch[3]
      }
    }

    const normalizedTime = ensureNormalizedTime(m.time)
    const isSentByMe = m.sender === undefined ? m.sent === true : m.sender === username
    const meta = readMessageMeta(metaRef, normalizedTime, messageText, isSentByMe)
    const idBasedReaction = m.id ? storedReactions[String(m.id)] : undefined

    let stableKey = idBridge.serverToTemp.get(m.id)

    if (!stableKey) {
      for (const [key, existing] of messagesByKey.entries()) {
        const ex = existing as T & {
          sent?: boolean
          image_path?: string
          video_path?: string
          audio_path?: string
          file_path?: string
          text?: string
          isOptimistic?: boolean
          time?: string
        }
        if (ex.sent !== isSentByMe) continue

        if (m.image_path && ex.image_path) {
          if (ex.image_path === m.image_path) {
            stableKey = key
            idBridge.serverToTemp.set(m.id, key)
            idBridge.tempToServer.set(key, m.id)
            break
          }
          if (ex.isOptimistic && ex.image_path.startsWith('blob:')) {
            const serverTs = getMessageTimestamp(m.time)
            const existingTs = getMessageTimestamp(ex.time)
            if (serverTs !== null && existingTs !== null && Math.abs(serverTs - existingTs) < 30000) {
              stableKey = key
              idBridge.serverToTemp.set(m.id, key)
              idBridge.tempToServer.set(key, m.id)
              break
            }
          }
          continue
        }

        if (m.video_path && ex.video_path) {
          if (ex.video_path === m.video_path) {
            stableKey = key
            idBridge.serverToTemp.set(m.id, key)
            idBridge.tempToServer.set(key, m.id)
            break
          }
          if (ex.isOptimistic && ex.video_path.startsWith('blob:')) {
            const serverTs = getMessageTimestamp(m.time)
            const existingTs = getMessageTimestamp(ex.time)
            if (serverTs !== null && existingTs !== null && Math.abs(serverTs - existingTs) < 30000) {
              stableKey = key
              idBridge.serverToTemp.set(m.id, key)
              idBridge.tempToServer.set(key, m.id)
              break
            }
          }
          continue
        }

        if (m.file_path || ex.file_path) {
          if (tryMatchDocumentOptimistic(m, ex, isSentByMe)) {
            stableKey = key
            idBridge.serverToTemp.set(m.id, key)
            idBridge.tempToServer.set(key, m.id)
            break
          }
          continue
        }

        if (m.audio_path && ex.audio_path) {
          if (ex.audio_path === m.audio_path) {
            stableKey = key
            idBridge.serverToTemp.set(m.id, key)
            idBridge.tempToServer.set(key, m.id)
            break
          }
          if (ex.isOptimistic && ex.audio_path.startsWith('blob:')) {
            const serverTs = getMessageTimestamp(m.time)
            const existingTs = getMessageTimestamp(ex.time)
            if (serverTs !== null && existingTs !== null && Math.abs(serverTs - existingTs) < 60000) {
              stableKey = key
              idBridge.serverToTemp.set(m.id, key)
              idBridge.tempToServer.set(key, m.id)
              break
            }
          }
          continue
        }

        if (!ex.isOptimistic) continue
        if (ex.text !== messageText) continue
        const serverTs = getMessageTimestamp(m.time)
        const existingTs = getMessageTimestamp(ex.time)
        if (serverTs !== null && existingTs !== null && Math.abs(serverTs - existingTs) < 5000) {
          stableKey = key
          idBridge.serverToTemp.set(m.id, key)
          idBridge.tempToServer.set(key, m.id)
          break
        }
      }
    }

    const finalKey = stableKey || String(m.id)
    const existing = messagesByKey.get(finalKey) as (T & {
      decryption_error?: boolean
      text?: string
      media_paths?: string[]
      audio_summary?: string | null
      time?: string
      reaction?: string | null
      replySnippet?: string
      storyReply?: unknown
    }) | undefined

    const shouldPreserveExistingText =
      existing &&
      !existing.decryption_error &&
      existing.text &&
      !existing.text.startsWith('[🔒') &&
      m.decryption_error

    const finalText = shouldPreserveExistingText ? existing.text : messageText
    const finalDecryptionError = shouldPreserveExistingText ? false : m.decryption_error
    const docFields = mergeDocumentFields(m, existing)
    const serverReaction = m.reaction || null

    messagesByKey.set(finalKey, {
      ...(existing || {}),
      id: m.id,
      text: finalText,
      image_path: m.image_path,
      video_path: m.video_path,
      media_paths: m.media_paths ?? existing?.media_paths,
      audio_path: m.audio_path,
      audio_duration_seconds: m.audio_duration_seconds,
      audio_summary: existing?.audio_summary || m.audio_summary || null,
      file_path: docFields.file_path,
      file_name: docFields.file_name,
      sent: isSentByMe,
      time: existing?.time ?? normalizedTime,
      reaction: serverReaction || existing?.reaction || idBasedReaction || meta.reaction,
      replySnippet: replySnippet || existing?.replySnippet || meta.replySnippet,
      storyReply: storyReply || existing?.storyReply,
      isOptimistic: false,
      edited_at: m.edited_at || null,
      clientKey: finalKey,
      is_encrypted: m.is_encrypted,
      encrypted_body: m.encrypted_body,
      encrypted_body_for_sender: m.encrypted_body_for_sender,
      signal_protocol: m.signal_protocol,
      decryption_error: finalDecryptionError,
    } as unknown as T)
  })

  const seenServerIds = new Map<number | string, string>()
  for (const [key, msg] of messagesByKey.entries()) {
    const serverId = (msg as { id?: number | string }).id
    if (serverId && !String(serverId).startsWith('temp_')) {
      if (seenServerIds.has(serverId)) {
        const existingKey = seenServerIds.get(serverId)!
        if (key.startsWith('temp_')) {
          messagesByKey.delete(existingKey)
          seenServerIds.set(serverId, key)
        } else {
          messagesByKey.delete(key)
        }
      } else {
        seenServerIds.set(serverId, key)
      }
    }
  }

  const now = Date.now()
  for (const [key, msg] of messagesByKey.entries()) {
    const m = msg as T & { isOptimistic?: boolean; sendFailed?: boolean; time?: string }
    if (m.isOptimistic && !m.sendFailed) {
      if (shouldRetainOptimisticDuringUpload(m, now)) continue
      const ts = getMessageTimestamp(m.time)
      if (ts !== null) {
        if (now - ts > 30000) messagesByKey.delete(key)
      } else {
        messagesByKey.delete(key)
      }
    }
  }

  const sorted = Array.from(messagesByKey.values()).sort((a, b) => {
    const aRaw = (a as { id?: number | string }).id
    const bRaw = (b as { id?: number | string }).id
    const aId = typeof aRaw === 'number' ? aRaw : parseInt(String(aRaw), 10) || 0
    const bId = typeof bRaw === 'number' ? bRaw : parseInt(String(bRaw), 10) || 0
    const aIsServer = aId > 0
    const bIsServer = bId > 0
    if (aIsServer && bIsServer) return aId - bId
    if (aIsServer && !bIsServer) return -1
    if (!aIsServer && bIsServer) return 1
    const aTs = getMessageTimestamp((a as { time?: string }).time) ?? Date.now()
    const bTs = getMessageTimestamp((b as { time?: string }).time) ?? Date.now()
    return aTs - bTs
  })

  return retainMessagesIfUnchanged(prev, sorted, messagePollSignature as (m: T) => string)
}
