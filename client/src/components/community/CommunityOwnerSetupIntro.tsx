import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { clearDeviceCache } from '../../utils/deviceCache'
import { invalidateDashboardCache } from '../../utils/dashboardCache'
import { resolveCommunityBackgroundUrl } from '../../utils/communityBackgroundUrl'

export const communityOwnerSetupStorageKey = (username: string, communityId: string) =>
  `cpoint_community_owner_setup:v1:${username.trim().toLowerCase()}:${communityId}`

export const communityOwnerSetupResumeKey = (username: string, communityId: string) =>
  `cpoint_community_owner_setup_resume:v1:${username.trim().toLowerCase()}:${communityId}`

export const communityOwnerSetupDraftKey = (username: string, communityId: string) =>
  `cpoint_community_owner_setup_draft:v1:${username.trim().toLowerCase()}:${communityId}`

export type IntroStepId =
  | 'welcome'
  | 'structure'
  | 'description'
  | 'subscription'
  | 'member_limit'
  | 'image'
  | 'personality'
  | 'invite'

const LEGACY_STEP_ORDER: IntroStepId[] = [
  'welcome',
  'description',
  'subscription',
  'member_limit',
  'image',
  'personality',
]

export function buildIntroSteps(includeStructure: boolean): IntroStepId[] {
  if (includeStructure) {
    return [
      'welcome',
      'structure',
      'description',
      'subscription',
      'member_limit',
      'image',
      'personality',
      'invite',
    ]
  }
  return [...LEGACY_STEP_ORDER, 'invite']
}

function readInitialStepIndex(
  username: string,
  communityId: string,
  steps: IntroStepId[],
): number {
  try {
    const raw = sessionStorage.getItem(communityOwnerSetupResumeKey(username, communityId))
    if (!raw) return 0
    const j = JSON.parse(raw) as { step?: unknown; stepIndex?: unknown }
    if (typeof j?.step === 'string') {
      const id = j.step as IntroStepId
      let idx = steps.indexOf(id)
      if (id === 'structure' && idx < 0) {
        idx = steps.indexOf('description')
      }
      if (idx >= 0) return idx
    }
    if (typeof j?.stepIndex === 'number' && Number.isFinite(j.stepIndex)) {
      const legacy = Math.max(0, Math.min(LEGACY_STEP_ORDER.length - 1, Math.floor(j.stepIndex)))
      const id = LEGACY_STEP_ORDER[legacy]
      const includeStructure = steps.includes('structure')
      if (includeStructure) {
        return legacy === 0 ? 0 : legacy + 1
      }
      return steps.indexOf(id)
    }
  } catch {
    /* ignore */
  }
  return 0
}

/**
 * Rehydrates only the fields this wizard actually edits. Everything else comes
 * from the live server snapshot, so a stale stored draft can never push back an
 * old name or parent over a change made elsewhere.
 */
function readStoredDraft(
  username: string,
  communityId: string,
  fallback: CommunityOwnerSetupSnapshot,
): CommunityOwnerSetupSnapshot {
  try {
    const raw = sessionStorage.getItem(communityOwnerSetupDraftKey(username, communityId))
    if (!raw) return { ...fallback }
    const j = JSON.parse(raw) as Partial<CommunityOwnerSetupSnapshot> | null
    if (!j || typeof j !== 'object') return { ...fallback }
    return {
      ...fallback,
      description: typeof j.description === 'string' ? j.description : fallback.description,
      maxMembers: typeof j.maxMembers === 'string' ? j.maxMembers : fallback.maxMembers,
    }
  } catch {
    return { ...fallback }
  }
}

export type CommunityOwnerSetupSnapshot = {
  name: string
  description: string
  networkType: string
  parentCommunityId: number | null
  notifyOnNewMember: boolean
  maxMembers: string
  backgroundPath: string | null
}

export type CommunityOwnerSetupIntroProps = {
  communityId: string
  username: string
  ownerDisplayName: string
  showSubCommunityFirstStep: boolean
  memberCap: number | null
  tierLabel: string | null
  billingInherited: boolean
  initialSnapshot: CommunityOwnerSetupSnapshot
  deviceFeedCacheKey: string | null
  onFinished: (reason: 'completed' | 'dismissed') => void
  onOpenManageCommunity: () => void
  onCommunityUpdated: () => void | Promise<void>
}

const PANEL_CLASS = 'rounded-2xl border border-c-border bg-c-bg-app'

function snapshotsEqual(a: CommunityOwnerSetupSnapshot, b: CommunityOwnerSetupSnapshot): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.networkType === b.networkType &&
    a.parentCommunityId === b.parentCommunityId &&
    a.notifyOnNewMember === b.notifyOnNewMember &&
    a.maxMembers === b.maxMembers &&
    a.backgroundPath === b.backgroundPath
  )
}

function ManageCommunityHint({
  busy,
  onOpenManageCommunity,
  onStay,
}: {
  busy?: boolean
  onOpenManageCommunity: () => void
  onStay: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5 text-center">
      <p className="text-sm leading-relaxed text-[#d5e4e7]">
        {t('communities.owner_setup_manage_hint')}
      </p>
      <p className="text-[10px] leading-relaxed text-white/30">
        {t('communities.owner_setup_manage_nav_hint')}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          disabled={busy}
          onClick={onOpenManageCommunity}
          className="w-full rounded-xl bg-cpoint-turquoise px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50 sm:w-auto"
        >
          {t('communities.owner_setup_open_manage')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onStay}
          className="w-full rounded-xl border border-c-border bg-c-bg-surface px-5 py-3 text-sm font-medium text-c-text-secondary transition hover:bg-c-hover-bg disabled:opacity-50 sm:w-auto"
        >
          {t('communities.owner_setup_stay_on_feed')}
        </button>
      </div>
    </div>
  )
}

export default function CommunityOwnerSetupIntro({
  communityId,
  username,
  ownerDisplayName,
  showSubCommunityFirstStep,
  memberCap,
  tierLabel,
  billingInherited,
  initialSnapshot,
  deviceFeedCacheKey,
  onFinished,
  onOpenManageCommunity,
  onCommunityUpdated,
}: CommunityOwnerSetupIntroProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const titleId = useId()
  const steps = useMemo(() => buildIntroSteps(showSubCommunityFirstStep), [showSubCommunityFirstStep])
  const stepCount = steps.length

  const prevIncludeStructureRef = useRef(showSubCommunityFirstStep)
  const [phase, setPhase] = useState<'steps' | 'exit_hint'>('steps')
  const [stepIndex, setStepIndex] = useState(() =>
    readInitialStepIndex(username, communityId, buildIntroSteps(showSubCommunityFirstStep)),
  )
  const [exitContext, setExitContext] = useState<'skipped' | 'finished_wizard' | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  const currentStepId = steps[Math.min(stepIndex, steps.length - 1)] ?? 'welcome'

  // Restored from sessionStorage so a reload, a backgrounded app, or a WebView
  // reap does not throw away setup work either.
  const [draft, setDraft] = useState<CommunityOwnerSetupSnapshot>(() =>
    readStoredDraft(username, communityId, initialSnapshot),
  )
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [removeBackground, setRemoveBackground] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveHint, setSaveHint] = useState<string | null>(null)

  const [aiPersonalities, setAiPersonalities] = useState<Array<{ key: string; name: string }>>([])
  const [aiPersonality, setAiPersonality] = useState('friendly')
  const [savingPersonality, setSavingPersonality] = useState(false)

  // What the server currently holds. Anything in `draft` that differs from this
  // is unsaved work, and must be flushed before the wizard navigates or closes —
  // owners were losing whole setups by leaving on a step they had filled in.
  const savedRef = useRef<CommunityOwnerSetupSnapshot>({ ...initialSnapshot })
  const savedPersonalityRef = useRef('friendly')
  const personalityTouchedRef = useRef(false)

  useEffect(() => {
    const prevSaved = savedRef.current
    savedRef.current = { ...initialSnapshot }
    // Adopt server truth only when the owner has nothing unsaved in flight;
    // a background feed reload must never wipe what they just typed.
    setDraft(cur => (snapshotsEqual(cur, prevSaved) ? { ...initialSnapshot } : cur))
  }, [initialSnapshot])

  useEffect(() => {
    const prev = prevIncludeStructureRef.current
    if (prev === showSubCommunityFirstStep) return
    prevIncludeStructureRef.current = showSubCommunityFirstStep
    const oldSteps = buildIntroSteps(prev)
    const newSteps = buildIntroSteps(showSubCommunityFirstStep)
    setStepIndex(cur => {
      const id = oldSteps[Math.min(cur, oldSteps.length - 1)]
      let idx = newSteps.indexOf(id)
      if (id === 'structure' && idx < 0) idx = newSteps.indexOf('description')
      return idx >= 0 ? idx : 0
    })
  }, [showSubCommunityFirstStep])

  useEffect(() => {
    setSaveHint(null)
  }, [stepIndex])

  useEffect(() => {
    const key = communityOwnerSetupDraftKey(username, communityId)
    try {
      if (snapshotsEqual(draft, savedRef.current)) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, JSON.stringify(draft))
    } catch {
      /* ignore */
    }
  }, [draft, username, communityId])

  useEffect(() => {
    try {
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch {
      setReducedMotion(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const persResp = await fetch('/api/ai/personalities', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const persData = await persResp.json().catch(() => null)
        if (!cancelled && persData?.success && Array.isArray(persData.personalities)) {
          setAiPersonalities(persData.personalities)
        }
      } catch {
        /* ignore */
      }
      try {
        const aiResp = await fetch(`/api/community/${communityId}/ai_personality`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const aiData = await aiResp.json().catch(() => null)
        if (!cancelled && aiData?.success && aiData.ai_personality) {
          const current = String(aiData.ai_personality)
          savedPersonalityRef.current = current
          if (!personalityTouchedRef.current) setAiPersonality(current)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [communityId])

  useEffect(() => {
    if (phase !== 'steps') return
    const id = steps[stepIndex]
    if (!id) return
    try {
      sessionStorage.setItem(
        communityOwnerSetupResumeKey(username, communityId),
        JSON.stringify({ step: id }),
      )
    } catch {
      /* ignore */
    }
  }, [phase, stepIndex, username, communityId, steps])

  const persistIntroSeen = useCallback(() => {
    void fetch(`/api/communities/${encodeURIComponent(communityId)}/owner-feed-setup-intro-seen`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(() => onCommunityUpdated())
      .catch(() => {})
  }, [communityId, onCommunityUpdated])

  const markSetupDone = useCallback(
    (reason: 'completed' | 'dismissed') => {
      try {
        sessionStorage.removeItem(communityOwnerSetupResumeKey(username, communityId))
        sessionStorage.removeItem(communityOwnerSetupDraftKey(username, communityId))
      } catch {
        /* ignore */
      }
      try {
        localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), reason)
      } catch {
        /* ignore */
      }
      persistIntroSeen()
    },
    [communityId, persistIntroSeen, username],
  )

  const postUpdateCommunity = useCallback(
    async (next: CommunityOwnerSetupSnapshot, opts?: { imageFile?: File | null; removeBackground?: boolean }) => {
      const fd = new FormData()
      fd.append('community_id', communityId)
      fd.append('name', next.name.trim())
      fd.append('description', next.description.trim())
      fd.append('network_type', next.networkType)
      fd.append(
        'parent_community_id',
        next.parentCommunityId != null ? String(next.parentCommunityId) : 'none',
      )
      fd.append('notify_on_new_member', next.notifyOnNewMember ? 'true' : 'false')
      if (next.maxMembers.trim()) fd.append('max_members', next.maxMembers.trim())
      const img = opts?.imageFile
      if (img) fd.append('background_file', img)
      if (opts?.removeBackground) fd.append('remove_background', 'true')
      const r = await fetch('/update_community', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (!j?.success) {
        alert(j?.error || t('communities.owner_setup_failed_save'))
        return false
      }
      if (deviceFeedCacheKey) clearDeviceCache(deviceFeedCacheKey)
      clearDeviceCache(`community-feed:${communityId}`)
      invalidateDashboardCache()
      await onCommunityUpdated()
      return true
    },
    [communityId, deviceFeedCacheKey, onCommunityUpdated],
  )

  const postPersonality = useCallback(
    async (value: string) => {
      try {
        const resp = await fetch(`/api/community/${communityId}/ai_personality`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ai_personality: value }),
        })
        const data = await resp.json().catch(() => null)
        if (!data?.success) {
          alert(data?.error || t('communities.owner_setup_failed_personality'))
          return false
        }
        await onCommunityUpdated()
        return true
      } catch {
        alert(t('communities.owner_setup_failed_personality'))
        return false
      }
    },
    [communityId, onCommunityUpdated],
  )

  const memberLimitError = useCallback(
    (raw: string): string | null => {
      const value = raw.trim()
      if (!value) return null
      const n = parseInt(value, 10)
      if (!Number.isFinite(n) || n < 1) return t('communities.owner_setup_member_limit_invalid')
      if (memberCap != null && memberCap > 0 && n > memberCap) {
        return t('communities.owner_setup_member_limit_over_cap', { cap: memberCap })
      }
      return null
    },
    [memberCap],
  )

  const communityDirty =
    !snapshotsEqual(draft, savedRef.current) || !!imageFile || removeBackground
  const personalityDirty = aiPersonality !== savedPersonalityRef.current
  const hasPendingChanges = communityDirty || personalityDirty

  // Single persistence path for the whole wizard: everything the owner has
  // touched on any step, saved in one shot. Returns false when the save failed
  // (the user has already been alerted) so callers can stay put instead of
  // navigating away from unsaved work.
  const flushPendingChanges = useCallback(async (): Promise<boolean> => {
    if (!communityDirty && !personalityDirty) return true

    if (communityDirty) {
      const err = memberLimitError(draft.maxMembers)
      if (err) {
        alert(err)
        return false
      }
    }

    setSaving(true)
    setSavingPersonality(personalityDirty)
    setSaveHint(null)
    try {
      if (communityDirty) {
        const ok = await postUpdateCommunity(draft, {
          imageFile: imageFile ?? undefined,
          removeBackground,
        })
        if (!ok) return false
        const persisted: CommunityOwnerSetupSnapshot = {
          ...draft,
          backgroundPath: removeBackground ? null : draft.backgroundPath,
        }
        savedRef.current = persisted
        setDraft(d => ({ ...d, backgroundPath: persisted.backgroundPath }))
        if (removeBackground) setRemoveBackground(false)
        if (imageFile) setImageFile(null)
      }
      if (personalityDirty) {
        const ok = await postPersonality(aiPersonality)
        if (!ok) return false
        savedPersonalityRef.current = aiPersonality
      }
      setSaveHint(t('communities.owner_setup_saved'))
      window.setTimeout(() => setSaveHint(null), 2200)
      return true
    } finally {
      setSaving(false)
      setSavingPersonality(false)
    }
  }, [
    aiPersonality,
    communityDirty,
    draft,
    imageFile,
    memberLimitError,
    personalityDirty,
    postPersonality,
    postUpdateCommunity,
    removeBackground,
  ])

  // Every way out of the wizard — Next/Back, Skip, Finish, Invite, Manage
  // Community, or a jump to Communities/Plans — commits first. A failed save
  // keeps the owner where they are (they have already been alerted) rather than
  // silently dropping the step they just filled in.
  // Runs `action` once everything the owner typed is safely on the server.
  // With nothing pending it runs straight away, so clean steps stay instant.
  const afterSaved = useCallback(
    (action: () => void) => {
      if (!hasPendingChanges) {
        action()
        return
      }
      void flushPendingChanges().then(ok => {
        if (ok) action()
      })
    },
    [flushPendingChanges, hasPendingChanges],
  )

  const goToStep = useCallback(
    (nextIndex: number) => {
      afterSaved(() => setStepIndex(Math.max(0, Math.min(stepCount - 1, nextIndex))))
    },
    [afterSaved, stepCount],
  )

  const leaveToExitHint = useCallback(
    (context: 'skipped' | 'finished_wizard') => {
      afterSaved(() => {
        setExitContext(context)
        setPhase('exit_hint')
      })
    },
    [afterSaved],
  )

  const persist = useCallback(
    (reason: 'completed' | 'dismissed') => {
      afterSaved(() => {
        markSetupDone(reason)
        onFinished(reason)
      })
    },
    [afterSaved, markSetupDone, onFinished],
  )

  const openManageAndComplete = useCallback(() => {
    afterSaved(() => {
      markSetupDone('completed')
      onOpenManageCommunity()
      onFinished('completed')
    })
  }, [afterSaved, markSetupDone, onFinished, onOpenManageCommunity])

  const openInviteAndComplete = useCallback(() => {
    afterSaved(() => {
      markSetupDone('completed')
      onFinished('completed')
      navigate(`/community/${encodeURIComponent(communityId)}/members?open_invite=1`)
    })
  }, [afterSaved, communityId, markSetupDone, navigate, onFinished])

  const navigateAwayAfterSave = useCallback(
    (to: string) => {
      afterSaved(() => navigate(to))
    },
    [afterSaved, navigate],
  )

  const memberLimitHelp =
    memberCap != null && memberCap > 0
      ? t('communities.owner_setup_member_limit_help_capped', {
          tierSuffix: tierLabel ? t('communities.owner_setup_tier_suffix', { tier: tierLabel }) : '',
          cap: memberCap,
        })
      : t('communities.owner_setup_member_limit_help_open')

  const heyName = (ownerDisplayName || 'there').trim() || 'there'
  const lastStep = stepIndex >= stepCount - 1
  const busy = saving || savingPersonality

  const goCommunitiesStructure = useCallback(() => {
    navigateAwayAfterSave(
      `/communities?parent_id=${encodeURIComponent(communityId)}&from_owner_intro=1&resume_feed_id=${encodeURIComponent(communityId)}`,
    )
  }, [communityId, navigateAwayAfterSave])

  const persistFooter = (
    <div className="space-y-1">
      <p className="text-center text-[10px] leading-relaxed text-white/30">
        {t('communities.owner_setup_autosave_hint')}
      </p>
      <p className="text-center text-[10px] leading-relaxed text-white/30">
        {t('communities.owner_setup_footer_hint')}
      </p>
    </div>
  )

  // Per-step Save stays: an owner who fills in one step and leaves by any other
  // route still has that step committed on its own.
  const saveBar = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={saving}
        onClick={() => void flushPendingChanges()}
        className="rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {saving ? t('communities.saving') : t('common.save')}
      </button>
      {saveHint ? <span className="text-xs text-cpoint-turquoise">{saveHint}</span> : null}
    </div>
  )

  const saveBarDescription = saveBar
  const saveBarImage = saveBar

  let stepContent: ReactNode = null
  switch (currentStepId) {
    case 'welcome':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.owner_setup_welcome_greeting', { name: heyName })}</h3>
          <p className="mt-2 text-base font-semibold text-c-text-primary">{t('communities.owner_setup_headline')}</p>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">{t('communities.owner_setup_intro_body')}</p>
        </>
      )
      break
    case 'structure':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.owner_setup_structure_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">{t('communities.owner_setup_structure_body')}</p>
          <p className="mt-3 text-sm leading-relaxed text-c-text-tertiary">
            {t('communities.owner_setup_structure_plan_intro')}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-c-text-tertiary">
            <li>{t('communities.owner_setup_structure_q_count')}</li>
            <li>{t('communities.owner_setup_structure_q_names')}</li>
            <li>{t('communities.owner_setup_structure_q_nested')}</li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-c-text-tertiary">
            {t('communities.owner_setup_structure_manage_hint')}
          </p>
          <button
            type="button"
            onClick={goCommunitiesStructure}
            className="mt-3 w-full rounded-xl border border-cpoint-turquoise/50 bg-cpoint-turquoise/10 px-5 py-3 text-sm font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/20"
          >
            {t('communities.owner_setup_see_structure')}
          </button>
        </>
      )
      break
    case 'description':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.description')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">
            {t('communities.owner_setup_description_hint')}
          </p>
          <textarea
            className="mt-3 w-full rounded-md border border-c-border bg-c-bg-app px-3 py-2 text-[16px] text-c-text-primary outline-none focus:border-cpoint-turquoise min-h-[100px]"
            value={draft.description}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            placeholder={t('communities.description_placeholder')}
            rows={4}
          />
          {saveBarDescription}
        </>
      )
      break
    case 'subscription':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.owner_setup_subscription_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">
            {billingInherited
              ? t('communities.owner_setup_subscription_inherited')
              : t('communities.owner_setup_subscription_local')}
          </p>
          {!billingInherited && (
            <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">
              {t('communities.owner_setup_subscription_trial')}
            </p>
          )}
          {!billingInherited && (
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                navigateAwayAfterSave(
                  `/subscription_plans?open=community_plans&community_id=${encodeURIComponent(communityId)}&from_owner_intro=1`,
                )
              }
              className="mt-4 w-full rounded-xl bg-cpoint-turquoise px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110"
            >
              {t('communities.owner_setup_plans_billing')}
            </button>
          )}
        </>
      )
      break
    case 'member_limit':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.owner_setup_member_limit_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">{memberLimitHelp}</p>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className="mt-3 w-full rounded-md border border-c-border bg-c-bg-app px-3 py-2 text-[16px] text-c-text-primary outline-none focus:border-cpoint-turquoise"
            placeholder={memberCap != null && memberCap > 0 ? t('communities.member_limit_example', { count: memberCap }) : t('communities.member_limit_example', { count: 25 })}
            value={draft.maxMembers}
            onChange={e => setDraft(d => ({ ...d, maxMembers: e.target.value.replace(/[^0-9]/g, '') }))}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void flushPendingChanges()}
              className="rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t('communities.saving') : t('communities.owner_setup_save_limit')}
            </button>
            {saveHint ? <span className="text-xs text-cpoint-turquoise">{saveHint}</span> : null}
          </div>
        </>
      )
      break
    case 'image':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.community_image')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">
            {t('communities.owner_setup_image_hint')}
          </p>
          {draft.backgroundPath && !removeBackground && !imageFile && (
            <div className="mt-3 overflow-hidden rounded-lg border border-c-border">
              <img
                src={resolveCommunityBackgroundUrl(draft.backgroundPath)}
                alt=""
                className="max-h-40 w-full object-cover"
              />
            </div>
          )}
          {imageFile && (
            <div className="mt-3 overflow-hidden rounded-lg border border-c-border">
              <img src={URL.createObjectURL(imageFile)} alt="" className="max-h-40 w-full object-cover" />
            </div>
          )}
          {removeBackground && !imageFile && (
            <p className="mt-2 text-xs text-amber-200/90">{t('communities.owner_setup_image_remove_on_save')}</p>
          )}
          <input
            type="file"
            accept="image/*"
            className="mt-3 block w-full text-sm text-c-text-tertiary"
            onChange={e => {
              const f = e.target.files?.[0] || null
              setImageFile(f)
              if (f) setRemoveBackground(false)
            }}
          />
          {draft.backgroundPath && (
            <button
              type="button"
              className="mt-2 text-xs text-c-text-tertiary underline hover:text-white"
              onClick={() => {
                setRemoveBackground(true)
                setImageFile(null)
              }}
            >
              {t('communities.owner_setup_remove_current_image')}
            </button>
          )}
          {saveBarImage}
        </>
      )
      break
    case 'personality':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.steve_personality_label')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">
            {t('communities.owner_setup_personality_hint')}
          </p>
          <select
            className="mt-3 w-full rounded-md border border-c-border bg-c-bg-app px-3 py-2 text-[16px] text-c-text-primary outline-none focus:border-cpoint-turquoise"
            value={aiPersonality}
            onChange={e => {
              personalityTouchedRef.current = true
              setAiPersonality(e.target.value)
            }}
            disabled={savingPersonality}
          >
            {aiPersonalities.length === 0 ? (
              <option value={aiPersonality}>{aiPersonality}</option>
            ) : (
              aiPersonalities.map(p => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingPersonality || saving}
              onClick={() => void flushPendingChanges()}
              className="rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {savingPersonality ? t('communities.saving') : t('communities.owner_setup_save_personality')}
            </button>
            {saveHint ? <span className="text-xs text-cpoint-turquoise">{saveHint}</span> : null}
          </div>
        </>
      )
      break
    case 'invite':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-c-text-primary">{t('communities.owner_setup_ready_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-c-text-tertiary">{t('communities.owner_setup_invite_body')}</p>
        </>
      )
      break
    default:
      stepContent = null
  }

  if (phase === 'exit_hint') {
    return (
      <div
        className="fixed inset-0 z-[1102] flex items-center justify-center bg-black/90 px-5 py-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={`w-full max-w-md p-6 sm:p-7 ${PANEL_CLASS}`}>
          <h2 id={titleId} className="sr-only">
            {t('communities.owner_setup_finish_sr_title')}
          </h2>
          <ManageCommunityHint
            busy={saving || savingPersonality}
            onOpenManageCommunity={() => openManageAndComplete()}
            onStay={() =>
              persist(exitContext === 'finished_wizard' ? 'completed' : 'dismissed')
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[1102] flex items-center justify-center bg-black/90 px-5 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={`w-full max-w-md ${PANEL_CLASS} max-h-[90vh] overflow-y-auto`}>
        <div className="border-b border-c-border px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">{t('communities.owner_setup_steve_label')}</div>
              <h2 id={titleId} className="mt-1 text-lg font-semibold text-c-text-primary">
                {draft.name || t('communities.owner_setup_your_community')}
              </h2>
            </div>
            <button
              type="button"
              disabled={saving || savingPersonality}
              onClick={() => leaveToExitHint('skipped')}
              className="shrink-0 rounded-full border border-c-border px-3 py-1.5 text-xs font-medium text-c-text-tertiary transition hover:border-cpoint-turquoise/40 hover:text-white disabled:opacity-50"
            >
              {t('feed.skip')}
            </button>
          </div>
          <div className="mt-3 flex gap-1.5" aria-hidden={reducedMotion}>
            {Array.from({ length: stepCount }, (_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-cpoint-turquoise' : 'bg-white/15'}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-5 px-5 py-6 sm:px-7">{stepContent}</div>

        <div className="flex flex-col gap-3 border-t border-c-border px-5 py-4 sm:px-7 sm:flex-row sm:justify-end">
          {stepIndex > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => goToStep(stepIndex - 1)}
              className="order-2 w-full rounded-xl border border-c-border bg-c-bg-surface px-5 py-3 text-sm font-medium text-c-text-secondary transition hover:bg-c-hover-bg disabled:opacity-50 sm:order-1 sm:w-auto"
            >
              {t('communities.owner_setup_step_back')}
            </button>
          )}
          {!lastStep ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => goToStep(stepIndex + 1)}
              className="order-1 w-full rounded-xl bg-cpoint-turquoise px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50 sm:order-2 sm:w-auto"
            >
              {busy ? t('communities.saving') : t('communities.owner_setup_step_next')}
            </button>
          ) : currentStepId === 'invite' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => leaveToExitHint('finished_wizard')}
                className="order-1 w-full rounded-xl border border-c-border bg-c-bg-surface px-5 py-3 text-sm font-medium text-c-text-secondary transition hover:bg-c-hover-bg disabled:opacity-50 sm:order-2 sm:w-auto"
              >
                {t('communities.owner_setup_not_yet')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => openInviteAndComplete()}
                className="order-2 w-full rounded-xl bg-cpoint-turquoise px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50 sm:order-3 sm:w-auto"
              >
                {busy ? t('communities.saving') : t('communities.owner_setup_invite_people')}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => leaveToExitHint('finished_wizard')}
              className="order-1 w-full rounded-xl bg-cpoint-turquoise px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50 sm:order-2 sm:w-auto"
            >
              {busy ? t('communities.saving') : t('communities.owner_setup_step_finish')}
            </button>
          )}
        </div>
        <div className="px-5 pb-5 sm:px-7">{persistFooter}</div>
      </div>
    </div>
  )
}
