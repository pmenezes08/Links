import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

export default function YourSports(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [hasGymAccess, setHasGymAccess] = useState(false)
  
  useEffect(() => { setTitle('Your Sports') }, [setTitle])

  useEffect(() => {
    async function checkAccess() {
      try {
        // Always check gym membership API first (it has Paulo's special access built in)
        const response = await fetch('/api/check_gym_membership', {
          method: 'GET',
          credentials: 'include'
        })
        const data = await response.json()
        console.log('YourSports: gym membership check result:', data)
        
        if (data.hasGymAccess) {
          console.log('YourSports: Access granted (hasGymAccess=true)')
          setHasGymAccess(true)
          setLoading(false)
        } else {
          console.log('YourSports: Access denied, redirecting to dashboard')
          // Redirect to premium dashboard if no gym access
          navigate('/premium_dashboard')
          return
        }
      } catch (error) {
        console.error('Error checking gym membership:', error)
        // On error, redirect to dashboard
        navigate('/premium_dashboard')
        return
      }
    }
    
    checkAccess()
  }, [navigate])

  if (loading) {
    return (
      <div className="fixed inset-x-0 top-14 bottom-0 bg-[#0b0f10] text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-[#4db6ac] rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-[#9fb0b5]">Checking access...</div>
        </div>
      </div>
    )
  }

  if (!hasGymAccess) {
    return (
      <div className="fixed inset-x-0 top-14 bottom-0 bg-[#0b0f10] text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <i className="fas fa-lock text-4xl text-[#4db6ac] mb-4"></i>
          <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
          <p className="text-[#9fb0b5] mb-6">You must be a member of a gym community to access Your Sports.</p>
          <button 
            onClick={() => navigate('/premium_dashboard')}
            className="px-6 py-2 bg-[#4db6ac] text-black rounded-lg font-medium hover:brightness-110"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-[#0b0f10] text-white overflow-auto">
      <div className="h-full flex items-center justify-center px-3">
        <div className="grid grid-cols-2 gap-3 w-full max-w-3xl">
          <Card icon="fa-dumbbell" title="Gym" subtitle="Workout generator and tracking" onClick={() => (location.assign('/workout_tracking'))} />
          <Card icon="fa-bolt" title="Crossfit" subtitle="WODs and lifts tracking" onClick={() => (location.assign('/crossfit'))} />
          <Card icon="fa-running" title="Running" subtitle="Coming soon" disabled />
          <Card icon="fa-golf-ball" title="Golf" subtitle="Coming soon" disabled />
          <Card icon="fa-table-tennis" title="Tennis" subtitle="Coming soon" disabled />
          <Card icon="fa-bicycle" title="Cycling" subtitle="Coming soon" disabled />
        </div>
      </div>
    </div>
  )
}

function Card({ icon, title, subtitle, onClick, disabled }:{ icon:string; title:string; subtitle:string; onClick?:()=>void; disabled?:boolean }){
  const base = "rounded-lg border border-white/10 p-4 w-full text-left transition-colors"
  const state = disabled ? " opacity-50 cursor-not-allowed" : " hover:bg-white/5 cursor-pointer"
  return (
    <button className={base + state} onClick={disabled ? undefined : onClick} disabled={disabled}>
      <div className="flex items-center">
        <i className={`fas ${icon} mr-3`} />
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-sm text-[#9fb0b5]">{subtitle}</div>
        </div>
        {!disabled && <i className="fas fa-chevron-right ml-auto" />}
      </div>
    </button>
  )
}