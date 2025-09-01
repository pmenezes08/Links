import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

type ExerciseSet = { weight: number; reps: number; created_at: string; source: string }
type Exercise = { id: number; name: string; muscle_group: string; sets_data: ExerciseSet[] }

async function fetchExercises(): Promise<{ success: boolean; exercises: Exercise[] }> {
  const r = await fetch('/get_workout_exercises', { credentials: 'include' })
  return r.json()
}

export default function Gym() {
  const [showTracking, setShowTracking] = useState(true)
  const { data, isLoading } = useQuery({ queryKey: ['gym-exercises'], queryFn: fetchExercises, enabled: showTracking })
  const exercises = data?.exercises ?? []

  return (
    <div className="min-h-screen bg-[#0b0f10] text-white">
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#333] flex items-center px-3 z-40 bg-black/50 backdrop-blur">
        <h1 className="text-lg font-semibold">Gym</h1>
      </div>

      <div className="pt-16 max-w-4xl mx-auto px-3">
        <div className="grid gap-3">
          <div className="rounded-lg border border-white/10 p-4 cursor-pointer hover:bg-white/5" onClick={() => (window.location.href = '/workout_generator')}>
            <div className="flex items-center">
              <i className="fas fa-magic mr-3" />
              <div>
                <div className="font-semibold">Workout Generator</div>
                <div className="text-sm text-[#9fb0b5]">Generate personalized workout plans</div>
              </div>
              <i className="fas fa-chevron-right ml-auto" />
            </div>
          </div>

          <div className="rounded-lg border border-white/10 p-4">
            <div className="flex items-center">
              <i className="fas fa-chart-line mr-3" />
              <div className="flex-1">
                <div className="font-semibold">Workout Tracking</div>
                <div className="text-sm text-[#9fb0b5]">Track your workouts, progress, and performance</div>
              </div>
              <button className="px-3 py-2 rounded border border-[#333]" onClick={() => setShowTracking((v) => !v)}>
                {showTracking ? 'Hide' : 'Show'}
              </button>
            </div>

            {showTracking && (
              <div className="mt-4">
                {isLoading ? (
                  <div className="text-sm text-[#9fb0b5]">Loading exercises…</div>
                ) : exercises.length === 0 ? (
                  <div className="text-sm text-[#9fb0b5]">No exercises yet. Add some to see your progress.</div>
                ) : (
                  <div className="space-y-3">
                    {exercises.map((ex) => (
                      <div key={ex.id} className="rounded border border-white/10">
                        <div className="px-3 py-2 font-medium">{ex.name} <span className="text-[#9fb0b5] text-xs">({ex.muscle_group})</span></div>
                        <div className="divide-y divide-white/10">
                          {ex.sets_data.slice(0, 5).map((s, idx) => (
                            <div key={idx} className="px-3 py-2 text-sm flex justify-between">
                              <span>{s.weight} kg × {s.reps}</span>
                              <span className="text-[#9fb0b5]">{s.created_at}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

