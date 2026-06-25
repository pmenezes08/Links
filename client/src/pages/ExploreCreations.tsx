import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

function kindLabel(item: ExploreCreation): string {
  const raw = String(item.public_kind || item.kind || 'creation').toLowerCase()
  if (raw === 'web' || raw === 'website') return 'Website'
  if (raw === 'app') return 'App'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

export default function ExploreCreations() {
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<ExploreCreation[]>([])

  useEffect(() => {
    setTitle('Explore Creations')
    return () => setTitle('')
  }, [setTitle])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch('/api/builder/explore', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        setState('error')
        return
      }
      setItems(Array.isArray(data.creations) ? data.creations : [])
      setState('ready')
    } catch {
      setState('error')
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
