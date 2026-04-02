import { useEffect, useState, useCallback } from 'react'
import { apiJson, api } from '../utils/api'

interface Analysis {
  summary?: string
  interests?: { [key: string]: number }
  traits?: string[]
  observations?: string
  dataQuality?: string
  companyIntel?: { name?: string; description?: string; sector?: string; stage?: string } | null
  roleContext?: { title?: string; seniority?: string; function?: string; implication?: string } | null
  networkingValue?: string | null
}

interface Profile {
  username: string
  display_name?: string
  analysis: Analysis
  lastUpdated?: string
}

export default function UserProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('')
  const [search, setSearch] = useState('')
  const [analyzing, setAnalyzing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await apiJson('/api/admin/steve_profiles')
      if (d?.success) setProfiles(d.profiles || [])
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const analyze = async (username: string) => {
    setAnalyzing(username)
    try {
      const res = await api(`/api/admin/steve_profiles/${encodeURIComponent(username)}/analyze`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
      })
      const d = await res.json()
      if (d?.success && d.analysis) {
        setProfiles(prev => prev.map(p =>
          p.username === username
            ? { ...p, analysis: d.analysis, lastUpdated: new Date().toISOString() }
            : p
        ))
      }
    } catch {} finally { setAnalyzing(null) }
  }

  const filtered = profiles.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.username.toLowerCase().includes(q) || (p.display_name || '').toLowerCase().includes(q)
  })

  const profile = profiles.find(p => p.username === selected)
  const a = profile?.analysis || {}
  const hasAnalysis = !!a.summary
  const isAnalyzing = analyzing === selected

  const analyzedCount = profiles.filter(p => !!p.analysis?.summary).length

  if (loading) return <div className="text-muted text-center py-20">Loading profiles...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">AI Profiles</h1>
          <p className="text-muted text-sm mt-0.5">
            Grok-powered member intelligence — {analyzedCount}/{profiles.length} analyzed
          </p>
        </div>
        <button onClick={load} disabled={loading} className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50 transition">
          <i className="fa-solid fa-refresh" />
          Refresh
        </button>
      </div>

      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        {/* Left: user list */}
        <div className="bg-surface-2 border border-white/10 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-white/10">
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-muted text-sm">No users found</div>
            ) : (
              filtered.map(p => {
                const analyzed = !!p.analysis?.summary
                return (
                  <button
                    key={p.username}
                    onClick={() => setSelected(p.username)}
                    className={`w-full text-left px-3 py-2.5 border-b border-white/5 flex items-center gap-2.5 transition ${
                      selected === p.username ? 'bg-accent/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${analyzed ? 'bg-green-400' : 'border border-white/20'}`} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${selected === p.username ? 'text-accent' : 'text-white'}`}>
                        @{p.username}
                      </div>
                      {p.display_name && p.display_name !== p.username && (
                        <div className="text-xs text-muted truncate">{p.display_name}</div>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
          {selected && profile ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-accent to-blue-500 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  {profile.username[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-lg font-semibold text-white truncate">@{profile.username}</div>
                  {profile.display_name && profile.display_name !== profile.username && (
                    <div className="text-xs text-muted truncate">{profile.display_name}</div>
                  )}
                  {hasAnalysis && (
                    <div className="text-[10px] text-muted flex items-center gap-2 mt-0.5">
                      <span className={`${a.dataQuality === 'rich' ? 'text-green-400' : a.dataQuality === 'moderate' ? 'text-yellow-400' : 'text-muted'}`}>
                        {a.dataQuality || 'sparse'} data
                      </span>
                      <span>·</span>
                      <span>{profile.lastUpdated ? new Date(profile.lastUpdated).toLocaleDateString() : '—'}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => analyze(profile.username)}
                  disabled={isAnalyzing}
                  className="px-3 py-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg text-xs text-accent flex items-center gap-1.5 disabled:opacity-50 flex-shrink-0 transition"
                >
                  {isAnalyzing ? (
                    <><i className="fa-solid fa-spinner fa-spin" /> Analyzing...</>
                  ) : (
                    <><i className="fa-solid fa-brain" /> {hasAnalysis ? 'Re-analyze' : 'Analyze'}</>
                  )}
                </button>
              </div>

              {isAnalyzing && (
                <div className="text-center py-8 text-muted">
                  <i className="fa-solid fa-spinner fa-spin text-xl mb-2" />
                  <div className="text-xs">Grok is analyzing this profile...</div>
                </div>
              )}

              {!isAnalyzing && !hasAnalysis && (
                <div className="text-center py-8 text-muted">
                  <i className="fa-solid fa-user-magnifying-glass text-2xl mb-2" />
                  <div className="text-sm">Not yet analyzed</div>
                  <div className="text-xs mt-1">Click "Analyze" to run Grok profile analysis</div>
                </div>
              )}

              {!isAnalyzing && hasAnalysis && (
                <div className="space-y-4">
                  {/* Summary */}
                  {a.summary && (
                    <div className="text-sm text-white/70 leading-relaxed bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-white/5">
                      {a.summary}
                    </div>
                  )}

                  {/* Company Intel */}
                  {a.companyIntel?.description && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Company Intel</div>
                      <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-white/5 space-y-1">
                        <div className="text-sm text-white font-medium">{a.companyIntel.name}</div>
                        <div className="text-xs text-white/60 leading-relaxed">{a.companyIntel.description}</div>
                        <div className="flex gap-2 mt-1">
                          {a.companyIntel.sector && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300/80 border border-purple-500/20">{a.companyIntel.sector}</span>}
                          {a.companyIntel.stage && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300/80 border border-amber-500/20">{a.companyIntel.stage}</span>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Role Context */}
                  {a.roleContext?.title && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Role Context</div>
                      <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-white">{a.roleContext.title}</span>
                          {a.roleContext.seniority && <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300/80 border border-teal-500/20">{a.roleContext.seniority}</span>}
                          {a.roleContext.function && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-muted border border-white/10">{a.roleContext.function}</span>}
                        </div>
                        {a.roleContext.implication && <div className="text-xs text-white/50 leading-relaxed">{a.roleContext.implication}</div>}
                      </div>
                    </div>
                  )}

                  {/* Networking Value */}
                  {a.networkingValue && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Networking Value</div>
                      <div className="text-xs text-white/60 leading-relaxed bg-accent/5 rounded-lg px-3.5 py-2.5 border border-accent/15">
                        <i className="fa-solid fa-handshake text-accent/50 mr-1.5" />{a.networkingValue}
                      </div>
                    </div>
                  )}

                  {/* Interests */}
                  {a.interests && Object.keys(a.interests).length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Interests</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(a.interests)
                          .sort((x, y) => (y[1] as number) - (x[1] as number))
                          .map(([topic, score]) => (
                            <span key={topic} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
                              <span className="text-white">{topic}</span>
                              <span className="text-accent font-mono text-[10px]">{Math.round((score as number) * 100)}%</span>
                            </span>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Traits */}
                  {a.traits && a.traits.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Traits</div>
                      <div className="flex flex-wrap gap-1.5">
                        {a.traits.map((trait, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300/80 border border-blue-500/20">
                            {trait}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Observations */}
                  {a.observations && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Observations</div>
                      <div className="text-xs text-muted leading-relaxed">{a.observations}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted text-sm">
              Select a user to view their AI profile
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
