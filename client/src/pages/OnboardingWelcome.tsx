import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function OnboardingWelcome(){
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)

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

  async function onJoin(){
    const trimmed = (code || '').trim()
    if (!trimmed){ setError('Please enter a code.'); return }
    setError('')
    setJoining(true)
    try{
      const body = new URLSearchParams({ community_code: trimmed })
      const resp = await fetch('/join_community', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      let data: any = null
      try { data = await resp.json() } catch { data = null }

      if (resp.ok && data?.success){
        const cid = data.community_id
        setShowModal(false)
        if (cid){
          navigate(`/community_feed_react/${cid}`)
        } else {
          navigate('/premium_dashboard')
        }
        return
      }

      // Handle common errors (e.g., 403 unverified email, invalid code, already a member)
      const msg = data?.error || (resp.status === 403 ? 'Please verify your email to join communities.' : 'Failed to join the community.')
      setError(msg)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="text-2xl font-bold">Welcome!</div>
        <div className="text-sm text-[#9fb0b5] mt-2">Connect with your community. Share updates, view announcements, answer to polls and much more.</div>
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
              <button className="px-4 py-2 rounded-lg border border-white/10 bg-white/[0.04]" onClick={onExit} disabled={joining}>Exit</button>
              <button className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-semibold" onClick={onJoin} disabled={joining}>{joining ? 'Joining…' : 'Join'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

