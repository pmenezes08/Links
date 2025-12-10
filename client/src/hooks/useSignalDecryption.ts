import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { encryptionService } from '../services/simpleEncryption'
import { signalService } from '../services/signalProtocol'
import type { ChatMessage } from '../types/chat'
import { safeLocalStorageGet } from '../utils/storage'

export const DECRYPTION_RETRY_DELAY_MS = 4000
export const SIGNAL_PENDING_TEXT = '[🔒 Setting up secure session…]'

// const MAX_SIGNAL_RETRIES = 2 // Currently unused - session errors are marked permanent
const SIGNAL_DECRYPT_CACHE_BASE_KEY = 'signal_decrypted_messages'
const SIGNAL_DECRYPT_CACHE_VERSION = 'signal-v2'
const SIGNAL_DECRYPT_CACHE_LIMIT = 400

type CacheEntry = { text: string; error: boolean }

function buildDecryptionCacheKey(username?: string | null, deviceId?: string | number | null) {
  const normalizedUser = (username || 'anonymous').toLowerCase()
  const normalizedDevice = deviceId ? String(deviceId) : 'nodevice'
  return `${SIGNAL_DECRYPT_CACHE_BASE_KEY}:${normalizedUser}:${normalizedDevice}:${SIGNAL_DECRYPT_CACHE_VERSION}`
}

function normalizeCacheMessageId(id: number | string): string {
  return String(id)
}

type UseSignalDecryptionOptions = {
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
}

export function useSignalDecryption({ messages, setMessages }: UseSignalDecryptionOptions) {
  const initialUsernameRef = useRef<string | null>(safeLocalStorageGet('current_username'))
  const initialSignalDeviceIdRef = useRef<string | null>(safeLocalStorageGet('signal_device_id'))
  const currentUserRef = useRef<string | null>(initialUsernameRef.current)
  const userFetchPromiseRef = useRef<Promise<string | null> | null>(null)
  const signalInitPromiseRef = useRef<Promise<boolean> | null>(null)
  const decryptionCache = useRef<Map<string, CacheEntry>>(new Map())
  const decryptionFailures = useRef<Map<string, { lastAttempt: number; errorText: string; permanent?: boolean }>>(new Map())
  const pendingCiphertextRequests = useRef<Map<string, Promise<any>>>(new Map())
  // Track which sessions have been cleared recently to avoid clearing multiple times
  const clearedSessionsRef = useRef<Map<string, number>>(new Map())
  const SESSION_CLEAR_COOLDOWN_MS = 30000 // 30 seconds
  const messagesRef = useRef<ChatMessage[]>([])
  const decryptionCacheStorageKeyRef = useRef(
    buildDecryptionCacheKey(initialUsernameRef.current, initialSignalDeviceIdRef.current)
  )
  const pendingDecryptionCacheSaveRef = useRef<number | null>(null)
  const [signalReadyTick, setSignalReadyTick] = useState(0)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const loadDecryptionCache = useCallback((storageKey: string) => {
    if (typeof window === 'undefined') return
    try {
      let raw = window.localStorage.getItem(storageKey)
      if (!raw && storageKey !== SIGNAL_DECRYPT_CACHE_BASE_KEY) {
        raw = window.localStorage.getItem(SIGNAL_DECRYPT_CACHE_BASE_KEY)
        if (raw) {
          console.log('🔐 Migrating legacy Signal cache into', storageKey)
          window.localStorage.removeItem(SIGNAL_DECRYPT_CACHE_BASE_KEY)
        }
      }
      decryptionCache.current.clear()
      if (!raw) return
      const parsed = JSON.parse(raw)
      const entries =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.entries
          ? parsed.entries
          : parsed
      if (!entries || typeof entries !== 'object') return
      Object.entries(entries as Record<string, CacheEntry>).forEach(([key, value]) => {
        if (value && typeof value.text === 'string') {
          decryptionCache.current.set(String(key), value)
        }
      })
      console.log('🔐 Loaded', decryptionCache.current.size, 'cached decrypted messages from', storageKey)
    } catch (error) {
      console.warn('Failed to load decryption cache:', error)
      decryptionCache.current.clear()
    }
  }, [])

  const persistDecryptionCache = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      const payload = {
        version: SIGNAL_DECRYPT_CACHE_VERSION,
        savedAt: Date.now(),
        entries: Object.fromEntries(
          Array.from(decryptionCache.current.entries()).filter(([, value]) => !value.error)
        ),
      }
      window.localStorage.setItem(decryptionCacheStorageKeyRef.current, JSON.stringify(payload))
    } catch (error) {
      console.warn('Failed to save decryption cache:', error)
    }
  }, [])

  const scheduleDecryptionCacheSave = useCallback(() => {
    if (typeof window === 'undefined') return
    if (pendingDecryptionCacheSaveRef.current) return
    pendingDecryptionCacheSaveRef.current = window.setTimeout(() => {
      pendingDecryptionCacheSaveRef.current = null
      persistDecryptionCache()
    }, 600)
  }, [persistDecryptionCache])

  const refreshDecryptionCacheStorageKey = useCallback(
    (user?: string | null, deviceId?: number | string | null) => {
      const nextKey = buildDecryptionCacheKey(user, deviceId)
      if (nextKey === decryptionCacheStorageKeyRef.current) return
      decryptionCacheStorageKeyRef.current = nextKey
      loadDecryptionCache(nextKey)
      if (typeof window !== 'undefined' && nextKey !== SIGNAL_DECRYPT_CACHE_BASE_KEY) {
        try {
          window.localStorage.removeItem(SIGNAL_DECRYPT_CACHE_BASE_KEY)
        } catch {
          // ignore
        }
      }
    },
    [loadDecryptionCache]
  )

  const fetchCurrentUsername = useCallback(async (): Promise<string | null> => {
    if (currentUserRef.current) return currentUserRef.current
    const cached = safeLocalStorageGet('current_username')
    if (cached) {
      currentUserRef.current = cached
      refreshDecryptionCacheStorageKey(cached, signalService.getDeviceId() || initialSignalDeviceIdRef.current)
      return cached
    }
    if (!userFetchPromiseRef.current) {
      userFetchPromiseRef.current = fetch('/api/profile_me', { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) return null
          const data = await res.json().catch(() => null)
          return data?.profile?.username || data?.username || null
        })
        .then((name) => {
          if (name && typeof window !== 'undefined') {
            window.localStorage.setItem('current_username', name)
          }
          currentUserRef.current = name
          refreshDecryptionCacheStorageKey(
            name,
            signalService.getDeviceId() || safeLocalStorageGet('signal_device_id')
          )
          userFetchPromiseRef.current = null
          return name
        })
        .catch((error) => {
          console.error('Failed to fetch current username', error)
          userFetchPromiseRef.current = null
          return null
        })
    }
    return userFetchPromiseRef.current
  }, [refreshDecryptionCacheStorageKey])

  const ensureSignalInitialized = useCallback(async (): Promise<boolean> => {
    if (signalService.isInitialized() && signalService.getDeviceId()) {
      refreshDecryptionCacheStorageKey(signalService.getUsername() || currentUserRef.current, signalService.getDeviceId())
      return true
    }
    if (signalInitPromiseRef.current) {
      return signalInitPromiseRef.current
    }
    signalInitPromiseRef.current = (async () => {
      const existingUser = signalService.getUsername()
      const resolvedUsername = existingUser || (await fetchCurrentUsername())
      if (!resolvedUsername) {
        console.warn('🔐 Unable to initialize Signal: missing username')
        return false
      }
      try {
        const { deviceId } = await signalService.init(resolvedUsername)
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('signal_device_id', String(deviceId))
          window.localStorage.setItem('current_username', resolvedUsername)
        }
        currentUserRef.current = resolvedUsername
        refreshDecryptionCacheStorageKey(resolvedUsername, deviceId)
        setSignalReadyTick((tick) => tick + 1)
        return true
      } catch (error) {
        console.error('🔐 ensureSignalInitialized failed:', error)
        return false
      } finally {
        signalInitPromiseRef.current = null
      }
    })()
    const result = await signalInitPromiseRef.current
    return result
  }, [fetchCurrentUsername, refreshDecryptionCacheStorageKey])

  useEffect(() => {
    loadDecryptionCache(decryptionCacheStorageKeyRef.current)
    return () => {
      if (pendingDecryptionCacheSaveRef.current !== null) {
        window.clearTimeout(pendingDecryptionCacheSaveRef.current)
        pendingDecryptionCacheSaveRef.current = null
        persistDecryptionCache()
      }
    }
  }, [loadDecryptionCache, persistDecryptionCache])

  useEffect(() => {
    const usernameForCache = currentUserRef.current || initialUsernameRef.current
    const deviceIdForCache =
      signalService.getDeviceId() || safeLocalStorageGet('signal_device_id') || initialSignalDeviceIdRef.current
    refreshDecryptionCacheStorageKey(usernameForCache, deviceIdForCache)
  }, [refreshDecryptionCacheStorageKey, signalReadyTick])

  useEffect(() => {
    let cancelled = false
    const attempt = async () => {
      const ready = await ensureSignalInitialized()
      if (!ready && !cancelled) {
        setTimeout(attempt, 2000)
      }
    }
    attempt()
    return () => {
      cancelled = true
    }
  }, [ensureSignalInitialized])

  const cacheDecryptedMessage = useCallback(
    (messageId: number | string, value: CacheEntry, immediate = false) => {
      const cacheKey = normalizeCacheMessageId(messageId)
      const cache = decryptionCache.current
      if (cache.has(cacheKey)) {
        cache.delete(cacheKey)
      }
      cache.set(cacheKey, value)
      while (cache.size > SIGNAL_DECRYPT_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value
        if (typeof oldestKey === 'undefined') break
        cache.delete(oldestKey)
      }
      
      // For sent messages (immediate=true), persist immediately to localStorage
      // This ensures the plaintext survives page reloads
      if (immediate) {
        persistDecryptionCache()
      } else {
        scheduleDecryptionCacheSave()
      }
    },
    [scheduleDecryptionCacheSave, persistDecryptionCache]
  )

  const recordDecryptionFailure = useCallback((messageId: number | string, errorText: string, permanent = false) => {
    decryptionFailures.current.set(normalizeCacheMessageId(messageId), {
      lastAttempt: Date.now(),
      errorText,
      permanent,
    })
  }, [])

  const clearDecryptionFailure = useCallback((messageId: number | string) => {
    decryptionFailures.current.delete(normalizeCacheMessageId(messageId))
  }, [])

  const shouldRetryDecryption = useCallback(
    (message: ChatMessage) => {
      if (!message) return false
      const failure = decryptionFailures.current.get(normalizeCacheMessageId(message.id))
      if (failure?.permanent) return false
      return Boolean(message.decryption_error) || message.text === SIGNAL_PENDING_TEXT
    },
    []
  )

  const fetchCiphertextPayload = useCallback(async (messageId: number | string, deviceId: number) => {
    const key = `${messageId}:${deviceId}`
    let pending = pendingCiphertextRequests.current.get(key)
    if (!pending) {
      pending = (async () => {
        const encodedId = encodeURIComponent(String(messageId))
        const response = await fetch(`/api/signal/get-ciphertext/${encodedId}?deviceId=${deviceId}`, {
          credentials: 'include',
        })
        if (!response.ok) {
          const error: any = new Error(`Failed to fetch ciphertext: ${response.status}`)
          error.status = response.status
          throw error
        }
        return response.json()
      })()
      pendingCiphertextRequests.current.set(key, pending)
      pending
        .finally(() => {
          pendingCiphertextRequests.current.delete(key)
        })
        .catch(() => {})
    }
    return pending
  }, [])

  const decryptSignalMessage = useCallback(
    async (message: ChatMessage): Promise<ChatMessage> => {
      const ready = await ensureSignalInitialized()
      if (!ready) {
        const pending = '[🔒 Signal: Device not initialized]'
        recordDecryptionFailure(message.id, pending)
        return {
          ...message,
          text: pending,
          decryption_error: true,
        }
      }

      const deviceId = signalService.getDeviceId()
      if (!deviceId) {
        const pending = '[🔒 Signal: Device not initialized]'
        recordDecryptionFailure(message.id, pending)
        return {
          ...message,
          text: pending,
          decryption_error: true,
        }
      }

      const cacheKeyString = normalizeCacheMessageId(message.id)
      const cached = decryptionCache.current.get(cacheKeyString)
      if (cached && !cached.error) {
        clearDecryptionFailure(cacheKeyString)
        return {
          ...message,
          text: cached.text,
          decryption_error: false,
        }
      }

      let senderUsernameFromResponse: string | null = null
      let senderDeviceIdFromResponse: number | null = null

      try {
        let data: any
        try {
          data = await fetchCiphertextPayload(message.id, deviceId)
        } catch (fetchError) {
          const status = (fetchError as any)?.status
          if (status === 404) {
            // 404 means no ciphertext exists for this device
            // This is PERMANENT - the sender encrypted for a different device
            // The ciphertext won't magically appear, so don't keep retrying
            const errorText = '[🔒 Message not encrypted for this device]'
            recordDecryptionFailure(message.id, errorText, true) // Mark as PERMANENT
            return {
              ...message,
              text: errorText,
              decryption_error: true,
            }
          }
          throw fetchError
        }

        senderUsernameFromResponse = data.senderUsername
        senderDeviceIdFromResponse = data.senderDeviceId

        console.log('🔐 Got ciphertext data:', {
          messageId: message.id,
          senderUsername: data.senderUsername,
          senderDeviceId: data.senderDeviceId,
          messageType: data.messageType,
          ciphertextLength: data.ciphertext?.length,
        })

        if (!data.success || !data.ciphertext) {
          throw new Error('Invalid ciphertext response')
        }

        const result = await signalService.decryptMessage(
          data.senderUsername,
          data.senderDeviceId,
          data.ciphertext,
          data.messageType
        )

        console.log('🔐 ✅ Decryption succeeded for message:', message.id)

        cacheDecryptedMessage(message.id, { text: result.plaintext, error: false })
        clearDecryptionFailure(cacheKeyString)

        return {
          ...message,
          text: result.plaintext,
          decryption_error: false,
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('🔐 ❌ Signal decryption failed for message:', message.id, 'Error:', errorMsg, error)

        // Determine if this is a permanent error that won't improve with retries
        // These are typically session/key state issues that require re-encryption
        const isSessionError =
          /message key not found/i.test(errorMsg) ||
          /counter was repeated/i.test(errorMsg) ||
          /session has been reset/i.test(errorMsg) ||
          /bad mac/i.test(errorMsg) ||
          /invalid mac/i.test(errorMsg) ||
          /mac check failed/i.test(errorMsg) ||
          /no record for device/i.test(errorMsg) ||
          /no session for device/i.test(errorMsg) ||
          /invalid ciphertext/i.test(errorMsg)

        // Session errors are permanent - the message was encrypted with a key/session
        // that no longer matches. Re-trying won't help.
        if (isSessionError) {
          const displayError = '[🔒 Message cannot be decrypted - session mismatch]'
          recordDecryptionFailure(message.id, displayError, true) // permanent
          
          // Try to clear the corrupted session for future messages
          // Use cooldown to prevent clearing the same session multiple times
          if (senderUsernameFromResponse && senderDeviceIdFromResponse) {
            const sessionKey = `${senderUsernameFromResponse.toLowerCase()}.${senderDeviceIdFromResponse}`
            const lastCleared = clearedSessionsRef.current.get(sessionKey)
            const now = Date.now()
            
            if (!lastCleared || (now - lastCleared) > SESSION_CLEAR_COOLDOWN_MS) {
              try {
                await signalService.clearSessionForDevice(senderUsernameFromResponse, senderDeviceIdFromResponse)
                clearedSessionsRef.current.set(sessionKey, now)
                console.log('🔐 Cleared corrupted session for future messages:', sessionKey)
              } catch {
                // Ignore - best effort
              }
            } else {
              console.log('🔐 Session already cleared recently, skipping:', sessionKey)
            }
          }
          
          return {
            ...message,
            text: displayError,
            decryption_error: true,
          }
        }

        // Other errors might be transient - allow retry
        const displayError = `[🔒 Decryption failed: ${errorMsg.slice(0, 50)}]`
        recordDecryptionFailure(message.id, displayError, false)

        return {
          ...message,
          text: displayError,
          decryption_error: true,
        }
      }
    },
    [cacheDecryptedMessage, clearDecryptionFailure, ensureSignalInitialized, fetchCiphertextPayload, recordDecryptionFailure]
  )

  const decryptMessageIfNeeded = useCallback(
    async (message: ChatMessage): Promise<ChatMessage> => {
      if (!message.is_encrypted) {
        return message
      }

      const cacheKeyString = normalizeCacheMessageId(message.id)

      // First check in-memory cache
      const cached = decryptionCache.current.get(cacheKeyString)
      // Only use cache for SUCCESSFUL decryptions - don't cache errors
      if (cached && !cached.error) {
        console.log('🔐 Using cached decryption for message:', message.id)
        clearDecryptionFailure(cacheKeyString)
        return {
          ...message,
          text: cached.text,
          decryption_error: false,
        }
      }

      // Check if message already has valid decrypted text (from state)
      // This handles the case where text was decrypted but cache was cleared
      if (message.text && 
          !message.decryption_error && 
          !message.text.startsWith('[🔒') &&
          message.text.trim().length > 0) {
        // Message has valid plaintext - cache it for future use
        console.log('🔐 Message already has plaintext, caching:', message.id)
        cacheDecryptedMessage(message.id, { text: message.text, error: false })
        clearDecryptionFailure(cacheKeyString)
        return message
      }

      const failureInfo = decryptionFailures.current.get(cacheKeyString)
      if (failureInfo) {
        if (failureInfo.permanent) {
          return {
            ...message,
            text: failureInfo.errorText,
            decryption_error: true,
          }
        }
        const timeSinceFailure = Date.now() - failureInfo.lastAttempt
        if (timeSinceFailure < DECRYPTION_RETRY_DELAY_MS) {
          return {
            ...message,
            text: failureInfo.errorText,
            decryption_error: true,
          }
        }
        decryptionFailures.current.delete(cacheKeyString)
      }

      if (message.signal_protocol) {
        // CRITICAL: For SENT messages, the current device cannot decrypt its own ciphertext!
        // Signal sessions are asymmetric - you can't decrypt what you encrypted.
        // The sender's current device must use cached plaintext.
        if (message.sent) {
          // For sent messages, check cache first - this is the only source of truth for the sender
          const cached = decryptionCache.current.get(cacheKeyString)
          if (cached && !cached.error) {
            console.log('🔐 Using cached plaintext for SENT Signal message:', message.id)
            clearDecryptionFailure(cacheKeyString)
            return {
              ...message,
              text: cached.text,
              decryption_error: false,
            }
          }
          
          // If no cache, this is a sent message we don't have plaintext for
          // This can happen if: page reloaded, cache cleared, or this is from another device
          // Try to see if there's a ciphertext for this device (only works if sent from another device)
          console.log('🔐 Sent Signal message without cached plaintext, checking if decryptable:', message.id)
          
          // If we sent this message ourselves (on this device), we should have the plaintext cached
          // If not, it means the cache was cleared - mark as unrecoverable for this device
          const deviceId = signalService.getDeviceId()
          if (deviceId) {
            try {
              // Check if there's a ciphertext entry for our device (meaning another device sent it)
              const response = await fetch(`/api/signal/get-ciphertext/${message.id}?deviceId=${deviceId}`, {
                credentials: 'include',
              })
              if (response.ok) {
                // There's a ciphertext for us - try to decrypt (this means another device sent it)
                console.log('🔐 Found ciphertext for sent message - was sent from another device')
                const decryptedSignal = await decryptSignalMessage(message)
                if (!decryptedSignal.decryption_error) {
                  clearDecryptionFailure(cacheKeyString)
                }
                return decryptedSignal
              }
            } catch {
              // No ciphertext available - this was sent from THIS device, cache is lost
            }
          }
          
          // No ciphertext for this device - message was sent from here but cache cleared
          const errorText = '[🔒 Sent message - plaintext cache cleared]'
          recordDecryptionFailure(message.id, errorText, true) // permanent
          return {
            ...message,
            text: errorText,
            decryption_error: true,
          }
        }
        
        // For RECEIVED messages, proceed with normal decryption
        const decryptedSignal = await decryptSignalMessage(message)
        // Only clear failure if decryption succeeded
        if (!decryptedSignal.decryption_error) {
          clearDecryptionFailure(cacheKeyString)
        }
        return decryptedSignal
      }

      let encryptedData: string | null = null

      if (message.sent) {
        encryptedData = message.encrypted_body_for_sender ?? null
        if (!encryptedData) {
          if (message.text && message.text.trim()) {
            return { ...message, decryption_error: false }
          }
          // Missing sender copy is permanent - data wasn't stored
          const errorText = '[🔒 Encrypted message - missing sender copy]'
          recordDecryptionFailure(message.id, errorText, true)
          return {
            ...message,
            text: errorText,
            decryption_error: true,
          }
        }
      } else {
        encryptedData = message.encrypted_body ?? null
        if (!encryptedData) {
          // Missing data is permanent - data wasn't stored
          const errorText = '[🔒 Encrypted message - missing data]'
          recordDecryptionFailure(message.id, errorText, true)
          return {
            ...message,
            text: errorText,
            decryption_error: true,
          }
        }
      }

      try {
        const decryptedText = await encryptionService.decryptMessage(encryptedData)
        cacheDecryptedMessage(message.id, { text: decryptedText, error: false })
        clearDecryptionFailure(cacheKeyString)
        return {
          ...message,
          text: decryptedText,
          decryption_error: false,
        }
      } catch (error) {
        console.error('🔐 ❌ Failed to decrypt message:', message.id, error)
        const failureText = '[🔒 Encrypted - decryption failed]'
        recordDecryptionFailure(cacheKeyString, failureText)
        return {
          ...message,
          text: failureText,
          decryption_error: true,
        }
      }
    },
    [cacheDecryptedMessage, clearDecryptionFailure, decryptSignalMessage, recordDecryptionFailure]
  )

  const retryFailedDecrypts = useCallback(async () => {
    const candidates = messagesRef.current.filter(shouldRetryDecryption)
    if (!candidates.length) return

    const unique = new Map<number | string, ChatMessage>()
    candidates.forEach((msg) => unique.set(msg.id, msg))

    unique.forEach((_, id) => decryptionFailures.current.delete(normalizeCacheMessageId(id)))

    const refreshed = await Promise.all(
      Array.from(unique.values()).map(async (msg) => {
        try {
          const updated = await decryptMessageIfNeeded(msg)
          return { id: msg.id, updated }
        } catch (error) {
          console.error('🔐 Retry decrypt failed for', msg.id, error)
          return null
        }
      })
    )

    const updateMap = new Map<number | string, ChatMessage>()
    refreshed.forEach((entry) => {
      if (entry?.updated) {
        updateMap.set(entry.id, entry.updated)
      }
    })

    if (!updateMap.size) return

    setMessages((prev) => prev.map((m) => (updateMap.has(m.id) ? updateMap.get(m.id)! : m)))
  }, [decryptMessageIfNeeded, setMessages, shouldRetryDecryption])

  const invalidateCachedDecryption = useCallback((messageId: number | string | null) => {
    if (messageId === null || messageId === undefined) return
    decryptionCache.current.delete(normalizeCacheMessageId(messageId))
  }, [])

  return {
    decryptMessageIfNeeded,
    retryFailedDecrypts,
    shouldRetryDecryption,
    signalReady: signalReadyTick > 0,
    invalidateCachedDecryption,
    cacheDecryptedMessage,
  }
}
