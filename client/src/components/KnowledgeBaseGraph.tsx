import React, { useCallback, useEffect, useState } from 'react'

interface KBNode {
  id: string
  type: string
  noteType: string
  label: string
  updatedAt: string
  hasContent: boolean
  version: number
}

interface KBEdge {
  source: string
  target: string
  type: string
}

interface KnowledgeData {
  [key: string]: {
    noteType: string
    type: string
    content: Record<string, unknown>
    updatedAt?: string
    createdAt?: string
    version?: number
    adminFeedback?: Record<string, unknown>
  }
}

const DIMENSION_COLORS: Record<string, string> = {
  Index: '#6366f1',
  LifeCareer: '#ef4444',
  GeographyCulture: '#f59e0b',
  Expertise: '#10b981',
  Opinions: '#8b5cf6',
  Identity: '#ec4899',
  Network: '#06b6d4',
  UniqueFingerprint: '#f97316',
}

function renderValue(val: unknown, depth = 0): React.ReactNode {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    if (val.length === 0) return '—'
    if (val.every(v => typeof v === 'string' || typeof v === 'number')) {
      return val.join(', ')
    }
    return (
      <div className="space-y-1.5">
        {val.map((item, i) => (
          <div key={i} className="pl-3 border-l border-white/10">
            {renderValue(item, depth + 1)}
          </div>
        ))}
      </div>
    )
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>)
    if (entries.length === 0) return '—'
    return (
      <div className={depth > 0 ? 'pl-3 border-l border-white/10 space-y-1' : 'space-y-2'}>
        {entries.map(([k, v]) => (
          <div key={k}>
            <span className="text-white/40 text-[11px] uppercase tracking-wide">{k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</span>
            <div className="text-white/80 text-xs mt-0.5">{renderValue(v, depth + 1)}</div>
          </div>
        ))}
      </div>
    )
  }
  return String(val)
}

export default function KnowledgeBaseGraph({ username, open, onClose }: { username: string; open: boolean; onClose: () => void }) {
  const [knowledge, setKnowledge] = useState<KnowledgeData>({})
  const [graphData, setGraphData] = useState<{ nodes: KBNode[]; edges: KBEdge[] }>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'graph' | 'notes'>('notes')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState<'approved' | 'needs_correction'>('approved')

  const loadKnowledge = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(username)}`, { credentials: 'include' })
      const data = await resp.json()
      if (data.success) {
        const k = data.knowledge || {}
        setKnowledge(k)
        const keys = Object.keys(k)
        if (keys.length > 0 && !selectedNote) setSelectedNote(keys[0])
      }
    } catch (err) {
      console.error('Failed to load knowledge base:', err)
    }
    setLoading(false)
  }, [username, selectedNote])

  const loadGraph = useCallback(async () => {
    try {
      const resp = await fetch(`/api/admin/knowledge_base/graph/${encodeURIComponent(username)}`, { credentials: 'include' })
      const data = await resp.json()
      if (data.success) {
        setGraphData({ nodes: data.nodes || [], edges: data.edges || [] })
      }
    } catch (err) {
      console.error('Failed to load graph:', err)
    }
  }, [username])

  useEffect(() => {
    if (open && username) {
      loadKnowledge()
      loadGraph()
    }
  }, [open, username, loadKnowledge, loadGraph])

  const triggerSynthesis = async () => {
    setSynthesizing(true)
    try {
      const resp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(username)}/synthesize`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await resp.json()
      if (data.success) {
        await loadKnowledge()
        await loadGraph()
      } else {
        alert(`Synthesis failed: ${data.error}`)
      }
    } catch (err) {
      console.error('Synthesis error:', err)
    }
    setSynthesizing(false)
  }

  const submitFeedback = async (noteType: string) => {
    try {
      const resp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(username)}/feedback`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteType,
          feedback: { status: feedbackStatus, note: feedbackNote },
        }),
      })
      const data = await resp.json()
      if (data.success) {
        setFeedbackNote('')
        await loadKnowledge()
      }
    } catch (err) {
      console.error('Feedback error:', err)
    }
  }

  if (!open) return null

  const noteKeys = Object.keys(knowledge)
  const hasKnowledge = noteKeys.length > 0
  const selected = selectedNote && knowledge[selectedNote] ? knowledge[selectedNote] : null

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#1a1a1a] rounded-xl w-full max-w-5xl max-h-[90vh] border border-white/10 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-[#6366f1] rounded-full flex items-center justify-center text-[11px] font-bold text-white">
              {username[0]?.toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Knowledge Base</h2>
              <p className="text-[11px] text-white/40">@{username}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/10">
              <button
                onClick={() => setActiveView('graph')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeView === 'graph' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                }`}
              >Graph</button>
              <button
                onClick={() => setActiveView('notes')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeView === 'notes' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                }`}
              >Notes</button>
            </div>

            <button
              onClick={triggerSynthesis}
              disabled={synthesizing}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                synthesizing
                  ? 'bg-[#10b981]/20 text-[#6ee7b7]/60 cursor-not-allowed'
                  : 'bg-[#10b981]/20 text-[#6ee7b7] border border-[#10b981]/30 hover:bg-[#10b981]/30'
              }`}
            >{synthesizing ? 'Synthesizing...' : 'Synthesize'}</button>

            <button onClick={onClose} className="ml-1 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {loading && (
            <div className="h-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          )}

          {!loading && !hasKnowledge && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 11.5a.75.75 0 110-1.5.75.75 0 010 1.5zM10.75 9a.75.75 0 01-1.5 0V6.5a.75.75 0 011.5 0V9z" fill="currentColor" className="text-white/30"/></svg>
              </div>
              <p className="text-sm text-white/50">No knowledge base data yet</p>
              <p className="text-xs text-white/30 mt-1">Click Synthesize to generate from existing profile data</p>
            </div>
          )}

          {/* Graph View */}
          {!loading && hasKnowledge && activeView === 'graph' && (
            <div className="h-full p-6 overflow-auto">
              <div className="bg-white/5 rounded-xl border border-white/10 p-6">
                <svg width="100%" height="380" viewBox="0 0 800 380">
                  {graphData.edges.map((edge, i) => {
                    const sourceNode = graphData.nodes.find(n => n.id === edge.source || n.noteType === edge.source)
                    const targetNode = graphData.nodes.find(n => n.id === edge.target || n.noteType === edge.target)
                    if (!sourceNode || !targetNode) return null
                    const si = graphData.nodes.indexOf(sourceNode)
                    const ti = graphData.nodes.indexOf(targetNode)
                    const total = Math.max(graphData.nodes.length, 1)
                    const sx = 400 + 160 * Math.cos((2 * Math.PI * si) / total)
                    const sy = 190 + 140 * Math.sin((2 * Math.PI * si) / total)
                    const tx = 400 + 160 * Math.cos((2 * Math.PI * ti) / total)
                    const ty = 190 + 140 * Math.sin((2 * Math.PI * ti) / total)
                    return (
                      <line key={`edge-${i}`} x1={sx} y1={sy} x2={tx} y2={ty}
                        stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray={edge.type === 'reference' ? '4 4' : 'none'} />
                    )
                  })}
                  {graphData.nodes.map((node, i) => {
                    const total = Math.max(graphData.nodes.length, 1)
                    const cx = 400 + 160 * Math.cos((2 * Math.PI * i) / total)
                    const cy = 190 + 140 * Math.sin((2 * Math.PI * i) / total)
                    const color = DIMENSION_COLORS[node.noteType] || '#9ca3af'
                    const isSelected = selectedNote === node.id
                    return (
                      <g key={node.id} onClick={() => { setSelectedNote(node.id); setActiveView('notes') }} style={{ cursor: 'pointer' }}>
                        <circle cx={cx} cy={cy} r={isSelected ? 26 : 20} fill={color} opacity={node.hasContent ? 0.85 : 0.25}
                          stroke={isSelected ? '#fff' : 'none'} strokeWidth="2" />
                        <text x={cx} y={cy + 34} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.6)" fontWeight="500">
                          {node.noteType}
                        </text>
                        {node.version > 1 && (
                          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="bold">v{node.version}</text>
                        )}
                      </g>
                    )
                  })}
                </svg>
                <div className="flex gap-3 flex-wrap mt-4 justify-center">
                  {Object.entries(DIMENSION_COLORS).map(([dim, color]) => (
                    <div key={dim} className="flex items-center gap-1.5 text-[11px] text-white/50">
                      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                      {dim}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes View */}
          {!loading && hasKnowledge && activeView === 'notes' && (
            <div className="flex h-full">
              {/* Sidebar */}
              <div className="w-48 flex-shrink-0 border-r border-white/10 p-3 overflow-y-auto">
                <p className="text-[10px] uppercase tracking-wider text-white/30 font-medium mb-2 px-1">Dimensions</p>
                {noteKeys.map(key => {
                  const data = knowledge[key]
                  const nt = data?.noteType || key
                  const color = DIMENSION_COLORS[nt] || '#9ca3af'
                  const active = selectedNote === key
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedNote(key)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs mb-0.5 transition-colors flex items-center gap-2 ${
                        active ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/70'
                      }`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      {nt}
                      {data?.version && data.version > 1 && (
                        <span className="text-[10px] text-white/30 ml-auto">v{data.version}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5">
                {selected ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ background: DIMENSION_COLORS[selected.noteType] || '#9ca3af' }} />
                      <h3 className="text-sm font-semibold" style={{ color: DIMENSION_COLORS[selected.noteType] || '#fff' }}>
                        {selected.noteType}
                      </h3>
                    </div>
                    <p className="text-[11px] text-white/30 mb-4">
                      Updated {selected.updatedAt ? new Date(selected.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                    </p>

                    <div className="bg-white/5 rounded-lg border border-white/10 p-4 max-h-[50vh] overflow-y-auto">
                      {renderValue(selected.content)}
                    </div>

                    {selected.adminFeedback && (
                      <div className="mt-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300/80">
                        Admin feedback: {JSON.stringify(selected.adminFeedback)}
                      </div>
                    )}

                    <div className="mt-4 flex gap-2 items-center">
                      <select
                        value={feedbackStatus}
                        onChange={e => setFeedbackStatus(e.target.value as typeof feedbackStatus)}
                        className="px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-[#4db6ac]"
                      >
                        <option value="approved">Approved</option>
                        <option value="needs_correction">Needs Correction</option>
                      </select>
                      <input
                        value={feedbackNote}
                        onChange={e => setFeedbackNote(e.target.value)}
                        placeholder="Optional note..."
                        className="flex-1 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/80 placeholder-white/30 focus:outline-none focus:border-[#4db6ac]"
                      />
                      <button
                        onClick={() => submitFeedback(selected.noteType)}
                        className="px-3 py-1.5 bg-[#6366f1]/20 text-[#a5b4fc] border border-[#6366f1]/30 rounded-lg text-xs font-medium hover:bg-[#6366f1]/30 transition-colors"
                      >Submit</button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-white/30 text-xs">
                    Select a dimension to view
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
