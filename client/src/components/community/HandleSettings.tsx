import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Manage Community — the "@address" identity card: handle field with live
 * availability in the hint-line slot (no icon circus), copy affordance,
 * and the "Open to join requests" findability toggle (disabled until a
 * handle is saved). Renders nothing for sub-communities or non-managers
 * (the settings endpoint refuses both). Saves through its own endpoint so
 * the page form stays untouched.
 */

export function normalizeHandleInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32)
}

type HintState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'invalid' }
  | { kind: 'cooldown'; days: number }
  | { kind: 'copied' }

export default function HandleSettings({ communityId }: { communityId: number | string }) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(false)
  const [savedHandle, setSavedHandle] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [discoverable, setDiscoverable] = useState(false)
  const [messageRequired, setMessageRequired] = useState(false)
  const [savedPrompt, setSavedPrompt] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [canChange, setCanChange] = useState(true)
  const [cooldownDays, setCooldownDays] = useState(0)
  const [hint, setHint] = useState<HintState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true
    fetch(`/api/community/${communityId}/handle_settings`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        if (!mounted) return
        if (data?.success) {
          setSavedHandle(data.handle || null)
          setDraft(data.handle || '')
          setDiscoverable(Boolean(data.discoverable))
          setMessageRequired(Boolean(data.join_request_message_required))
          setSavedPrompt(data.join_request_prompt || '')
          setPromptDraft(data.join_request_prompt || '')
          setCanChange(Boolean(data.can_change_handle))
          setCooldownDays(Number(data.cooldown_days_remaining) || 0)
          setVisible(true)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoaded(true)
      })
    return () => {
      mounted = false
    }
  }, [communityId])

  const dirty = draft !== (savedHandle || '')
  const draftValid = draft.length >= 3 && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(draft)

  const onDraftChange = useCallback(
    (raw: string) => {
      const normalized = normalizeHandleInput(raw)
      setDraft(normalized)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (normalized === (savedHandle || '')) {
        setHint({ kind: 'idle' })
        return
      }
      if (!canChange) {
        setHint({ kind: 'cooldown', days: cooldownDays })
        return
      }
      if (normalized.length < 3 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalized)) {
        setHint({ kind: 'invalid' })
        return
      }
      debounceRef.current = setTimeout(() => {
        setHint({ kind: 'checking' })
        fetch(`/api/community/handle_check?handle=${encodeURIComponent(normalized)}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
          .then(r => r.json())
          .then(data => {
            setDraft(current => {
              if (current === normalized) {
                if (!data?.valid) setHint({ kind: 'invalid' })
                else setHint(data.available ? { kind: 'available' } : { kind: 'taken' })
              }
              return current
            })
          })
          .catch(() => setHint({ kind: 'idle' }))
      }, 400)
    },
    [savedHandle, canChange, cooldownDays],
  )

  const saveHandle = useCallback(() => {
    if (!dirty || !draftValid || saving) return
    setSaving(true)
    fetch(`/api/community/${communityId}/handle_settings`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: draft }),
    })
      .then(r => r.json())
      .then(data => {
        if (data?.success) {
          setSavedHandle(data.handle || null)
          setDraft(data.handle || '')
          setCanChange(Boolean(data.can_change_handle))
          setCooldownDays(Number(data.cooldown_days_remaining) || 0)
          setHint({ kind: 'idle' })
        } else if (data?.reason === 'handle_taken') {
          setHint({ kind: 'taken' })
        } else if (data?.reason === 'handle_cooldown') {
          setHint({ kind: 'cooldown', days: Number(data.cooldown_days_remaining) || 0 })
        } else {
          setHint({ kind: 'invalid' })
        }
      })
      .catch(() => {})
      .finally(() => setSaving(false))
  }, [communityId, dirty, draft, draftValid, saving])

  const toggleDiscoverable = useCallback(() => {
    if (!savedHandle) return
    const next = !discoverable
    setDiscoverable(next)
    fetch(`/api/community/${communityId}/handle_settings`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discoverable: next }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data?.success) setDiscoverable(!next)
      })
      .catch(() => setDiscoverable(!next))
  }, [communityId, discoverable, savedHandle])

  const toggleMessageRequired = useCallback(() => {
    if (!savedHandle || !discoverable) return
    const next = !messageRequired
    setMessageRequired(next)
    fetch(`/api/community/${communityId}/handle_settings`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ join_request_message_required: next }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data?.success) setMessageRequired(!next)
      })
      .catch(() => setMessageRequired(!next))
  }, [communityId, discoverable, messageRequired, savedHandle])

  const savePrompt = useCallback(() => {
    if (savingPrompt) return
    const trimmed = promptDraft.trim()
    setSavingPrompt(true)
    fetch(`/api/community/${communityId}/handle_settings`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      // Empty string clears the question server-side.
      body: JSON.stringify({ join_request_prompt: trimmed }),
    })
      .then(r => r.json())
      .then(data => {
        if (data?.success) {
          setSavedPrompt(data.join_request_prompt || '')
          setPromptDraft(data.join_request_prompt || '')
        }
      })
      .catch(() => {})
      .finally(() => setSavingPrompt(false))
  }, [communityId, promptDraft, savingPrompt])

  const copyHandle = useCallback(() => {
    if (!savedHandle || dirty) return
    try {
      void navigator.clipboard.writeText(`@${savedHandle}`)
      setHint({ kind: 'copied' })
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setHint({ kind: 'idle' }), 1500)
    } catch {}
  }, [savedHandle, dirty])

  if (!loaded || !visible) return null

  const hintLine = (() => {
    switch (hint.kind) {
      case 'checking':
        return <span className="text-c-text-tertiary">{t('communities.handle_checking')}</span>
      case 'available':
        return <span className="text-cpoint-turquoise">{t('communities.handle_available')}</span>
      case 'taken':
        return <span className="text-red-400">{t('communities.handle_taken')}</span>
      case 'invalid':
        return <span className="text-red-400">{t('communities.handle_invalid')}</span>
      case 'cooldown':
        return <span className="text-red-400">{t('communities.handle_cooldown', { days: hint.days })}</span>
      case 'copied':
        return <span className="text-cpoint-turquoise">{t('communities.handle_copied')}</span>
      default:
        return <span className="text-c-text-tertiary">{t('communities.handle_helper')}</span>
    }
  })()

  return (
    <div className="rounded-lg border border-c-border bg-c-bg-app p-4">
      <label className="block text-sm font-medium text-c-text-primary mb-2">
        {t('communities.handle_section_title')}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-c-text-tertiary">@</span>
        <input
          className="w-full rounded-md bg-c-bg-app border border-c-border pl-7 pr-12 py-2 text-[16px] text-c-text-primary focus:border-cpoint-turquoise outline-none"
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        {!dirty && savedHandle && (
          <button
            type="button"
            onClick={copyHandle}
            aria-label={t('communities.handle_copy_aria')}
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-c-text-tertiary hover:text-c-text-primary"
          >
            <i className="fa-regular fa-copy text-sm" />
          </button>
        )}
      </div>
      <div className="text-xs mt-1 flex items-center gap-3">
        <span className="flex-1">{hintLine}</span>
        {dirty && draftValid && hint.kind === 'available' && (
          <button
            type="button"
            onClick={saveHandle}
            disabled={saving}
            className="font-medium text-cpoint-turquoise hover:brightness-110 disabled:opacity-50"
          >
            {t('communities.handle_save')}
          </button>
        )}
      </div>

      <div className="mt-3 border-t border-c-border pt-3">
        <label className={`flex items-center justify-between cursor-pointer ${!savedHandle ? 'opacity-40' : ''}`}>
          <div className="flex-1">
            <div className="text-sm font-medium text-c-text-primary">{t('communities.findable_label')}</div>
            <div className="text-xs text-c-text-tertiary mt-0.5">
              {!savedHandle
                ? t('communities.findable_requires_handle')
                : discoverable
                  ? t('communities.findable_hint_on')
                  : t('communities.findable_hint_off')}
            </div>
          </div>
          <div className="ml-3">
            <button
              type="button"
              disabled={!savedHandle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${discoverable ? 'bg-cpoint-turquoise' : 'bg-c-border-strong'}`}
              onClick={toggleDiscoverable}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${discoverable ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </label>
      </div>

      {/* Owner policy: a knock on this door must come with a note. Only
          meaningful while the community is findable, so it dims with the
          toggle above. */}
      <div className="mt-3 border-t border-c-border pt-3">
        <label className={`flex items-center justify-between cursor-pointer ${!savedHandle || !discoverable ? 'opacity-40' : ''}`}>
          <div className="flex-1">
            <div className="text-sm font-medium text-c-text-primary">{t('communities.join_message_required_label')}</div>
            <div className="text-xs text-c-text-tertiary mt-0.5">
              {!discoverable
                ? t('communities.join_message_requires_findable')
                : messageRequired
                  ? t('communities.join_message_required_hint_on')
                  : t('communities.join_message_required_hint_off')}
            </div>
          </div>
          <div className="ml-3">
            <button
              type="button"
              disabled={!savedHandle || !discoverable}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${messageRequired && discoverable ? 'bg-cpoint-turquoise' : 'bg-c-border-strong'}`}
              onClick={toggleMessageRequired}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${messageRequired && discoverable ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </label>

        {/* Owner-written question the message must answer. Requesters see it
            verbatim above the message box; the answer comes back on the
            request card. */}
        {messageRequired && discoverable && savedHandle && (
          <div className="mt-3">
            <label className="block text-xs text-c-text-tertiary mb-1">
              {t('communities.join_prompt_label')}
            </label>
            <textarea
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value.slice(0, 200))}
              maxLength={200}
              rows={2}
              placeholder={t('communities.join_prompt_placeholder')}
              className="w-full resize-none rounded-md border border-c-border bg-c-bg-app px-3 py-2 text-sm text-c-text-primary placeholder:text-c-text-disabled outline-none focus:border-cpoint-turquoise"
            />
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="flex-1 text-c-text-tertiary">
                {t('communities.join_prompt_hint')}
              </span>
              {promptDraft.trim() !== savedPrompt && (
                <button
                  type="button"
                  onClick={savePrompt}
                  disabled={savingPrompt}
                  className="font-medium text-cpoint-turquoise hover:brightness-110 disabled:opacity-50"
                >
                  {savingPrompt ? t('communities.saving') : t('common.save')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
