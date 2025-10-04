import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function OnboardingWelcome(){
  const navigate = useNavigate()
  const [cards, setCards] = useState<string[]>([])
  const [cardIndex, setCardIndex] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchDeltaX, setTouchDeltaX] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // Onboarding step modals
  const [step, setStep] = useState<1|2|3>(1)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')
  const [picFile, setPicFile] = useState<File | null>(null)
  const [picPreview, setPicPreview] = useState('')
  const [uploadingPic, setUploadingPic] = useState(false)
  const [communityMode, setCommunityMode] = useState<'join'|'create'>('join')
  const [joinCode, setJoinCode] = useState('')
  const [communityName, setCommunityName] = useState('')
  const [communityType, setCommunityType] = useState('general')
  const [communityError, setCommunityError] = useState('')
  const sentences = [
    'Welcome to the network where ideas connect people',
    'Share your thoughts, images, and connect through meaningful conversations.',
    'Connect with your world'
  ]
  const fallbackSlides = [
    'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?q=80&w=1600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1520975916090-3105956dac38?q=80&w=1600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1517423440428-a5a00ad493e8?q=80&w=1600&auto=format&fit=crop'
  ]

  // no modal state

  useEffect(() => {
    // Client instrumentation: log when onboarding is shown
    ;(async () => {
      try{
        await fetch('/api/client_log', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ level:'warn', type:'onboarding_mount', path: window.location.pathname }) })
      }catch{}
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      try{
        const r = await fetch('/welcome_cards')
        const j = await r.json().catch(()=>null)
        if (j && j.success && Array.isArray(j.cards)){
          setCards(j.cards.filter(Boolean))
        }
      }catch{} finally {
        setLoaded(true)
      }
    })()
  }, [])

  // Prefill display name with username
  useEffect(() => {
    ;(async () => {
      try{
        const r = await fetch('/api/profile_me', { credentials:'include' })
        const j = await r.json().catch(()=>null)
        if (j?.profile?.username){ setDisplayName(j.profile.username) }
      }catch{}
    })()
  }, [])

  // Manual scroll only (no autoplay)

  function onGetStarted(){
    setStep(1)
  }
  // no join/profile picture or resend flows

  return (
    <div className="h-screen overflow-hidden bg-black text-white flex items-center justify-center" style={{ height: '100dvh' }}>
      <div className="w-full max-w-xl px-4">
        <div className="mb-3">
          <div className="text-2xl font-bold">Community Point</div>
        </div>
        <div className="text-sm text-[#9fb0b5] mb-3" style={{ minHeight: '32px' }}>{sentences[cardIndex % sentences.length]}</div>

        <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/[0.03]">
          {!loaded ? (
            <div className="w-full h-[46vh] bg-white/[0.06] animate-pulse" />
          ) : (
            <div className="relative w-full h-[46vh]"
                 onTouchStart={(e)=>{ try{ setTouchStartX(e.touches[0].clientX); setTouchDeltaX(0) }catch{} }}
                 onTouchMove={(e)=>{ try{ if (touchStartX!=null){ setTouchDeltaX(e.touches[0].clientX - touchStartX) } }catch{} }}
                 onTouchEnd={()=>{
                   try{
                     const slides = (cards && cards.length) ? cards : fallbackSlides
                     const total = slides.length
                     if (Math.abs(touchDeltaX) > 40){
                       if (touchDeltaX < 0){ setCardIndex(i => (i + 1) % total) }
                       else { setCardIndex(i => (i - 1 + total) % total) }
                     }
                   }finally{
                     setTouchStartX(null); setTouchDeltaX(0)
                   }
                 }}>
              <div className="absolute inset-0 flex transition-transform duration-500"
                   style={{ transform: `translateX(calc(-${cardIndex * 100}% + ${touchDeltaX}px))` }}>
                {((cards && cards.length) ? cards : fallbackSlides).map((src, i) => (
                  <div key={i} className="min-w-full h-full">
                    <img src={src} alt="welcome"
                         className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
              {(((cards && cards.length) ? cards : fallbackSlides).length) > 1 && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
                  {((cards && cards.length) ? cards : fallbackSlides).map((_, i) => (
                    <button key={i}
                            aria-label={`Go to slide ${i+1}`}
                            onClick={() => setCardIndex(i)}
                            className={`w-2.5 h-2.5 rounded-full ${cardIndex===i ? 'bg-[#4db6ac]' : 'bg-white/30'}`} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-4">
          <button className="px-4 py-3 rounded-xl bg-[#4db6ac] text-black font-semibold" onClick={onGetStarted}>Get started</button>
        </div>

        {step === 1 && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
            <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
              <div className="text-lg font-semibold mb-2">Choose your display name</div>
              <div className="text-xs text-[#9fb0b5] mb-3">By default, your display name matches your username. You can change it now.</div>
              <input value={displayName} onChange={(e)=> setDisplayName(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-white/10 bg-white/[0.04]" />
              {nameError && <div className="text-xs text-red-400 mt-2">{nameError}</div>}
              <div className="mt-4 flex gap-2 justify-end">
                <button className="px-4 py-2 rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setStep(2)} disabled={savingName}>Skip</button>
                <button className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-semibold" disabled={savingName} onClick={async()=>{
                  setNameError(''); setSavingName(true)
                  try{
                    const fd = new FormData()
                    fd.append('display_name', displayName.trim())
                    const r = await fetch('/update_public_profile', { method:'POST', credentials:'include', body: fd })
                    if (!r.ok){ setNameError('Failed to save name'); return }
                    setStep(2)
                  }catch{ setNameError('Network error'); } finally { setSavingName(false) }
                }}>{savingName ? 'Saving…' : 'Save & continue'}</button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
            <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
              <div className="text-lg font-semibold mb-2">Add a profile picture</div>
              <div className="text-xs text-[#9fb0b5] mb-3">Help people recognize you. You can change this later in your profile.</div>
              <input type="file" accept="image/*" onChange={(e)=>{
                const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
                setPicFile(f as any)
                if (f){ try{ setPicPreview(URL.createObjectURL(f)) }catch{ setPicPreview('') } }
              }} />
              {picPreview && (
                <div className="mt-3 flex items-center justify-center">
                  <img src={picPreview} className="max-h-40 rounded-lg border border-white/10" />
                </div>
              )}
              <div className="mt-4 flex gap-2 justify-end">
                <button className="px-4 py-2 rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> setStep(3)} disabled={uploadingPic}>Skip</button>
                <button className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-semibold" disabled={uploadingPic || !picFile} onClick={async()=>{
                  if (!picFile) return; setUploadingPic(true)
                  try{
                    const fd = new FormData(); fd.append('profile_picture', picFile)
                    const r = await fetch('/upload_profile_picture', { method:'POST', credentials:'include', body: fd })
                    const j = await r.json().catch(()=>null)
                    if (!r.ok || !j?.success){ alert(j?.error || 'Failed to upload'); return }
                    setStep(3)
                  }catch{ alert('Network error') } finally { setUploadingPic(false) }
                }}>{uploadingPic ? 'Uploading…' : 'Upload & continue'}</button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
            <div className="w-[92%] max-w-md rounded-xl border border-white/10 bg-[#0b0f10] p-5">
              <div className="text-lg font-semibold mb-2">Get started</div>
              <div className="text-xs text-[#9fb0b5] mb-3">Join an existing community with a code, or create a new one.</div>
              <div className="flex gap-2 mb-3">
                <button className={`px-3 py-2 rounded-lg border ${communityMode==='join' ? 'border-[#4db6ac] text-[#4db6ac]' : 'border-white/15 text-white/80'}`} onClick={()=> setCommunityMode('join')}>Join</button>
                <button className={`px-3 py-2 rounded-lg border ${communityMode==='create' ? 'border-[#4db6ac] text-[#4db6ac]' : 'border-white/15 text-white/80'}`} onClick={()=> setCommunityMode('create')}>Create</button>
              </div>
              {communityMode === 'join' ? (
                <div>
                  <input value={joinCode} onChange={(e)=> setJoinCode(e.target.value)} placeholder="Enter community code" className="w-full px-3 py-3 rounded-xl border border-white/10 bg-white/[0.04]" />
                </div>
              ) : (
                <div className="space-y-2">
                  <input value={communityName} onChange={(e)=> setCommunityName(e.target.value)} placeholder="Community name" className="w-full px-3 py-3 rounded-xl border border-white/10 bg-white/[0.04]" />
                  <select value={communityType} onChange={(e)=> setCommunityType(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-white/10 bg-white/[0.04]">
                    <option value="general">General</option>
                    <option value="gym">Gym</option>
                    <option value="crossfit">Crossfit</option>
                  </select>
                </div>
              )}
              {communityError && <div className="text-xs text-red-400 mt-2">{communityError}</div>}
              <div className="mt-4 flex gap-2 justify-end">
                <button className="px-4 py-2 rounded-lg border border-white/10 bg-white/[0.04]" onClick={()=> { setStep(0 as any); navigate('/premium_dashboard') }}>Skip</button>
                <button className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-semibold" onClick={async()=>{
                  setCommunityError('')
                  try{
                    if (communityMode==='join'){
                      const body = new URLSearchParams({ community_code: joinCode.trim() })
                      const r = await fetch('/join_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body })
                      const j = await r.json().catch(()=>null)
                      if (!r.ok || !j?.success){ setCommunityError(j?.error || 'Failed to join'); return }
                      navigate(`/community_feed_react/${j.community_id}`)
                    } else {
                      const fd = new URLSearchParams({ name: communityName.trim(), type: communityType })
                      const r = await fetch('/create_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                      const j = await r.json().catch(()=>null)
                      if (!r.ok || !j?.success){ setCommunityError(j?.error || 'Failed to create'); return }
                      navigate(`/community_feed_react/${j.community_id}`)
                    }
                  }catch{ setCommunityError('Network error') }
                }}>Continue</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

