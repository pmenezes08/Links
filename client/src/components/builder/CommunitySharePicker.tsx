import { useEffect, useMemo, useState } from 'react'

export type CommunityNode = {
  id: number
  name: string | null
  type?: string | null
  parent_community_id?: number | null
  is_frozen?: boolean
  is_parent_only?: boolean
  children?: CommunityNode[]
}

type SearchResult = {
  node: CommunityNode
  label: string
}

type ShareResponse = {
  post_id?: number
  community_id?: number
  already_published?: boolean
}

type Props = {
  creationId: number
  sharedCommunityIds: number[]
  onShared: (communityId: number, response: ShareResponse) => void
}

function nodeName(node: CommunityNode): string {
  return node.name?.trim() || 'Untitled community'
}

function descendants(node: CommunityNode): CommunityNode[] {
  const children = Array.isArray(node.children) ? node.children : []
  return children.flatMap(child => [child, ...descendants(child)])
}

function searchTree(nodes: CommunityNode[], term: string): SearchResult[] {
  const q = term.trim().toLowerCase()
  if (!q) return []
  const results: SearchResult[] = []
  const visit = (node: CommunityNode, path: string[]) => {
    const label = [...path, nodeName(node)].join(' / ')
    if (label.toLowerCase().includes(q)) {
      results.push({ node, label })
    }
    for (const child of node.children || []) {
      visit(child, [...path, nodeName(node)])
    }
  }
  nodes.forEach(root => visit(root, []))
  return results
}

export default function CommunitySharePicker({ creationId, sharedCommunityIds, onShared }: Props) {
  const [roots, setRoots] = useState<CommunityNode[]>([])
  const [selectedRoot, setSelectedRoot] = useState<CommunityNode | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [sharingId, setSharingId] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const sharedSet = useMemo(() => new Set(sharedCommunityIds.map(Number)), [sharedCommunityIds])
  const results = useMemo(() => searchTree(roots, query), [query, roots])

  useEffect(() => {
    let active = true
    setState('loading')
    fetch('/api/user_communities_hierarchical', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (!r.ok || !j?.success) throw new Error('load_failed')
        return Array.isArray(j.communities) ? j.communities : []
      })
      .then(items => {
        if (!active) return
        setRoots(items)
        setState('ready')
      })
      .catch(() => {
        if (!active) return
        setState('error')
      })
    return () => {
      active = false
    }
  }, [])

  async function shareTo(node: CommunityNode) {
    if (sharedSet.has(node.id) || sharingId) return
    setSharingId(node.id)
    setMessage(null)
    try {
      const r = await fetch(`/api/builder/${creationId}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ community_id: node.id }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        setMessage(j?.error === 'not_found'
          ? 'You no longer have access to that community.'
          : 'Could not share this build. Please try again.')
        return
      }
      onShared(Number(j.community_id || node.id), j)
      setMessage(`Shared to ${nodeName(node)}.`)
    } catch {
      setMessage('Could not share this build. Please check your connection and try again.')
    } finally {
      setSharingId(null)
    }
  }

  const shareButton = (node: CommunityNode, label = 'Share') => {
    const shared = sharedSet.has(node.id)
    return (
      <button
        type="button"
        onClick={() => { void shareTo(node) }}
        disabled={shared || sharingId != null || node.is_frozen}
        className="rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-1.5 text-xs font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/15 disabled:cursor-not-allowed disabled:border-c-border disabled:bg-c-hover-bg disabled:text-c-text-tertiary"
      >
        {shared ? 'Shared' : sharingId === node.id ? 'Sharing...' : label}
      </button>
    )
  }

  if (state === 'loading') {
    return <div className="rounded-2xl border border-c-border bg-c-hover-bg p-4 text-sm text-c-text-tertiary">Loading your communities...</div>
  }

  if (state === 'error') {
    return <div className="rounded-2xl border border-c-border bg-c-hover-bg p-4 text-sm text-c-text-tertiary">We could not load your communities.</div>
  }

  return (
    <section className="rounded-2xl border border-c-border bg-c-hover-bg p-3">
      <div className="mb-3">
        <div className="text-sm font-semibold text-c-text-primary">Share to community</div>
        <p className="mt-1 text-xs text-c-text-tertiary">Choose a root first, then share to that root or any sub-community inside it.</p>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search communities"
        className="mb-3 w-full rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-sm text-c-text-primary outline-none placeholder:text-c-text-tertiary focus:border-cpoint-turquoise/50"
      />

      {query.trim() ? (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {results.length === 0 && <div className="px-2 py-3 text-sm text-c-text-tertiary">No communities found.</div>}
          {results.map(({ node, label }) => (
            <div key={node.id} className="flex items-center justify-between gap-3 rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-c-text-primary">{label}</span>
              {shareButton(node)}
            </div>
          ))}
        </div>
      ) : selectedRoot ? (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => setSelectedRoot(null)}
            className="mb-1 inline-flex items-center gap-2 text-xs font-semibold text-c-text-tertiary transition hover:text-cpoint-turquoise"
          >
            <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true" />
            Back to roots
          </button>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-cpoint-turquoise/20 bg-cpoint-turquoise/10 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-c-text-primary">Share to {nodeName(selectedRoot)}</span>
            {shareButton(selectedRoot, 'Share here')}
          </div>
          {descendants(selectedRoot).map(node => (
            <div key={node.id} className="flex items-center justify-between gap-3 rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-c-text-primary">{nodeName(node)}</span>
              {shareButton(node)}
            </div>
          ))}
          {descendants(selectedRoot).length === 0 && (
            <div className="px-2 py-3 text-sm text-c-text-tertiary">No sub-communities inside this root yet.</div>
          )}
        </div>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {roots.length === 0 && <div className="px-2 py-3 text-sm text-c-text-tertiary">You do not have communities to share to yet.</div>}
          {roots.map(root => (
            <button
              key={root.id}
              type="button"
              onClick={() => setSelectedRoot(root)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-left transition hover:border-cpoint-turquoise/35"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-c-text-primary">{nodeName(root)}</span>
                <span className="text-xs text-c-text-tertiary">{descendants(root).length} sub-communities</span>
              </span>
              <i className="fa-solid fa-chevron-right text-xs text-c-text-tertiary" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {message && <div className="mt-3 rounded-xl bg-c-bg-elevated px-3 py-2 text-xs text-c-text-secondary">{message}</div>}
    </section>
  )
}
