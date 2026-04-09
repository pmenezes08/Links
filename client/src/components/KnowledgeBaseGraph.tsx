import { useCallback, useEffect, useState } from 'react'

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

export default function KnowledgeBaseGraph({ username }: { username: string }) {
  const [knowledge, setKnowledge] = useState<KnowledgeData>({})
  const [graphData, setGraphData] = useState<{ nodes: KBNode[]; edges: KBEdge[] }>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'graph' | 'notes'>('graph')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState<'approved' | 'needs_correction'>('approved')

  const loadKnowledge = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(username)}`, { credentials: 'include' })
      const data = await resp.json()
      if (data.success) {
        setKnowledge(data.knowledge || {})
      }
    } catch (err) {
      console.error('Failed to load knowledge base:', err)
    }
    setLoading(false)
  }, [username])

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
    if (username) {
      loadKnowledge()
      loadGraph()
    }
  }, [username, loadKnowledge, loadGraph])

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

  const noteKeys = Object.keys(knowledge)
  const hasKnowledge = noteKeys.length > 0

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ margin: 0 }}>Knowledge Base: @{username}</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveView('graph')}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: activeView === 'graph' ? '#6366f1' : '#e5e7eb', color: activeView === 'graph' ? '#fff' : '#374151',
            }}
          >Graph View</button>
          <button
            onClick={() => setActiveView('notes')}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: activeView === 'notes' ? '#6366f1' : '#e5e7eb', color: activeView === 'notes' ? '#fff' : '#374151',
            }}
          >Linked Notes</button>
          <button
            onClick={triggerSynthesis}
            disabled={synthesizing}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: synthesizing ? 'not-allowed' : 'pointer',
              background: '#10b981', color: '#fff', opacity: synthesizing ? 0.6 : 1,
            }}
          >{synthesizing ? 'Synthesizing...' : 'Synthesize'}</button>
        </div>
      </div>

      {loading && <p>Loading knowledge base...</p>}

      {!loading && !hasKnowledge && (
        <div style={{ textAlign: 'center', padding: '40px', background: '#f9fafb', borderRadius: '8px' }}>
          <p style={{ fontSize: '16px', color: '#6b7280' }}>No knowledge base data yet for this user.</p>
          <p style={{ fontSize: '14px', color: '#9ca3af' }}>Click "Synthesize" to generate the knowledge base from their existing profile and public data.</p>
        </div>
      )}

      {!loading && hasKnowledge && activeView === 'graph' && (
        <div style={{ position: 'relative', background: '#f9fafb', borderRadius: '12px', padding: '24px', minHeight: '400px' }}>
          <svg width="100%" height="400" viewBox="0 0 800 400">
            {graphData.edges.map((edge, i) => {
              const sourceNode = graphData.nodes.find(n => n.id === edge.source || n.noteType === edge.source)
              const targetNode = graphData.nodes.find(n => n.id === edge.target || n.noteType === edge.target)
              if (!sourceNode || !targetNode) return null
              const si = graphData.nodes.indexOf(sourceNode)
              const ti = graphData.nodes.indexOf(targetNode)
              const sx = 400 + 150 * Math.cos((2 * Math.PI * si) / Math.max(graphData.nodes.length, 1))
              const sy = 200 + 130 * Math.sin((2 * Math.PI * si) / Math.max(graphData.nodes.length, 1))
              const tx = 400 + 150 * Math.cos((2 * Math.PI * ti) / Math.max(graphData.nodes.length, 1))
              const ty = 200 + 130 * Math.sin((2 * Math.PI * ti) / Math.max(graphData.nodes.length, 1))
              return (
                <line key={`edge-${i}`} x1={sx} y1={sy} x2={tx} y2={ty}
                  stroke="#d1d5db" strokeWidth="1.5" strokeDasharray={edge.type === 'reference' ? '4 4' : 'none'} />
              )
            })}
            {graphData.nodes.map((node, i) => {
              const cx = 400 + 150 * Math.cos((2 * Math.PI * i) / Math.max(graphData.nodes.length, 1))
              const cy = 200 + 130 * Math.sin((2 * Math.PI * i) / Math.max(graphData.nodes.length, 1))
              const color = DIMENSION_COLORS[node.noteType] || '#9ca3af'
              const isSelected = selectedNote === node.id
              return (
                <g key={node.id} onClick={() => { setSelectedNote(node.id); setActiveView('notes') }} style={{ cursor: 'pointer' }}>
                  <circle cx={cx} cy={cy} r={isSelected ? 28 : 22} fill={color} opacity={node.hasContent ? 1 : 0.4} stroke={isSelected ? '#1f2937' : 'none'} strokeWidth="2" />
                  <text x={cx} y={cy + 36} textAnchor="middle" fontSize="11" fill="#374151" fontWeight="500">{node.noteType}</text>
                  {node.version > 1 && (
                    <text x={cx} y={cy + 5} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="bold">v{node.version}</text>
                  )}
                </g>
              )
            })}
          </svg>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px', justifyContent: 'center' }}>
            {Object.entries(DIMENSION_COLORS).map(([dim, color]) => (
              <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color }} />
                <span>{dim}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && hasKnowledge && activeView === 'notes' && (
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ width: '240px', flexShrink: 0 }}>
            <h4 style={{ margin: '0 0 8px' }}>Dimensions</h4>
            {noteKeys.map(key => {
              const data = knowledge[key]
              const nt = data?.noteType || key
              const color = DIMENSION_COLORS[nt] || '#9ca3af'
              return (
                <div
                  key={key}
                  onClick={() => setSelectedNote(key)}
                  style={{
                    padding: '8px 12px', marginBottom: '4px', borderRadius: '6px', cursor: 'pointer',
                    background: selectedNote === key ? color : '#f3f4f6',
                    color: selectedNote === key ? '#fff' : '#374151',
                    fontSize: '14px', fontWeight: selectedNote === key ? 600 : 400,
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  {nt}
                  {data?.version && data.version > 1 && (
                    <span style={{ fontSize: '10px', marginLeft: '6px', opacity: 0.8 }}>v{data.version}</span>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ flex: 1, background: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            {selectedNote && knowledge[selectedNote] ? (
              <>
                <h4 style={{ margin: '0 0 4px', color: DIMENSION_COLORS[knowledge[selectedNote].noteType] || '#374151' }}>
                  {knowledge[selectedNote].noteType}
                </h4>
                <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 12px' }}>
                  Updated: {knowledge[selectedNote].updatedAt || 'N/A'}
                </p>
                <pre style={{
                  background: '#f9fafb', padding: '12px', borderRadius: '6px', fontSize: '13px',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '300px', overflow: 'auto',
                }}>
                  {JSON.stringify(knowledge[selectedNote].content, null, 2)}
                </pre>
                {knowledge[selectedNote].adminFeedback && (
                  <div style={{ marginTop: '8px', padding: '8px', background: '#fef3c7', borderRadius: '6px', fontSize: '13px' }}>
                    Admin feedback: {JSON.stringify(knowledge[selectedNote].adminFeedback)}
                  </div>
                )}
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select value={feedbackStatus} onChange={e => setFeedbackStatus(e.target.value as typeof feedbackStatus)}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db' }}>
                    <option value="approved">Approved</option>
                    <option value="needs_correction">Needs Correction</option>
                  </select>
                  <input
                    value={feedbackNote} onChange={e => setFeedbackNote(e.target.value)}
                    placeholder="Optional feedback note..."
                    style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                  />
                  <button
                    onClick={() => submitFeedback(knowledge[selectedNote].noteType)}
                    style={{ padding: '4px 12px', borderRadius: '4px', border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer' }}
                  >Submit</button>
                </div>
              </>
            ) : (
              <p style={{ color: '#9ca3af' }}>Select a dimension from the sidebar to view its content.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
