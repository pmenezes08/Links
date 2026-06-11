import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { useEntitlementsHandler } from '../contexts/EntitlementsContext'
import { renderBoldText } from '../utils/linkUtils'

type SteveProfilePayload = {
  username: string
  analysis: Record<string, unknown>
  lastUpdated?: string | null
  profilingExternalSources?: {
    updatedAt?: string
    items?: Array<{ url: string; kind: string; postDate?: string; success: boolean; detail?: string }>
  } | null
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
  if (Array.isArray(val)) return val.map(String).filter(Boolean).join(' Â· ')
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, { score?: number }>)
    if (entries.length === 0) return ''
    return entries
      .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
      .map(([name]) => name)
      .join(' Â· ')
  }
  return ''
}

/** Plain text for the edit modal (matches what we can POST as user edits). */
function sectionEditSeed(key: string, val: unknown): string {
  if (key === 'interests') return formatInterestsHuman(val)
  if (key === 'summary' || key === 'networkingValue') return typeof val === 'string' ? val : ''
  return ''
}

function getUserEdits(analysis: Record<string, unknown>): Record<string, unknown> {
  const u = analysis._userEdits
  if (u && typeof u === 'object' && !Array.isArray(u)) return u as Record<string, unknown>
  return {}
}

/** Prefer Firestore `_userEdits` over base analysis so saved suggestions show after reload. */
function getMergedSectionValue(key: string, analysis: Record<string, unknown>): unknown {
  const ue = getUserEdits(analysis)
  if (Object.prototype.hasOwnProperty.call(ue, key)) {
    const v = ue[key]
    if (v === null || v === undefined) return analysis[key]
    if (typeof v === 'string' && v.trim() === '') return analysis[key]
    return v
  }
  return analysis[key]
}

function visibleSectionKeys(analysis: Record<string, unknown>): string[] {
  return SECTION_ORDER.filter(k => sectionHasContent(k, getMergedSectionValue(k, analysis)))
}

export default function SteveKnowsMe() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const entitlementsHandler = useEntitlementsHandler()
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
        setError(d?.error || t('profile.steve_knows_page.load_failed'))
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
      setError(t('errors.network'))
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setTitle(t('profile.steve_knows_page.page_title'))
    return () => setTitle('')
  }, [setTitle, t])

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
    if (!d?.success) throw new Error(d?.error || t('profile.steve_knows_page.save_failed'))
  }

  const analysis = (profile?.analysis || {}) as Record<string, unknown>

  async function handleApprove() {
    const keys = visibleSectionKeys(analysis)
    if (keys.length === 0) {
      setFeedback(t('profile.steve_knows_page.nothing_to_approve'))
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
      setFeedback(t('profile.steve_knows_page.review_saved'))
      await load()
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : t('profile.steve_knows_page.save_failed'))
    } finally {
      setActionBusy(false)
    }
  }

  async function handleDispute() {
    if (!window.confirm(t('profile.steve_knows_page.dispute_confirm'))) return
    setActionBusy(true)
    setFeedback(null)
    try {
      await postAiReview({
        status: 'disputed',
        acceptedSections: [],
        edits: {},
      })
      setFeedback(t('profile.steve_knows_page.dispute_saved'))
      await load()
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : t('profile.steve_knows_page.save_failed'))
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
      setFeedback(t('profile.steve_knows_page.edit_saved'))
      await load()
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : t('profile.steve_knows_page.save_failed'))
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
      const d = await entitlementsHandler.handleResponse<{ success?: boolean; error?: string; message?: string }>(r)
      if (!d) { await load(); return } // entitlements modal already shown
      if (r.status === 429) {
        setFeedback(d?.error || t('profile.steve_knows_page.wait_before_refresh'))
        await load()
        return
      }
      if (r.status === 409) {
        setFeedback(t('profile.steve_knows_page.already_updating'))
        await load()
        return
      }
      if (!d?.success) {
        setFeedback(d?.error || t('profile.steve_knows_page.refresh_start_failed'))
        return
      }
      setFeedback(d.message || t('profile.steve_knows_page.refresh_started'))
      await load()
    } catch {
      setFeedback(t('errors.network'))
    } finally {
      setRefreshBusy(false)
    }
  }

  function openEdit(key: string) {
    setEditKey(key)
    setEditText(sectionEditSeed(key, getMergedSectionValue(key, analysis)))
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
                className="text-xs px-2.5 py-1 rounded-full bg-cpoint-turquoise/15 text-cpoint-turquoise border border-cpoint-turquoise/25"
              >
                {r}
              </span>
            ))}
          </div>
        ) : null}
        {driving ? (
          <p className="text-sm text-c-text-secondary leading-relaxed whitespace-pre-wrap">{renderBoldText(driving)}</p>
        ) : null}
        {bridge ? (
          <p className="text-sm text-cpoint-turquoise/90 leading-relaxed italic whitespace-pre-wrap">{renderBoldText(bridge)}</p>
        ) : null}
      </div>
    )
  }

  function renderSectionBody(key: string, val: unknown) {
    switch (key) {
      case 'summary':
      case 'networkingValue':
        return (
          <p className="text-sm text-c-text-primary leading-relaxed whitespace-pre-wrap">
            {renderBoldText(typeof val === 'string' ? val : '')}
          </p>
        )
      case 'identity':
        return renderIdentityBlock(val)
      case 'interests':
        return (
          <p className="text-sm text-c-text-primary leading-relaxed">{formatInterestsHuman(val)}</p>
        )
      default:
        return null
    }
  }

  const sectionTitle: Record<string, string> = {
    summary: t('profile.steve_knows_page.section_summary'),
    identity: t('profile.steve_knows_page.section_identity'),
    networkingValue: t('profile.steve_knows_page.section_networking'),
    interests: t('profile.steve_knows_page.section_interests'),
  }

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary px-4 py-6 pb-24 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-c-text-tertiary hover:text-white"
        >
          {t('profile.steve_knows_page.back')}
        </button>
      </div>

      <h1 className="text-xl font-semibold text-cpoint-turquoise mb-1">{t('profile.steve_knows_page.headline')}</h1>
      <p className="text-sm text-c-text-tertiary mb-4">{t('profile.steve_knows_page.subtitle')}</p>

      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate('/profile/steve')}
          className="text-sm text-cpoint-turquoise hover:underline"
        >
          {t('profile.steve_knows_page.view_public_profile')}
        </button>
      </div>

      {meta.analysisInProgress ? (
        <div className="mb-4 rounded-lg border border-cpoint-turquoise/40 bg-cpoint-turquoise/10 px-3 py-2 text-sm text-cpoint-turquoise">
          <i className="fa-solid fa-spinner fa-spin mr-2" />
          {t('profile.steve_knows_page.updating_banner')}
        </div>
      ) : null}

      {!meta.canRequestRefresh && !meta.analysisInProgress ? (
        <div className="mb-4 text-sm text-c-text-tertiary">
          {t(cooldownHours === 1 ? 'profile.steve_knows_page.cooldown' : 'profile.steve_knows_page.cooldown_other', {
            hours: cooldownHours,
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          type="button"
          title={
            !meta.canRequestRefresh && !meta.analysisInProgress
              ? t(cooldownHours === 1 ? 'profile.steve_knows_page.refresh_title_cooldown' : 'profile.steve_knows_page.refresh_title_cooldown_other', {
                  hours: cooldownHours,
                })
              : t('profile.steve_knows_page.refresh_title_available')
          }
          disabled={refreshBusy || meta.analysisInProgress || !meta.canRequestRefresh}
          onClick={() => setShowRefreshExplainer(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cpoint-turquoise/20 border border-cpoint-turquoise/40 text-cpoint-turquoise hover:bg-cpoint-turquoise/30 disabled:opacity-40"
          aria-label={t('profile.steve_knows_page.refresh_aria')}
        >
          {refreshBusy ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-arrows-rotate" />}
        </button>
        <button
          type="button"
          disabled={actionBusy || !profile || visibleSectionKeys(analysis).length === 0}
          onClick={() => void handleApprove()}
          className="px-3 py-2 rounded-lg bg-green-500/20 border border-green-500/40 text-sm text-green-300 hover:bg-green-500/30 disabled:opacity-40"
        >
          {t('profile.steve_knows_page.approve')}
        </button>
        <button
          type="button"
          disabled={actionBusy || !profile}
          onClick={() => void handleDispute()}
          className="px-3 py-2 rounded-lg bg-orange-500/15 border border-orange-500/35 text-sm text-orange-300 hover:bg-orange-500/25 disabled:opacity-40"
        >
          {t('profile.steve_knows_page.not_me')}
        </button>
      </div>

      {reviewStatus ? (
        <p className="text-xs text-c-text-tertiary mb-4">
          {t('profile.steve_knows_page.last_review')} <span className="text-c-text-secondary">{reviewStatus}</span>
        </p>
      ) : null}

      {loading ? (
        <div className="text-center py-16 text-c-text-tertiary">
          <i className="fa-solid fa-spinner fa-spin text-2xl mb-2" />
          <div>{t('profile.loading')}</div>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : !profile ? (
        <div className="space-y-4 text-sm text-c-text-tertiary">
          <p>{t('profile.steve_knows_page.empty_no_analysis')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-xs text-c-text-tertiary">
            {t('profile.steve_knows_page.last_updated_label')} {profile.lastUpdated || 'â€”'}
          </div>

            <section className="rounded-xl border border-c-border p-4 space-y-6">
            <div className="font-semibold text-cpoint-turquoise">{t('profile.steve_knows_page.what_steve_sees')}</div>
            {visibleSectionKeys(analysis).length === 0 ? (
              <p className="text-sm text-c-text-tertiary">{t('profile.steve_knows_page.no_sections_yet')}</p>
            ) : (
              visibleSectionKeys(analysis).map(key => (
                <div key={key} className="border-b border-c-border pb-5 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-semibold text-c-text-primary">{sectionTitle[key] ?? key}</div>
                    {(USER_EDITABLE_SECTIONS as readonly string[]).includes(key) ? (
                      <button
                        type="button"
                        onClick={() => openEdit(key)}
                        className="text-[11px] text-cpoint-turquoise hover:underline"
                      >
                        {t('profile.steve_knows_page.suggest_edit')}
                      </button>
                    ) : null}
                  </div>
                  <div className="bg-white/[0.03] rounded-lg px-3.5 py-3 border border-c-border">
                    {renderSectionBody(key, getMergedSectionValue(key, analysis))}
                  </div>
                </div>
              ))
            )}
          </section>

          {profile.profilingExternalSources?.items && profile.profilingExternalSources.items.length > 0 ? (
            <section className="rounded-xl border border-c-border p-4 space-y-3">
              <div className="font-semibold text-cyan-400/90 text-sm">{t('profile.steve_knows_page.external_sources_title')}</div>
              <p className="text-[11px] text-c-text-tertiary">{t('profile.steve_knows_page.external_sources_helper')}</p>
              {profile.profilingExternalSources.updatedAt ? (
                <div className="text-[10px] text-c-text-tertiary">
                  {t('profile.steve_knows_page.external_updated', {
                    date: new Date(profile.profilingExternalSources.updatedAt).toLocaleString(),
                  })}
                </div>
              ) : null}
              <ul className="space-y-2 text-[11px]">
                {profile.profilingExternalSources.items.map((item, idx) => (
                  <li key={`${item.url}-${idx}`} className="border-b border-c-border last:border-0 pb-2 last:pb-0">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cpoint-turquoise hover:underline break-all"
                    >
                      {item.url}
                    </a>
                    <div className="flex flex-wrap gap-1.5 mt-1 items-center text-c-text-tertiary">
                      <span className="text-[9px] uppercase tracking-wide">{item.kind}</span>
                      {item.postDate ? <span>Â· {t('profile.steve_knows_page.post_date_prefix', { date: item.postDate })}</span> : null}
                      <span className={item.success ? 'text-green-400/90' : 'text-amber-400/90'}>
                        Â· {item.success ? t('profile.steve_knows_page.source_used') : t('profile.steve_knows_page.source_not_used')}
                      </span>
                    </div>
                    {item.detail ? <div className="text-[10px] text-c-text-tertiary mt-0.5">{item.detail}</div> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="text-xs text-orange-300/90">
            {t('profile.steve_knows_page.footer_dispute_hint')}
          </p>
        </div>
      )}

      {editKey ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-c-border bg-c-bg-surface p-5 space-y-3">
            <div className="font-semibold text-c-text-primary">
              {t('profile.steve_knows_page.edit_modal_title', { section: sectionTitle[editKey] ?? editKey })}
            </div>
            <p className="text-xs text-c-text-tertiary">{t('profile.steve_knows_page.edit_modal_helper')}</p>
            <textarea
              className="w-full min-h-[140px] rounded-lg bg-c-bg-app border border-c-border px-3 py-2 text-sm outline-none focus:border-cpoint-turquoise"
              value={editText}
              onChange={e => setEditText(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditKey(null)}
                className="px-3 py-2 text-sm text-c-text-tertiary hover:text-white"
              >
                {t('profile.cancel')}
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleSaveEdit()}
                className="px-4 py-2 rounded-lg bg-cpoint-turquoise text-black text-sm font-medium disabled:opacity-50"
              >
                {t('profile.steve_knows_page.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRefreshExplainer ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-c-border bg-c-bg-surface p-5 space-y-4">
            <div className="font-semibold text-c-text-primary">{t('profile.steve_knows_page.refresh_explainer_title')}</div>
            <p className="text-sm text-c-text-tertiary leading-relaxed">{t('profile.steve_knows_page.refresh_explainer_body')}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowRefreshExplainer(false)}
                className="px-3 py-2 text-sm text-c-text-tertiary hover:text-white"
              >
                {t('profile.steve_knows_page.refresh_explainer_cancel')}
              </button>
              <button
                type="button"
                disabled={refreshBusy || meta.analysisInProgress || !meta.canRequestRefresh}
                onClick={() => {
                  setShowRefreshExplainer(false)
                  void handleRequestRefresh()
                }}
                className="px-4 py-2 rounded-lg bg-cpoint-turquoise text-black text-sm font-medium disabled:opacity-50"
              >
                {t('profile.steve_knows_page.refresh_button')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full border border-c-border bg-c-active-bg text-sm text-white max-w-[90vw] text-center">
          {feedback}
        </div>
      ) : null}
    </div>
  )
}
