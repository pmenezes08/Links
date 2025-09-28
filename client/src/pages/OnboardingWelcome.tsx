import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function OnboardingWelcome(){
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    // Mobile-safe: prevent background scroll when modal open
    if (showModal) { document.body.style.overflow = 'hidden' } else { document.body.style.overflow = '' }
    return () => { document.body.style.overflow = '' }
  }, [showModal])

  function onExplore(){
    navigate('/premium_dashboard')
  }

  function onGetStarted(){
    setShowModal(true)
  }

  function onExit(){
    setShowModal(false)
    navigate('/premium_dashboard')
  }

  function onJoin(){
    const trimmed = (code || '').trim()
    if (!trimmed){ setError('Please enter a code.'); return }
    setError('')
    // Step 1: no backend call to avoid breaking; wire in next step
    alert('Thanks! We will connect this in the next step.')
    setShowModal(false)
    navigate('/premium_dashboard')
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="text-2xl font-bold">Welcome!</div>
        <div className="text-sm text-[#9fb0b5] mt-2">Connect with your community. Share updates, join groups, and get the most out of C‑Point.</div>
        <div className="mt-4 flex gap-3 flex-wrap">
          <button className="px-4 py-3 rounded-xl bg-[#4db6ac] text-black font-semibold" onClick={onGetStarted}>Get started</button>
          <button className="px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04]" onClick={onExplore}>Explore first</button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Do you have a community code?</div>
              <button className="text-[#9fb0b5] text-2xl" onClick={()=> setShowModal(false)}>&times;</button>
            </div>
            <div className="mt-3">
              <input
                value={code}
                onChange={(e)=> setCode(e.target.value)}
                placeholder="Enter community code"
                className="w-full px-3 py-3 rounded-xl border border-white/10 bg-white/[0.04]"
              />
              {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
              <div className="text-xs text-[#9fb0b5] mt-2">Enter the code provided by your community admin.</div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button className="px-4 py-2 rounded-lg border border-white/10 bg-white/[0.04]" onClick={onExit}>Exit</button>
              <button className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-semibold" onClick={onJoin}>Join</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

