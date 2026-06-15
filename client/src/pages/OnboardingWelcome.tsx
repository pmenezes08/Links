import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const WELCOME_CARDS_CACHE_KEY = 'cpoint:welcome_cards'

function readCachedWelcomeCards(): string[] {
  try {
    const raw = localStorage.getItem(WELCOME_CARDS_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed)
      ? parsed.filter((c: unknown): c is string => typeof c === 'string' && !!c.trim())
      : []
  } catch {
    return []
  }
}

export default function OnboardingWelcome(){
  const navigate = useNavigate()
  const { t } = useTranslation()
  // Render last-known cards instantly (stale-while-revalidate); the effect below
  // refreshes them in the background. Avoids the blank → fetch → image-load wait
  // on every open.
  const cachedCards = useMemo(readCachedWelcomeCards, [])
  const [cards, setCards] = useState<string[]>(cachedCards)
  const [cardIndex, setCardIndex] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchDeltaX, setTouchDeltaX] = useState(0)
  const [loaded, setLoaded] = useState(cachedCards.length > 0)
  const [imagesLoaded, setImagesLoaded] = useState<Record<number, boolean>>({})

  const sentences = t('onboarding.welcome.carousel', { returnObjects: true }) as string[]

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
        // Revalidate in the background. We render the cached cards instantly
        // above, so a fresh fetch (no-store, so admin updates show next paint)
        // just reconciles the list and re-caches it for the next open.
        const r = await fetch('/welcome_cards', {
          cache: 'no-store',
          headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }
        })
        const j = await r.json().catch(()=>null)
        if (j && j.success && Array.isArray(j.cards)){
          // Filter out any empty strings and use only server-provided cards
          const validCards = j.cards.filter((c: string) => c && c.trim())
          setCards(validCards)
          try { localStorage.setItem(WELCOME_CARDS_CACHE_KEY, JSON.stringify(validCards)) } catch {}
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
    <div className="min-h-[100dvh] overflow-y-auto bg-c-bg-app text-c-text-primary flex items-center justify-center py-6">
      <div className="w-full max-w-xl px-4">
        <div className="mb-3">
          <div className="text-2xl font-bold">{t('onboarding.welcome.title')}</div>
        </div>
        <div className="text-sm text-c-text-tertiary mb-3" style={{ minHeight: '32px' }}>
          {sentences[cardIndex % sentences.length]}
        </div>

        <div className="rounded-2xl border border-c-border overflow-hidden bg-c-bg-surface">
          {!loaded ? (
            // Loading state
            <div className="w-full h-[46vh] bg-c-bg-surface animate-pulse" />
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
                  <div key={i} className="min-w-full h-full bg-c-bg-surface relative">
                    {/* Show subtle loading shimmer only if image not loaded yet */}
                    {!imagesLoaded[i] && (
                      <div className="absolute inset-0 bg-white/[0.03] animate-pulse" />
                    )}
                    <img 
                      src={src} 
                      alt="welcome"
                      className={`w-full h-full object-cover transition-opacity duration-300 ${imagesLoaded[i] ? 'opacity-100' : 'opacity-0'}`}
                      loading="eager"
                      decoding="async"
                      onLoad={() => setImagesLoaded(prev => ({ ...prev, [i]: true }))}
                    />
                  </div>
                ))}
              </div>
              {cards.length > 1 && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
                  {cards.map((_, i) => (
                    <button key={i}
                            aria-label={t('onboarding.welcome.slide_label', { number: i + 1 })}
                            onClick={() => setCardIndex(i)}
                            className={`w-2.5 h-2.5 rounded-full ${cardIndex===i ? 'bg-cpoint-turquoise' : 'bg-white/30'}`} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Placeholder when no cards are uploaded
            <div className="w-full h-[46vh] bg-c-bg-surface flex items-center justify-center">
              <div className="text-center text-c-text-tertiary">
                <i className="fa-solid fa-images text-4xl mb-2" />
                <p className="text-sm">{t('onboarding.welcome.images_coming_soon')}</p>
              </div>
            </div>
          )}
        </div>
        <div className="mt-4">
          <button className="px-4 py-3 rounded-xl bg-cpoint-turquoise text-c-text-on-accent font-semibold" onClick={onGetStarted}>{t('onboarding.welcome.get_started')}</button>
        </div>
      </div>
    </div>
  )
}
