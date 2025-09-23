import { useEffect } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

export default function Gym() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  useEffect(() => { setTitle('Gym') }, [setTitle])

  return (
    <div className="bg-[#0b0f10] text-white px-3 py-4">
      <div className="max-w-4xl mx-auto grid gap-3">
        <button
          className="rounded-lg border border-white/10 p-4 hover:bg-white/5 w-full text-left"
          onClick={() => navigate('/communities')}
        >
          <div className="flex items-center">
            <i className="fas fa-home mr-3" />
            <div>
              <div className="font-semibold">Home</div>
              <div className="text-sm text-[#9fb0b5]">Go to your communities</div>
            </div>
            <i className="fas fa-chevron-right ml-auto" />
          </div>
        </button>

        <button
          className="rounded-lg border border-white/10 p-4 hover:bg-white/5 w-full text-left"
          onClick={() => (window.location.href = '/workout_tracking')}
        >
          <div className="flex items-center">
            <i className="fas fa-chart-line mr-3" />
            <div>
              <div className="font-semibold">Workout Tracking</div>
              <div className="text-sm text-[#9fb0b5]">Track your workouts, progress, and performance</div>
            </div>
            <i className="fas fa-chevron-right ml-auto" />
          </div>
        </button>
      </div>
    </div>
  )
}

