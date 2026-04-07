import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type SteveProfilePayload = {
  username: string
  analysis: Record<string, unknown>
  lastUpdated?: string | null
  profilingPlatformActivity?: unknown
  profilingSharedExternals?: unknown
  profilingContextUpdatedAt?: string | null
}

const USER_EDITABLE_SECTIONS = ['summary', 'professional', 'personal', 'interests', 'networkingValue'] as const

function analysisSectionToText(key: string, val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (key === 'interests' && typeof val === 'object' && !Array.isArray(val)) {
    return Object.keys(val as Record<string, unknown>).join(', ')
  }
  if (key === 'professional' && typeof val === 'object' && val !== null) {
    const o = val as Record<string, unknown>
    const parts: string[] = []
    const company = o.company as Record<string, string> | undefined
    if (company?.description) parts.push(`${company.name || 'Company'}: ${company.description}`)
    const role = o.role as Record<string, string> | undefined
    if (role?.title) parts.push(`${role.title}${role.implication ? ' — ' + role.implication : ''}`)
    if (o.education) parts.push(String(o.education))
    const loc = o.location as Record<string, string> | undefined
    if (loc?.context) parts.push(loc.context)
    if (o.webFindings) parts.push(String(o.webFindings))
    return parts.join('. ')
  }
  if (key === 'personal' && typeof val === 'object' && val !== null) {
    const o = val as Record<string, unknown>
    const parts: string[] = []
    if (o.webFindings) parts.push(String(o.webFindings))
    if (o.lifestyle) parts.push(String(o.lifestyle))
    const social = o.socialProfiles
    if (Array.isArray(social)) {
      for (const sp of social) {
        if (typeof sp === 'object' && sp && 'url' in sp) parts.push(String((sp as { url: string }).url))
      }
    }
    return parts.join('. ')
  }
  if (key === 'identity' && typeof val === 'object' && val !== null) {
    const o = val as Record<string, unknown>
    const roles = o.roles
    if (Array.isArray(roles)) return roles.join(' · ')
    return JSON.stringify(val, null, 2)
  }
  try {
    return JSON.stringify(val, null, 2)
  } catch {
    return String(val)
  }
}

function nonEmptyAnalysisKeys(analysis: Record<string, unknown>): string[] {
  return Object.keys(analysis).filter(k => {
    if (k.startsWith('_')) return false
    const v = analysis[k]
    if (v == null || v === '') return false
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'object') return Object.keys(v as object).length > 0
    return true
  })
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
    const keys = nonEmptyAnalysisKeys(analysis)
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
    if (!window.confirm('Mark Steve’s profile as wrong? You can then refresh your data or update your public profile.')) return
    setActionBusy(true)
    setFeedback(null)
    try {
      await postAiReview({
        status: 'disputed',
        acceptedSections: [],
        edits: {},
      })
      setFeedback('Recorded. Improve your profile and use Request refresh when ready.')
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
      setFeedback('Section update saved.')
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
        setFeedback(d?.error || 'Please wait before another refresh.')
        await load()
        return
      }
      if (r.status === 409) {
        setFeedback('Analysis is already running. Check back shortly.')
        await load()
        return
      }
      if (!d?.success) {
        setFeedback(d?.error || 'Could not queue refresh')
        return
      }
      setFeedback(d.message || 'Queued. Refresh this page in a minute.')
      await load()
    } catch {
      setFeedback('Network error')
    } finally {
      setRefreshBusy(false)
    }
  }

  function openEdit(key: string) {
    setEditKey(key)
    setEditText(analysisSectionToText(key, analysis[key]))
  }

  const reviewStatus = (analysis._userReview as { status?: string } | undefined)?.status

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
        Full internal view for testing — we can hide sections later. This is not your public profile; it is Steve’s model of you in Firestore.
      </p>

      {meta.analysisInProgress ? (
        <div className="mb-4 rounded-lg border border-[#4db6ac]/40 bg-[#4db6ac]/10 px-3 py-2 text-sm text-[#4db6ac]">
          <i className="fa-solid fa-spinner fa-spin mr-2" />
          Steve is updating your analysis… refresh this page in a bit.
        </div>
      ) : null}

      {!meta.canRequestRefresh && !meta.analysisInProgress ? (
        <div className="mb-4 text-xs text-white/50">
          Next self-service refresh available after the cooldown (
          {Math.round((meta.refreshCooldownSeconds || 86400) / 3600)}h window — override with{' '}
          <code className="text-white/70">STEVE_SELF_REFRESH_COOLDOWN_SECONDS</code>).
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          disabled={refreshBusy || meta.analysisInProgress || !meta.canRequestRefresh}
          onClick={() => void handleRequestRefresh()}
          className="px-3 py-2 rounded-lg bg-[#4db6ac]/20 border border-[#4db6ac]/40 text-sm text-[#4db6ac] hover:bg-[#4db6ac]/30 disabled:opacity-40"
        >
          {refreshBusy ? 'Queueing…' : 'Request refresh'}
        </button>
        <button
          type="button"
          disabled={actionBusy || !profile || nonEmptyAnalysisKeys(analysis).length === 0}
          onClick={() => void handleApprove()}
          className="px-3 py-2 rounded-lg bg-green-500/20 border border-green-500/40 text-sm text-green-300 hover:bg-green-500/30 disabled:opacity-40"
        >
          Approve Steve&apos;s view
        </button>
        <button
          type="button"
          disabled={actionBusy || !profile}
          onClick={() => void handleDispute()}
          className="px-3 py-2 rounded-lg bg-orange-500/15 border border-orange-500/35 text-sm text-orange-300 hover:bg-orange-500/25 disabled:opacity-40"
        >
          This is wrong
        </button>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="px-3 py-2 rounded-lg border border-white/15 text-sm text-white/80 hover:bg-white/10"
        >
          Edit public profile
        </button>
      </div>

      {reviewStatus ? (
        <p className="text-xs text-white/50 mb-4">
          Your last review status: <span className="text-white/80">{reviewStatus}</span>
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
          <p>Steve doesn&apos;t have an analysis document for you yet. Complete your profile, then use Request refresh (or ask an admin to analyze).</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-xs text-white/40">
            Last updated: {profile.lastUpdated || '—'}
            {profile.profilingContextUpdatedAt ? (
              <span className="ml-2">· Profiling data: {profile.profilingContextUpdatedAt}</span>
            ) : null}
          </div>

          <section className="rounded-xl border border-white/10 p-4 space-y-4">
            <div className="font-semibold text-[#4db6ac]">Analysis</div>
            {nonEmptyAnalysisKeys(analysis).length === 0 ? (
              <p className="text-sm text-white/50">No analysis sections yet.</p>
            ) : (
              nonEmptyAnalysisKeys(analysis).map(key => (
                <div key={key} className="border-b border-white/5 pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/50">{key}</div>
                    {(USER_EDITABLE_SECTIONS as readonly string[]).includes(key) ? (
                      <button
                        type="button"
                        onClick={() => openEdit(key)}
                        className="text-[11px] text-[#4db6ac] hover:underline"
                      >
                        Edit note
                      </button>
                    ) : null}
                  </div>
                  <pre className="text-xs text-white/85 whitespace-pre-wrap font-sans leading-relaxed">
                    {analysisSectionToText(key, analysis[key])}
                  </pre>
                </div>
              ))
            )}
          </section>

          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-white/70">profilingPlatformActivity (raw)</summary>
            <pre className="mt-3 text-[10px] text-white/60 overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(profile.profilingPlatformActivity ?? null, null, 2)}
            </pre>
          </details>
          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-white/70">profilingSharedExternals (raw)</summary>
            <pre className="mt-3 text-[10px] text-white/60 overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(profile.profilingSharedExternals ?? null, null, 2)}
            </pre>
          </details>

          <p className="text-xs text-orange-300/90">
            If this is totally wrong, tap <strong>This is wrong</strong>, then update your{' '}
            <button type="button" className="underline" onClick={() => navigate('/profile')}>
              public profile
            </button>{' '}
            and activity so Steve has better inputs, and use <strong>Request refresh</strong> (rate-limited).
          </p>
        </div>
      )}

      {editKey ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111] p-5 space-y-3">
            <div className="font-semibold text-white">Edit: {editKey}</div>
            <p className="text-xs text-[#9fb0b5]">
              Your note is stored on Steve&apos;s profile as a user edit (see <code className="text-white/70">_userEdits</code> in Firestore).
            </p>
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

      {feedback ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full border border-white/10 bg-white/10 text-sm text-white max-w-[90vw] text-center">
          {feedback}
        </div>
      ) : null}
    </div>
  )
}
