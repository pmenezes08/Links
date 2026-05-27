import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { clearDeviceCache, readDeviceCache, writeDeviceCache } from '../utils/deviceCache'

const DRAFT_PREFS_PREFIX = 'chat_draft:'

function draftPrefsKey(storageKey: string) {
  return `${DRAFT_PREFS_PREFIX}${storageKey}`
}

async function readDraftFromPreferences(storageKey: string): Promise<string | null> {
  if (Capacitor.getPlatform() === 'web') return null
  try {
    const { value } = await Preferences.get({ key: draftPrefsKey(storageKey) })
    return value?.trim() || null
  } catch {
    return null
  }
}

async function writeDraftToPreferences(storageKey: string, text: string | null): Promise<void> {
  if (Capacitor.getPlatform() === 'web') return
  try {
    const key = draftPrefsKey(storageKey)
    if (text?.trim()) await Preferences.set({ key, value: text.trim() })
    else await Preferences.remove({ key })
  } catch {
    // ignore quota / native errors
  }
}

export interface UseChatDraftOptions {
  storageKey: string | null
  enabled: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  draftRef: MutableRefObject<string>
  setDraftDisplay: (value: string) => void
  adjustTextareaHeight?: () => void
  debounceMs?: number
}

/** Restore + persist composer draft via device cache. */
export function useChatDraft({
  storageKey,
  enabled,
  textareaRef,
  draftRef,
  setDraftDisplay,
  adjustTextareaHeight,
  debounceMs = 500,
}: UseChatDraftOptions) {
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || !storageKey || !textareaRef.current) return

    if (textareaRef.current.value) {
      textareaRef.current.value = ''
    }

    const applyDraft = (savedDraft: string | null | undefined) => {
      if (savedDraft?.trim()) {
        textareaRef.current!.value = savedDraft
        draftRef.current = savedDraft
        setDraftDisplay(savedDraft)
      } else {
        draftRef.current = ''
        setDraftDisplay('')
      }
      adjustTextareaHeight?.()
    }

    const cachedDraft = readDeviceCache<string>(storageKey)
    if (cachedDraft?.trim()) {
      applyDraft(cachedDraft)
      return
    }

    applyDraft(null)

    let cancelled = false
    void readDraftFromPreferences(storageKey).then(prefsDraft => {
      if (cancelled || !prefsDraft?.trim() || !textareaRef.current) return
      if (draftRef.current.trim()) return
      textareaRef.current.value = prefsDraft
      draftRef.current = prefsDraft
      setDraftDisplay(prefsDraft)
      adjustTextareaHeight?.()
      writeDeviceCache(storageKey, prefsDraft)
    })

    return () => {
      cancelled = true
    }
  }, [enabled, storageKey, textareaRef, draftRef, setDraftDisplay, adjustTextareaHeight])

  useEffect(() => {
    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current)
      if (!storageKey) return
      const current = draftRef.current?.trim()
      if (current) writeDeviceCache(storageKey, current)
      else clearDeviceCache(storageKey)
    }
  }, [storageKey, draftRef])

  const scheduleSave = (text: string) => {
    if (!storageKey) return
    draftRef.current = text
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current)
    draftSaveTimeoutRef.current = setTimeout(() => {
      const trimmed = text.trim()
      if (trimmed) {
        writeDeviceCache(storageKey, trimmed)
        void writeDraftToPreferences(storageKey, trimmed)
      } else {
        clearDeviceCache(storageKey)
        void writeDraftToPreferences(storageKey, null)
      }
    }, debounceMs)
  }

  const clearDraft = () => {
    if (!storageKey) return
    clearDeviceCache(storageKey)
    void writeDraftToPreferences(storageKey, null)
    draftRef.current = ''
  }

  return { scheduleSave, clearDraft, draftSaveTimeoutRef }
}
