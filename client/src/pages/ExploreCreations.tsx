import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type ExploreCreation = {
  id: number
  title: string
  kind?: string | null
  public_kind?: string | null
  play_url?: string | null
  public_url?: string | null
  plays?: number | null
  label?: string | null
}

type ExploreLocationState = {
  optimisticCreation?: ExploreCreation | null
}

const OPTIMISTIC_EXPLORE_KEY = 'cpoint:explore:optimistic_creations'

function safeOptimisticCreation(value: unknown): ExploreCreation | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ExploreCreation>
  const id = Number(raw.id)
  if (!Number.isFinite(id) || id <= 0) return null
  return {
    id,
    title: String(raw.title || 'Untitled creation'),
    kind: raw.kind || null,
    public_kind: raw.public_kind || null,
    play_url: raw.play_url || `/creation/${id}`,
    public_url: raw.public_url || null,
    plays: Number(raw.plays || 0),
    label: raw.label || 'Made with Steve',
  }
}

function readStoredOptimisticCreations(): ExploreCreation[] {
  try {
    const raw = window.sessionStorage.getItem(OPTIMISTIC_EXPLORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const values = Array.isArray(parsed) ? parsed : [parsed]
    return values.map(safeOptimisticCreation).filter((item): item is ExploreCreation => Boolean(item))
  } catch {
    return []
  }
}

function mergeCreations(primary: ExploreCreation[], secondary: ExploreCreation[]): ExploreCreation[] {
  const seen = new Set<number>()
  const merged: ExploreCreation[] = []
  for (const item of [...primary, ...secondary]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

function kindLabel(item: ExploreCreation): string {
  const raw = String(item.public_kind || item.kind || 'creation').toLowerCase()
  if (raw === 'web' || raw === 'website') return 'Website'
  if (raw === 'app') return 'App'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

export default function ExploreCreations() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setTitle } = useHeader()
  const optimisticCreations = useMemo(() => (
    mergeCreations(
      [safeOptimisticCreation((location.state as ExploreLocationState | null)?.optimisticCreation)]
        .filter((item): item is ExploreCreation => Boolean(item)),
      readStoredOptimisticCreations(),
    )
  ), [location.state])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(optimisticCreations.length > 0 ? 'ready' : 'loading')
  const [items, setItems] = useState<ExploreCreation[]>(() => optimisticCreations)

  useEffect(() => {
    if (optimisticCreations.length === 0) return
    setItems(prev => mergeCreations(optimisticCreations, prev))
    setState('ready')
  }, [optimisticCreations])

  useEffect(() => {
    setTitle('Explore Creations')
    return () => setTitle('')
  }, [setTitle])

  const load = useCallback(async () => {
    setState(prev => (prev === 'ready' ? 'ready' : 'loading'))
    try {
      const res = await fetch(`/api/builder/explore?limit=60&_=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        setState(prev => (prev === 'ready' ? 'ready' : 'error'))
        return
      }
      const fetched = Array.isArray(data.creations) ? data.creations : []
      setItems(prev => mergeCreations(prev, fetched))
      setState('ready')
    } catch {
      setState(prev => (prev === 'ready' ? 'ready' : 'error'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="app-content min-h-screen chat-thread-bg text-c-text-primary">
      <div className="mx-auto max-w-5xl px-4 py-6 pb-[var(--app-dashboard-content-pad-bottom)]">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cpoint-turquoise">Made with Steve</p>
            <h1 className="mt-1 text-2xl font-semibold text-c-text-primary">Explore Creations</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-c-text-secondary">
              Try websites, apps, and tools built by C-Point members. Creator names and communities are private in this gallery.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/builder')}
            className="rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
          >
            Create with Steve
          </button>
        </div>

        {state === 'loading' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-40 rounded-2xl border border-c-border bg-c-bg-elevated/60 animate-pulse" />
            ))}
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-6 text-center">
            <p className="text-sm text-c-text-secondary">We couldn't load Explore Creations.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
            >
              Try again
            </button>
          </div>
        )}

        {state === 'ready' && items.length === 0 && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cpoint-turquoise/15 text-cpoint-turquoise">
              <i className="fa-solid fa-wand-magic-sparkles text-xl" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-c-text-primary">No public creations yet</h2>
            <p className="mt-1 text-sm text-c-text-tertiary">Be one of the first to create something with Steve and request gallery listing.</p>
          </div>
        )}

        {state === 'ready' && items.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col rounded-2xl border border-c-border bg-c-bg-elevated p-4 shadow-c-card">
                <div className="mb-4 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide">
                  <span className="rounded-full bg-cpoint-turquoise/15 px-2 py-0.5 text-cpoint-turquoise">{kindLabel(item)}</span>
                  <span className="text-c-text-tertiary">{item.label || 'Made with Steve'}</span>
                </div>
                <h2 className="line-clamp-2 text-[15px] font-semibold text-c-text-primary">{item.title || 'Untitled creation'}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-c-text-tertiary">
                  Open this creation inside C-Point. Creator and community details are not shown.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(item.play_url || `/creation/${item.id}`)}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-cpoint-turquoise px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110"
                >
                  Open creation <i className="fa-solid fa-arrow-right text-xs" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
