import { useEffect, useMemo, useState } from 'react'

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
  status: string
  payload?: Record<string, string>
  schedule?: Record<string, string>
  timezone?: string | null
  last_run_at?: string | null
}

type Run = {
  id: number
  idea_id: string
  status: string
  started_at?: string | null
  finished_at?: string | null
  output_post_id?: number | null
  output_message_id?: number | null
  source_links?: string[]
  error?: string | null
}

type Member = {
  username: string
}

type Props = {
  communityId: string
  open: boolean
  onClose: () => void
}

type ScheduleState = {
  cadence: 'weekly' | 'monthly'
  weekday: string
  week_of_month: string
  time_of_day: string
  timezone: string
}

const WEEKDAY_OPTIONS = [
  { value: 'MO', label: 'Monday' },
  { value: 'TU', label: 'Tuesday' },
  { value: 'WE', label: 'Wednesday' },
  { value: 'TH', label: 'Thursday' },
  { value: 'FR', label: 'Friday' },
  { value: 'SA', label: 'Saturday' },
  { value: 'SU', label: 'Sunday' },
]

const WEEK_OF_MONTH_OPTIONS = [
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

function scheduleSummary(schedule: Partial<ScheduleState> | undefined) {
  if (!schedule) return 'No schedule preferences saved yet.'
  const dayLabel = WEEKDAY_OPTIONS.find(option => option.value === schedule.weekday)?.label || schedule.weekday || 'Friday'
  const timeOfDay = schedule.time_of_day || '09:00'
  const timezone = schedule.timezone || 'UTC'
  if (schedule.cadence === 'monthly') {
    const weekLabel = WEEK_OF_MONTH_OPTIONS.find(option => option.value === schedule.week_of_month)?.label || 'First'
    return `${weekLabel} ${dayLabel} of each month at ${timeOfDay} (${timezone})`
  }
  return `Every ${dayLabel} at ${timeOfDay} (${timezone})`
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

export default function ContentGenerationModal({ communityId, open, onClose }: Props) {
  const [ideas, setIdeas] = useState<IdeaDescriptor[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runningJobId, setRunningJobId] = useState<number | null>(null)
  const [selectedIdeaId, setSelectedIdeaId] = useState('')
  const [title, setTitle] = useState('')
  const [payload, setPayload] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState<ScheduleState>(defaultSchedule)
  const [editingJobId, setEditingJobId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const selectedIdea = useMemo(
    () => ideas.find(idea => idea.idea_id === selectedIdeaId) || null,
    [ideas, selectedIdeaId],
  )

  async function loadData() {
    if (!communityId) return
    setLoading(true)
    try {
      const [ideasResp, jobsResp, membersResp] = await Promise.all([
        fetch('/api/content-generation/ideas?surface=community', { credentials: 'include' }),
        fetch(`/api/content-generation/jobs?community_id=${communityId}`, { credentials: 'include' }),
        fetch('/get_community_members', {
          method: 'POST',
          credentials: 'include',
          body: new URLSearchParams({ community_id: String(communityId) }),
        }),
      ])
      const ideasJson = await ideasResp.json().catch(() => null)
      const jobsJson = await jobsResp.json().catch(() => null)
      const membersJson = await membersResp.json().catch(() => null)
      const nextIdeas = Array.isArray(ideasJson?.ideas) ? ideasJson.ideas : []
      setIdeas(nextIdeas)
      setJobs(Array.isArray(jobsJson?.jobs) ? jobsJson.jobs : [])
      setRuns(Array.isArray(jobsJson?.runs) ? jobsJson.runs : [])
      setMembers(Array.isArray(membersJson?.members) ? membersJson.members : [])
      if (!selectedIdeaId && nextIdeas.length > 0) {
        setSelectedIdeaId(nextIdeas[0].idea_id)
      }
    } catch {
      setFeedback({ type: 'error', text: 'Failed to load content generation options.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void loadData()
  }, [open, communityId])

  useEffect(() => {
    if (!selectedIdea && ideas.length > 0) {
      setSelectedIdeaId(ideas[0].idea_id)
    }
  }, [ideas, selectedIdea])

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 5000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  function resetForm(nextIdeaId?: string) {
    setEditingJobId(null)
    setTitle('')
    setPayload({})
    setSchedule(defaultSchedule())
    if (nextIdeaId) setSelectedIdeaId(nextIdeaId)
  }

  function startEdit(job: Job) {
    setEditingJobId(job.id)
    setSelectedIdeaId(job.idea_id)
    setTitle(job.title || '')
    setPayload(Object.fromEntries(Object.entries(job.payload || {}).map(([key, value]) => [key, String(value ?? '')])))
    setSchedule({
      ...defaultSchedule(),
      ...(job.schedule || {}),
      timezone: job.timezone || job.schedule?.timezone || defaultSchedule().timezone,
    })
  }

  async function submitJob(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedIdea) return
    setSaving(true)
    setFeedback(null)
    try {
      const body = {
        idea_id: selectedIdea.idea_id,
        community_id: Number(communityId),
        title: title.trim() || undefined,
        payload,
        schedule,
        timezone: schedule.timezone,
      }
      const url = editingJobId ? `/api/content-generation/jobs/${editingJobId}` : '/api/content-generation/jobs'
      const method = editingJobId ? 'PATCH' : 'POST'
      const resp = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await resp.json().catch(() => null)
      if (!json?.success) {
        throw new Error(json?.error || 'Failed to save job')
      }
      setFeedback({ type: 'success', text: editingJobId ? 'Job updated.' : 'Job created.' })
      resetForm(selectedIdea.idea_id)
      await loadData()
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save job.' })
    } finally {
      setSaving(false)
    }
  }

  async function runJob(jobId: number) {
    setRunningJobId(jobId)
    try {
      const resp = await fetch(`/api/content-generation/jobs/${jobId}/run`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await resp.json().catch(() => null)
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
      const resp = await fetch(`/api/content-generation/jobs/${job.id}`, {
        method: 'PATCH',
        credentials: 'include',
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[160] bg-black/80 backdrop-blur-sm flex items-center justify-center px-3" onClick={(e) => e.currentTarget === e.target && onClose()}>
      <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-black text-white p-4 sm:p-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Content Generation</h2>
            <p className="text-sm text-[#9fb0b5]">Create and run Steve jobs for this community.</p>
          </div>
          <button className="px-3 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5" onClick={onClose}>
            Close
          </button>
        </div>

        {feedback && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'border-[#4db6ac]/40 bg-[#4db6ac]/10 text-[#9bf3ea]' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
            {feedback.text}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium">{editingJobId ? 'Edit job' : 'Create job'}</div>
                <div className="text-xs text-[#9fb0b5]">Choose a fixed topic or let Steve pick a timely one automatically. Use Run Now for immediate delivery.</div>
              </div>
              {editingJobId && (
                <button className="text-xs text-[#4db6ac]" type="button" onClick={() => resetForm(selectedIdeaId)}>
                  Cancel edit
                </button>
              )}
            </div>

            {loading ? (
              <div className="text-sm text-[#9fb0b5]">Loading options...</div>
            ) : (
              <form className="space-y-3" onSubmit={submitJob}>
                <div>
                  <label className="block text-xs text-[#9fb0b5] mb-1">Idea</label>
                  <select
                    value={selectedIdeaId}
                    onChange={(e) => {
                      const nextIdeaId = e.target.value
                      setSelectedIdeaId(nextIdeaId)
                      setPayload({})
                    }}
                    className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  >
                    {ideas.map((idea) => (
                      <option key={idea.idea_id} value={idea.idea_id}>{idea.title}</option>
                    ))}
                  </select>
                  {selectedIdea && <p className="text-xs text-[#9fb0b5] mt-1">{selectedIdea.description}</p>}
                </div>

                <div>
                  <label className="block text-xs text-[#9fb0b5] mb-1">Job title <span className="text-white/40">(optional)</span></label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    placeholder="Give this job an internal label"
                  />
                </div>

                {selectedIdea?.payload_fields.map((field) => (
                  shouldShowField(field, payload) ? (
                    <div key={field.name}>
                      <label className="block text-xs text-[#9fb0b5] mb-1">
                        {field.label}
                        {field.required ? ' *' : ''}
                      </label>
                      {field.name === 'target_username' ? (
                        <select
                          value={payload[field.name] || ''}
                          onChange={(e) => setPayload((prev) => ({ ...prev, [field.name]: e.target.value }))}
                          className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                        >
                          <option value="">{field.required ? 'Select a member' : 'Steve chooses automatically'}</option>
                          {members.map((member) => (
                            <option key={member.username} value={member.username}>@{member.username}</option>
                          ))}
                        </select>
                      ) : field.kind === 'select' ? (
                        <select
                          value={(field.name === 'topic_mode' ? getTopicMode(payload) : payload[field.name]) || ''}
                          onChange={(e) => {
                            const nextValue = e.target.value
                            setPayload((prev) => {
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
                          className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                        >
                          {(field.options || []).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={payload[field.name] || ''}
                          onChange={(e) => setPayload((prev) => ({ ...prev, [field.name]: e.target.value }))}
                          required={field.required}
                          placeholder={field.placeholder || ''}
                          className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                        />
                      )}
                      {field.help_text && <p className="text-xs text-[#9fb0b5] mt-1">{field.help_text}</p>}
                      {field.name === 'topic_mode' && getTopicMode(payload) === 'auto' && (
                        <p className="text-xs text-[#9fb0b5] mt-1">
                          Steve will pick a timely topic automatically whenever this job runs.
                        </p>
                      )}
                    </div>
                  ) : null
                ))}

                <div className="rounded-xl border border-white/10 p-3 space-y-3">
                  <div className="text-sm font-medium">Schedule preferences</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Frequency</label>
                      <select
                        value={schedule.cadence}
                        onChange={(e) => setSchedule((prev) => ({ ...prev, cadence: e.target.value as ScheduleState['cadence'] }))}
                        className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Weekday</label>
                      <select
                        value={schedule.weekday}
                        onChange={(e) => setSchedule((prev) => ({ ...prev, weekday: e.target.value }))}
                        className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                      >
                        {WEEKDAY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    {schedule.cadence === 'monthly' && (
                      <div>
                        <label className="block text-xs text-[#9fb0b5] mb-1">Week of month</label>
                        <select
                          value={schedule.week_of_month}
                          onChange={(e) => setSchedule((prev) => ({ ...prev, week_of_month: e.target.value }))}
                          className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                        >
                          {WEEK_OF_MONTH_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Time</label>
                      <input
                        type="time"
                        value={schedule.time_of_day}
                        onChange={(e) => setSchedule((prev) => ({ ...prev, time_of_day: e.target.value }))}
                        className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-[#9fb0b5] mb-1">Timezone</label>
                      <input
                        value={schedule.timezone}
                        onChange={(e) => setSchedule((prev) => ({ ...prev, timezone: e.target.value }))}
                        className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-[#9fb0b5]">Saved summary: {scheduleSummary(schedule)}</p>
                </div>

                <button
                  type="submit"
                  disabled={saving || !selectedIdea}
                  className="w-full rounded-lg bg-[#4db6ac] text-black font-semibold py-2.5 disabled:opacity-50 hover:brightness-110"
                >
                  {saving ? 'Saving...' : editingJobId ? 'Update job' : 'Create job'}
                </button>
              </form>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <div className="font-medium mb-3">Saved jobs</div>
              <div className="space-y-3 max-h-[320px] overflow-y-auto">
                {jobs.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No jobs saved for this community yet.</div>
                ) : jobs.map((job) => (
                  <div key={job.id} className="rounded-xl border border-white/10 p-3 bg-black">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-sm">{job.title || job.idea_id}</div>
                        <div className="text-xs text-[#9fb0b5] mt-1">{scheduleSummary(job.schedule as Partial<ScheduleState>)}</div>
                        {job.last_run_at && <div className="text-[11px] text-white/40 mt-1">Last run: {job.last_run_at}</div>}
                      </div>
                      <span className={`text-[11px] px-2 py-1 rounded-full ${job.status === 'active' ? 'bg-[#4db6ac]/15 text-[#9bf3ea]' : 'bg-white/10 text-white/60'}`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-[#4db6ac] text-black text-xs font-semibold disabled:opacity-50"
                        disabled={runningJobId === job.id}
                        onClick={() => runJob(job.id)}
                      >
                        {runningJobId === job.id ? 'Running...' : 'Run now'}
                      </button>
                      <button type="button" className="px-3 py-1.5 rounded-lg border border-white/10 text-xs hover:bg-white/5" onClick={() => startEdit(job)}>
                        Edit
                      </button>
                      <button type="button" className="px-3 py-1.5 rounded-lg border border-white/10 text-xs hover:bg-white/5" onClick={() => toggleJobStatus(job)}>
                        {job.status === 'active' ? 'Pause' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-4">
              <div className="font-medium mb-3">Recent runs</div>
              <div className="space-y-3 max-h-[260px] overflow-y-auto">
                {runs.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No runs yet.</div>
                ) : runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-white/10 p-3 bg-black">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{run.idea_id}</div>
                      <span className={`text-[11px] px-2 py-1 rounded-full ${run.status === 'succeeded' ? 'bg-[#4db6ac]/15 text-[#9bf3ea]' : run.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-white/60'}`}>
                        {run.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#9fb0b5] mt-1">{run.finished_at || run.started_at || 'Pending'}</div>
                    {Array.isArray(run.source_links) && run.source_links.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {run.source_links.slice(0, 3).map((link) => (
                          <a key={link} href={link} target="_blank" rel="noreferrer" className="text-[11px] text-[#4db6ac] hover:underline">
                            Source
                          </a>
                        ))}
                      </div>
                    )}
                    {run.error && <div className="text-[11px] text-red-300 mt-2">{run.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

