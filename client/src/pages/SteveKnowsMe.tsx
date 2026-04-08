import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type SteveProfilePayload = {
  username: string
  analysis: Record<string, unknown>
  lastUpdated?: string | null
}

/** Fixed order for the user-facing Steve page (matches product spec). */
const SECTION_ORDER = ['summary', 'identity', 'networkingValue', 'interests'] as const

/** Sections the user can send text edits for via /api/profile/ai_review */
const USER_EDITABLE_SECTIONS = ['summary', 'networkingValue', 'interests'] as const

function identityHasContent(identity: Record<string, unknown> | null): boolean {
  if (!identity || typeof identity !== 'object') return false
  const roles = identity.roles
  const hasRoles = Array.isArray(roles) && roles.length > 0
  const df = identity.drivingForces
  const bi = identity.bridgeInsight
  return Boolean(hasRoles || (typeof df === 'string' && df.trim()) || (typeof bi === 'string' && bi.trim()))
}

function sectionHasContent(key: string, val: unknown): boolean {
  if (val == null || val === '') return false
  if (key === 'identity') {
    return identityHasContent(val as Record<string, unknown>)
  }
  if (key === 'interests') {
    if (typeof val === 'object' && !Array.isArray(val)) return Object.keys(val as object).length > 0
    if (Array.isArray(val)) return val.length > 0
    return typeof val === 'string' && val.trim().length > 0
  }
  if (typeof val === 'string') return val.trim().length > 0
  if (Array.isArray(val)) return val.length > 0
  if (typeof val === 'object') return Object.keys(val as object).length > 0
  return true
}

function formatInterestsHuman(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return val.trim()
  if (Array.isArray(val)) return val.map(String).filter(Boolean).join(' · ')
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, { score?: number }>)
    if (entries.length === 0) return ''
    return entries
      .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
      .map(([name]) => name)
      .join(' · ')
  }
  return ''
}

/** Plain text for the edit modal (matches what we can POST as user edits). */
function sectionEditSeed(key: string, val: unknown): string {
  if (key === 'interests') return formatInterestsHuman(val)
  if (key === 'summary' || key === 'networkingValue') return typeof val === 'string' ? val : ''
  return ''
}

function visibleSectionKeys(analysis: Record<string, unknown>): string[] {
  return SECTION_ORDER.filter(k => sectionHasContent(k, analysis[k]))
}

export default function SteveKnowsMe() {
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<SteveProfilePayload | null>(null)
  const [meta, setMeta] = useState<{
    canRequestRefresh?: boolean
    analysisInProgress?: boolean
    refreshCooldownSeconds?: number
  }>({})
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showRefreshExplainer, setShowRefreshExplainer] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/profile/steve_analysis', {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      })
      const d = await r.json().catch(() => null)
      if (!d?.success) {
        setError(d?.error || 'Could not load Steve profile')
        setProfile(null)
        return
      }
      setMeta({
        canRequestRefresh: d.canRequestRefresh,
        analysisInProgress: d.analysisInProgress,
        refreshCooldownSeconds: d.refreshCooldownSeconds,
      })
      setProfile(d.profile || null)
    } catch {
      setError('Network error')
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setTitle("Steve's view of you")
    return () => setTitle('')
  }, [setTitle])

  useEffect(() => {
    void load()
  }, [load])

  async function postAiReview(body: Record<string, unknown>) {
    const r = await fetch('/api/profile/ai_review', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => null)
    if (!d?.success) throw new Error(d?.error || 'Save failed')
  }

  const analysis = (profile?.analysis || {}) as Record<string, unknown>

  async function handleApprove() {
    const keys = visibleSectionKeys(analysis)
    if (keys.length === 0) {
      setFeedback('Nothing to approve yet.')
      return
    }
    setActionBusy(true)
    setFeedback(null)
    try {
      await postAiReview({
        status: 'confirmed',
        acceptedSections: keys,
        edits: {},
      })
      setFeedback('Thanks — your review was saved.')
      await load()
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleDispute() {
    if (!window.confirm('Mark this as not you? Update your profile elsewhere if needed, then use refresh when it’s available again.')) return
    setActionBusy(true)
    setFeedback(null)
    try {
      await postAiReview({
        status: 'disputed',
        acceptedSections: [],
        edits: {},
      })
      setFeedback('Recorded. Update your profile if needed, then tap refresh when it’s available again.')
      await load()
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleSaveEdit() {
    if (!editKey) return
    setActionBusy(true)
    setFeedback(null)
    try {
      await postAiReview({
        status: 'edited',
        acceptedSections: [editKey],
        edits: { [editKey]: editText },
      })
      setEditKey(null)
      setFeedback('Your changes were saved.')
      await load()
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleRequestRefresh() {
    setRefreshBusy(true)
    setFeedback(null)
    try {
      const r = await fetch('/api/profile/steve_request_refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const d = await r.json().catch(() => null)
      if (r.status === 429) {
        setFeedback(d?.error || 'Please wait before asking again.')
        await load()
        return
      }
      if (r.status === 409) {
        setFeedback('Steve is already updating your profile. Check back shortly.')
        await load()
        return
      }
      if (!d?.success) {
        setFeedback(d?.error || 'Could not start a refresh')
        return
      }
      setFeedback(d.message || 'Steve is updating your profile. Refresh this page in a minute.')
      await load()
    } catch {
      setFeedback('Network error')
    } finally {
      setRefreshBusy(false)
    }
  }

  function openEdit(key: string) {
    setEditKey(key)
    setEditText(sectionEditSeed(key, analysis[key]))
  }

  const reviewStatus = (analysis._userReview as { status?: string } | undefined)?.status

  const cooldownHours = Math.max(1, Math.round((meta.refreshCooldownSeconds || 86400) / 3600))

  function renderIdentityBlock(val: unknown) {
    const identity = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>
    const roles = Array.isArray(identity.roles) ? (identity.roles as string[]).filter(Boolean) : []
    const driving = typeof identity.drivingForces === 'string' ? identity.drivingForces.trim() : ''
    const bridge = typeof identity.bridgeInsight === 'string' ? identity.bridgeInsight.trim() : ''
    return (
      <div className="space-y-3">
        {roles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {roles.map((r, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-1 rounded-full bg-[#4db6ac]/15 text-[#4db6ac] border border-[#4db6ac]/25"
              >
                {r}
              </span>
            ))}
          </div>
        ) : null}
        {driving ? (
          <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{driving}</p>
        ) : null}
        {bridge ? (
          <p className="text-sm text-[#4db6ac]/90 leading-relaxed italic whitespace-pre-wrap">{bridge}</p>
        ) : null}
      </div>
    )
  }

  function renderSectionBody(key: string, val: unknown) {
    switch (key) {
      case 'summary':
      case 'networkingValue':
        return (
          <p className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap">
            {typeof val === 'string' ? val : ''}
          </p>
        )
      case 'identity':
        return renderIdentityBlock(val)
      case 'interests':
        return (
          <p className="text-sm text-white/85 leading-relaxed">{formatInterestsHuman(val)}</p>
        )
      default:
        return null
    }
  }

  const sectionTitle: Record<string, string> = {
    summary: 'Summary',
    identity: 'Identity',
    networkingValue: 'Networking value',
    interests: 'Interests',
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6 pb-24 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-[#9fb0b5] hover:text-white"
        >
          ← Back
        </button>
      </div>

      <h1 className="text-xl font-semibold text-[#4db6ac] mb-1">What Steve knows about you</h1>
      <p className="text-sm text-[#9fb0b5] mb-4">
        This is Steve&apos;s understanding of you — not your public profile. Use it to check accuracy and suggest corrections.
      </p>

      {meta.analysisInProgress ? (
        <div className="mb-4 rounded-lg border border-[#4db6ac]/40 bg-[#4db6ac]/10 px-3 py-2 text-sm text-[#4db6ac]">
          <i className="fa-solid fa-spinner fa-spin mr-2" />
          Steve is updating your profile… refresh this page in a bit.
        </div>
      ) : null}

      {!meta.canRequestRefresh && !meta.analysisInProgress ? (
        <div className="mb-4 text-sm text-[#9fb0b5]">
          You&apos;ve recently asked Steve to take a fresh look. You can ask again in about{' '}
          <span className="text-white/90">{cooldownHours}</span> hour{cooldownHours !== 1 ? 's' : ''}.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          type="button"
          title={
            !meta.canRequestRefresh && !meta.analysisInProgress
              ? `Available again in about ${cooldownHours} hour${cooldownHours !== 1 ? 's' : ''}`
              : 'Refresh Steve’s view'
          }
          disabled={refreshBusy || meta.analysisInProgress || !meta.canRequestRefresh}
          onClick={() => setShowRefreshExplainer(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#4db6ac]/20 border border-[#4db6ac]/40 text-[#4db6ac] hover:bg-[#4db6ac]/30 disabled:opacity-40"
          aria-label="Refresh Steve’s view"
        >
          {refreshBusy ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-arrows-rotate" />}
        </button>
        <button
          type="button"
          disabled={actionBusy || !profile || visibleSectionKeys(analysis).length === 0}
          onClick={() => void handleApprove()}
          className="px-3 py-2 rounded-lg bg-green-500/20 border border-green-500/40 text-sm text-green-300 hover:bg-green-500/30 disabled:opacity-40"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={actionBusy || !profile}
          onClick={() => void handleDispute()}
          className="px-3 py-2 rounded-lg bg-orange-500/15 border border-orange-500/35 text-sm text-orange-300 hover:bg-orange-500/25 disabled:opacity-40"
        >
          This is not me
        </button>
      </div>

      {reviewStatus ? (
        <p className="text-xs text-white/50 mb-4">
          Your last review: <span className="text-white/80">{reviewStatus}</span>
        </p>
      ) : null}

      {loading ? (
        <div className="text-center py-16 text-white/50">
          <i className="fa-solid fa-spinner fa-spin text-2xl mb-2" />
          <div>Loading…</div>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : !profile ? (
        <div className="space-y-4 text-sm text-[#9fb0b5]">
          <p>
            Steve doesn&apos;t have an analysis for you yet. Update your profile information, then tap the{' '}
            <strong>refresh</strong> icon above (or ask a community admin for help).
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-xs text-white/40">Last updated: {profile.lastUpdated || '—'}</div>

          <section className="rounded-xl border border-white/10 p-4 space-y-6">
            <div className="font-semibold text-[#4db6ac]">What Steve sees</div>
            {visibleSectionKeys(analysis).length === 0 ? (
              <p className="text-sm text-white/50">No sections yet. Try refreshing after updating your profile.</p>
            ) : (
              visibleSectionKeys(analysis).map(key => (
                <div key={key} className="border-b border-white/5 pb-5 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-semibold text-white">{sectionTitle[key] ?? key}</div>
                    {(USER_EDITABLE_SECTIONS as readonly string[]).includes(key) ? (
                      <button
                        type="button"
                        onClick={() => openEdit(key)}
                        className="text-[11px] text-[#4db6ac] hover:underline"
                      >
                        Suggest an edit
                      </button>
                    ) : null}
                  </div>
                  <div className="bg-white/[0.03] rounded-lg px-3.5 py-3 border border-white/5">
                    {renderSectionBody(key, analysis[key])}
                  </div>
                </div>
              ))
            )}
          </section>

          <p className="text-xs text-orange-300/90">
            If something is completely off, tap <strong>This is not me</strong>, update your profile if needed, then use the{' '}
            <strong>refresh</strong> icon when it becomes available again.
          </p>
        </div>
      )}

      {editKey ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111] p-5 space-y-3">
            <div className="font-semibold text-white">Suggest an edit: {sectionTitle[editKey] ?? editKey}</div>
            <p className="text-xs text-[#9fb0b5]">Your text is saved with your review so Steve can use your wording.</p>
            <textarea
              className="w-full min-h-[140px] rounded-lg bg-black border border-white/15 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
              value={editText}
              onChange={e => setEditText(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditKey(null)}
                className="px-3 py-2 text-sm text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleSaveEdit()}
                className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-sm font-medium disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRefreshExplainer ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111] p-5 space-y-4">
            <div className="font-semibold text-white">Refresh Steve&apos;s view</div>
            <p className="text-sm text-[#9fb0b5] leading-relaxed">
              When you refresh, Steve looks for updates to his picture of you — using your profile and public sources
              (for example the web). This can take a minute. You can only do this occasionally.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowRefreshExplainer(false)}
                className="px-3 py-2 text-sm text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={refreshBusy || meta.analysisInProgress || !meta.canRequestRefresh}
                onClick={() => {
                  setShowRefreshExplainer(false)
                  void handleRequestRefresh()
                }}
                className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-sm font-medium disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full border border-white/10 bg-white/10 text-sm text-white max-w-[90vw] text-center">
          {feedback}
        </div>
      ) : null}
    </div>
  )
}
