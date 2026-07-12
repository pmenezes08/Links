import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Data layer for the Made with Steve gallery (Explore Creations).
 *
 * - Fetches the anonymous approved catalog (`/api/builder/explore`) without a
 *   cache-buster: the endpoint is short-cacheable server-side, and the
 *   "I just listed mine" case is covered by the optimistic sessionStorage
 *   handoff below, not by defeating the HTTP cache.
 * - Groups creations into sections (game → app → website) client-side so
 *   optimistic items land in their shelf immediately.
 * - `sectioned` implements the thin-supply collapse rule: shelves only render
 *   when every section holds at least 3 items and the catalog totals 12+;
 *   below that the page shows one mixed grid so sparse supply never reads as
 *   empty shelves.
 */

export type ExploreCreation = {
  id: number
  title: string
  kind?: string | null
  public_kind?: string | null
  category?: string | null
  play_url?: string | null
  public_url?: string | null
  plays?: number | null
  label?: string | null
}

export type ExploreSectionKind = 'game' | 'app' | 'website'

export type ExploreSection = {
  kind: ExploreSectionKind
  items: ExploreCreation[]
  /** category slug → item count (untagged items excluded; they still list) */
  categories: Record<string, number>
}

type ExploreLocationState = {
  optimisticCreation?: ExploreCreation | null
}

const OPTIMISTIC_EXPLORE_KEY = 'cpoint:explore:optimistic_creations'
export const SECTION_ORDER: ExploreSectionKind[] = ['game', 'app', 'website']

/** Mirrors the backend's `_public_kind` buckets so both sides agree on shelves. */
export function sectionOf(item: Pick<ExploreCreation, 'kind' | 'public_kind'>): ExploreSectionKind {
  const raw = String(item.public_kind || item.kind || 'website').trim().toLowerCase()
  if (raw === 'game' || raw === 'games') return 'game'
  if (['app', 'tool', 'application', 'quiz', 'dashboard', 'tracker'].includes(raw)) return 'app'
  return 'website'
}

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
    category: raw.category || null,
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

export function useExploreCreations() {
  const location = useLocation()
  const optimisticCreations = useMemo(() => (
    mergeCreations(
      [safeOptimisticCreation((location.state as ExploreLocationState | null)?.optimisticCreation)]
        .filter((item): item is ExploreCreation => Boolean(item)),
      readStoredOptimisticCreations(),
    )
  ), [location.state])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(optimisticCreations.length > 0 ? 'ready' : 'loading')
  const [items, setItems] = useState<ExploreCreation[]>(() => optimisticCreations)
  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (optimisticCreations.length === 0) return
    setItems(prev => mergeCreations(optimisticCreations, prev))
    setState('ready')
  }, [optimisticCreations])

  const load = useCallback(async () => {
    setState(prev => (prev === 'ready' ? 'ready' : 'loading'))
    try {
      const res = await fetch('/api/builder/explore?limit=60', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        setState(prev => (prev === 'ready' ? 'ready' : 'error'))
        return
      }
      const fetched = Array.isArray(data.creations) ? data.creations : []
      if (data.taxonomy && typeof data.taxonomy === 'object') setTaxonomy(data.taxonomy)
      setItems(prev => mergeCreations(prev, fetched))
      setState('ready')
    } catch {
      setState(prev => (prev === 'ready' ? 'ready' : 'error'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const sections = useMemo<ExploreSection[]>(() => {
    const grouped: Record<ExploreSectionKind, ExploreCreation[]> = { game: [], app: [], website: [] }
    for (const item of items) grouped[sectionOf(item)].push(item)
    return SECTION_ORDER.map(kind => {
      const sectionItems = grouped[kind]
      const categories: Record<string, number> = {}
      for (const item of sectionItems) {
        if (item.category) categories[item.category] = (categories[item.category] || 0) + 1
      }
      return { kind, items: sectionItems, categories }
    })
  }, [items])

  // Thin-supply collapse rule (see module doc).
  const sectioned = items.length >= 12 && sections.every(s => s.items.length >= 3)

  return { state, items, sections, sectioned, taxonomy, reload: load }
}
