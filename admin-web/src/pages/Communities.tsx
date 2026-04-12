import { useEffect, useState } from 'react'
import { apiJson, apiPost } from '../utils/api'

interface Community {
  id: number
  name: string
  creator?: string
  member_count?: number
  created_at?: string
  network_type?: string
}

interface NetworkInsights {
  summary: string
  groupRecommendations: Array<{
    title: string
    memberCount: number
    rationale: string
    suggestedName: string
    confidence: number
  }>
  contentIdeas: string[]
  talentSignals: string[]
}

export default function Communities() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null)
  const [insights, setInsights] = useState<NetworkInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  const fetchCommunities = () => {
    setLoading(true)
    apiJson<{ communities?: Community[] }>('/api/admin/dashboard')
      .then(d => setCommunities(d.communities ?? []))
      .catch(() => setError('Failed to load communities'))
      .finally(() => setLoading(false))
  }

  const generateInsights = async (community: Community) => {
    setSelectedCommunity(community)
    setInsightsLoading(true)
    setError('')  // Clear previous errors
    try {
      const result = await apiPost(`/api/admin/knowledge_base/network/${community.id}/insights`, {})
      if (result.success && result.insights) {
        setInsights(result.insights)
      } else {
        setError(result.error || 'Failed to generate insights')
        setInsights(null)
      }
    } catch (err: any) {
      const errorMsg = err?.message || err?.error || 'Failed to generate insights'
      setError(errorMsg)
      setInsights(null)
    } finally {
      setInsightsLoading(false)
    }
  }

  useEffect(fetchCommunities, [])

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete community "${name}"?`)) return
    try {
      await apiPost('/api/admin/delete_community', { community_id: id })
      setActionMsg('Community deleted')
      fetchCommunities()
    } catch {
      setActionMsg('Failed to delete community')
    }
    setTimeout(() => setActionMsg(''), 3000)
  }

  if (loading) return <div className="text-muted text-center py-20">Loading communities...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left: Community List */}
      <div className="w-1/3 border-r border-white/10 overflow-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Network Communities</h1>
          <button
            onClick={fetchCommunities}
            className="px-3 py-1 text-xs bg-surface-2 hover:bg-surface-3 rounded border border-white/10"
          >
            Refresh
          </button>
        </div>

        {actionMsg && (
          <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{actionMsg}</div>
        )}

        <div className="space-y-3">
          {communities.map(c => (
            <div
              key={c.id}
              className="bg-surface-2 border border-white/10 rounded-xl p-4 hover:border-white/30 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{c.name}</h3>
                  {c.creator && <p className="text-muted text-xs mt-0.5">by {c.creator}</p>}
                  {c.network_type && (
                    <span className="inline-block mt-2 px-2 py-0.5 text-[10px] bg-[#4db6ac]/10 text-[#4db6ac] rounded">
                      {c.network_type}
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(c.id, c.name) }}
                  className="text-red-400 hover:text-red-300 text-xs p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted mb-4">
                <span><i className="fa-solid fa-users mr-1" />{c.member_count ?? 0} members</span>
                {c.created_at && <span>{new Date(c.created_at).toLocaleDateString()}</span>}
              </div>
              <button
                onClick={() => generateInsights(c)}
                className="w-full py-2 text-sm bg-[#4db6ac] hover:bg-[#3da89a] text-black font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-brain" />
                Generate Insights
              </button>
            </div>
          ))}
        </div>

        {communities.length === 0 && (
          <div className="bg-surface-2 border border-white/10 rounded-xl p-8 text-center text-muted">No communities found</div>
        )}
      </div>

      {/* Right: Insights Panel */}
      <div className="flex-1 p-6 overflow-auto">
        {!selectedCommunity ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-6xl mb-6 opacity-30">🌐</div>
            <h3 className="text-xl font-medium text-white/70 mb-2">Network Insights</h3>
            <p className="text-muted max-w-xs">Select a network on the left to generate strategic insights, group recommendations, and content ideas from Steve's Knowledge Base.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">{selectedCommunity.name}</h2>
                <p className="text-muted">Network Insights • Generated by Steve's Reasoning Layer</p>
              </div>
              <button
                onClick={() => generateInsights(selectedCommunity)}
                disabled={insightsLoading}
                className="px-6 py-2 bg-[#4db6ac] hover:bg-[#3da89a] disabled:opacity-50 text-black font-medium rounded-lg flex items-center gap-2"
              >
                {insightsLoading ? 'Generating...' : 'Generate Fresh Insights'}
              </button>
            </div>

            {insightsLoading && (
              <div className="bg-surface-2 border border-white/10 rounded-2xl p-12 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-[#4db6ac] border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-muted">Steve is analyzing the Knowledge Base...</p>
              </div>
            )}

            {insights && !insightsLoading && (
              <div className="space-y-8">
                {/* Summary */}
                <div className="bg-surface-2 border border-white/10 rounded-2xl p-6">
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <span className="text-[#4db6ac]">📋</span> Executive Summary
                  </h3>
                  <p className="text-white/80 leading-relaxed">{insights.summary}</p>
                </div>

                {/* Group Recommendations */}
                <div>
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <span className="text-[#4db6ac]">👥</span> Recommended Groups
                  </h3>
                  <div className="grid gap-4">
                    {insights.groupRecommendations.map((rec, i) => (
                      <div key={i} className="bg-surface-2 border border-white/10 rounded-2xl p-6">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="font-semibold text-lg">{rec.title}</div>
                            <div className="text-[#4db6ac] text-sm">{rec.memberCount} members • {Math.round(rec.confidence * 100)}% confidence</div>
                          </div>
                          <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs rounded-full">Recommended</div>
                        </div>
                        <p className="text-white/70 text-sm mb-4">{rec.rationale}</p>
                        <div className="flex gap-3">
                          <button className="px-5 py-2 bg-white text-black text-sm font-medium rounded-xl hover:bg-white/90">Create Group</button>
                          <button className="px-5 py-2 border border-white/30 text-sm rounded-xl hover:bg-white/5">Dismiss</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Content Ideas */}
                <div>
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <span className="text-[#4db6ac]">📅</span> Content Ideas
                  </h3>
                  <div className="bg-surface-2 border border-white/10 rounded-2xl p-6 space-y-3">
                    {insights.contentIdeas.map((idea, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-black/30 rounded-xl">
                        <div className="w-6 h-6 rounded-full bg-[#4db6ac]/10 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">#{i+1}</div>
                        <div className="text-white/80">{idea}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Talent Signals */}
                <div>
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <span className="text-[#4db6ac]">⭐</span> Notable Talent Signals
                  </h3>
                  <div className="bg-surface-2 border border-white/10 rounded-2xl p-6">
                    <ul className="space-y-2 text-white/80">
                      {insights.talentSignals.map((signal, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-[#4db6ac] mt-1">•</span>
                          {signal}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
