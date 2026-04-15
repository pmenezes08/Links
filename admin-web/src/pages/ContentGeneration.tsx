import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, apiJson, apiPost } from '../utils/api'

const SECTION = 'rounded-xl border border-accent/25 bg-black p-5 shadow-[inset_0_0_0_1px_rgba(77,182,172,0.06)]'

function CollapsibleSection({
  title,
  defaultOpen = true,
  right,
  children,
}: {
  title: string
  defaultOpen?: boolean
  right?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={SECTION}>
      <div className="flex items-start justify-between gap-2 mb-0">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left min-w-0"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <i
            className={`fa-solid shrink-0 w-5 text-center text-[10px] text-muted ${open ? 'fa-chevron-down' : 'fa-chevron-right'}`}
            aria-hidden
          />
          <span className="font-medium">{title}</span>
        </button>
        {right}
      </div>
      {open ? <div className="mt-3">{children}</div> : null}
    </section>
  )
}

type IdeaField = {
  name: string
  label: string
  kind?: string
  required: boolean
  help_text?: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

type IdeaDescriptor = {
  idea_id: string
  title: string
  description: string
  target_type: 'community' | 'member'
  delivery_channel: 'feed_post' | 'dm'
  payload_fields: IdeaField[]
}

type Job = {
  id: number
  idea_id: string
  title: string
  target_type: 'community' | 'member'
  community_id?: number | null
  target_username?: string | null
  status: string
  payload?: Record<string, string>
  schedule?: Record<string, string>
  last_run_at?: string | null
}

type Run = {
  id: number
  idea_id: string
  status: string
  community_id?: number | null
  target_username?: string | null
  finished_at?: string | null
  source_links?: string[]
  error?: string | null
}

type Community = {
  id: number
  name: string
}

type ScheduleState = {
  cadence: 'weekly' | 'monthly'
  weekday: string
  week_of_month: string
  time_of_day: string
  timezone: string
}

const weekdayOptions = [
  { value: 'MO', label: 'Monday' },
  { value: 'TU', label: 'Tuesday' },
  { value: 'WE', label: 'Wednesday' },
  { value: 'TH', label: 'Thursday' },
  { value: 'FR', label: 'Friday' },
  { value: 'SA', label: 'Saturday' },
  { value: 'SU', label: 'Sunday' },
]

const weekOfMonthOptions = [
  { value: '1', label: 'First' },
  { value: '2', label: 'Second' },
  { value: '3', label: 'Third' },
  { value: '4', label: 'Fourth' },
]

function defaultSchedule(): ScheduleState {
  return {
    cadence: 'weekly',
    weekday: 'FR',
    week_of_month: '1',
    time_of_day: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }
}

function scheduleSummary(schedule?: Partial<ScheduleState>) {
  if (!schedule) return 'No schedule preferences saved.'
  const weekday = weekdayOptions.find(option => option.value === schedule.weekday)?.label || schedule.weekday || 'Friday'
  const time = schedule.time_of_day || '09:00'
  const timezone = schedule.timezone || 'UTC'
  if (schedule.cadence === 'monthly') {
    const week = weekOfMonthOptions.find(option => option.value === schedule.week_of_month)?.label || 'First'
    return `${week} ${weekday} at ${time} (${timezone})`
  }
  return `Every ${weekday} at ${time} (${timezone})`
}

function getTopicMode(payload: Record<string, string>) {
  return payload.topic_mode || 'manual'
}

function shouldShowField(field: IdeaField, payload: Record<string, string>) {
  const topicMode = getTopicMode(payload)
  if (field.name === 'topic') return topicMode !== 'auto'
  if (field.name === 'topic_seed') return topicMode === 'auto'
  return true
}

export default function ContentGeneration() {
  const [ideas, setIdeas] = useState<IdeaDescriptor[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningJobId, setRunningJobId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedIdeaId, setSelectedIdeaId] = useState('')
  const [selectedCommunityIds, setSelectedCommunityIds] = useState<string[]>([])
  const [targetUsername, setTargetUsername] = useState('')
  const [title, setTitle] = useState('')
  const [payload, setPayload] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState<ScheduleState>(defaultSchedule)
  const [jobFilter, setJobFilter] = useState<'all' | 'community' | 'member'>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const selectedIdea = useMemo(
    () => ideas.find(idea => idea.idea_id === selectedIdeaId) || null,
    [ideas, selectedIdeaId],
  )

  const filteredJobs = useMemo(() => {
    if (jobFilter === 'all') return jobs
    return jobs.filter(job => job.target_type === jobFilter)
  }, [jobFilter, jobs])

  async function loadData() {
    setLoading(true)
    try {
      const [ideasData, jobsData, runsData, communitiesData] = await Promise.all([
        apiJson<{ ideas?: IdeaDescriptor[] }>('/api/content-generation/ideas?surface=admin'),
        apiJson<{ jobs?: Job[] }>('/api/admin/content-generation/jobs'),
        apiJson<{ runs?: Run[] }>('/api/admin/content-generation/runs?limit=60'),
        apiJson<{ communities?: Community[] }>('/api/admin/communities_list'),
      ])
      setIdeas(ideasData.ideas ?? [])
      setJobs(jobsData.jobs ?? [])
      setRuns(runsData.runs ?? [])
      setCommunities(communitiesData.communities ?? [])
      if (!selectedIdeaId && ideasData.ideas?.length) {
        setSelectedIdeaId(ideasData.ideas[0].idea_id)
      }
    } catch {
      setFeedback({ type: 'error', text: 'Failed to load content generation data.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 5000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  function resetForm(nextIdeaId?: string) {
    setTitle('')
    setPayload({})
    setTargetUsername('')
    setSelectedCommunityIds([])
    setSchedule(defaultSchedule())
    if (nextIdeaId) setSelectedIdeaId(nextIdeaId)
  }

  async function submitJob(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedIdea) return
    setSaving(true)
    setFeedback(null)
    try {
      const body: Record<string, unknown> = {
        idea_id: selectedIdea.idea_id,
        title: title.trim() || undefined,
        payload,
        schedule,
        timezone: schedule.timezone,
      }
      if (selectedIdea.target_type === 'community') {
        body.community_ids = selectedCommunityIds.map(value => Number(value))
      } else {
        body.target_username = targetUsername.trim()
      }
      const json = await apiPost('/api/admin/content-generation/jobs', body)
      if (!json?.success) throw new Error(json?.error || 'Failed to create jobs')
      const createdCount = Array.isArray(json.jobs) ? json.jobs.length : 0
      setFeedback({ type: 'success', text: createdCount > 1 ? `${createdCount} jobs created.` : 'Job created.' })
      resetForm(selectedIdea.idea_id)
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to create jobs.' })
    } finally {
      setSaving(false)
    }
  }

  async function runJob(jobId: number) {
    setRunningJobId(jobId)
    try {
      const json = await apiPost(`/api/admin/content-generation/jobs/${jobId}/run`, {})
      if (!json?.success) throw new Error(json?.error || 'Failed to run job')
      setFeedback({ type: 'success', text: 'Job executed.' })
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to run job.' })
    } finally {
      setRunningJobId(null)
    }
  }

  async function toggleJobStatus(job: Job) {
    const nextStatus = job.status === 'active' ? 'paused' : 'active'
    try {
      const resp = await api(`/api/content-generation/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const json = await resp.json().catch(() => null)
      if (!json?.success) throw new Error(json?.error || 'Failed to update job')
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update job.' })
    }
  }

  async function deleteJob(jobId: number) {
    if (!window.confirm('Delete this job? This cannot be undone.')) return
    setDeletingId(`job-${jobId}`)
    try {
      const resp = await api(`/api/admin/content-generation/jobs/${jobId}`, { method: 'DELETE' })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) throw new Error(json?.error || 'Failed to delete job')
      setFeedback({ type: 'success', text: 'Job deleted.' })
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete job.' })
    } finally {
      setDeletingId(null)
    }
  }

  async function deleteAllJobs() {
    if (!window.confirm('Delete ALL jobs platform-wide? This cannot be undone.')) return
    setDeletingId('jobs-all')
    try {
      const resp = await api('/api/admin/content-generation/jobs?all=1', { method: 'DELETE' })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) throw new Error(json?.error || 'Failed to delete jobs')
      setFeedback({ type: 'success', text: 'All jobs removed.' })
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete jobs.' })
    } finally {
      setDeletingId(null)
    }
  }

  async function deleteRun(runId: number) {
    if (!window.confirm('Remove this run from history?')) return
    setDeletingId(`run-${runId}`)
    try {
      const resp = await api(`/api/admin/content-generation/runs/${runId}`, { method: 'DELETE' })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) throw new Error(json?.error || 'Failed to delete run')
      setFeedback({ type: 'success', text: 'Run removed.' })
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete run.' })
    } finally {
      setDeletingId(null)
    }
  }

  async function deleteAllRuns() {
    if (!window.confirm('Delete ALL run history platform-wide? This cannot be undone.')) return
    setDeletingId('runs-all')
    try {
      const resp = await api('/api/admin/content-generation/runs?all=1', { method: 'DELETE' })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) throw new Error(json?.error || 'Failed to delete runs')
      setFeedback({ type: 'success', text: `Removed ${json.removed ?? 0} run(s).` })
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete runs.' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Content Generation</h1>
        <p className="text-sm text-white/60 mt-1">Manage Steve’s modular content jobs across communities and members.</p>
      </div>

      {feedback && (
        <div className={`p-3 rounded-lg text-sm border ${feedback.type === 'success' ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {feedback.text}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-5">
          <CollapsibleSection
            title="Create jobs"
            right={
              <p className="text-xs text-white/50 max-w-[200px] text-right hidden sm:block">
                Bulk create; fixed or auto topic.
              </p>
            }
          >
            <p className="text-xs text-white/50 mb-4">Bulk community creation fans out into separate single-community jobs. Choose a fixed topic or let Steve select a timely one automatically.</p>
            {loading ? (
              <div className="text-sm text-white/60">Loading...</div>
            ) : (
              <form onSubmit={submitJob} className="space-y-3">
                <div>
                  <label className="text-sm text-muted block mb-1.5">Idea</label>
                  <select
                    value={selectedIdeaId}
                    onChange={e => {
                      setSelectedIdeaId(e.target.value)
                      setPayload({})
                      setSelectedCommunityIds([])
                      setTargetUsername('')
                    }}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                  >
                    {ideas.map(idea => (
                      <option key={idea.idea_id} value={idea.idea_id}>{idea.title}</option>
                    ))}
                  </select>
                  {selectedIdea && <p className="text-xs text-white/50 mt-1">{selectedIdea.description}</p>}
                </div>

                <div>
                  <label className="text-sm text-muted block mb-1.5">Job title <span className="text-white/40">(optional)</span></label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                    placeholder="Internal label"
                  />
                </div>

                {selectedIdea?.target_type === 'community' ? (
                  <div>
                    <label className="text-sm text-muted block mb-1.5">Communities</label>
                    <select
                      multiple
                      value={selectedCommunityIds}
                      onChange={e => {
                        const values = Array.from(e.target.selectedOptions).map(option => option.value)
                        setSelectedCommunityIds(values)
                      }}
                      className="w-full min-h-[140px] bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                    >
                      {communities.map(community => (
                        <option key={community.id} value={String(community.id)}>
                          {community.name} (ID: {community.id})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-white/50 mt-1">Tip: hold Ctrl/Cmd to multi-select. Each community will get its own independent job.</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-sm text-muted block mb-1.5">Target member</label>
                    <input
                      type="text"
                      value={targetUsername}
                      onChange={e => setTargetUsername(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                      placeholder="username"
                    />
                  </div>
                )}

                {selectedIdea?.payload_fields.filter(field => field.name !== 'target_username').map(field => (
                  shouldShowField(field, payload) ? (
                    <div key={field.name}>
                      <label className="text-sm text-muted block mb-1.5">
                        {field.label}
                        {field.required ? ' *' : ''}
                      </label>
                      {field.kind === 'select' ? (
                        <select
                          value={(field.name === 'topic_mode' ? getTopicMode(payload) : payload[field.name]) || ''}
                          onChange={e => {
                            const nextValue = e.target.value
                            setPayload(prev => {
                              if (field.name !== 'topic_mode') {
                                return { ...prev, [field.name]: nextValue }
                              }
                              return {
                                ...prev,
                                topic_mode: nextValue,
                                topic: nextValue === 'auto' ? '' : prev.topic || '',
                                topic_seed: nextValue === 'auto' ? prev.topic_seed || '' : '',
                              }
                            })
                          }}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                        >
                          {(field.options || []).map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={payload[field.name] || ''}
                          onChange={e => setPayload(prev => ({ ...prev, [field.name]: e.target.value }))}
                          required={field.required}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                          placeholder={field.placeholder || ''}
                        />
                      )}
                      {field.help_text && <p className="text-xs text-white/50 mt-1">{field.help_text}</p>}
                      {field.name === 'topic_mode' && getTopicMode(payload) === 'auto' && (
                        <p className="text-xs text-white/50 mt-1">
                          Steve will choose a timely topic automatically each time the job runs.
                        </p>
                      )}
                    </div>
                  ) : null
                ))}

                <div className="rounded-xl border border-white/10 p-4 space-y-3">
                  <div className="font-medium text-sm">Schedule preferences</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-sm text-muted block mb-1.5">Frequency</label>
                      <select
                        value={schedule.cadence}
                        onChange={e => setSchedule(prev => ({ ...prev, cadence: e.target.value as ScheduleState['cadence'] }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm text-muted block mb-1.5">Weekday</label>
                      <select
                        value={schedule.weekday}
                        onChange={e => setSchedule(prev => ({ ...prev, weekday: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                      >
                        {weekdayOptions.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    {schedule.cadence === 'monthly' && (
                      <div>
                        <label className="text-sm text-muted block mb-1.5">Week of month</label>
                        <select
                          value={schedule.week_of_month}
                          onChange={e => setSchedule(prev => ({ ...prev, week_of_month: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                        >
                          {weekOfMonthOptions.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="text-sm text-muted block mb-1.5">Time</label>
                      <input
                        type="time"
                        value={schedule.time_of_day}
                        onChange={e => setSchedule(prev => ({ ...prev, time_of_day: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm text-muted block mb-1.5">Timezone</label>
                      <input
                        type="text"
                        value={schedule.timezone}
                        onChange={e => setSchedule(prev => ({ ...prev, timezone: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-white/50">Saved summary: {scheduleSummary(schedule)}</p>
                </div>

                <button type="submit" disabled={saving || loading} className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition text-sm">
                  {saving ? 'Saving...' : 'Create job'}
                </button>
              </form>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Ideas library"
            right={<div className="text-xs text-white/50">{ideas.length} ideas</div>}
          >
            <div className="space-y-3">
              {ideas.map(idea => (
                <div key={idea.idea_id} className="rounded-lg border border-white/10 p-3 bg-black/30">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-sm">{idea.title}</div>
                    <span className="text-[11px] uppercase tracking-wide text-white/50">{idea.delivery_channel}</span>
                  </div>
                  <p className="text-xs text-white/60 mt-1">{idea.description}</p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>

        <div className="space-y-5">
          <CollapsibleSection
            title="Jobs"
            right={
              <div className="flex items-center gap-2 shrink-0">
                {filteredJobs.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-50"
                    disabled={deletingId !== null}
                    onClick={e => {
                      e.stopPropagation()
                      void deleteAllJobs()
                    }}
                  >
                    Delete all
                  </button>
                )}
                <select
                  value={jobFilter}
                  onClick={e => e.stopPropagation()}
                  onChange={e => setJobFilter(e.target.value as typeof jobFilter)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:border-accent focus:outline-none"
                >
                  <option value="all">All targets</option>
                  <option value="community">Community</option>
                  <option value="member">Member</option>
                </select>
              </div>
            }
          >
            <div className="space-y-3">
              {filteredJobs.length === 0 ? (
                <div className="text-sm text-white/60">No jobs yet.</div>
              ) : filteredJobs.map(job => (
                <div key={job.id} className="rounded-lg border border-white/10 p-3 bg-black/30">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">{job.title || job.idea_id}</div>
                      <div className="text-xs text-white/50 mt-1">
                        {job.target_type === 'community' ? `Community ${job.community_id}` : `@${job.target_username}`}
                      </div>
                      <div className="text-xs text-white/50 mt-1">{scheduleSummary(job.schedule as Partial<ScheduleState>)}</div>
                      {job.last_run_at && <div className="text-[11px] text-white/40 mt-1">Last run: {job.last_run_at}</div>}
                    </div>
                    <span className={`text-[11px] px-2 py-1 rounded-full ${job.status === 'active' ? 'bg-accent/15 text-accent' : 'bg-white/10 text-white/60'}`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={runningJobId === job.id}
                      onClick={() => runJob(job.id)}
                      className="px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold disabled:opacity-50"
                    >
                      {runningJobId === job.id ? 'Running...' : 'Run now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleJobStatus(job)}
                      className="px-3 py-1.5 rounded-lg border border-white/10 text-xs hover:bg-white/5"
                    >
                      {job.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      disabled={deletingId !== null}
                      onClick={() => deleteJob(job.id)}
                      className="px-3 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {deletingId === `job-${job.id}` ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Recent runs"
            right={
              runs.length > 0 ? (
                <button
                  type="button"
                  className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-50 shrink-0"
                  disabled={deletingId !== null}
                  onClick={e => {
                    e.stopPropagation()
                    void deleteAllRuns()
                  }}
                >
                  Delete all
                </button>
              ) : null
            }
          >
            <div className="space-y-3">
              {runs.length === 0 ? (
                <div className="text-sm text-white/60">No runs yet.</div>
              ) : runs.map(run => (
                <div key={run.id} className="rounded-lg border border-white/10 p-3 bg-black/30">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-sm">{run.idea_id}</div>
                    <span className={`text-[11px] px-2 py-1 rounded-full ${run.status === 'succeeded' ? 'bg-accent/15 text-accent' : run.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-white/60'}`}>
                      {run.status}
                    </span>
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    {run.community_id ? `Community ${run.community_id}` : run.target_username ? `@${run.target_username}` : 'Direct target'}
                  </div>
                  <div className="text-[11px] text-white/40 mt-1">{run.finished_at || 'In progress'}</div>
                  {Array.isArray(run.source_links) && run.source_links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {run.source_links.slice(0, 3).map(link => (
                        <a key={link} href={link} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">Source</a>
                      ))}
                    </div>
                  )}
                  {run.error && <div className="text-[11px] text-red-300 mt-2">{run.error}</div>}
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={deletingId !== null}
                      onClick={() => deleteRun(run.id)}
                      className="text-[11px] text-red-300/90 hover:text-red-200 disabled:opacity-50"
                    >
                      {deletingId === `run-${run.id}` ? '…' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  )
}

