import { useEffect, useState } from 'react'
import { apiJson, apiPost } from '../utils/api'

interface DashCommunity {
  id: number
  name: string
  creator_username?: string | null
  member_count?: number
  type?: string
  children?: DashCommunity[]
}

interface CommunityRow {
  id: number
  name: string
  creator?: string
  member_count?: number
  network_type?: string
}

function flattenDashboardCommunities(nodes: DashCommunity[]): CommunityRow[] {
  const out: CommunityRow[] = []
  const walk = (n: DashCommunity) => {
    out.push({
      id: n.id,
      name: n.name,
      creator: n.creator_username ?? undefined,
      member_count: n.member_count,
      network_type: n.type ?? undefined,
    })
    for (const ch of n.children ?? []) walk(ch)
  }
  for (const n of nodes) walk(n)
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
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
  memberCount?: number
  membersWithKB?: number
  kbDimensions?: number
  generatedAt?: string
  networkType?: string
}

export default function NetworkInsights() {
  const [communities, setCommunities] = useState<CommunityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [insightError, setInsightError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [selectedCommunity, setSelectedCommunity] = useState<CommunityRow | null>(null)
  const [insights, setInsights] = useState<NetworkInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  const fetchCommunities = () => {
    setLoading(true)
    setLoadError('')
    apiJson<{ communities?: DashCommunity[] }>('/api/admin/dashboard')
      .then(d => setCommunities(flattenDashboardCommunities(d.communities ?? [])))
      .catch(() => setLoadError('Failed to load communities'))
      .finally(() => setLoading(false))
  }

  const generateInsights = async (community: CommunityRow) => {
    setSelectedCommunity(community)
    setInsightsLoading(true)
    setInsightError('')
    try {
      const result = await apiPost(`/api/admin/knowledge_base/network/${community.id}/insights`, {})
      if (result.success && result.insights) {
        setInsights(result.insights)
      } else {
        setInsightError(result.error || 'Failed to generate insights')
        setInsights(null)
      }
    } catch (err: unknown) {
      const errorMsg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : err && typeof err === 'object' && 'error' in err
            ? String((err as { error?: string }).error)
            : 'Failed to generate insights'
      setInsightError(errorMsg)
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
  if (loadError) return <div className="text-red-400 text-center py-20">{loadError}</div>

  return (
    <div className="flex h-[calc(100vh-4rem)]">
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
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(c.id, c.name)
                  }}
                  className="text-red-400 hover:text-red-300 text-xs p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                  type="button"
                >
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted mb-4">
                <span>
                  <i className="fa-solid fa-users mr-1" />
                  {c.member_count ?? 0} members
                </span>
              </div>
              <button
                type="button"
                onClick={() => generateInsights(c)}
                className="w-full py-2 text-sm bg-[#4db6ac] hover:bg-[#3da89a] text-black font-medium rounded-xl transition-colors"
              >
                Generate Insights
              </button>
            </div>
          ))}
        </div>

        {communities.length === 0 && (
          <div className="bg-surface-2 border border-white/10 rounded-xl p-8 text-center text-muted">No communities found</div>
        )}
      </div>

      <div className="flex-1 p-6 overflow-auto">
        {!selectedCommunity ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-6xl mb-6 opacity-30">🌐</div>
            <h3 className="text-xl font-medium text-white/70 mb-2">Network Insights</h3>
            <p className="text-muted max-w-xs">
              Select a network on the left to generate strategic insights, group recommendations, and content ideas from
              Steve&apos;s Knowledge Base.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">{selectedCommunity.name}</h2>
                <p className="text-muted">Network Insights • Generated by Steve&apos;s Reasoning Layer</p>
              </div>
              <button
                type="button"
                onClick={() => generateInsights(selectedCommunity)}
                disabled={insightsLoading}
                className="px-6 py-2 bg-[#4db6ac] hover:bg-[#3da89a] disabled:opacity-50 text-black font-medium rounded-lg flex items-center gap-2"
              >
                {insightsLoading ? 'Generating...' : 'Generate Fresh Insights'}
              </button>
            </div>

            {insightError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{insightError}</div>
            )}

            {insightsLoading && (
              <div className="bg-surface-2 border border-white/10 rounded-2xl p-12 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-[#4db6ac] border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-muted">Steve is analyzing the Knowledge Base...</p>
              </div>
            )}

            {insights && !insightsLoading && (
              <div className="space-y-8">
                <div className="bg-surface-2 border border-white/10 rounded-2xl p-4 flex flex-wrap items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-[#4db6ac]">📊</span>
                    <span className="text-muted">Data Coverage:</span>
                  </div>
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-white/80">
                      <strong className="text-white">{insights.membersWithKB ?? '?'}</strong>/{insights.memberCount ?? '?'}{' '}
                      members with KB
                    </span>
                    <span className="text-white/80">
                      <strong className="text-white">{insights.kbDimensions ?? '?'}</strong>/6 dimensions
                    </span>
                    {insights.networkType && (
                      <span className="px-2 py-0.5 bg-[#4db6ac]/10 text-[#4db6ac] rounded text-xs">{insights.networkType}</span>
                    )}
                  </div>
                  {insights.generatedAt && (
                    <span className="text-muted ml-auto text-xs">{new Date(insights.generatedAt).toLocaleString()}</span>
                  )}
                </div>

                <div className="bg-surface-2 border border-white/10 rounded-2xl p-6">
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <span className="text-[#4db6ac]">📋</span> Executive Summary
                  </h3>
                  <p className="text-white/80 leading-relaxed">{insights.summary}</p>
                </div>

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
                            <div className="text-[#4db6ac] text-sm">
                              {rec.memberCount} members • {Math.round(rec.confidence * 100)}% confidence
                            </div>
                          </div>
                          <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs rounded-full">Recommended</div>
                        </div>
                        <p className="text-white/70 text-sm mb-4">{rec.rationale}</p>
                        <div className="flex gap-3">
                          <button type="button" className="px-5 py-2 bg-white text-black text-sm font-medium rounded-xl hover:bg-white/90">
                            Create Group
                          </button>
                          <button type="button" className="px-5 py-2 border border-white/30 text-sm rounded-xl hover:bg-white/5">
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <span className="text-[#4db6ac]">📅</span> Content Ideas
                  </h3>
                  <div className="bg-surface-2 border border-white/10 rounded-2xl p-6 space-y-3">
                    {insights.contentIdeas.map((idea, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-black/30 rounded-xl">
                        <div className="w-6 h-6 rounded-full bg-[#4db6ac]/10 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                          #{i + 1}
                        </div>
                        <div className="text-white/80">{idea}</div>
                      </div>
                    ))}
                  </div>
                </div>

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
