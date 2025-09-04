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
  useEffect(() => { setTitle('Workout Tracking') }, [setTitle])

  const [activeTab, setActiveTab] = useState<'performance' | 'exercise' | 'workouts' | 'leaderboard'>('performance')
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
  const [logsEntries, setLogsEntries] = useState<Array<{ date:string; weight:number; reps:number }>>([])

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
    // Group by date (YYYY-MM-DD) and take max weight per day
    const byDate: Record<string, number> = {}
    for (const s of rawSets){
      const key = String(s.created_at || s.date || '').slice(0,10)
      if (!key) continue
      const w = Number(s.weight || 0)
      if (!(key in byDate) || w > byDate[key]) byDate[key] = w
    }
    // Sort dates and take most recent 15
    const allDates = Object.keys(byDate).sort()
    const lastDates = allDates.slice(-15)
    const labels = lastDates.map(d => formatMonthDay(d))
    const weights = lastDates.map(d => byDate[d])
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
    <div className="min-h-screen bg-black text-white pt-14">
      <div className="max-w-3xl mx-auto px-3 pt-0 pb-4">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10 mt-0 mb-2 overflow-x-auto no-scrollbar flex-nowrap">
          <TabButton active={activeTab==='performance'} onClick={()=> setActiveTab('performance')} icon="fa-chart-line" label="Performance Tracking" />
          <TabButton active={activeTab==='exercise'} onClick={()=> setActiveTab('exercise')} icon="fa-dumbbell" label="Exercise Management" />
          <TabButton active={activeTab==='workouts'} onClick={()=> setActiveTab('workouts')} icon="fa-calendar-alt" label="Workouts" />
          <TabButton active={activeTab==='leaderboard'} onClick={()=> setActiveTab('leaderboard')} icon="fa-trophy" label="Community Leaderboard" />
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
                    <div className="px-3 py-2 font-semibold text-[#cfd8dc] text-xs uppercase tracking-wider">{group}</div>
                    {/* Group helicopter view: expand group to see exercises; exercises are single-row items */}
                    <button className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 text-left"
                      onClick={()=> setExpandedGroups(prev=> ({...prev, [group]: !expandedGroups[group]}))}
                      title="Toggle group">
                      <div className="font-medium text-sm">{group}</div>
                      <i className={`fa-solid ${expandedGroups[group] ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-[#9fb0b5]`} />
                    </button>
                    {expandedGroups[group] && (
                      <div className="pb-1">
                        {list.map(ex => (
                          <button key={ex.id} className="w-full pl-6 pr-3 py-1.5 flex items-center justify-between hover:bg-white/5 text-left"
                            onClick={()=> {
                              setSelectedExerciseId(ex.id)
                              setLogsExerciseName(ex.name)
                              const sets = (ex.sets_data || []).slice().sort((a,b)=> String(b.created_at||b.date||'').localeCompare(String(a.created_at||a.date||'')))
                              const mapped = sets.map(s=> ({ date: String(s.created_at||s.date||''), weight: Number(s.weight||0), reps: Number(s.reps||0) }))
                              setLogsEntries(mapped)
                              setShowLogsModal(true)
                            }}
                            aria-label={`View logs for ${ex.name}`}
                            title="View logs">
                            <i className="fa-solid fa-clipboard-list text-xs text-[#9fb0b5]" />
                          </button>
                        ))}
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
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Your Workouts</div>
              <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110"><i className="fa-solid fa-plus mr-2"/>Create Workout</button>
            </div>
            <div className="space-y-2">
              {workouts.length===0 ? (
                <div className="text-[#9fb0b5] text-sm">No workouts found.</div>
              ) : workouts.map(w => (
                <div key={w.id} className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{w.name}</div>
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
          <div className="space-y-4">
            <div className="text-lg font-semibold">Community Leaderboard</div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex flex-wrap gap-2 items-center">
                <select value={lbCommunityId as any} onChange={e=> setLbCommunityId(e.target.value ? Number(e.target.value) : '')} className="bg-black border border-white/15 rounded-md px-2 py-1 text-sm">
                  <option value="">Select Community</option>
                  {communities.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={lbExerciseId as any} onChange={e=> setLbExerciseId(e.target.value ? Number(e.target.value) : '')} className="bg-black border border-white/15 rounded-md px-2 py-1 text-sm">
                  <option value="">Select Exercise</option>
                  {userExercises.map(ex=> <option key={ex.id} value={ex.id}>{ex.name} ({ex.muscle_group})</option>)}
                </select>
                <button className="ml-auto px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15" onClick={loadLeaderboard}>
                  <i className="fa-solid fa-list-ol mr-2"/>Load Leaderboard
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {leaderboardRows.length===0 ? (
                  <div className="text-[#9fb0b5] text-sm">No entries yet.</div>
                ) : leaderboardRows.map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/50 px-3 py-2">
                    <div className="font-medium">#{idx+1} {r.username}</div>
                    <div className="text-[#9fb0b5]">{r.max} kg</div>
                  </div>
                ))}
              </div>
            </div>
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
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">{logsExerciseName} Logs</div>
              <button className="p-2 rounded-md hover:bg-white/5" onClick={()=> setShowLogsModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto no-scrollbar divide-y divide-white/10">
              {logsEntries.length === 0 ? (
                <div className="text-sm text-[#9fb0b5]">No logs yet.</div>
              ) : logsEntries.map((e, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between text-sm">
                  <div>{formatMonthDay(e.date)}</div>
                  <div className="text-[#9fb0b5]">{e.weight} kg × {e.reps}</div>
                </div>
              ))}
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
    const d = new Date(s)
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric' })
  }catch{ return s }
}

function formatMonthDay(s?:string){
  if (!s) return ''
  try{
    const d = new Date(s)
    const month = d.toLocaleString('en-US', { month: 'short' })
    return `${month} ${d.getDate()}`
  }catch{ return s }
}

