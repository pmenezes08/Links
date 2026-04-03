import { useEffect, useState, useCallback, useRef } from 'react'
import { apiJson, api } from '../utils/api'

interface Analysis {
  _schemaVersion?: number
  summary?: string
  analysisDepth?: string
  dataQuality?: string
  identity?: { roles?: string[]; drivingForces?: string; bridgeInsight?: string } | null
  professional?: {
    company?: { name?: string; description?: string; sector?: string; stage?: string } | null
    role?: { title?: string; seniority?: string; function?: string; implication?: string } | null
    education?: string | null
    location?: { city?: string; country?: string; context?: string } | null
    webFindings?: string
    publications?: { source?: string; date?: string; insight?: string }[]
  } | null
  personal?: {
    socialProfiles?: { platform?: string; url?: string; handle?: string }[]
    interests?: string[]
    lifestyle?: string
    webFindings?: string
    publicPosts?: { source?: string; date?: string; insight?: string }[]
  } | null
  interests?: Record<string, { score: number; source?: string; type?: string }>
  traits?: string[]
  observations?: string
  networkingValue?: string | null
  conversationStarters?: string[]
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

  // Batch analysis state
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentUser: '' })
  const batchAbortRef = useRef(false)

  // Auto-poll: refresh list every 15s while any analysis is in flight
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const d = await apiJson('/api/admin/steve_profiles')
      if (d?.success) setProfiles(d.profiles || [])
    } catch {} finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Start/stop auto-poll when analyzing or batch is running
  useEffect(() => {
    if (analyzing || batchRunning) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => load(true), 15000)
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [analyzing, batchRunning, load])

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

  const analyzeAll = async () => {
    const unanalyzed = profiles.filter(p => !p.analysis?.summary)
    if (unanalyzed.length === 0) return
    batchAbortRef.current = false
    setBatchRunning(true)
    setBatchProgress({ current: 0, total: unanalyzed.length, currentUser: '' })

    for (let i = 0; i < unanalyzed.length; i++) {
      if (batchAbortRef.current) break
      const u = unanalyzed[i]
      setBatchProgress({ current: i + 1, total: unanalyzed.length, currentUser: u.username })
      try {
        const res = await api(`/api/admin/steve_profiles/${encodeURIComponent(u.username)}/analyze`, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
        })
        const d = await res.json()
        if (d?.success && d.analysis) {
          setProfiles(prev => prev.map(p =>
            p.username === u.username
              ? { ...p, analysis: d.analysis, lastUpdated: new Date().toISOString() }
              : p
          ))
        }
      } catch {}
    }
    setBatchRunning(false)
    setBatchProgress({ current: 0, total: 0, currentUser: '' })
  }

  const stopBatch = () => { batchAbortRef.current = true }

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
  const unanalyzedCount = profiles.length - analyzedCount

  if (loading) return <div className="text-muted text-center py-20">Loading profiles...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">AI Profiles</h1>
          <p className="text-muted text-sm mt-0.5">
            Steve's member intelligence — {analyzedCount}/{profiles.length} analyzed
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!batchRunning && unanalyzedCount > 0 && (
            <button
              onClick={analyzeAll}
              className="px-4 py-2 bg-accent/10 border border-accent/30 hover:bg-accent/20 rounded-lg text-sm flex items-center gap-2 text-accent transition"
            >
              <i className="fa-solid fa-bolt" />
              Analyze All ({unanalyzedCount})
            </button>
          )}
          <button onClick={() => load()} disabled={loading} className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50 transition">
            <i className="fa-solid fa-refresh" />
            Refresh
          </button>
        </div>
      </div>

      {/* Batch progress bar */}
      {batchRunning && (
        <div className="bg-surface-2 border border-accent/20 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-white flex items-center gap-2">
              <i className="fa-solid fa-spinner fa-spin text-accent" />
              Analyzing {batchProgress.current}/{batchProgress.total}
              {batchProgress.currentUser && <span className="text-muted">— @{batchProgress.currentUser}</span>}
            </div>
            <button onClick={stopBatch} className="px-3 py-1 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 hover:bg-red-500/20 transition">
              Stop
            </button>
          </div>
          <div className="w-full bg-white/5 rounded-full h-1.5">
            <div
              className="bg-accent h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

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
                const isBatchTarget = batchRunning && batchProgress.currentUser === p.username
                return (
                  <button
                    key={p.username}
                    onClick={() => setSelected(p.username)}
                    className={`w-full text-left px-3 py-2.5 border-b border-white/5 flex items-center gap-2.5 transition ${
                      selected === p.username ? 'bg-accent/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isBatchTarget ? 'bg-accent animate-pulse' : analyzed ? 'bg-green-400' : 'border border-white/20'
                    }`} />
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
                  disabled={isAnalyzing || batchRunning}
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
                  <div className="text-xs">Steve is analyzing this profile...</div>
                </div>
              )}

              {!isAnalyzing && !hasAnalysis && (
                <div className="text-center py-8 text-muted">
                  <i className="fa-solid fa-user-magnifying-glass text-2xl mb-2" />
                  <div className="text-sm">Not yet analyzed</div>
                  <div className="text-xs mt-1">Click "Analyze" to run Steve's profile analysis</div>
                </div>
              )}

              {!isAnalyzing && hasAnalysis && (
                <div className="space-y-4">
                  {a.summary && (
                    <div className="text-sm text-white/70 leading-relaxed bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-white/5">
                      {a.summary}
                    </div>
                  )}

                  {a.identity && (a.identity.bridgeInsight || a.identity.roles?.length) && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2"><i className="fa-solid fa-fingerprint mr-1" /> Identity</div>
                      <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-white/5 space-y-2">
                        {a.identity.roles && a.identity.roles.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {a.identity.roles.map((r, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">{r}</span>
                            ))}
                          </div>
                        )}
                        {a.identity.bridgeInsight && <div className="text-xs text-accent/80 italic">{a.identity.bridgeInsight}</div>}
                      </div>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2"><i className="fa-solid fa-briefcase mr-1" /> Professional</div>
                      {a.professional ? (
                        <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-white/5 space-y-1.5">
                          {a.professional.company?.description && (
                            <div>
                              <div className="text-sm text-white font-medium">{a.professional.company.name}</div>
                              <div className="text-xs text-white/60">{a.professional.company.description}</div>
                            </div>
                          )}
                          {a.professional.role?.title && (
                            <div className="text-xs text-white/60">{a.professional.role.title}{a.professional.role.implication ? ` — ${a.professional.role.implication}` : ''}</div>
                          )}
                          {a.professional.education && <div className="text-xs text-white/50"><i className="fa-solid fa-graduation-cap mr-1" />{a.professional.education}</div>}
                          {a.professional.webFindings && <div className="text-xs text-white/45 italic">{a.professional.webFindings}</div>}
                        </div>
                      ) : <div className="text-xs text-muted text-center py-3 border border-dashed border-white/10 rounded-lg">No data</div>}
                    </div>
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2"><i className="fa-solid fa-user mr-1" /> Personal</div>
                      {a.personal ? (
                        <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-white/5 space-y-1.5">
                          {a.personal.lifestyle && <div className="text-xs text-white/60">{a.personal.lifestyle}</div>}
                          {a.personal.interests && a.personal.interests.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {a.personal.interests.map((item, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-300/80 border border-pink-500/20">{item}</span>
                              ))}
                            </div>
                          )}
                          {a.personal.webFindings && <div className="text-xs text-white/45 italic">{a.personal.webFindings}</div>}
                        </div>
                      ) : <div className="text-xs text-muted text-center py-3 border border-dashed border-white/10 rounded-lg">Run Deep analysis</div>}
                    </div>
                  </div>

                  {a.networkingValue && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Networking Value</div>
                      <div className="text-xs text-white/60 leading-relaxed bg-accent/5 rounded-lg px-3.5 py-2.5 border border-accent/15">
                        <i className="fa-solid fa-handshake text-accent/50 mr-1.5" />{a.networkingValue}
                      </div>
                    </div>
                  )}

                  {a.interests && Object.keys(a.interests).length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Interests</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(a.interests)
                          .sort(([, x], [, y]) => (y?.score ?? 0) - (x?.score ?? 0))
                          .map(([topic, meta]) => (
                            <span key={topic} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
                              <span className="text-white">{topic}</span>
                              <span className="text-accent font-mono text-[10px]">{Math.round((meta?.score ?? 0) * 100)}%</span>
                            </span>
                          ))}
                      </div>
                    </div>
                  )}

                  {a.traits && a.traits.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">Traits</div>
                      <div className="flex flex-wrap gap-1.5">
                        {a.traits.map((trait, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300/80 border border-blue-500/20">{trait}</span>
                        ))}
                      </div>
                    </div>
                  )}

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
