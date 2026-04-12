import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Title, Tooltip, Legend)

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
    adminFeedback?: {
      status?: string
      note?: string | React.ReactNode
    }
  }
}

const DIMENSION_COLORS: Record<string, string> = {
  Index: '#6366f1',
  LifeCareer: '#ef4444',
  GeographyCulture: '#f59e0b',
  Expertise: '#10b981',
  CompanyIntel: '#14b8a6',
  Opinions: '#8b5cf6',
  Identity: '#ec4899',
  Network: '#06b6d4',
  UniqueFingerprint: '#f97316',
  InferredContext: '#a855f7', // prominent purple for transformative insights
  // Network-level dimensions
  NetworkIndex: '#22d3ee',
  NetworkExpertise: '#10b981',
  NetworkGeographyCulture: '#f59e0b',
  NetworkComposition: '#8b5cf6',
  NetworkInferredContext: '#a855f7',
  NetworkUniqueFingerprint: '#f97316',
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

export default function KnowledgeBaseGraph({ username, networkId, open, onClose }: { username?: string; networkId?: number | null; open: boolean; onClose: () => void }) {
  const isNetwork = !!networkId
  const displayName = isNetwork ? `Network ${networkId}` : (username || 'Unknown')
  // Use correct document identifier (_network_{id} for networks, username for members)
  // This matches how synthesize_network_knowledge() stores documents in Firestore
  const backendId = isNetwork ? `_network_${networkId}` : (username || '')

  const [knowledge, setKnowledge] = useState<KnowledgeData>({})
  const [graphData, setGraphData] = useState<{ nodes: KBNode[]; edges: KBEdge[] }>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'graph' | 'notes' | 'analytics'>(isNetwork ? 'analytics' : 'notes')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState<'approved' | 'needs_correction' | 'missing_info'>('approved')
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)

  const loadKnowledge = useCallback(async () => {
    if (!backendId) return
    setLoading(true)
    try {
      // Use backendId (_network_XXX or username) for correct document lookup
      const resp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(backendId)}`, { credentials: 'include' })
      const data = await resp.json()
      if (data.success) {
        const k = data.knowledge || {}
        setKnowledge(k)
        const keys = Object.keys(k)
        if (keys.length > 0 && !selectedNote) setSelectedNote(keys[0])
      } else {
        console.warn('No knowledge base data found for', backendId, data)
      }
    } catch (err) {
      console.error('Failed to load knowledge base:', err)
    }
    setLoading(false)
  }, [backendId, selectedNote])

  const loadGraph = useCallback(async () => {
    if (!backendId) return
    try {
      const resp = await fetch(`/api/admin/knowledge_base/graph/${encodeURIComponent(backendId)}`, { credentials: 'include' })
      const data = await resp.json()
      if (data.success) {
        setGraphData({ nodes: data.nodes || [], edges: data.edges || [] })
      } else {
        console.warn('No graph data for', backendId)
      }
    } catch (err) {
      console.error('Failed to load graph:', err)
    }
  }, [backendId])

  useEffect(() => {
    if (open && (username || networkId)) {
      loadKnowledge()
      loadGraph()
    }
  }, [open, username, networkId, backendId, loadKnowledge, loadGraph])

  const triggerSynthesis = async () => {
    if (!backendId) return
    setSynthesizing(true)
    try {
      // For networks, use the dedicated network synthesize endpoint to match AdminDashboard
      const url = isNetwork
        ? `/api/admin/knowledge_base/network/${networkId}/synthesize`
        : `/api/admin/knowledge_base/${encodeURIComponent(backendId)}/synthesize`

      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await resp.json()
      if (data.success) {
        await loadKnowledge()
        await loadGraph()
      } else {
        const reason = data.reason ? ` [${data.reason}]` : ''
        alert(`Synthesis failed: ${data.error || 'Unknown error'}${reason}`)
      }
    } catch (err) {
      console.error('Synthesis error:', err)
      alert('Synthesis request failed')
    }
    setSynthesizing(false)
  }

  const resetKnowledgeBase = async () => {
    const confirmMsg = isNetwork
      ? `Delete ALL synthesized knowledge for Network ${networkId}?\n\nThis cannot be undone.`
      : `Delete ALL synthesized knowledge for @${username}?\n\nThis cannot be undone.`
    if (!confirm(confirmMsg)) return

    try {
      const resp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(backendId)}/reset`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await resp.json()
      if (data.success) {
        await loadKnowledge()
        await loadGraph()
        setSelectedNote(null)
      } else {
        alert(`Reset failed: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Reset error:', err)
      alert('Failed to reset knowledge base')
    }
  }

  const submitFeedback = async (noteType: string) => {
    if (!backendId) return
    if ((feedbackStatus === 'needs_correction' || feedbackStatus === 'missing_info') && !feedbackNote.trim()) return
    setFeedbackSubmitting(true)
    try {
      const resp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(backendId)}/feedback`, {
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
        setFeedbackStatus('approved')
        await loadKnowledge()
      } else {
        console.error('Feedback failed:', data)
      }
    } catch (err) {
      console.error('Feedback error:', err)
    }
    setFeedbackSubmitting(false)
  }

  if (!open) return null

  const noteKeys = Object.keys(knowledge)
  const hasKnowledge = noteKeys.length > 0
  const selected = selectedNote && knowledge[selectedNote] ? knowledge[selectedNote] : null

  const networkAnalytics = useMemo(() => {
    if (!isNetwork || !hasKnowledge) return null
    const compositionKey = noteKeys.find(k => knowledge[k]?.noteType === 'NetworkComposition')
    const indexKey = noteKeys.find(k => knowledge[k]?.noteType === 'NetworkIndex')
    const expertiseKey = noteKeys.find(k => knowledge[k]?.noteType === 'NetworkExpertise')
    const geoKey = noteKeys.find(k => knowledge[k]?.noteType === 'NetworkGeographyCulture')
    const fingerprintKey = noteKeys.find(k => knowledge[k]?.noteType === 'NetworkUniqueFingerprint')
    const inferredKey = noteKeys.find(k => knowledge[k]?.noteType === 'NetworkInferredContext')

    const comp = compositionKey ? (knowledge[compositionKey].content as Record<string, any>) : {}
    const idx = indexKey ? (knowledge[indexKey].content as Record<string, any>) : {}
    const exp = expertiseKey ? (knowledge[expertiseKey].content as Record<string, any>) : {}
    const geo = geoKey ? (knowledge[geoKey].content as Record<string, any>) : {}
    const fp = fingerprintKey ? (knowledge[fingerprintKey].content as Record<string, any>) : {}
    const inf = inferredKey ? (knowledge[inferredKey].content as Record<string, any>) : {}

    const ci = comp.companyIntel || {}
    const pp = comp.personalProfile || {}

    return { comp, idx, exp, geo, fp, inf, ci, pp }
  }, [isNetwork, hasKnowledge, knowledge, noteKeys])

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
              {isNetwork ? '🌐' : (username?.[0]?.toUpperCase() || '?')}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{isNetwork ? 'Network Knowledge Base' : 'Knowledge Base'}</h2>
              <p className="text-[11px] text-white/40">@{displayName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/10">
              {isNetwork && (
                <button
                  onClick={() => setActiveView('analytics')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeView === 'analytics' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >Analytics</button>
              )}
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

            <button
              onClick={resetKnowledgeBase}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 border border-red-500/30 hover:border-red-500/50 transition-colors"
            >
              Reset KB
            </button>

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

          {/* Analytics View (Network only) */}
          {!loading && hasKnowledge && activeView === 'analytics' && isNetwork && networkAnalytics && (() => {
            const { comp, idx, exp, geo, fp, inf, ci, pp } = networkAnalytics
            const memberCount = idx.memberCount || 0
            const kbCount = idx.membersWithKB || 0

            const chartOpts = {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: '#1a1a1a', titleColor: '#fff', bodyColor: '#ccc', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 },
              },
              scales: {
                x: { ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
              },
            }
            const doughnutOpts = {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'right' as const, labels: { color: 'rgba(255,255,255,0.6)', font: { size: 10 }, boxWidth: 10, padding: 8 } },
                tooltip: { backgroundColor: '#1a1a1a', titleColor: '#fff', bodyColor: '#ccc' },
              },
            }
            const palette = ['#4db6ac', '#6366f1', '#ef4444', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4', '#22d3ee', '#a855f7', '#14b8a6']

            const expertiseDist = exp.primaryDomains || idx.expertiseDistribution || {}
            const expertiseLabels = Object.keys(expertiseDist).slice(0, 10)
            const expertiseValues = expertiseLabels.map(k => expertiseDist[k])

            const locDist = geo.primaryLocations || idx.primaryLocations || {}
            const locLabels = typeof locDist === 'object' && !Array.isArray(locDist) ? Object.keys(locDist).slice(0, 10) : []
            const locValues = locLabels.map(k => (locDist as Record<string, number>)[k])

            const industryDist = comp.industryDistribution || idx.industryDistribution || {}
            const industryLabels = Object.keys(industryDist).slice(0, 10)
            const industryValues = industryLabels.map(k => industryDist[k])

            const globalPresence = ci.globalPresence || {}
            const gpLabels = Object.keys(globalPresence)
            const gpValues = gpLabels.map(k => globalPresence[k])

            const ppSplit = ci.publicPrivateSplit || {}
            const ppLabels = Object.keys(ppSplit)
            const ppValues = ppLabels.map(k => ppSplit[k])

            const valDist = ci.valuationDistribution || {}
            const valLabels = Object.keys(valDist)
            const valValues = valLabels.map(k => valDist[k])

            const sectorDist = ci.sectorBreakdown || {}
            const sectorLabels = Object.keys(sectorDist).slice(0, 10)
            const sectorValues = sectorLabels.map(k => sectorDist[k])

            const traitDist = pp.traitDistribution || {}
            const traitLabels = Object.keys(traitDist).slice(0, 12)
            const traitValues = traitLabels.map(k => traitDist[k])

            const valueDist = pp.coreValueDistribution || {}
            const valueLabels = Object.keys(valueDist).slice(0, 10)
            const valueValues = valueLabels.map(k => valueDist[k])

            return (
              <div className="h-full overflow-y-auto p-5 space-y-6">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="text-2xl font-bold text-[#4db6ac]">{memberCount}</div>
                    <div className="text-[11px] text-white/50 mt-1">Total Members</div>
                  </div>
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="text-2xl font-bold text-[#6366f1]">{kbCount}</div>
                    <div className="text-[11px] text-white/50 mt-1">With Knowledge Base</div>
                  </div>
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="text-2xl font-bold text-[#f59e0b]">{ci.totalCompanies || '—'}</div>
                    <div className="text-[11px] text-white/50 mt-1">Companies Tracked</div>
                  </div>
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="text-2xl font-bold text-[#10b981]">{ci.avgSize != null ? `~${ci.avgSize}` : '—'}</div>
                    <div className="text-[11px] text-white/50 mt-1">Avg Company Size</div>
                  </div>
                </div>

                {/* Synthesis narrative */}
                {idx.currentSynthesis && (
                  <div className="bg-white/[0.03] rounded-xl border border-white/10 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium mb-2">Network Overview</div>
                    <p className="text-sm text-white/70 leading-relaxed">{String(idx.currentSynthesis)}</p>
                  </div>
                )}

                {/* Professional Section */}
                <div>
                  <div className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Professional Intelligence</div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Expertise Distribution */}
                    {expertiseLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Expertise Domains</div>
                        <div className="h-48">
                          <Bar data={{
                            labels: expertiseLabels,
                            datasets: [{ data: expertiseValues, backgroundColor: palette.slice(0, expertiseLabels.length), borderRadius: 4 }],
                          }} options={chartOpts} />
                        </div>
                      </div>
                    )}

                    {/* Industry Distribution */}
                    {industryLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Industry Mix</div>
                        <div className="h-48">
                          <Bar data={{
                            labels: industryLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
                            datasets: [{ data: industryValues, backgroundColor: palette.slice(2, 2 + industryLabels.length), borderRadius: 4 }],
                          }} options={chartOpts} />
                        </div>
                      </div>
                    )}

                    {/* Company Intel: Global vs Regional vs Local */}
                    {gpLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Global Presence</div>
                        <div className="h-48">
                          <Doughnut data={{
                            labels: gpLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
                            datasets: [{ data: gpValues, backgroundColor: ['#4db6ac', '#6366f1', '#f59e0b'], borderWidth: 0 }],
                          }} options={doughnutOpts} />
                        </div>
                      </div>
                    )}

                    {/* Company Intel: Public vs Private */}
                    {ppLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Public vs Private</div>
                        <div className="h-48">
                          <Doughnut data={{
                            labels: ppLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
                            datasets: [{ data: ppValues, backgroundColor: ['#10b981', '#8b5cf6', '#f97316', '#06b6d4'], borderWidth: 0 }],
                          }} options={doughnutOpts} />
                        </div>
                      </div>
                    )}

                    {/* Valuation Tiers */}
                    {valLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Valuation Tiers</div>
                        <div className="h-48">
                          <Bar data={{
                            labels: valLabels.map(l => l.replace(/_/g, ' ')),
                            datasets: [{ data: valValues, backgroundColor: palette.slice(4, 4 + valLabels.length), borderRadius: 4 }],
                          }} options={chartOpts} />
                        </div>
                      </div>
                    )}

                    {/* Sector Breakdown */}
                    {sectorLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Sector Breakdown</div>
                        <div className="h-48">
                          <Bar data={{
                            labels: sectorLabels,
                            datasets: [{ data: sectorValues, backgroundColor: palette.slice(1, 1 + sectorLabels.length), borderRadius: 4 }],
                          }} options={chartOpts} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Geography Section */}
                {locLabels.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Geographic Distribution</div>
                    <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                      <div className="h-52">
                        <Bar data={{
                          labels: locLabels,
                          datasets: [{ data: locValues, backgroundColor: '#f59e0b', borderRadius: 4 }],
                        }} options={chartOpts} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Personal Section */}
                <div>
                  <div className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Personal Intelligence</div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Trait Distribution */}
                    {traitLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Personality Traits</div>
                        <div className="h-52">
                          <Bar data={{
                            labels: traitLabels,
                            datasets: [{ data: traitValues, backgroundColor: '#ec4899', borderRadius: 4 }],
                          }} options={{
                            ...chartOpts,
                            indexAxis: 'y' as const,
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Core Values */}
                    {valueLabels.length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Core Values</div>
                        <div className="h-52">
                          <Bar data={{
                            labels: valueLabels,
                            datasets: [{ data: valueValues, backgroundColor: '#a855f7', borderRadius: 4 }],
                          }} options={{
                            ...chartOpts,
                            indexAxis: 'y' as const,
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Energy Patterns */}
                    {(pp.energyPatterns || []).length > 0 && (
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4 lg:col-span-2">
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-2">Collective Energy Patterns</div>
                        <div className="space-y-1.5">
                          {(pp.energyPatterns as string[]).slice(0, 6).map((ep: string, i: number) => (
                            <div key={i} className="text-xs text-white/60 pl-3 border-l-2 border-[#ec4899]/30">{ep}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Unique Fingerprint & Bridging */}
                {(fp.whatMakesThisNetworkSpecial || fp.bridgingCapability) && (
                  <div className="bg-gradient-to-r from-[#6366f1]/10 to-[#4db6ac]/10 rounded-xl border border-white/10 p-5">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Network Fingerprint</div>
                    {fp.whatMakesThisNetworkSpecial && (
                      <p className="text-sm text-white/70 leading-relaxed mb-3">{String(fp.whatMakesThisNetworkSpecial)}</p>
                    )}
                    {fp.bridgingCapability && (
                      <div>
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-1">Bridging Capability</div>
                        <p className="text-xs text-white/60">{String(fp.bridgingCapability)}</p>
                      </div>
                    )}
                    {fp.rareQualities && Array.isArray(fp.rareQualities) && fp.rareQualities.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(fp.rareQualities as string[]).slice(0, 8).map((q: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-[10px] text-white/50">{q}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Strategic Value & Inferred Context */}
                {(inf.strategicValue || inf.bridgingOpportunities) && (
                  <div className="bg-white/[0.03] rounded-xl border border-white/10 p-5">
                    <div className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">Strategic Intelligence</div>
                    {inf.strategicValue && (
                      <p className="text-sm text-white/70 leading-relaxed mb-3">{String(inf.strategicValue)}</p>
                    )}
                    {inf.bridgingOpportunities && (
                      <div>
                        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-1">Bridging Opportunities</div>
                        <p className="text-xs text-white/60">{String(inf.bridgingOpportunities)}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Top Companies */}
                {comp.topCompanies && Object.keys(comp.topCompanies).length > 0 && (
                  <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                    <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">Top Companies in Network</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(comp.topCompanies as Record<string, number>).slice(0, 12).map(([name, count]) => (
                        <span key={name} className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white/60">
                          {name} <span className="text-white/30">({count})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

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
                      <div className={`mt-3 px-3 py-2 rounded-lg text-xs border ${
                        selected.adminFeedback.status === 'needs_correction'
                          ? 'bg-red-500/10 border-red-500/20 text-red-300/80'
                          : selected.adminFeedback.status === 'missing_info'
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-300/80'
                          : 'bg-green-500/10 border-green-500/20 text-green-300/80'
                      }`}>
                        <span className="font-medium">
                          {selected.adminFeedback.status === 'needs_correction' ? 'Correction pending'
                            : selected.adminFeedback.status === 'missing_info' ? 'Missing information flagged'
                            : 'Approved'}
                        </span>
                        {selected.adminFeedback.note && (
                          <p className="text-white/60 mt-1">{String(selected.adminFeedback.note)}</p>
                        )}
                      </div>
                    )}

                    <div className="mt-4 border-t border-white/5 pt-3">
                      <p className="text-[10px] uppercase tracking-wider text-white/30 font-medium mb-2">Feedback</p>
                      <div className="flex gap-1.5 mb-2">
                        <button
                          onClick={() => setFeedbackStatus('approved')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            feedbackStatus === 'approved'
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                          }`}
                        >Approve</button>
                        <button
                          onClick={() => setFeedbackStatus('needs_correction')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            feedbackStatus === 'needs_correction'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                          }`}
                        >Wrong Info</button>
                        <button
                          onClick={() => setFeedbackStatus('missing_info')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            feedbackStatus === 'missing_info'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                          }`}
                        >Missing Info</button>
                      </div>
                      {feedbackStatus === 'needs_correction' && (
                        <textarea
                          value={feedbackNote}
                          onChange={e => setFeedbackNote(e.target.value)}
                          placeholder="What's wrong? What should it say instead? (required)"
                          rows={2}
                          className="w-full px-2.5 py-2 bg-white/5 border border-red-500/20 rounded-lg text-xs text-white/80 placeholder-white/25 focus:outline-none focus:border-red-500/40 resize-none mb-2"
                        />
                      )}
                      {feedbackStatus === 'missing_info' && (
                        <textarea
                          value={feedbackNote}
                          onChange={e => setFeedbackNote(e.target.value)}
                          placeholder='What info is missing? e.g. "Spent 7 years at Deloitte in consulting" (required)'
                          rows={2}
                          className="w-full px-2.5 py-2 bg-white/5 border border-amber-500/20 rounded-lg text-xs text-white/80 placeholder-white/25 focus:outline-none focus:border-amber-500/40 resize-none mb-2"
                        />
                      )}
                      {feedbackStatus === 'approved' && (
                        <input
                          value={feedbackNote}
                          onChange={e => setFeedbackNote(e.target.value)}
                          placeholder="Optional note..."
                          className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/80 placeholder-white/25 focus:outline-none focus:border-[#4db6ac] mb-2"
                        />
                      )}
                      <button
                        onClick={() => submitFeedback(selected.noteType)}
                        disabled={feedbackSubmitting || ((feedbackStatus === 'needs_correction' || feedbackStatus === 'missing_info') && !feedbackNote.trim())}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          feedbackSubmitting || ((feedbackStatus === 'needs_correction' || feedbackStatus === 'missing_info') && !feedbackNote.trim())
                            ? 'bg-white/5 text-white/20 cursor-not-allowed'
                            : 'bg-[#6366f1]/20 text-[#a5b4fc] border border-[#6366f1]/30 hover:bg-[#6366f1]/30'
                        }`}
                      >{feedbackSubmitting ? 'Saving...' : 'Submit Feedback'}</button>
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
