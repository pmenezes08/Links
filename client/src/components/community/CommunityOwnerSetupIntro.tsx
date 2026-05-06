import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearDeviceCache } from '../../utils/deviceCache'
import { invalidateDashboardCache } from '../../utils/dashboardCache'

export const communityOwnerSetupStorageKey = (username: string, communityId: string) =>
  `cpoint_community_owner_setup:v1:${username}:${communityId}`

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

const WELCOME = {
  title: 'Set up your community',
  body:
    "I'm Steve. We'll walk through settings you can save as we go. Use More (⋯) on the bottom bar anytime for Manage Community.",
}

function ManageCommunityHint({
  onOpenManageCommunity,
  onStay,
}: {
  onOpenManageCommunity: () => void
  onStay: () => void
}) {
  return (
    <div className="space-y-5 text-center">
      <p className="text-sm leading-relaxed text-[#d5e4e7]">
        You can finish setting up the community in <span className="font-semibold text-white">Manage Community</span>.
      </p>
      <p className="text-xs leading-relaxed text-[#9fb0b5]">
        Tap <span className="text-[#4db6ac]">More</span> (<span className="text-white/90">⋯</span>) on the bottom navigation
        bar, then tap <span className="text-white/90">Manage Community</span>.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={onOpenManageCommunity}
          className="w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:w-auto"
        >
          Open Manage Community
        </button>
        <button
          type="button"
          onClick={onStay}
          className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/90 transition hover:bg-white/[0.08] sm:w-auto"
        >
          Stay on feed
        </button>
      </div>
    </div>
  )
}

export default function CommunityOwnerSetupIntro({
  communityId,
  username,
  memberCap,
  tierLabel,
  billingInherited,
  initialSnapshot,
  deviceFeedCacheKey,
  onFinished,
  onOpenManageCommunity,
  onCommunityUpdated,
}: CommunityOwnerSetupIntroProps) {
  const navigate = useNavigate()
  const titleId = useId()
  const [phase, setPhase] = useState<'steps' | 'exit_hint'>('steps')
  const [stepIndex, setStepIndex] = useState(0)
  const [exitContext, setExitContext] = useState<'skipped' | 'finished_wizard' | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

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

  const persist = useCallback(
    (reason: 'completed' | 'dismissed') => {
      try {
        localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), reason)
      } catch {
        /* ignore */
      }
      onFinished(reason)
    },
    [communityId, onFinished, username],
  )

  const finishFromSteps = useCallback(() => {
    setExitContext('finished_wizard')
    setPhase('exit_hint')
  }, [])

  const openManageAndComplete = useCallback(() => {
    try {
      localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), 'completed')
    } catch {
      /* ignore */
    }
    onOpenManageCommunity()
    onFinished('completed')
  }, [communityId, onFinished, onOpenManageCommunity, username])

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
        alert(j?.error || 'Failed to save')
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
        setSaveHint('Saved')
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
        setSaveHint('Saved')
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
        alert('Enter a positive number for the member limit, or clear the field.')
        return
      }
      if (memberCap != null && memberCap > 0 && n > memberCap) {
        alert(`Your current plan allows up to ${memberCap} members. Enter ${memberCap} or less.`)
        return
      }
    }
    setSaving(true)
    setSaveHint(null)
    try {
      const ok = await postUpdateCommunity(draft, {})
      if (ok) {
        setSaveHint('Saved')
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
        setSaveHint('Saved')
        window.setTimeout(() => setSaveHint(null), 2200)
        await onCommunityUpdated()
      } else {
        alert(data?.error || 'Failed to update Steve personality')
      }
    } catch {
      alert('Failed to update Steve personality')
    } finally {
      setSavingPersonality(false)
    }
  }, [aiPersonality, communityId, onCommunityUpdated])

  const memberLimitHelp =
    memberCap != null && memberCap > 0
      ? `On your current plan${tierLabel ? ` (${tierLabel})` : ''}, you can have up to ${memberCap} members. Leave blank for no custom cap.`
      : 'Leave blank for no custom cap, or set a limit that fits your plan (see Manage Community for the exact ceiling).'

  const stepCount = 6
  const lastStep = stepIndex >= stepCount - 1

  const persistFooter = (
    <p className="text-center text-[11px] leading-relaxed text-white/35">
      Any time: <span className="text-white/50">More</span> (⋯) on the bottom bar →{' '}
      <span className="text-white/50">Manage Community</span>.
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
        {saving ? 'Saving…' : 'Save'}
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
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saveHint ? <span className="text-xs text-[#4db6ac]">{saveHint}</span> : null}
    </div>
  )

  let stepContent: ReactNode = null
  if (stepIndex === 0) {
    stepContent = (
      <>
        <h3 className="text-base font-semibold text-white">{WELCOME.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">{WELCOME.body}</p>
      </>
    )
  } else if (stepIndex === 1) {
    stepContent = (
      <>
        <h3 className="text-base font-semibold text-white">Description</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
          This appears under your community name on the feed.
        </p>
        <textarea
          className="mt-3 w-full rounded-md border border-white/15 bg-black px-3 py-2 text-[16px] text-white outline-none focus:border-[#4db6ac] min-h-[100px]"
          value={draft.description}
          onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
          placeholder="What is this community about?"
          rows={4}
        />
        {saveBarDescription}
      </>
    )
  } else if (stepIndex === 2) {
    stepContent = (
      <>
        <h3 className="text-base font-semibold text-white">Subscription</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
          {billingInherited
            ? 'Billing and tier for this community are managed on the parent network. Open the root community’s Manage Community to change the plan.'
            : 'Your community plan sets member caps, storage, and more. You can compare tiers and checkout here.'}
        </p>
        {!billingInherited && (
          <button
            type="button"
            onClick={() =>
              navigate(`/subscription_plans?mode=choose&open=community_plans&community_id=${communityId}`)
            }
            className="mt-4 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110"
          >
            Community plans & billing
          </button>
        )}
      </>
    )
  } else if (stepIndex === 3) {
    stepContent = (
      <>
        <h3 className="text-base font-semibold text-white">Member limit</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">{memberLimitHelp}</p>
        <input
          type="number"
          min={1}
          inputMode="numeric"
          className="mt-3 w-full rounded-md border border-white/15 bg-black px-3 py-2 text-[16px] text-white outline-none focus:border-[#4db6ac]"
          placeholder={memberCap != null && memberCap > 0 ? `e.g., ${memberCap}` : 'e.g., 25'}
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
            {saving ? 'Saving…' : 'Save limit'}
          </button>
          {saveHint ? <span className="text-xs text-[#4db6ac]">{saveHint}</span> : null}
        </div>
      </>
    )
  } else if (stepIndex === 4) {
    stepContent = (
      <>
        <h3 className="text-base font-semibold text-white">Community image</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
          Banner shown for your community. Save after choosing a file or removing the current image.
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
          <p className="mt-2 text-xs text-amber-200/90">Current image will be removed when you save.</p>
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
            Remove current image
          </button>
        )}
        {saveBarImage}
      </>
    )
  } else if (stepIndex === 5) {
    stepContent = (
      <>
        <h3 className="text-base font-semibold text-white">Steve personality</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">
          How Steve responds when members mention @Steve in comments.
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
            {savingPersonality ? 'Saving…' : 'Save personality'}
          </button>
          {saveHint ? <span className="text-xs text-[#4db6ac]">{saveHint}</span> : null}
        </div>
      </>
    )
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
            Finish in Manage Community
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
              <div className="text-xs uppercase tracking-[0.2em] text-[#4db6ac]">Steve</div>
              <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
                {draft.name || 'Your community'}
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
              Skip
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
              Back
            </button>
          )}
          {!lastStep ? (
            <button
              type="button"
              onClick={() => setStepIndex(i => Math.min(stepCount - 1, i + 1))}
              className="order-1 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:order-2 sm:w-auto"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={finishFromSteps}
              className="order-1 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:order-2 sm:w-auto"
            >
              Done
            </button>
          )}
        </div>
        <div className="px-5 pb-5 sm:px-7">{persistFooter}</div>
      </div>
    </div>
  )
}
