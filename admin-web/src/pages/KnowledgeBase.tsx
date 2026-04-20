import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../utils/api'

// ── Types ────────────────────────────────────────────────────────────────

type FieldType =
  | 'integer'
  | 'decimal'
  | 'percent'
  | 'boolean'
  | 'string'
  | 'markdown'
  | 'date'
  | 'enum'
  | 'list_of_objects'
  | 'weighted_map'

interface Field {
  name: string
  label: string
  type: FieldType
  value: any
  prefix?: string
  suffix?: string
  help?: string
  tbd?: boolean
  group?: string
  allowed_values?: string[]
  schema?: { name: string; type: FieldType; label: string; allowed_values?: string[] }[]
}

interface FieldGroup {
  id: string
  label: string
  icon?: string
  description?: string
}

interface Category {
  id: string
  label: string
  icon: string
}

interface PageSummary {
  slug: string
  title: string
  category: string
  icon?: string
  description?: string
  sort_order: number
  version: number
  updated_at?: string
  updated_by?: string
  tbd_count: number
}

interface PageDetail extends PageSummary {
  fields: Field[]
  field_groups?: FieldGroup[]
  body_markdown: string
}

const STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-white/10 text-white/60 border-white/15',
  ongoing: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  completed: 'bg-green-500/15 text-green-400 border-green-500/30',
}

function StatusPill({ value }: { value: string }) {
  const cls = STATUS_COLORS[value] || 'bg-white/10 text-white/60 border-white/15'
  const label = (value || 'not_started').replace('_', ' ')
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${cls}`}>
      {label}
    </span>
  )
}

const PHASE_COLORS: Record<string, string> = {
  now: 'bg-accent/15 text-accent border-accent/30',
  next: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  later: 'bg-white/10 text-white/60 border-white/15',
  exploring: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/25',
}

function PhasePill({ value }: { value: string }) {
  const cls = PHASE_COLORS[value] || 'bg-white/10 text-white/60 border-white/15'
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${cls}`}>
      {value || '—'}
    </span>
  )
}

interface ChangelogEntry {
  id: number
  page_slug: string
  version_from: number | null
  version_to: number
  reason: string
  actor_username: string
  created_at: string
  changes: {
    body_changed?: boolean
    fields?: { name: string; label: string; from: any; to: any; tbd_from?: boolean; tbd_to?: boolean }[]
  }
}

// ── Utilities ────────────────────────────────────────────────────────────

const cloneFields = (fields: Field[]): Field[] =>
  JSON.parse(JSON.stringify(fields || []))

const fmtValue = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// ── Field editor ─────────────────────────────────────────────────────────

function FieldEditor({ field, onChange }: { field: Field; onChange: (newValue: any) => void }) {
  const common =
    'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none'

  switch (field.type) {
    case 'integer':
      return (
        <div className="flex items-center gap-2">
          {field.prefix && <span className="text-muted text-sm">{field.prefix}</span>}
          <input
            type="number"
            step={1}
            value={field.value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
            className={common + ' max-w-[180px]'}
          />
          {field.suffix && <span className="text-muted text-sm">{field.suffix}</span>}
        </div>
      )
    case 'decimal':
      return (
        <div className="flex items-center gap-2">
          {field.prefix && <span className="text-muted text-sm">{field.prefix}</span>}
          <input
            type="number"
            step="0.01"
            value={field.value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
            className={common + ' max-w-[180px]'}
          />
          {field.suffix && <span className="text-muted text-sm">{field.suffix}</span>}
        </div>
      )
    case 'percent':
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={field.value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
            className={common + ' max-w-[140px]'}
          />
          <span className="text-muted text-sm">%</span>
        </div>
      )
    case 'boolean':
      return (
        <button
          type="button"
          onClick={() => onChange(!field.value)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
            field.value ? 'bg-accent' : 'bg-white/20'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              field.value ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      )
    case 'enum':
      return (
        <select
          value={field.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={common + ' max-w-[260px]'}
        >
          <option value="" disabled>— select —</option>
          {(field.allowed_values || []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )
    case 'date':
      return (
        <input
          type="date"
          value={field.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={common + ' max-w-[200px]'}
        />
      )
    case 'string':
      return (
        <input
          type="text"
          value={field.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={common}
        />
      )
    case 'markdown':
      return (
        <textarea
          rows={4}
          value={field.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={common + ' font-mono text-xs'}
        />
      )
    case 'weighted_map':
      return <WeightedMapEditor value={field.value || {}} onChange={onChange} />
    case 'list_of_objects':
      return (
        <ListOfObjectsEditor
          schema={field.schema || []}
          value={Array.isArray(field.value) ? field.value : []}
          onChange={onChange}
        />
      )
    default:
      return <span className="text-red-400 text-xs">Unsupported field type: {field.type}</span>
  }
}

function WeightedMapEditor({
  value,
  onChange,
}: {
  value: Record<string, number>
  onChange: (v: Record<string, number>) => void
}) {
  const entries = Object.entries(value)
  const setKey = (i: number, key: string) => {
    const nextEntries = entries.map(([k, v], idx) => (idx === i ? [key, v] : [k, v])) as [string, number][]
    onChange(Object.fromEntries(nextEntries))
  }
  const setVal = (i: number, v: number) => {
    const nextEntries = entries.map(([k, oldV], idx) => (idx === i ? [k, v] : [k, oldV])) as [string, number][]
    onChange(Object.fromEntries(nextEntries))
  }
  const del = (i: number) => {
    const nextEntries = entries.filter((_, idx) => idx !== i)
    onChange(Object.fromEntries(nextEntries))
  }
  const add = () => {
    onChange({ ...value, [`new_key_${entries.length}`]: 1 })
  }
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={k}
            onChange={(e) => setKey(i, e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
          <span className="text-muted text-sm">=</span>
          <input
            type="number"
            step="0.1"
            value={v}
            onChange={(e) => setVal(i, parseFloat(e.target.value) || 0)}
            className="w-24 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => del(i)}
            className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-accent hover:text-accent/80 px-2 py-1"
      >
        <i className="fa-solid fa-plus mr-1" /> Add row
      </button>
    </div>
  )
}

function ListOfObjectsEditor({
  schema,
  value,
  onChange,
}: {
  schema: { name: string; type: FieldType; label: string; allowed_values?: string[] }[]
  value: any[]
  onChange: (v: any[]) => void
}) {
  const addRow = () => {
    const blank: Record<string, any> = {}
    for (const col of schema) blank[col.name] = col.type === 'boolean' ? false : ''
    onChange([...value, blank])
  }
  const del = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const update = (i: number, key: string, v: any) => {
    const next = value.map((row, idx) => (idx === i ? { ...row, [key]: v } : row))
    onChange(next)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const hasStatusCol = schema.some((c) => c.name === 'status')
  const hasPhaseCol = schema.some((c) => c.name === 'phase')
  const hasTitleCol = schema.some((c) => c.name === 'title')
  const hasTermCol = schema.some((c) => c.name === 'term')
  const hasUsernameCol = schema.some((c) => c.name === 'username')
  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-xs text-muted shrink-0">#{i + 1}</span>
              {hasTitleCol && row.title && (
                <span className="text-sm font-medium text-white/90 truncate max-w-[420px]">
                  {row.title}
                </span>
              )}
              {hasTermCol && row.term && (
                <span className="text-sm font-medium text-white/90 truncate max-w-[240px]">
                  {row.term}
                </span>
              )}
              {hasUsernameCol && row.username && (
                <span className="text-sm font-medium text-white/90 truncate max-w-[240px]">
                  @{row.username}
                </span>
              )}
              {hasPhaseCol && row.phase && <PhasePill value={row.phase} />}
              {hasStatusCol && <StatusPill value={row.status || 'not_started'} />}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => move(i, -1)} className="text-muted hover:text-white text-xs px-2 py-1">
                <i className="fa-solid fa-arrow-up" />
              </button>
              <button type="button" onClick={() => move(i, 1)} className="text-muted hover:text-white text-xs px-2 py-1">
                <i className="fa-solid fa-arrow-down" />
              </button>
              <button type="button" onClick={() => del(i)} className="text-red-400 hover:text-red-300 text-xs px-2 py-1">
                <i className="fa-solid fa-trash" />
              </button>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {schema.map((col) => (
              <div key={col.name}>
                <label className="block text-xs text-muted mb-1">{col.label}</label>
                {col.type === 'enum' ? (
                  <select
                    value={row[col.name] ?? ''}
                    onChange={(e) => update(i, col.name, e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                  >
                    <option value="" disabled>— select —</option>
                    {(col.allowed_values || []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : col.type === 'markdown' ? (
                  <textarea
                    rows={2}
                    value={row[col.name] ?? ''}
                    onChange={(e) => update(i, col.name, e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono focus:border-accent focus:outline-none"
                  />
                ) : col.type === 'boolean' ? (
                  <button
                    type="button"
                    onClick={() => update(i, col.name, !row[col.name])}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                      row[col.name] ? 'bg-accent' : 'bg-white/20'
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${
                        row[col.name] ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                ) : (
                  <input
                    type={col.type === 'integer' || col.type === 'decimal' || col.type === 'percent' ? 'number' : 'text'}
                    value={row[col.name] ?? ''}
                    onChange={(e) => update(i, col.name, e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="text-xs text-accent hover:text-accent/80 px-2 py-1"
      >
        <i className="fa-solid fa-plus mr-1" /> Add row
      </button>
    </div>
  )
}

// ── Changelog panel ──────────────────────────────────────────────────────

function ChangelogPanel({ slug, refreshKey }: { slug: string; refreshKey: number }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    apiJson<{ success: boolean; entries?: ChangelogEntry[] }>(
      `/api/admin/kb/changelog?slug=${encodeURIComponent(slug)}&limit=50`,
    )
      .then((d) => setEntries(d.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [slug, refreshKey])

  if (loading) return <div className="text-muted text-sm py-2">Loading history...</div>
  if (!entries.length) return <div className="text-muted text-xs py-2">No edits yet.</div>
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div key={e.id} className="bg-white/[0.03] border border-white/10 rounded-lg p-3 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-accent font-medium">
              v{e.version_from ?? '—'} → v{e.version_to}
            </span>
            <span className="text-muted">
              {e.created_at ? new Date(e.created_at).toLocaleString() : ''} · @{e.actor_username}
            </span>
          </div>
          <div className="text-white/80 italic mb-2">“{e.reason}”</div>
          {e.changes?.fields && e.changes.fields.length > 0 && (
            <div className="space-y-1">
              {e.changes.fields.map((f, i) => (
                <div key={i} className="text-white/70">
                  <span className="text-muted">{f.label}:</span>{' '}
                  <span className="line-through text-red-400/70">{fmtValue(f.from)}</span>{' '}
                  →{' '}
                  <span className="text-accent">{fmtValue(f.to)}</span>
                </div>
              ))}
            </div>
          )}
          {e.changes?.body_changed && (
            <div className="text-muted italic mt-1">Body text updated.</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────

export default function KnowledgeBase() {
  const [categories, setCategories] = useState<Category[]>([])
  const [pages, setPages] = useState<PageSummary[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [editFields, setEditFields] = useState<Field[]>([])
  const [editBody, setEditBody] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showReasonModal, setShowReasonModal] = useState(false)
  const [reason, setReason] = useState('')
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast] = useState('')
  const [reseeding, setReseeding] = useState(false)

  const refreshPages = () => {
    setLoading(true)
    apiJson<{ success: boolean; categories?: Category[]; pages?: PageSummary[] }>(
      '/api/admin/kb/pages',
    )
      .then((d) => {
        setCategories(d.categories || [])
        setPages(d.pages || [])
        if (!selectedSlug && d.pages && d.pages.length) {
          setSelectedSlug(d.pages[0].slug)
        }
      })
      .catch(() => setError('Failed to load knowledge base'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refreshPages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    setSaveError('')
    apiJson<{ success: boolean; page?: PageDetail }>(
      `/api/admin/kb/pages/${encodeURIComponent(selectedSlug)}`,
    )
      .then((d) => {
        if (d.page) {
          setDetail(d.page)
          setEditFields(cloneFields(d.page.fields || []))
          setEditBody(d.page.body_markdown || '')
        }
      })
      .catch(() => setSaveError('Failed to load page'))
      .finally(() => setDetailLoading(false))
  }, [selectedSlug])

  const isDirty = useMemo(() => {
    if (!detail) return false
    if (editBody !== (detail.body_markdown || '')) return true
    return JSON.stringify(editFields) !== JSON.stringify(detail.fields || [])
  }, [detail, editFields, editBody])

  const pagesByCategory = useMemo(() => {
    const m: Record<string, PageSummary[]> = {}
    for (const p of pages) {
      if (!m[p.category]) m[p.category] = []
      m[p.category].push(p)
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
    }
    return m
  }, [pages])

  const updateFieldValue = (idx: number, newValue: any) => {
    setEditFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value: newValue, tbd: false } : f)))
  }
  const toggleTbd = (idx: number) => {
    setEditFields((prev) => prev.map((f, i) => (i === idx ? { ...f, tbd: !f.tbd } : f)))
  }

  const handleReseed = async (force = false) => {
    if (force) {
      const ok = window.confirm(
        'FORCE RESEED will overwrite ALL pages with the latest seed content, including pages you have edited. This cannot be undone (changelog kept). Continue?',
      )
      if (!ok) return
    }
    setReseeding(true)
    try {
      const base = import.meta.env.VITE_API_BASE || ''
      const r = await fetch(`${base}/api/admin/kb/seed`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await r.json()
      if (!data.success) {
        setToast(`Reseed failed: ${data.error || 'unknown'}`)
      } else {
        const r2 = data.result || {}
        const parts: string[] = []
        if (r2.inserted) parts.push(`${r2.inserted} new`)
        if (r2.auto_upgraded) parts.push(`${r2.auto_upgraded} upgraded`)
        if (r2.forced) parts.push(`${r2.forced} forced`)
        if (r2.skipped) parts.push(`${r2.skipped} unchanged`)
        setToast(parts.length ? `Reseed OK: ${parts.join(', ')}` : 'Reseed OK')
        refreshPages()
        if (selectedSlug) {
          // Re-fetch the currently selected page to show any new fields/groups.
          const cur = selectedSlug
          setSelectedSlug(null)
          setTimeout(() => setSelectedSlug(cur), 0)
        }
      }
    } catch {
      setToast('Reseed failed: network error')
    } finally {
      setReseeding(false)
      setTimeout(() => setToast(''), 4000)
    }
  }

  const handleSave = async () => {
    if (!detail || !selectedSlug) return
    if (!reason.trim()) {
      setSaveError('Change reason is required.')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const base = import.meta.env.VITE_API_BASE || ''
      const r = await fetch(`${base}/api/admin/kb/pages/${encodeURIComponent(selectedSlug)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: editFields,
          body_markdown: editBody,
          reason: reason.trim(),
        }),
      })
      const data = await r.json()
      if (!data.success) {
        setSaveError(data.error || 'Save failed')
      } else if (data.page) {
        setDetail(data.page)
        setEditFields(cloneFields(data.page.fields || []))
        setEditBody(data.page.body_markdown || '')
        setShowReasonModal(false)
        setReason('')
        setHistoryRefreshKey((k) => k + 1)
        refreshPages()
        setToast('Saved')
        setTimeout(() => setToast(''), 3000)
      }
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-muted text-center py-20">Loading knowledge base...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  const selectedPage = pages.find((p) => p.slug === selectedSlug)

  return (
    <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6">
      <div className="flex min-h-[calc(100vh-3.5rem)] md:min-h-screen">
        {/* Left rail: categories + pages */}
        <aside className="hidden lg:block w-72 shrink-0 border-r border-white/10 bg-black p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-semibold">Knowledge Base</h1>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleReseed(false)}
                disabled={reseeding}
                title="Insert any new pages and upgrade untouched seeded pages to the latest version. Edited pages are preserved."
                className="text-[11px] px-2 py-1 rounded border border-white/10 text-white/70 hover:bg-white/5 disabled:opacity-50"
              >
                <i className={`fa-solid ${reseeding ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1`} />
                Reseed
              </button>
              <button
                onClick={() => handleReseed(true)}
                disabled={reseeding}
                title="DANGER: overwrite all pages with latest seed content, including pages you've edited."
                className="text-[11px] px-2 py-1 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                Force
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {categories.map((cat) => {
              const catPages = pagesByCategory[cat.id] || []
              if (!catPages.length) return null
              return (
                <div key={cat.id}>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted font-semibold mb-1.5 px-2">
                    <i className={`fa-solid ${cat.icon} text-[10px]`} />
                    {cat.label}
                  </div>
                  <div className="space-y-0.5">
                    {catPages.map((p) => (
                      <button
                        key={p.slug}
                        onClick={() => setSelectedSlug(p.slug)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                          selectedSlug === p.slug
                            ? 'bg-accent/10 text-accent'
                            : 'text-white/70 hover:bg-white/5'
                        }`}
                      >
                        {p.icon && <i className={`fa-solid ${p.icon} w-4 text-center text-xs`} />}
                        <span className="flex-1 truncate">{p.title}</span>
                        {p.tbd_count > 0 && (
                          <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                            {p.tbd_count} TBD
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {/* Mobile page picker */}
          <div className="lg:hidden mb-4">
            <select
              value={selectedSlug || ''}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
            >
              {pages.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title} {p.tbd_count > 0 ? `· ${p.tbd_count} TBD` : ''}
                </option>
              ))}
            </select>
          </div>

          {detailLoading ? (
            <div className="text-muted text-center py-20">Loading page...</div>
          ) : !detail ? (
            <div className="text-muted text-center py-20">Select a page on the left.</div>
          ) : (
            <div className="max-w-4xl space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    {detail.icon && <i className={`fa-solid ${detail.icon} text-accent`} />}
                    <h2 className="text-xl font-semibold">{detail.title}</h2>
                    <span className="text-xs text-muted">v{detail.version}</span>
                  </div>
                  {detail.description && (
                    <p className="text-muted text-sm">{detail.description}</p>
                  )}
                  {detail.updated_at && (
                    <p className="text-muted text-xs mt-1">
                      Last edited {new Date(detail.updated_at).toLocaleString()}
                      {detail.updated_by ? ` by @${detail.updated_by}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowHistory((v) => !v)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition"
                  >
                    <i className="fa-solid fa-clock-rotate-left mr-1.5" />
                    {showHistory ? 'Hide' : 'Show'} history
                  </button>
                  <button
                    onClick={() => setShowReasonModal(true)}
                    disabled={!isDirty}
                    className="px-4 py-1.5 text-xs rounded-lg bg-accent text-black font-semibold hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <i className="fa-solid fa-floppy-disk mr-1.5" />
                    Save changes
                  </button>
                </div>
              </div>

              {toast && (
                <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">
                  <i className="fa-solid fa-check mr-2" />
                  {toast}
                </div>
              )}

              {/* History panel */}
              {showHistory && (
                <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
                  <h3 className="font-semibold text-sm mb-3">Edit history</h3>
                  <ChangelogPanel slug={detail.slug} refreshKey={historyRefreshKey} />
                </div>
              )}

              {/* Fields (grouped if detail.field_groups present) */}
              {editFields.length > 0 && (() => {
                const groups = detail.field_groups || []
                const renderField = (f: Field, i: number) => (
                  <div
                    key={f.name}
                    className="border-b border-white/5 pb-4 last:border-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="text-sm font-medium text-white/90">{f.label}</label>
                          <code className="text-[10px] text-muted bg-white/5 px-1.5 py-0.5 rounded">
                            {f.name}
                          </code>
                          <span className="text-[10px] text-muted uppercase tracking-wide">
                            {f.type}
                          </span>
                          {f.tbd && (
                            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-medium">
                              ⚠ TBD
                            </span>
                          )}
                        </div>
                        {f.help && <p className="text-xs text-muted mt-1">{f.help}</p>}
                      </div>
                      <button
                        onClick={() => toggleTbd(i)}
                        className="text-[10px] text-muted hover:text-yellow-400 px-2 py-1"
                        title="Toggle TBD flag"
                      >
                        {f.tbd ? 'Clear TBD' : 'Mark TBD'}
                      </button>
                    </div>
                    <FieldEditor field={f} onChange={(v) => updateFieldValue(i, v)} />
                  </div>
                )

                // No explicit groups → fall back to flat list.
                if (groups.length === 0) {
                  return (
                    <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
                      <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-sliders text-accent" />
                        Editable parameters
                      </h3>
                      <div className="space-y-5">
                        {editFields.map((f, i) => renderField(f, i))}
                      </div>
                    </div>
                  )
                }

                // Grouped view: render one card per group, in field_groups order.
                // Fields without a matching group go into an "Other" bucket at the end.
                const groupedIds = new Set(groups.map((g) => g.id))
                const byGroup = new Map<string, { field: Field; index: number }[]>()
                for (const g of groups) byGroup.set(g.id, [])
                const other: { field: Field; index: number }[] = []
                editFields.forEach((f, i) => {
                  if (f.group && groupedIds.has(f.group)) {
                    byGroup.get(f.group)!.push({ field: f, index: i })
                  } else {
                    other.push({ field: f, index: i })
                  }
                })

                return (
                  <div className="space-y-4">
                    {groups.map((g) => {
                      const items = byGroup.get(g.id) || []
                      if (items.length === 0) return null
                      return (
                        <div
                          key={g.id}
                          className="bg-surface-2 border border-white/10 rounded-xl p-5"
                        >
                          <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                            {g.icon && <i className={`fa-solid ${g.icon} text-accent`} />}
                            {g.label}
                          </h3>
                          {g.description && (
                            <p className="text-xs text-muted mb-4">{g.description}</p>
                          )}
                          <div className="space-y-5 mt-3">
                            {items.map(({ field: f, index: i }) => renderField(f, i))}
                          </div>
                        </div>
                      )
                    })}
                    {other.length > 0 && (
                      <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
                        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                          <i className="fa-solid fa-ellipsis text-accent" />
                          Other
                        </h3>
                        <div className="space-y-5">
                          {other.map(({ field: f, index: i }) => renderField(f, i))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Body markdown */}
              <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <i className="fa-brands fa-markdown text-accent" />
                  Narrative (markdown)
                </h3>
                <textarea
                  rows={18}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:border-accent focus:outline-none"
                />
                <p className="text-[11px] text-muted mt-2">
                  Prose that explains the fields above. Keep numbers referenced here in sync with
                  the editable parameters — or better, only mention field names, not values.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Save reason modal */}
      {showReasonModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-50" onClick={() => !saving && setShowReasonModal(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
            <div className="bg-surface-2 border border-white/10 rounded-xl p-6 max-w-lg w-full pointer-events-auto">
              <h3 className="font-semibold mb-1">Save changes to “{selectedPage?.title}”</h3>
              <p className="text-muted text-xs mb-4">
                This will bump the page to v{(detail?.version || 1) + 1} and append a changelog
                entry. Reason is required.
              </p>
              <label className="text-sm text-muted block mb-1.5">Change reason</label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                placeholder="e.g. Raised Premium standard to €7.99 after margin recalc."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              {saveError && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
                  {saveError}
                </div>
              )}
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setShowReasonModal(false)}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !reason.trim()}
                  className="px-4 py-2 text-sm rounded-lg bg-accent text-black font-semibold hover:bg-accent/90 disabled:opacity-50 transition"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
