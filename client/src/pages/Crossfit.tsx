import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend)

type Community = { id: number; name: string; type: string }

const commonLifts = ['Back Squat','Front Squat','Overhead Squat','Deadlift','Clean','Jerk','Clean & Jerk','Snatch','Bench Press','Push Press','Thruster']
const commonWODs = ['Fran','Murph','Cindy','Helen','Annie','Diane','Grace','Isabel','Angie','Kelly','Jackie','Karen']

function fetchUserCommunities(): Promise<{ success: boolean; communities: Community[] }> {
  return fetch('/get_user_communities', { credentials: 'include' }).then((r) => r.json())
}

export default function Crossfit() {
  const [activeTab, setActiveTab] = useState<'tracking'|'management'|'comparison'>('tracking')
  const [modalOpen, setModalOpen] = useState(false)
  const [type, setType] = useState<'lift'|'wod'>('lift')
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [date, setDate] = useState<string>('')

  useEffect(() => {
    setDate(new Date().toISOString().split('T')[0])
  }, [])

  const { data: commData } = useQuery({ queryKey: ['user-communities'], queryFn: fetchUserCommunities })
  const communities = commData?.communities ?? []

  // Comparison controls
  const [selectedCommunityId, setSelectedCommunityId] = useState<string>('')
  const [selectedItem, setSelectedItem] = useState<string>('') // format: "lift:Back Squat" | "wod:Fran"

  const canCompare = selectedCommunityId && selectedItem

  const comparisonQuery = useQuery({
    queryKey: ['cf-compare', selectedCommunityId, selectedItem],
    queryFn: async () => {
      const item_type = selectedItem.startsWith('wod:') ? 'wod' : 'lift'
      const item_name = selectedItem.replace(/^(lift:|wod:)/,'')
      const url = `/cf_compare_item_in_box?community_id=${encodeURIComponent(selectedCommunityId)}&item_type=${encodeURIComponent(item_type)}&item_name=${encodeURIComponent(item_name)}`
      const resp = await fetch(url, { credentials: 'include' })
      return resp.json()
    },
    enabled: !!canCompare,
  })

  const chartData = useMemo(() => {
    const d = comparisonQuery.data?.data
    if (!d) return null
    return {
      labels: d.labels,
      datasets: [
        { label: `You (${d.unit})`, data: d.userValues, backgroundColor: 'rgba(77, 182, 172, 0.6)', borderColor: '#4db6ac', borderWidth: 1 },
        { label: `Avg (${d.unit})`, data: d.avgValues, backgroundColor: 'rgba(176, 184, 185, 0.5)', borderColor: '#9fb0b5', borderWidth: 1 },
      ],
    }
  }, [comparisonQuery.data])

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: { y: { beginAtZero: true } },
    plugins: { legend: { position: 'bottom' as const } },
  }), [])

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault()
    const body = new URLSearchParams({ type, name, weight, reps, score: reps, date })
    const resp = await fetch('/cf_add_entry', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const json = await resp.json()
    if (json?.success) {
      setModalOpen(false)
      setWeight(''); setReps('');
    } else {
      alert(json?.error || 'Error adding entry')
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f10] text-white">
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#333] flex items-center px-3 z-40 bg-black/50 backdrop-blur">
        <button className="px-3 py-2 rounded border border-[#333] bg-[#1a1a1a]" onClick={() => history.back()}>
          <i className="fa-solid fa-arrow-left" /> Back
        </button>
        <h1 className="ml-3 text-lg font-semibold">Crossfit Tracking</h1>
      </div>

      <div className="pt-16 max-w-5xl mx-auto px-3">
        <div className="flex gap-2 mb-4">
          <button className={`tab-btn ${activeTab==='tracking'?'active':''}`} onClick={() => setActiveTab('tracking')}>
            <i className="fas fa-chart-line" /> <span className="ml-1">Performance Tracking</span>
          </button>
          <button className={`tab-btn ${activeTab==='management'?'active':''}`} onClick={() => setActiveTab('management')}>
            <i className="fas fa-dumbbell" /> <span className="ml-1">Workout Management</span>
          </button>
          <button className={`tab-btn ${activeTab==='comparison'?'active':''}`} onClick={() => setActiveTab('comparison')}>
            <i className="fas fa-chart-bar" /> <span className="ml-1">You vs Your Box</span>
          </button>
        </div>

        {activeTab === 'tracking' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Your Crossfit Overview</h3>
              <button className="px-3 py-2 rounded bg-teal-700/20 text-teal-300 border border-teal-500/40" onClick={() => setModalOpen(true)}>
                <i className="fas fa-plus" /> Add Entry
              </button>
            </div>
            <div className="rounded-lg border border-white/10 p-3">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium">Progress Analytics</h4>
                <div className="flex gap-2">
                  <select className="analytics-select">
                    <option value="">Select Lift or WOD</option>
                    <optgroup label="Lifts">{commonLifts.map(n => <option key={n} value={`lift:${n}`}>{n}</option>)}</optgroup>
                    <optgroup label="WODs">{commonWODs.map(n => <option key={n} value={`wod:${n}`}>{n}</option>)}</optgroup>
                  </select>
                  <select className="analytics-select">
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="180">Last 6 months</option>
                    <option value="365">Last year</option>
                    <option value="all">All time</option>
                  </select>
                </div>
              </div>
              <div className="h-64 flex items-center justify-center text-[#9fb0b5] text-sm">
                Select a lift or WOD to view your progress.
              </div>
            </div>
            <div>
              <div className="muscle-groups-view">
                <div className="muscle-group-section">
                  <div className="flex items-center justify-between cursor-pointer py-1.5">
                    <h3 className="m-0">Lifts</h3>
                  </div>
                </div>
                <div className="muscle-group-section">
                  <div className="flex items-center justify-between cursor-pointer py-1.5">
                    <h3 className="m-0">WODs</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'management' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Manage Lifts and WODs</h3>
              <div className="flex gap-2">
                <button className="px-3 py-2 rounded bg-teal-700/20 text-teal-300 border border-teal-500/40" onClick={() => setModalOpen(true)}>
                  <i className="fas fa-plus" /> Add Entry
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 p-3">
              <div className="muscle-groups-view">
                <div className="muscle-group-section">
                  <div className="flex items-center justify-between cursor-pointer py-1.5">
                    <h3 className="m-0">Lifts</h3>
                  </div>
                </div>
                <div className="muscle-group-section">
                  <div className="flex items-center justify-between cursor-pointer py-1.5">
                    <h3 className="m-0">WODs</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'comparison' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">You vs Your Box</h3>
            </div>
            <div className="rounded-lg border border-white/10 p-3">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium">Select Community and Item</h4>
                <div className="flex gap-2 items-center">
                  <select className="analytics-select" value={selectedCommunityId} onChange={(e) => setSelectedCommunityId(e.target.value)}>
                    <option value="">Select Community</option>
                    {communities.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                  <select className="analytics-select" value={selectedItem} onChange={(e)=> setSelectedItem(e.target.value)} disabled={!selectedCommunityId}>
                    <option value="">Select Lift or WOD</option>
                    <optgroup label="Lifts">{commonLifts.map(n => <option key={n} value={`lift:${n}`}>{n}</option>)}</optgroup>
                    <optgroup label="WODs">{commonWODs.map(n => <option key={n} value={`wod:${n}`}>{n}</option>)}</optgroup>
                  </select>
                </div>
              </div>
              {canCompare && chartData ? (
                <div className="h-64">
                  <Bar options={chartOptions} data={chartData} />
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-[#9fb0b5] text-sm">Select community and item to compare.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur" onClick={(e) => e.currentTarget === e.target && setModalOpen(false)}>
          <form onSubmit={submitEntry} className="w-[90%] max-w-[480px] rounded-xl bg-[#2d3839] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-teal-700/30 bg-black">
              <h3 className="text-base font-semibold">Add Crossfit Entry</h3>
              <button type="button" className="text-2xl text-[#9fb0b5] hover:text-white" onClick={() => setModalOpen(false)}>&times;</button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 gap-3">
                <label className="text-sm">Type
                  <select className="w-full mt-1 p-2 rounded bg-[#1a1a1a] border border-[#333]" value={type} onChange={(e)=> setType(e.target.value as 'lift'|'wod')}>
                    <option value="lift">Lift</option>
                    <option value="wod">WOD</option>
                  </select>
                </label>
                <label className="text-sm">Name
                  <input className="w-full mt-1 p-2 rounded bg-[#1a1a1a] border border-[#333]" value={name} onChange={(e)=> setName(e.target.value)} placeholder="e.g., Fran / Clean & Jerk" required />
                </label>
                <label className="text-sm">Weight (kg) (for lifts)
                  <input type="number" className="w-full mt-1 p-2 rounded bg-[#1a1a1a] border border-[#333]" value={weight} onChange={(e)=> setWeight(e.target.value)} min={0} step={0.1} />
                </label>
                <label className="text-sm">Reps (for lifts) or Time/Score (for WODs)
                  <input className="w-full mt-1 p-2 rounded bg-[#1a1a1a] border border-[#333]" value={reps} onChange={(e)=> setReps(e.target.value)} placeholder="e.g., 5x3, or 5:12" />
                </label>
                <label className="text-sm">Date
                  <input type="date" className="w-full mt-1 p-2 rounded bg-[#1a1a1a] border border-[#333]" value={date} onChange={(e)=> setDate(e.target.value)} required />
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="px-3 py-2 rounded border border-[#333]" onClick={()=> setModalOpen(false)}>Cancel</button>
                <button type="submit" className="px-3 py-2 rounded bg-teal-700/20 text-teal-300 border border-teal-500/40"><i className="fas fa-save" /> Save</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

