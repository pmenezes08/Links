import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type Creation = {
  id: number
  title: string | null
  kind: string | null
  status: string | null
  community_id: number | null
  published_post_id: number | null
  updated_at: string | null
  plays: number
}

function formatUpdated(value: string | null): string {
  if (!value) return ''
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const mins = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

export default function MyBuilds() {
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [creations, setCreations] = useState<Creation[]>([])

  useEffect(() => {
    setTitle('My Builds')
    return () => setTitle('')
  }, [setTitle])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const r = await fetch('/api/builder/mine', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        setState('error')
        return
      }
      setCreations(Array.isArray(j.creations) ? j.creations : [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="app-content min-h-screen chat-thread-bg text-c-text-primary">
      <div className="mx-auto max-w-3xl px-4 py-6 pb-[var(--app-dashboard-content-pad-bottom)]">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-c-text-primary">My Builds</h1>
          <p className="mt-1 text-sm text-c-text-tertiary">Creations you made with Steve.</p>
        </div>

        {state === 'loading' && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-2xl border border-c-border bg-c-bg-elevated/60 animate-pulse" />
            ))}
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-5 text-center">
            <p className="text-sm text-c-text-secondary">We couldn't load your builds.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
            >
              Try again
            </button>
          </div>
        )}

        {state === 'ready' && creations.length === 0 && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cpoint-turquoise/15 text-cpoint-turquoise">
              <i className="fa-solid fa-wand-magic-sparkles text-xl" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-c-text-primary">Create your first build</h2>
            <p className="mt-1 text-sm text-c-text-tertiary">
              Open a community and ask Steve to build a game, quiz, or tool.
            </p>
            <button
              type="button"
              onClick={() => navigate('/premium_dashboard')}
              className="mt-4 rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
            >
              Choose a community
            </button>
          </div>
        )}

        {state === 'ready' && creations.length > 0 && (
          <ul className="space-y-3">
            {creations.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-c-border bg-c-bg-elevated p-4 shadow-c-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-c-text-primary">
                      {c.title?.trim() || 'Untitled build'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-c-text-tertiary">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          c.status === 'published'
                            ? 'bg-cpoint-turquoise/20 text-cpoint-turquoise'
                            : 'bg-c-hover-bg text-c-text-secondary'
                        }`}
                      >
                        {c.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-play text-[9px]" aria-hidden="true" />
                        {c.plays}
                      </span>
                      {formatUpdated(c.updated_at) && (
                        <span className="flex items-center gap-1">
                          <i className="fa-regular fa-clock text-[9px]" aria-hidden="true" />
                          {formatUpdated(c.updated_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {c.community_id != null && (
                    <button
                      type="button"
                      onClick={() => navigate(`/community/${c.community_id}/creation/${c.id}`)}
                      className="rounded-xl bg-cpoint-turquoise px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-110"
                    >
                      {c.status === 'published' ? 'Play' : 'Preview'}
                    </button>
                  )}
                  {c.community_id != null && (
                    <button
                      type="button"
                      onClick={() => navigate(`/community/${c.community_id}/builder?creation_id=${c.id}`)}
                      className="rounded-xl border border-c-border bg-c-hover-bg px-3 py-1.5 text-xs font-semibold text-c-text-primary transition hover:border-cpoint-turquoise/40"
                    >
                      Continue building
                    </button>
                  )}
                  {c.community_id != null && (
                    <button
                      type="button"
                      onClick={() => navigate(`/community_feed_react/${c.community_id}`)}
                      className="rounded-xl border border-c-border bg-transparent px-3 py-1.5 text-xs font-medium text-c-text-secondary transition hover:text-c-text-primary"
                    >
                      Open community
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
