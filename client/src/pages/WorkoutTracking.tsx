import { useEffect } from 'react'
import { useHeader } from '../contexts/HeaderContext'

export default function WorkoutTracking(){
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Workout Tracking') }, [setTitle])

  return (
    <div className="min-h-screen bg-black text-white pt-14">
      <div className="max-w-3xl mx-auto p-4">
        <div className="text-lg font-semibold mb-3">Workout Tracking</div>
        <div className="text-[#9fb0b5] text-sm">Mobile-friendly tracker coming here.</div>
      </div>
    </div>
  )
}

