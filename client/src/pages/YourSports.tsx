import { useEffect } from 'react'
import { useHeader } from '../contexts/HeaderContext'

export default function YourSports(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Your Sports') }, [setTitle])

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