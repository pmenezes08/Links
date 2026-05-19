import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { clearDeviceCache } from '../../utils/deviceCache'
import { invalidateDashboardCache } from '../../utils/dashboardCache'

export const communityOwnerSetupStorageKey = (username: string, communityId: string) =>
  `cpoint_community_owner_setup:v1:${username.trim().toLowerCase()}:${communityId}`

export const communityOwnerSetupResumeKey = (username: string, communityId: string) =>
  `cpoint_community_owner_setup_resume:v1:${username.trim().toLowerCase()}:${communityId}`

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

const PANEL_CLASS = 'rounded-2xl border border-white/10 bg-black'

function ManageCommunityHint({
  onOpenManageCommunity,
  onStay,
}: {
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
          onClick={onOpenManageCommunity}
          className="w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:w-auto"
        >
          {t('communities.owner_setup_open_manage')}
        </button>
        <button
          type="button"
          onClick={onStay}
          className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/90 transition hover:bg-white/[0.08] sm:w-auto"
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

  const [draft, setDraft] = useState<CommunityOwnerSetupSnapshot>(() => ({ ...initialSnapshot }))
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [removeBackground, setRemoveBackground] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveHint, setSaveHint] = useState<string | null>(null)

  const [aiPersonalities, setAiPersonalities] = useState<Array<{ key: string; name: string }>>([])
  const [aiPersonality, setAiPersonality] = useState('friendly')
  const [savingPersonality, setSavingPersonality] = useState(false)

  useEffect(() => {
    setDraft({ ...initialSnapshot })
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
          setAiPersonality(String(aiData.ai_personality))
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

  const persist = useCallback(
    (reason: 'completed' | 'dismissed') => {
      try {
        sessionStorage.removeItem(communityOwnerSetupResumeKey(username, communityId))
      } catch {
        /* ignore */
      }
      try {
        localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), reason)
      } catch {
        /* ignore */
      }
      persistIntroSeen()
      onFinished(reason)
    },
    [communityId, onFinished, persistIntroSeen, username],
  )

  const finishFromSteps = useCallback(() => {
    setExitContext('finished_wizard')
    setPhase('exit_hint')
  }, [])

  const openManageAndComplete = useCallback(() => {
    try {
      sessionStorage.removeItem(communityOwnerSetupResumeKey(username, communityId))
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), 'completed')
    } catch {
      /* ignore */
    }
    persistIntroSeen()
    onOpenManageCommunity()
    onFinished('completed')
  }, [communityId, onFinished, onOpenManageCommunity, persistIntroSeen, username])

  const openInviteAndComplete = useCallback(() => {
    try {
      sessionStorage.removeItem(communityOwnerSetupResumeKey(username, communityId))
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), 'completed')
    } catch {
      /* ignore */
    }
    persistIntroSeen()
    onFinished('completed')
    navigate(`/community/${encodeURIComponent(communityId)}/members?open_invite=1`)
  }, [communityId, navigate, onFinished, persistIntroSeen, username])

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

  const saveCommunityFieldsOnly = useCallback(async () => {
    setSaving(true)
    setSaveHint(null)
    try {
      const ok = await postUpdateCommunity(draft, {})
      if (ok) {
        setSaveHint(t('communities.owner_setup_saved'))
        window.setTimeout(() => setSaveHint(null), 2200)
      }
    } finally {
      setSaving(false)
    }
  }, [draft, postUpdateCommunity])

  const saveWithImage = useCallback(async () => {
    setSaving(true)
    setSaveHint(null)
    try {
      const ok = await postUpdateCommunity(draft, {
        imageFile: imageFile ?? undefined,
        removeBackground,
      })
      if (ok) {
        setDraft(d => ({
          ...d,
          backgroundPath: removeBackground ? null : d.backgroundPath,
        }))
        if (removeBackground) setRemoveBackground(false)
        if (imageFile) setImageFile(null)
        setSaveHint(t('communities.owner_setup_saved'))
        window.setTimeout(() => setSaveHint(null), 2200)
      }
    } finally {
      setSaving(false)
    }
  }, [draft, imageFile, postUpdateCommunity, removeBackground])

  const saveMemberLimitOnly = useCallback(async () => {
    const raw = draft.maxMembers.trim()
    if (raw) {
      const n = parseInt(raw, 10)
      if (!Number.isFinite(n) || n < 1) {
        alert(t('communities.owner_setup_member_limit_invalid'))
        return
      }
      if (memberCap != null && memberCap > 0 && n > memberCap) {
        alert(t('communities.owner_setup_member_limit_over_cap', { cap: memberCap }))
        return
      }
    }
    setSaving(true)
    setSaveHint(null)
    try {
      const ok = await postUpdateCommunity(draft, {})
      if (ok) {
        setSaveHint(t('communities.owner_setup_saved'))
        window.setTimeout(() => setSaveHint(null), 2200)
      }
    } finally {
      setSaving(false)
    }
  }, [draft, memberCap, postUpdateCommunity])

  const savePersonality = useCallback(async () => {
    setSavingPersonality(true)
    try {
      const resp = await fetch(`/api/community/${communityId}/ai_personality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ai_personality: aiPersonality }),
      })
      const data = await resp.json().catch(() => null)
      if (data?.success) {
        setSaveHint(t('communities.owner_setup_saved'))
        window.setTimeout(() => setSaveHint(null), 2200)
        await onCommunityUpdated()
      } else {
        alert(data?.error || t('communities.owner_setup_failed_personality'))
      }
    } catch {
      alert(t('communities.owner_setup_failed_personality'))
    } finally {
      setSavingPersonality(false)
    }
  }, [aiPersonality, communityId, onCommunityUpdated])

  const memberLimitHelp =
    memberCap != null && memberCap > 0
      ? t('communities.owner_setup_member_limit_help_capped', {
          tierSuffix: tierLabel ? t('communities.owner_setup_tier_suffix', { tier: tierLabel }) : '',
          cap: memberCap,
        })
      : t('communities.owner_setup_member_limit_help_open')

  const heyName = (ownerDisplayName || 'there').trim() || 'there'
  const lastStep = stepIndex >= stepCount - 1

  const goCommunitiesStructure = useCallback(() => {
    navigate(
      `/communities?parent_id=${encodeURIComponent(communityId)}&from_owner_intro=1&resume_feed_id=${encodeURIComponent(communityId)}`,
    )
  }, [communityId, navigate])

  const persistFooter = (
    <p className="text-center text-[10px] leading-relaxed text-white/30">
      {t('communities.owner_setup_footer_hint')}
    </p>
  )

  const saveBarDescription = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={saving}
        onClick={() => void saveCommunityFieldsOnly()}
        className="rounded-xl bg-[#4db6ac] px-4 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {saving ? t('communities.saving') : t('common.save')}
      </button>
      {saveHint ? <span className="text-xs text-[#4db6ac]">{saveHint}</span> : null}
    </div>
  )

  const saveBarImage = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={saving}
        onClick={() => void saveWithImage()}
        className="rounded-xl bg-[#4db6ac] px-4 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {saving ? t('communities.saving') : t('common.save')}
      </button>
      {saveHint ? <span className="text-xs text-[#4db6ac]">{saveHint}</span> : null}
    </div>
  )

  let stepContent: ReactNode = null
  switch (currentStepId) {
    case 'welcome':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-white">{t('communities.owner_setup_welcome_greeting', { name: heyName })}</h3>
          <p className="mt-2 text-base font-semibold text-white">{t('communities.owner_setup_headline')}</p>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">{t('communities.owner_setup_intro_body')}</p>
        </>
      )
      break
    case 'structure':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-white">{t('communities.owner_setup_structure_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">{t('communities.owner_setup_structure_body')}</p>
          <p className="mt-3 text-sm leading-relaxed text-[#9fb0b5]">
            {t('communities.owner_setup_structure_plan_intro')}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-[#9fb0b5]">
            <li>{t('communities.owner_setup_structure_q_count')}</li>
            <li>{t('communities.owner_setup_structure_q_names')}</li>
            <li>{t('communities.owner_setup_structure_q_nested')}</li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-[#9fb0b5]">
            {t('communities.owner_setup_structure_manage_hint')}
          </p>
          <button
            type="button"
            onClick={goCommunitiesStructure}
            className="mt-3 w-full rounded-xl border border-[#4db6ac]/50 bg-[#4db6ac]/10 px-5 py-3 text-sm font-semibold text-[#4db6ac] transition hover:bg-[#4db6ac]/20"
          >
            {t('communities.owner_setup_see_structure')}
          </button>
        </>
      )
      break
    case 'description':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-white">{t('communities.description')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
            {t('communities.owner_setup_description_hint')}
          </p>
          <textarea
            className="mt-3 w-full rounded-md border border-white/15 bg-black px-3 py-2 text-[16px] text-white outline-none focus:border-[#4db6ac] min-h-[100px]"
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
          <h3 className="text-base font-semibold text-white">{t('communities.owner_setup_subscription_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
            {billingInherited
              ? t('communities.owner_setup_subscription_inherited')
              : t('communities.owner_setup_subscription_local')}
          </p>
          {!billingInherited && (
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/subscription_plans?mode=choose&open=community_plans&community_id=${encodeURIComponent(communityId)}&from_owner_intro=1`,
                )
              }
              className="mt-4 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110"
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
          <h3 className="text-base font-semibold text-white">{t('communities.owner_setup_member_limit_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">{memberLimitHelp}</p>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className="mt-3 w-full rounded-md border border-white/15 bg-black px-3 py-2 text-[16px] text-white outline-none focus:border-[#4db6ac]"
            placeholder={memberCap != null && memberCap > 0 ? t('communities.member_limit_example', { count: memberCap }) : t('communities.member_limit_example', { count: 25 })}
            value={draft.maxMembers}
            onChange={e => setDraft(d => ({ ...d, maxMembers: e.target.value.replace(/[^0-9]/g, '') }))}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveMemberLimitOnly()}
              className="rounded-xl bg-[#4db6ac] px-4 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t('communities.saving') : t('communities.owner_setup_save_limit')}
            </button>
            {saveHint ? <span className="text-xs text-[#4db6ac]">{saveHint}</span> : null}
          </div>
        </>
      )
      break
    case 'image':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-white">{t('communities.community_image')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
            {t('communities.owner_setup_image_hint')}
          </p>
          {draft.backgroundPath && !removeBackground && !imageFile && (
            <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
              <img
                src={`/uploads/${draft.backgroundPath}`}
                alt=""
                className="max-h-40 w-full object-cover"
              />
            </div>
          )}
          {imageFile && (
            <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
              <img src={URL.createObjectURL(imageFile)} alt="" className="max-h-40 w-full object-cover" />
            </div>
          )}
          {removeBackground && !imageFile && (
            <p className="mt-2 text-xs text-amber-200/90">{t('communities.owner_setup_image_remove_on_save')}</p>
          )}
          <input
            type="file"
            accept="image/*"
            className="mt-3 block w-full text-sm text-[#9fb0b5]"
            onChange={e => {
              const f = e.target.files?.[0] || null
              setImageFile(f)
              if (f) setRemoveBackground(false)
            }}
          />
          {draft.backgroundPath && (
            <button
              type="button"
              className="mt-2 text-xs text-[#9fb0b5] underline hover:text-white"
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
          <h3 className="text-base font-semibold text-white">{t('communities.steve_personality_label')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
            {t('communities.owner_setup_personality_hint')}
          </p>
          <select
            className="mt-3 w-full rounded-md border border-white/15 bg-black px-3 py-2 text-[16px] text-white outline-none focus:border-[#4db6ac]"
            value={aiPersonality}
            onChange={e => setAiPersonality(e.target.value)}
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
              disabled={savingPersonality}
              onClick={() => void savePersonality()}
              className="rounded-xl bg-[#4db6ac] px-4 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {savingPersonality ? t('communities.saving') : t('communities.owner_setup_save_personality')}
            </button>
            {saveHint ? <span className="text-xs text-[#4db6ac]">{saveHint}</span> : null}
          </div>
        </>
      )
      break
    case 'invite':
      stepContent = (
        <>
          <h3 className="text-base font-semibold text-white">{t('communities.owner_setup_ready_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">{t('communities.owner_setup_invite_body')}</p>
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
            onOpenManageCommunity={openManageAndComplete}
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
        <div className="border-b border-white/10 px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#4db6ac]">{t('communities.owner_setup_steve_label')}</div>
              <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
                {draft.name || t('communities.owner_setup_your_community')}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setExitContext('skipped')
                setPhase('exit_hint')
              }}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-[#9fb0b5] transition hover:border-[#4db6ac]/40 hover:text-white"
            >
              {t('feed.skip')}
            </button>
          </div>
          <div className="mt-3 flex gap-1.5" aria-hidden={reducedMotion}>
            {Array.from({ length: stepCount }, (_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-[#4db6ac]' : 'bg-white/15'}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-5 px-5 py-6 sm:px-7">{stepContent}</div>

        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:px-7 sm:flex-row sm:justify-end">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={() => setStepIndex(i => Math.max(0, i - 1))}
              className="order-2 w-full rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/90 transition hover:bg-white/[0.08] sm:order-1 sm:w-auto"
            >
              {t('communities.owner_setup_step_back')}
            </button>
          )}
          {!lastStep ? (
            <button
              type="button"
              onClick={() => setStepIndex(i => Math.min(stepCount - 1, i + 1))}
              className="order-1 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:order-2 sm:w-auto"
            >
              {t('communities.owner_setup_step_next')}
            </button>
          ) : currentStepId === 'invite' ? (
            <>
              <button
                type="button"
                onClick={finishFromSteps}
                className="order-1 w-full rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/90 transition hover:bg-white/[0.08] sm:order-2 sm:w-auto"
              >
                {t('communities.owner_setup_not_yet')}
              </button>
              <button
                type="button"
                onClick={openInviteAndComplete}
                className="order-2 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:order-3 sm:w-auto"
              >
                {t('communities.owner_setup_invite_people')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={finishFromSteps}
              className="order-1 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:order-2 sm:w-auto"
            >
              {t('communities.owner_setup_step_finish')}
            </button>
          )}
        </div>
        <div className="px-5 pb-5 sm:px-7">{persistFooter}</div>
      </div>
    </div>
  )
}
