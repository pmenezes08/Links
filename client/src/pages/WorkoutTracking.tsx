import { useEffect, useMemo, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  PointElement,
  LineElement
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, Tooltip, Legend, PointElement, LineElement)

type Exercise = {
  id: number
  name: string
  muscle_group: string
  sets_data?: Array<{ weight: number; reps: number; created_at?: string; date?: string }>
}

type Workout = {
  id: number
  name: string
  date?: string
  exercise_count?: number
}

type Community = { id: number; name: string; type?: string }

export default function WorkoutTracking(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Your Workouts') }, [setTitle])
  const parentId = useMemo(()=> {
    try{ return new URLSearchParams(window.location.search).get('parent_id') }catch{ return null }
  }, [])

  const [activeTab, setActiveTab] = useState<'performance' | 'exercise' | 'workouts' | 'leaderboard' | 'generator'>('performance')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [newWeight, setNewWeight] = useState('')
  const [newReps, setNewReps] = useState('')
  const [newDate, setNewDate] = useState<string>(() => new Date().toISOString().slice(0,10))

  // Data stores
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const [userExercises, setUserExercises] = useState<Exercise[]>([])

  // Selections
  const [selectedExerciseId, setSelectedExerciseId] = useState<number|''>('')
  const [timeRange, setTimeRange] = useState<'30'|'90'|'180'|'365'|'all'>('30')
  const [lbCommunityId, setLbCommunityId] = useState<number|''>('')
  const [lbExerciseId, setLbExerciseId] = useState<number|''>('')

  const [leaderboardRows, setLeaderboardRows] = useState<Array<{ username:string; max:number }>>([])
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [logsExerciseName, setLogsExerciseName] = useState<string>('')
  const [logsExerciseId, setLogsExerciseId] = useState<number|''>('')
  const [logsEntries, setLogsEntries] = useState<Array<{ date:string; weight:number; reps:number }>>([])
  const [newLogWeight, setNewLogWeight] = useState('')
  const [newLogSets, setNewLogSets] = useState('')
  const [newLogDate, setNewLogDate] = useState<string>(() => new Date().toISOString().slice(0,10))
  const [showCreateWorkoutModal, setShowCreateWorkoutModal] = useState(false)
  const [newWorkoutName, setNewWorkoutName] = useState('')
  const [newWorkoutDate, setNewWorkoutDate] = useState<string>(() => new Date().toISOString().slice(0,10))

  // Load base data on mount
  useEffect(() => {
    // Exercises with sets
    fetch('/get_workout_exercises', { credentials:'include' })
      .then(r=>r.json()).then(j=>{ if (j?.success && Array.isArray(j.exercises)) setExercises(j.exercises) }).catch(()=>{})
    // Workouts list
    fetch('/get_workouts', { credentials:'include' })
      .then(r=>r.json()).then(j=>{ if (j?.success && Array.isArray(j.workouts)) setWorkouts(j.workouts) }).catch(()=>{})
    // Communities for leaderboard
    fetch('/get_user_communities', { credentials:'include' })
      .then(r=>r.json()).then(j=>{ if (j?.success && Array.isArray(j.communities)) setCommunities(j.communities) }).catch(()=>{})
    // User exercises for leaderboard select
    fetch('/get_user_exercises', { credentials:'include' })
      .then(r=>r.json()).then(j=>{ if (j?.success && Array.isArray(j.exercises)) setUserExercises(j.exercises) }).catch(()=>{})
  }, [])

  // Default: start in helicopter view (groups only, collapsed) when entering Exercise tab
  useEffect(() => {
    if (activeTab === 'exercise') {
      setExpandedGroups({})
    }
  }, [activeTab])

  function openAddExercise(){
    setNewName('')
    setNewGroup('')
    setNewWeight('')
    setNewReps('')
    setNewDate(new Date().toISOString().slice(0,10))
    setShowAddModal(true)
  }

  async function submitNewExercise(){
    if (!newName || !newGroup || !newWeight || !newReps || !newDate){
      alert('Please fill in all fields')
      return
    }
    // Prevent future dates
    try{
      const d = new Date(newDate)
      const today = new Date()
      today.setHours(23,59,59,999)
      if (d > today){
        alert('Cannot log exercises for future dates.')
        return
      }
    }catch{}
    const fd = new URLSearchParams({
      name: newName,
      muscle_group: newGroup,
      weight: newWeight,
      reps: newReps,
      date: newDate,
    })
    const r = await fetch('/add_exercise', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      setShowAddModal(false)
      // reload exercises
      fetch('/get_workout_exercises', { credentials:'include' })
        .then(r=>r.json()).then(j=>{ if (j?.success && Array.isArray(j.exercises)) setExercises(j.exercises) }).catch(()=>{})
    } else {
      alert(j?.error || 'Error adding exercise')
    }
  }

  // Performance: derive groups and placeholder chart data
  const muscleGroupToExercises = useMemo(() => {
    const map: Record<string, Exercise[]> = {}
    for (const ex of exercises){
      const key = ex.muscle_group || 'Other'
      if (!map[key]) map[key] = []
      map[key].push(ex)
    }
    return map
  }, [exercises])

  const chartData = useMemo(() => {
    if (!selectedExerciseId || !exercises.length){
      return { labels: [], datasets: [] as any[] }
    }
    const ex = exercises.find(e => e.id === selectedExerciseId)
    const rawSets = (ex?.sets_data || [])
    // Normalize date keys (YYYY-MM-DD) and group max weight per day
    function normalizeDateKey(input?: string){
      if (!input) return ''
      try{
        const s = String(input)
        // If already ISO-like yyyy-mm-dd ...
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10)
        // Try Date parsing for RFC 2822/other formats
        const d = new Date(s)
        if (!isNaN(d.getTime())){
          const y = d.getFullYear()
          const m = String(d.getMonth()+1).padStart(2,'0')
          const day = String(d.getDate()).padStart(2,'0')
          return `${y}-${m}-${day}`
        }
      }catch{}
      return ''
    }
    // Group by normalized date
    const byDate: Record<string, number> = {}
    for (const s of rawSets){
      const key = normalizeDateKey(String(s.created_at || s.date || ''))
      if (!key) continue
      const w = Number(s.weight || 0)
      if (!(key in byDate) || w > byDate[key]) byDate[key] = w
    }
    // Sort dates and take most recent 15
    const allDates = Object.keys(byDate).sort((a,b)=> a.localeCompare(b))
    const lastDates = allDates.slice(-15)
    const lastDatesAsc = lastDates.slice().sort((a,b)=> a.localeCompare(b))
    const labels = lastDatesAsc.map(d => formatMonthDay(d))
    const weights = lastDatesAsc.map(d => byDate[d])
    return {
      labels,
      datasets: [
        {
          label: 'Weight (kg)',
          data: weights,
          borderColor: '#4db6ac',
          backgroundColor: 'rgba(77,182,172,0.15)',
          pointRadius: 3,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true
        }
      ]
    }
  }, [selectedExerciseId, exercises])

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.08)' } },
      x: { grid: { display: false } }
    },
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          usePointStyle: false,
          // Prefer line sample instead of box
          useLineStyle: true as any,
          boxWidth: 30,
          boxHeight: 2
        }
      }
    }
  }), [])

  function loadLeaderboard(){
    if (!lbCommunityId || !lbExerciseId) return
    const params = new URLSearchParams({ community_id: String(lbCommunityId), exercise_id: String(lbExerciseId) })
    fetch(`/leaderboard_exercise_in_community?${params.toString()}`, { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.entries)){
          setLeaderboardRows(j.entries.map((e:any)=>({ username: e.username, max: e.max })))
        } else {
          setLeaderboardRows([])
        }
      }).catch(()=> setLeaderboardRows([]))
  }

  return (
    <div className="app-content min-h-screen bg-black text-white">
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }}
      >
        <div className="max-w-3xl mx-auto h-full flex items-center px-3">
          <button
            type="button"
            className="mr-2 p-2 rounded-full hover:bg-white/5"
            onClick={()=> {
              if (parentId) window.location.href = `/communities?parent_id=${parentId}`
              else window.history.back()
            }}
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="text-sm text-white/90">Back</div>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-3 pt-0 pb-4">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10 mt-12 mb-2 overflow-x-auto no-scrollbar flex-nowrap">
          <TabButton active={activeTab==='performance'} onClick={()=> setActiveTab('performance')} icon="fa-chart-line" label="Performance Tracking" />
          <TabButton active={activeTab==='exercise'} onClick={()=> setActiveTab('exercise')} icon="fa-dumbbell" label="Exercise Management" />
          <TabButton active={activeTab==='workouts'} onClick={()=> setActiveTab('workouts')} icon="fa-calendar-alt" label="Workouts" />
          <TabButton active={activeTab==='leaderboard'} onClick={()=> setActiveTab('leaderboard')} icon="fa-trophy" label="Community Leaderboard" />
          <TabButton active={activeTab==='generator'} onClick={()=> setActiveTab('generator')} icon="fa-magic" label="Workout Generator" />
        </div>

        {/* Performance Tracking */}
        {activeTab==='performance' && (
          <div className="space-y-4">

            {/* Analytics */}
            <div className="rounded-xl border border-white/10 bg-white/5 mt-2">
              <div className="flex flex-wrap gap-2 items-center p-3 border-b border-white/10">
                <div className="font-semibold text-sm">Progress Analytics</div>
                <select value={selectedExerciseId as any} onChange={e=> setSelectedExerciseId(e.target.value ? Number(e.target.value) : '')} className="bg-black border border-white/15 rounded-md px-2 py-1 text-sm">
                  <option value="">Select Exercise</option>
                  {exercises.map(ex => (
                    <option key={ex.id} value={ex.id}>{ex.name} ({ex.muscle_group})</option>
                  ))}
                </select>
                <select value={timeRange} onChange={e=> setTimeRange(e.target.value as any)} className="bg-black border border-white/15 rounded-md px-2 py-1 text-sm">
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="180">Last 6 months</option>
                  <option value="365">Last year</option>
                  <option value="all">All time</option>
                </select>
                <button className="ml-auto p-2 rounded-md hover:bg-white/5" title="Share Progress"><i className="fa-solid fa-share-nodes"/></button>
              </div>
              <div className="h-64 p-3">
                {chartData.labels.length ? (
                  <Line data={chartData as any} options={chartOptions}/>
                ) : (
                  <div className="h-full flex items-center justify-center text-[#9fb0b5] text-sm">Select an exercise to see progress</div>
                )}
              </div>
            </div>

            {/* Muscle groups */}
            <div className="space-y-2">
              {Object.keys(muscleGroupToExercises).length === 0 ? (
                <div className="text-[#9fb0b5] text-sm text-center py-4">No exercises found. Add exercises to see your 1RM data here.</div>
              ) : (
                Object.entries(muscleGroupToExercises).map(([group, list]) => {
                  const maxWeight = Math.max(...list.map(ex => (ex.sets_data||[]).reduce((m,s)=> Math.max(m, s.weight||0), 0)))
                  const isOpen = !!expandedGroups[group]
                  return (
                    <div key={group} className="rounded-xl border border-white/10 bg-white/5">
                      <button className="w-full p-3 flex items-center justify-between" onClick={()=> setExpandedGroups(prev=> ({...prev, [group]: !isOpen}))}>
                        <div className="font-semibold text-left">{group}</div>
                        <div className="text-xs text-[#9fb0b5]">{list.length} exercises • Max {maxWeight>0? `${maxWeight} kg` : 'No data'}</div>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 space-y-2">
                          {list.map(ex => {
                            const sets = ex.sets_data || []
                            let max = 0
                            let maxDate: string | undefined = undefined
                            for (const s of sets){
                              const w = Number(s.weight || 0)
                              if (w >= max){ max = w; maxDate = String(s.created_at || s.date || '') }
                            }
                            return (
                              <div key={ex.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                                <div className="font-medium">{ex.name}</div>
                                <div className="text-xs text-[#9fb0b5]">{max>0? `${max} kg` : 'No data'}{maxDate ? ` • ${formatMonthDay(maxDate)}` : ''}</div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Exercise Management */}
        {activeTab==='exercise' && (
          <div className="rounded-xl border border-white/10 bg-white/5 mt-2">
            <div className="flex flex-wrap gap-2 items-center p-3 border-b border-white/10">
              <div className="font-semibold text-sm">Exercise Management</div>
              <div className="ml-auto flex items-center gap-2">
                <button className="w-8 h-8 rounded-md bg-[#4db6ac] text-black hover:brightness-110 flex items-center justify-center" onClick={openAddExercise} title="Add Exercise"><i className="fa-solid fa-plus"/></button>
                <button className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/15 flex items-center justify-center" title="Toggle All Groups" onClick={()=>{
                  const groupKeys = Object.keys(muscleGroupToExercises)
                  const anyOpen = groupKeys.some(g => expandedGroups[g])
                  if (anyOpen) setExpandedGroups({})
                  else {
                    const all: Record<string, boolean> = {}
                    for (const g of groupKeys) all[g] = true
                    setExpandedGroups(all)
                  }
                }}><i className="fa-solid fa-eye-slash"/></button>
                {/* Group button removed */}
              </div>
            </div>
            <div className="divide-y divide-white/10 text-[13px]">
              {Object.keys(muscleGroupToExercises).length === 0 ? (
                <div className="text-[#9fb0b5] text-sm px-3 py-3">No exercises found.</div>
              ) : (
                Object.entries(muscleGroupToExercises).map(([group, list]) => (
                  <div key={group} className="">
                    {/* Removed muscle group header label per request */}
                    {/* Group helicopter view: expand group to see exercises; exercises are single-row items */}
                    <button className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 text-left"
                      onClick={()=> setExpandedGroups(prev=> ({...prev, [group]: !expandedGroups[group]}))}
                      title="Toggle group">
                      <div className="font-medium text-sm">{group}</div>
                      <i className={`fa-solid ${expandedGroups[group] ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-[#9fb0b5]`} />
                    </button>
                    {expandedGroups[group] && (
                      <div className="pb-1">
                        {list.map(ex => {
                          // Compute simple trend: max per day, compare earliest vs latest of last up to 5 points
                          const byDate: Record<string, number> = {}
                          for (const s of (ex.sets_data || [])){
                            const key = String(s.created_at || s.date || '').slice(0,10)
                            if (!key) continue
                            const w = Number(s.weight || 0)
                            if (!(key in byDate) || w > byDate[key]) byDate[key] = w
                          }
                          const ordered = Object.keys(byDate).sort()
                          const windowKeys = ordered.slice(-5)
                          let trendUp = true
                          if (windowKeys.length >= 2){
                            const first = byDate[windowKeys[0]]
                            const last = byDate[windowKeys[windowKeys.length-1]]
                            trendUp = last >= first
                          }
                          return (
                            <div key={ex.id} className="w-full pl-6 pr-3 py-1.5 flex items-center justify-between hover:bg-white/5"
                              onClick={()=> {
                                setSelectedExerciseId(ex.id)
                                setLogsExerciseName(ex.name)
                                setLogsExerciseId(ex.id)
                                const sets = (ex.sets_data || []).slice().sort((a,b)=> String(b.created_at||b.date||'').localeCompare(String(a.created_at||a.date||'')))
                                const mapped = sets.map(s=> ({ date: String(s.created_at||s.date||''), weight: Number(s.weight||0), reps: Number(s.reps||0) }))
                                setLogsEntries(mapped)
                                setShowLogsModal(true)
                              }}
                              title="View logs">
                              <div className="text-xs text-[#cfd8dc] truncate mr-2">{ex.name}</div>
                              <div className="flex items-center gap-2">
                                <i className={`fa-solid ${trendUp ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-xs`} style={{ color: trendUp ? '#4db6ac' : '#e53935' }} />
                                <button className="p-1 rounded hover:bg-white/5 text-red-400" title="Delete exercise" aria-label="Delete exercise"
                                  onClick={async (ev)=>{
                                    ev.stopPropagation()
                                    if (!confirm('Delete this exercise and all its logs?')) return
                                    const fd = new URLSearchParams({ exercise_id: String(ex.id) })
                                    const r = await fetch('/delete_exercise', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                                    const j = await r.json().catch(()=>null)
                                    if (j?.success){
                                      setExercises(prev => prev.filter(e => e.id !== ex.id))
                                      setUserExercises(prev => prev.filter(e => e.id !== ex.id))
                                      if (selectedExerciseId === ex.id){ setSelectedExerciseId(''); if (showLogsModal) setShowLogsModal(false) }
                                    } else {
                                      alert(j?.error || 'Failed to delete exercise')
                                    }
                                  }}>
                                  <i className="fa-solid fa-trash"/>
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Workouts */}
        {activeTab==='workouts' && (
          <div className="rounded-xl border border-white/10 bg-white/5 mt-2">
            <div className="flex items-center justify-between p-3 border-b border-white/10">
              <div className="font-semibold text-sm">Workouts</div>
              <button type="button" className="w-8 h-8 p-0 rounded-md bg-[#4db6ac] text-black hover:brightness-110 flex items-center justify-center" title="Create Workout" onClick={(e)=> { e.preventDefault(); e.stopPropagation(); setNewWorkoutName(''); setNewWorkoutDate(new Date().toISOString().slice(0,10)); setShowCreateWorkoutModal(true) }}>
                <i className="fa-solid fa-plus" />
              </button>
            </div>
            <div className="divide-y divide-white/10">
              {workouts.length===0 ? (
                <div className="px-3 py-3 text-[#9fb0b5] text-sm">No workouts found.</div>
              ) : workouts.map(w => (
                <div key={w.id} className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium leading-tight">{w.name}</div>
                    <div className="text-xs text-[#9fb0b5]">{formatDate(w.date)} • Exercises {w.exercise_count ?? 0}</div>
                  </div>
                  <button className="p-2 rounded-md hover:bg-white/10" title="Share"><i className="fa-solid fa-share-nodes"/></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Community Leaderboard */}
        {activeTab==='leaderboard' && (
          <div className="rounded-xl border border-white/10 bg-white/5 mt-2">
            <div className="flex items-center justify-between p-3 border-b border-white/10">
              <div className="font-semibold text-sm">Community Leaderboard</div>
              <button className="w-8 h-8 p-0 rounded-md bg-white/10 hover:bg-white/15 flex items-center justify-center" onClick={loadLeaderboard} title="Load Leaderboard">
                <i className="fa-solid fa-list-ol" />
              </button>
            </div>
            <div className="p-3 flex flex-wrap items-center gap-2">
              <select value={lbCommunityId as any} onChange={e=> setLbCommunityId(e.target.value ? Number(e.target.value) : '')} className="bg-black border border-white/15 rounded-md px-2 py-1 text-sm">
                <option value="">Select Community</option>
                {communities.filter((c:any)=> (c.type||'').toLowerCase()==='gym').map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={lbExerciseId as any} onChange={e=> setLbExerciseId(e.target.value ? Number(e.target.value) : '')} className="bg-black border border-white/15 rounded-md px-2 py-1 text-sm">
                <option value="">Select Exercise</option>
                {userExercises.map(ex=> <option key={ex.id} value={ex.id}>{ex.name} ({ex.muscle_group})</option>)}
              </select>
            </div>
            <div className="divide-y divide-white/10">
              {leaderboardRows.length===0 ? (
                <div className="px-3 py-3 text-[#9fb0b5] text-sm">No entries yet.</div>
              ) : leaderboardRows.map((r, idx) => (
                <div key={idx} className="px-3 py-2 flex items-center justify-between">
                  <div className="font-medium">#{idx+1} {r.username}</div>
                  <div className="text-[#9fb0b5]">{r.max} kg</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Workout Generator */}
        {activeTab==='generator' && (
          <div className="rounded-xl border border-white/10 bg-white/5 mt-2 p-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">Workout Generator</div>
              <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={()=> (window.location.href = '/workout_generator')}>
                Open Generator
              </button>
            </div>
            <div className="text-[#9fb0b5] text-sm mt-2">Create personalized workout plans based on your goals.</div>
          </div>
        )}
      </div>

      {/* Add Exercise Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[90%] max-w-md rounded-xl border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Add New Exercise</div>
              <button className="p-2 rounded-md hover:bg-white/5" onClick={()=> setShowAddModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-[#9fb0b5]">Exercise Name</label>
                <input value={newName} onChange={e=> setNewName(e.target.value)} placeholder="e.g., Bench Press" className="mt-1 w-full px-3 py-2 rounded-md bg-black border border-white/15" />
              </div>
              <div>
                <label className="text-sm text-[#9fb0b5]">Muscle Group</label>
                <select value={newGroup} onChange={e=> setNewGroup(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-md bg-black border border-white/15">
                  <option value="">Select muscle group</option>
                  <option value="Chest">Chest</option>
                  <option value="Back">Back</option>
                  <option value="Shoulders">Shoulders</option>
                  <option value="Biceps">Biceps</option>
                  <option value="Triceps">Triceps</option>
                  <option value="Legs">Legs</option>
                  <option value="Core">Core</option>
                  <option value="Glutes">Glutes</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-[#9fb0b5]">Weight (kg)</label>
                  <input type="number" step="0.1" value={newWeight} onChange={e=> setNewWeight(e.target.value)} placeholder="e.g., 80" className="mt-1 w-full px-3 py-2 rounded-md bg-black border border-white/15" />
                </div>
                <div>
                  <label className="text-sm text-[#9fb0b5]">Reps</label>
                  <input type="number" value={newReps} onChange={e=> setNewReps(e.target.value)} placeholder="e.g., 8" className="mt-1 w-full px-3 py-2 rounded-md bg-black border border-white/15" />
                </div>
              </div>
              <div>
                <label className="text-sm text-[#9fb0b5]">Date</label>
                <input type="date" max={new Date().toISOString().slice(0,10)} value={newDate} onChange={e=> setNewDate(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-md bg-black border border-white/15" />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/15" onClick={()=> setShowAddModal(false)}>Cancel</button>
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={submitNewExercise}><i className="fa-solid fa-plus mr-2"/>Add Exercise</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Exercise Logs Modal */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-sm">{logsExerciseName}</div>
              <button className="p-1.5 rounded-md hover:bg-white/5" onClick={()=> setShowLogsModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div>
              {/* Add entry row */}
              <div className="pb-2 grid grid-cols-2 gap-3 items-center">
                {/* Left column: Weight on top, Sets below */}
                <div className="flex flex-col gap-2">
                  <label className="sr-only">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newLogWeight}
                    onChange={e=> setNewLogWeight(e.target.value)}
                    placeholder="Weight (kg)"
                    className="block w-36 h-9 px-3 rounded-md bg-black border border-white/15 text-base focus:outline-none focus:ring-2 focus:ring-[#4db6ac] focus:border-[#4db6ac] focus:bg-teal-900/20"
                  />
                  <label className="sr-only">Reps</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={newLogSets}
                    onChange={e=> setNewLogSets(e.target.value)}
                    placeholder="Reps"
                    className="block w-36 h-9 px-3 rounded-md bg-black border border-white/15 text-base focus:outline-none focus:ring-2 focus:ring-[#4db6ac] focus:border-[#4db6ac]"
                  />
                </div>
                {/* Right column: Date (borderless) on top with calendar icon; + button below centered */}
                <div className="flex flex-col items-center justify-center gap-2">
                  <label className="sr-only">Date</label>
                  <input
                    type="date"
                    value={newLogDate}
                    max={new Date().toISOString().slice(0,10)}
                    onChange={e=> setNewLogDate(e.target.value)}
                    className="block w-40 h-9 px-0 bg-transparent border-0 outline-none focus:outline-none ring-0 text-sm text-center [text-align-last:center] appearance-none"
                  />
                  <button className="w-8 h-8 p-0 rounded-md bg-[#4db6ac] text-black hover:brightness-110 flex items-center justify-center" aria-label="Add entry" onClick={async()=>{
                  if (!logsExerciseId || !newLogWeight || !newLogDate) return
                  const repsVal = newLogSets && Number(newLogSets) > 0 ? String(Number(newLogSets)) : '1'
                  const fd = new URLSearchParams({ exercise_id: String(logsExerciseId), weight: newLogWeight, reps: repsVal, date: newLogDate })
                  const r = await fetch('/log_weight_set', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                  const j = await r.json().catch(()=>null)
                  if (j?.success){
                    const updated = [{ date: newLogDate, weight: Number(newLogWeight), reps: Number(repsVal) }, ...logsEntries]
                    setLogsEntries(updated)
                    // Also update main exercises state so entries persist after closing modal
                    setExercises(prev => prev.map(ex => {
                      if (ex.id !== logsExerciseId) return ex
                      const newSets = updated.map(le => ({ weight: le.weight, reps: le.reps, created_at: le.date }))
                      return { ...ex, sets_data: newSets }
                    }))
                    setNewLogWeight('')
                    setNewLogSets('')
                    setNewLogDate(new Date().toISOString().slice(0,10))
                  } else alert(j?.error || 'Failed to add entry')
                }}><i className="fa-solid fa-plus text-xs"/></button>
                </div>
              </div>
              {logsEntries.length === 0 ? (
                <div className="text-sm text-[#9fb0b5]">No logs yet.</div>
              ) : (
                (() => {
                  const monthMap: Record<string, Array<{ date:string; weight:number; reps:number }>> = {}
                  for (const e of logsEntries){
                    const key = (e.date||'').slice(0,7)
                    if (!monthMap[key]) monthMap[key] = []
                    monthMap[key].push(e)
                  }
                  const keys = Object.keys(monthMap).sort().reverse()
                  return (
                    <div className="divide-y divide-white/10">
                      {keys.map(k => (
                        <div key={k}>
                          <div className="py-1.5 px-1 flex items-center justify-between text-xs">
                            <div className="font-medium">{formatMonthYear(k)}</div>
                          </div>
                          <div className="py-0.5">
                            {monthMap[k].map((e, idx) => (
                              <div key={idx} className="py-0.5 flex items-center justify-between text-xs">
                                <div>{formatMonthDay(e.date)}</div>
                                <div className="flex items-center gap-2">
                                  <div className="text-[#9fb0b5]">{e.weight} kg × {e.reps}</div>
                                  <button className="p-0.5 rounded hover:bg-white/5" title="Edit" onClick={async()=>{
                                    const newW = prompt('New weight (kg):', String(e.weight))
                                    if (!newW || !logsExerciseId) return
                                    const fd = new URLSearchParams({ exercise_id: String(logsExerciseId), set_id: '', weight: newW })
                                    const r = await fetch('/edit_set', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                                    const j = await r.json().catch(()=>null)
                                    if (j?.success){
                                      // Update client view (best-effort)
                                      const updated = logsEntries.slice()
                                      updated[idx] = { ...e, weight: Number(newW) }
                                      setLogsEntries(updated)
                                      // Sync back to main exercises state
                                      setExercises(prev => prev.map(ex => {
                                        if (ex.id !== logsExerciseId) return ex
                                        const newSets = updated.map(le => ({ weight: le.weight, reps: le.reps, created_at: le.date }))
                                        return { ...ex, sets_data: newSets }
                                      }))
                                    } else alert(j?.error||'Failed to edit entry')
                                  }}><i className="fa-solid fa-pen"/></button>
                                  <button className="p-0.5 rounded hover:bg-white/5" title="Delete" onClick={async()=>{
                                    if (!confirm('Delete this entry?')) return
                                    if (!logsExerciseId) return
                                    const fd = new URLSearchParams({ exercise_id: String(logsExerciseId), date: e.date, weight: String(e.weight), reps: String(e.reps) })
                                    const r = await fetch('/delete_weight_entry', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                                    const j = await r.json().catch(()=>null)
                                    if (j?.success){
                                      const filtered = logsEntries.filter((x, i)=> !(i===idx && x.date===e.date && x.weight===e.weight && x.reps===e.reps))
                                      setLogsEntries(filtered)
                                      // Sync back to main exercises state
                                      setExercises(prev => prev.map(ex => {
                                        if (ex.id !== logsExerciseId) return ex
                                        const newSets = filtered.map(le => ({ weight: le.weight, reps: le.reps, created_at: le.date }))
                                        return { ...ex, sets_data: newSets }
                                      }))
                                    } else alert(j?.error||'Failed to delete entry')
                                  }}><i className="fa-solid fa-trash"/></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Workout Modal */}
      {showCreateWorkoutModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-sm">Create New Workout</div>
              <button className="p-1.5 rounded-md hover:bg-white/5" onClick={()=> setShowCreateWorkoutModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-[#9fb0b5]">Workout Name</label>
                <input value={newWorkoutName} onChange={e=> setNewWorkoutName(e.target.value)} placeholder="e.g., Push Day" className="mt-1 w-full h-9 px-3 rounded-md bg-black border border-white/15 text-sm" />
              </div>
              <div>
                <label className="text-xs text-[#9fb0b5]">Date</label>
                <input type="date" value={newWorkoutDate} max={new Date().toISOString().slice(0,10)} onChange={e=> setNewWorkoutDate(e.target.value)} className="mt-1 w-48 h-9 px-3 rounded-md bg-black border border-white/15 text-sm text-center [text-align-last:center]" />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/15" onClick={()=> setShowCreateWorkoutModal(false)}>Cancel</button>
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=>{
                  if (!newWorkoutName || !newWorkoutDate) return
                  const fd = new URLSearchParams({ name: newWorkoutName, date: newWorkoutDate })
                  const r = await fetch('/create_workout', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                  const j = await r.json().catch(()=>null)
                  if (j?.success){
                    setShowCreateWorkoutModal(false)
                    // refresh workouts
                    fetch('/get_workouts', { credentials:'include' }).then(r=> r.json()).then(j=> { if (j?.success) setWorkouts(j.workouts||[]) }).catch(()=>{})
                  } else alert(j?.error||'Failed to create workout')
                }}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }:{ active:boolean; onClick:()=>void; icon:string; label:string }){
  return (
    <button onClick={onClick} className={`px-2.5 py-1.5 rounded-t-md text-[13px] whitespace-nowrap ${active ? 'text-white border-b-2 border-[#4db6ac] bg-white/5' : 'text-[#9fb0b5] hover:text-white/90'}`}>
      <i className={`fa-solid ${icon} mr-2`} />{label}
    </button>
  )
}

function formatDate(s?:string){
  if (!s) return ''
  try{
    const t = String(s).slice(0,10)
    const parts = t.split('-')
    if (parts.length === 3){
      const y = parseInt(parts[0], 10)
      const m = parseInt(parts[1], 10)
      const dnum = parseInt(parts[2], 10)
      if (!isNaN(y) && !isNaN(m) && !isNaN(dnum) && m>=1 && m<=12){
        const date = new Date(y, m-1, dnum)
        return date.toLocaleDateString('en-US', { month:'short', day:'numeric' })
      }
    }
    return t
  }catch{ return s }
}

function formatMonthDay(s?:string){
  if (!s) return ''
  try{
    const t = String(s).slice(0,10)
    const parts = t.split('-')
    if (parts.length === 3){
      const y = parseInt(parts[0], 10)
      const m = parseInt(parts[1], 10)
      const dnum = parseInt(parts[2], 10)
      if (!isNaN(y) && !isNaN(m) && !isNaN(dnum) && m>=1 && m<=12){
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        return `${months[m-1]} ${dnum}`
      }
    }
    return t
  }catch{ return s }
}

function formatMonthYear(s?:string){
  if (!s) return ''
  try{
    const parts = String(s).slice(0,7).split('-')
    if (parts.length === 2){
      const y = parseInt(parts[0], 10)
      const m = parseInt(parts[1], 10)
      if (!isNaN(y) && !isNaN(m) && m>=1 && m<=12){
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        return `${months[m-1]} ${y}`
      }
    }
    return String(s)
  }catch{ return s }
}

