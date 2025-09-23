import { useEffect, useRef, useState } from 'react'
import Chart from 'chart.js/auto'

type Community = { id: number; name: string; type: string }

const commonLifts = ['Back Squat','Front Squat','Overhead Squat','Deadlift','Clean','Jerk','Clean & Jerk','Snatch','Bench Press','Push Press','Thruster']
const commonWODs = ['Fran','Murph','Cindy','Helen','Annie','Diane','Grace','Isabel','Angie','Kelly','Jackie','Karen']

export default function CrossfitExact() {
  // Inject legacy stylesheet only on this page to preserve exact desktop layout
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/static/styles.css'
    document.head.appendChild(link)
    return () => { document.head.removeChild(link) }
  }, [])

  const [activeTab, setActiveTab] = useState<'cf-tracking'|'cf-management'|'cf-comparison'>('cf-tracking')
  const [modalOpen, setModalOpen] = useState(false)
  const [formType, setFormType] = useState<'lift'|'wod'>('lift')
  const [formName, setFormName] = useState('')
  const [formWeight, setFormWeight] = useState('')
  const [formReps, setFormReps] = useState('')
  const [formDate, setFormDate] = useState('')

  useEffect(() => { setFormDate(new Date().toISOString().split('T')[0]) }, [])

  // Comparison state
  const [communities, setCommunities] = useState<Community[]>([])
  const [cfCommunityId, setCfCommunityId] = useState('')
  const [cfItemSel, setCfItemSel] = useState('') // e.g. lift:Back Squat

  useEffect(() => {
    if (activeTab !== 'cf-comparison') return
    fetch('/get_user_communities', { credentials: 'include' })
      .then(r => r.json())
      .then(resp => {
        if (resp?.success && Array.isArray(resp.communities)) setCommunities(resp.communities)
      })
      .catch(() => {})
  }, [activeTab])

  const canCompare = !!cfCommunityId && !!cfItemSel
  const compareChartRef = useRef<Chart|null>(null)
  const compareCanvasRef = useRef<HTMLCanvasElement|null>(null)
  const [compareSummary, setCompareSummary] = useState('')

  async function loadComparison() {
    if (!canCompare) return
    const item_type = cfItemSel.startsWith('wod:') ? 'wod' : 'lift'
    const item_name = cfItemSel.replace(/^(lift:|wod:)/,'')
    const url = `/cf_compare_item_in_box?community_id=${encodeURIComponent(cfCommunityId)}&item_type=${encodeURIComponent(item_type)}&item_name=${encodeURIComponent(item_name)}`
    const resp = await fetch(url, { credentials: 'include' })
    const json = await resp.json()
    if (json?.success) {
      setCompareSummary(json.summary || '')
      const d = json.data
      // Sort labels asc if they look like dates YYYY-MM-DD
      let labels = d.labels as string[]
      let userValues = d.userValues as number[]
      let avgValues = d.avgValues as number[]
      if (Array.isArray(labels) && labels.length && /\d{4}-\d{2}-\d{2}/.test(labels[0])){
        const pairs = labels.map((lbl, idx)=> ({ lbl, u: userValues[idx], a: avgValues[idx] }))
        pairs.sort((p,q)=> p.lbl.localeCompare(q.lbl))
        labels = pairs.map(p=> p.lbl)
        userValues = pairs.map(p=> p.u)
        avgValues = pairs.map(p=> p.a)
      }
      // Reset chart instance
      if (compareChartRef.current) { compareChartRef.current.destroy(); compareChartRef.current = null }
      const ctx = compareCanvasRef.current?.getContext('2d')
      if (!ctx) return
      compareChartRef.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: `You (${d.unit})`, data: userValues, backgroundColor: 'rgba(77, 182, 172, 0.6)', borderColor: '#4db6ac', borderWidth: 1 },
            { label: `Avg (${d.unit})`, data: avgValues, backgroundColor: 'rgba(176, 184, 185, 0.5)', borderColor: '#9fb0b5', borderWidth: 1 },
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } }
      })
    }
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault()
    const body = new URLSearchParams({ type: formType, name: formName, weight: formWeight, reps: formReps, score: formReps, date: formDate })
    const resp = await fetch('/cf_add_entry', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const json = await resp.json()
    if (json?.success) {
      setModalOpen(false)
      setFormWeight(''); setFormReps('')
    } else {
      alert(json?.error || 'Error adding entry')
    }
  }

  return (
    <div className="workout-container">
      <div className="workout-header">
        <div className="header-content">
          <button className="back-btn" onClick={() => history.back()}>
            <i className="fas fa-arrow-left"></i> Back
          </button>
          <h1>Crossfit Tracking</h1>
        </div>
      </div>

      <div className="tab-navigation">
        <button className={`tab-btn ${activeTab==='cf-tracking'?'active':''}`} data-tab="cf-tracking" onClick={() => setActiveTab('cf-tracking')}>
          <i className="fas fa-chart-line"></i>
          Performance Tracking
        </button>
        <button className={`tab-btn ${activeTab==='cf-management'?'active':''}`} data-tab="cf-management" onClick={() => setActiveTab('cf-management')}>
          <i className="fas fa-dumbbell"></i>
          Workout Management
        </button>
        <button className={`tab-btn ${activeTab==='cf-comparison'?'active':''}`} data-tab="cf-comparison" onClick={() => setActiveTab('cf-comparison')}>
          <i className="fas fa-chart-bar"></i>
          You vs Your Box
        </button>
      </div>

      {activeTab === 'cf-tracking' && (
        <div id="cf-tracking" className="tab-content active">
          <div className="performance-tracking-container">
            <div className="header-section">
              <h3>Your Crossfit Overview</h3>
              <button className="add-btn" onClick={() => setModalOpen(true)}>
                <i className="fas fa-plus"></i> Add Entry
              </button>
            </div>
            <div className="analytics-section">
              <div className="analytics-header">
                <h4>Progress Analytics</h4>
                <div className="analytics-controls">
                  <select id="cf-exercise-select" className="analytics-select" defaultValue="">
                    <option value="">Select Lift or WOD</option>
                    <optgroup label="Lifts">{commonLifts.map(n => <option key={n} value={`lift:${n}`}>{n}</option>)}</optgroup>
                    <optgroup label="WODs">{commonWODs.map(n => <option key={n} value={`wod:${n}`}>{n}</option>)}</optgroup>
                  </select>
                  <select id="cf-time-range" className="analytics-select" defaultValue="30">
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="180">Last 6 months</option>
                    <option value="365">Last year</option>
                    <option value="all">All time</option>
                  </select>
                </div>
              </div>
              <div className="chart-container">
                <canvas id="cfChart"></canvas>
              </div>
            </div>
            <div className="exercises-section">
              <div id="cf-view" className="muscle-groups-view"></div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cf-management' && (
        <div id="cf-management" className="tab-content active">
          <div className="exercise-management-container">
            <div className="header-section">
              <h3>Manage Lifts and WODs</h3>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <button className="add-btn" onClick={() => setModalOpen(true)}>
                  <i className="fas fa-plus"></i> Add Entry
                </button>
                <button className="add-btn" title="Hide/Show all">
                  <i className="fas fa-eye-slash"></i> Toggle
                </button>
              </div>
            </div>
            <div className="exercises-list-section">
              <div id="cf-management-list" className="exercises-list"></div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cf-comparison' && (
        <div id="cf-comparison" className="tab-content active">
          <div className="workouts-container">
            <div className="header-section">
              <h3>You vs Your Box</h3>
            </div>
            <div className="analytics-section">
              <div className="analytics-header">
                <h4>Select Community and Item</h4>
                <div className="analytics-controls">
                  <select id="cf-community-select" className="analytics-select" value={cfCommunityId} onChange={e=> setCfCommunityId(e.target.value)}>
                    <option value="">Select Community</option>
                    {communities.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                  <select id="cf-item-type" className="analytics-select" disabled>
                    <option value="lift">Lift</option>
                    <option value="wod">WOD</option>
                  </select>
                  <select id="cf-item-select" className="analytics-select" value={cfItemSel} onChange={e=> setCfItemSel(e.target.value)} disabled={!cfCommunityId}>
                    <option value="">Select Lift or WOD</option>
                    <optgroup label="Lifts">{commonLifts.map(n => <option key={n} value={`wod:${n}`.replace('wod:','lift:')}>{n}</option>)}</optgroup>
                    <optgroup label="WODs">{commonWODs.map(n => <option key={n} value={`wod:${n}`}>{n}</option>)}</optgroup>
                  </select>
                  <button className="share-btn" id="cf-load-compare-btn" title="Load Comparison" disabled={!canCompare} onClick={loadComparison}>
                    <i className="fas fa-sync"></i>
                  </button>
                </div>
              </div>
              <div className="chart-container" id="cf-compare-chart-container" style={{minHeight:260, display:'block'}}>
                <canvas id="cfCompareChart" ref={compareCanvasRef as any}></canvas>
              </div>
              <div id="cf-compare-summary" style={{color:'#b0b8b9', fontSize:13, marginTop:8}}>{compareSummary}</div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div id="cf-add-modal" className="modal" onClick={(e) => e.currentTarget === e.target && setModalOpen(false)}>
          <div className="modal-content" style={{maxWidth:480}}>
            <div className="modal-header">
              <h3>Add Crossfit Entry</h3>
              <button className="close-btn" onClick={() => setModalOpen(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <form id="cf-add-form" className="exercise-form" onSubmit={submitEntry}>
                <div className="form-group">
                  <label htmlFor="cf-type">Type</label>
                  <select id="cf-type" value={formType} onChange={e=> setFormType(e.target.value as 'lift'|'wod')} required>
                    <option value="lift">Lift</option>
                    <option value="wod">WOD</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="cf-name">Name</label>
                  <input type="text" id="cf-name" placeholder="e.g., Fran / Clean & Jerk" value={formName} onChange={e=> setFormName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label htmlFor="cf-weight">Weight (kg) (for lifts)</label>
                  <input type="number" id="cf-weight" min="0" step="0.1" value={formWeight} onChange={e=> setFormWeight(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="cf-reps">Reps (for lifts) or Time/Score (for WODs)</label>
                  <input type="text" id="cf-reps" placeholder="e.g., 5x3, or 5:12" value={formReps} onChange={e=> setFormReps(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="cf-date">Date</label>
                  <input type="date" id="cf-date" value={formDate} onChange={e=> setFormDate(e.target.value)} required />
                </div>
                <div className="form-actions" style={{marginTop:8, display:'flex', gap:8, justifyContent:'flex-end'}}>
                  <button type="button" className="submit-btn" onClick={()=> setModalOpen(false)} style={{background:'transparent', border:'1px solid #333'}}>Cancel</button>
                  <button type="submit" className="submit-btn"><i className="fas fa-save"></i> Save</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

