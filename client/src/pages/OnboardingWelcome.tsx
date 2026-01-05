import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function OnboardingWelcome(){
  const navigate = useNavigate()
  const [cards, setCards] = useState<string[]>([])
  const [cardIndex, setCardIndex] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchDeltaX, setTouchDeltaX] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // Remove onboarding modals logic from welcome (now handled on dashboard)
  const sentences = [
    'Enter the network where ideas connect people.',
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
        // Add cache-buster to prevent browser/service worker caching
        const r = await fetch(`/welcome_cards?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        })
        const j = await r.json().catch(()=>null)
        if (j && j.success && Array.isArray(j.cards)){
          setCards(j.cards.filter(Boolean))
        }
      }catch{} finally {
        setLoaded(true)
      }
    })()
  }, [])

  // No profile gating on welcome

  // Manual scroll only (no autoplay)

  function onGetStarted(){ navigate('/login') }
  // no join/profile picture or resend flows

  return (
    <div className="h-screen overflow-hidden bg-black text-white flex items-center justify-center" style={{ height: '100dvh' }}>
      <div className="w-full max-w-xl px-4">
        <div className="mb-3">
          <div className="text-2xl font-bold">Welcome to Connection Point</div>
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
                    <img 
                      src={src} 
                      alt="welcome"
                      className="w-full h-full object-cover"
                      loading="eager"
                      decoding="async"
                      crossOrigin="anonymous"
                    />
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

      </div>
    </div>
  )
}

