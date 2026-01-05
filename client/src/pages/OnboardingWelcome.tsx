import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function OnboardingWelcome(){
  const navigate = useNavigate()
  const [cards, setCards] = useState<string[]>([])
  const [cardIndex, setCardIndex] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchDeltaX, setTouchDeltaX] = useState(0)
  const [loaded, setLoaded] = useState(false)
  
  const sentences = [
    'Enter the network where ideas connect people.',
    'Share your thoughts, images, and connect through meaningful conversations.',
    'Connect with your world'
  ]

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
          // Filter out any empty strings and use only server-provided cards
          const validCards = j.cards.filter((c: string) => c && c.trim())
          setCards(validCards)
        }
      }catch{} finally {
        setLoaded(true)
      }
    })()
  }, [])

  function onGetStarted(){ navigate('/login') }

  // Only show carousel if we have cards
  const hasCards = cards && cards.length > 0

  return (
    <div className="h-screen overflow-hidden bg-black text-white flex items-center justify-center" style={{ height: '100dvh' }}>
      <div className="w-full max-w-xl px-4">
        <div className="mb-3">
          <div className="text-2xl font-bold">Welcome to Connection Point</div>
        </div>
        <div className="text-sm text-[#9fb0b5] mb-3" style={{ minHeight: '32px' }}>
          {sentences[cardIndex % sentences.length]}
        </div>

        <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/[0.03]">
          {!loaded ? (
            // Loading state
            <div className="w-full h-[46vh] bg-white/[0.06] animate-pulse" />
          ) : hasCards ? (
            // Show carousel with server-provided cards
            <div className="relative w-full h-[46vh]"
                 onTouchStart={(e)=>{ try{ setTouchStartX(e.touches[0].clientX); setTouchDeltaX(0) }catch{} }}
                 onTouchMove={(e)=>{ try{ if (touchStartX!=null){ setTouchDeltaX(e.touches[0].clientX - touchStartX) } }catch{} }}
                 onTouchEnd={()=>{
                   try{
                     const total = cards.length
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
                {cards.map((src, i) => (
                  <div key={i} className="min-w-full h-full bg-gradient-to-br from-[#1a1a2e] to-[#16213e]">
                    <img 
                      src={src} 
                      alt="welcome"
                      className="w-full h-full object-cover"
                      loading="eager"
                      decoding="async"
                    />
                  </div>
                ))}
              </div>
              {cards.length > 1 && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
                  {cards.map((_, i) => (
                    <button key={i}
                            aria-label={`Go to slide ${i+1}`}
                            onClick={() => setCardIndex(i)}
                            className={`w-2.5 h-2.5 rounded-full ${cardIndex===i ? 'bg-[#4db6ac]' : 'bg-white/30'}`} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Placeholder when no cards are uploaded
            <div className="w-full h-[46vh] bg-gradient-to-br from-[#1a1a2e] to-[#16213e] flex items-center justify-center">
              <div className="text-center text-white/40">
                <i className="fa-solid fa-images text-4xl mb-2" />
                <p className="text-sm">Welcome images coming soon</p>
              </div>
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
