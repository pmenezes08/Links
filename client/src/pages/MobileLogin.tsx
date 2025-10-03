import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function MobileLogin() {
  const navigate = useNavigate()
  const [showForgot, setShowForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installEvt, setInstallEvt] = useState<any>(null)
  const [isStandalone, setIsStandalone] = useState<boolean>(false)
  const [isIOS, setIsIOS] = useState<boolean>(false)
  const [showInstall, setShowInstall] = useState(false)
  const [installMode, setInstallMode] = useState<'android'|'ios'|null>(null)

  // If already authenticated, skip login
  useEffect(() => {
    async function check(){
      try{
        const r = await fetch('/api/profile_me', { credentials:'include' })
        if (r.status === 403){
          navigate('/verify_required', { replace: true })
          return
        }
        if (r.ok){
          const j = await r.json()
          if (j && j.username){
            // Try to infer onboarding state: if user has no communities, send to /onboarding
            try{
              const ht = await fetch('/api/home_timeline', { credentials:'include' })
              const hj = await ht.json().catch(()=>null)
              const hasCommunities = Boolean(hj?.admin_communities?.length || hj?.communities_list?.length)
              if (!hasCommunities){
                // Direct fix: do not redirect here; let dashboard handle first-time UI
                return
              }
            }catch{}
            navigate('/premium_dashboard', { replace: true })
            return
          }
        }
      }catch{}
    }
    check()
  }, [navigate])

  // Read error from query string (e.g., /?error=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const e = params.get('error')
    setError(e)
  }, [])

  // PWA install prompt
  useEffect(() => {
    try{
      const checkStandalone = () => {
        const mql = window.matchMedia && window.matchMedia('(display-mode: standalone)')
        const standalone = (mql && mql.matches) || (navigator as any).standalone === true
        setIsStandalone(!!standalone)
      }
      checkStandalone()
      const onChange = () => checkStandalone()
      try{ window.matchMedia('(display-mode: standalone)').addEventListener('change', onChange) }catch{}
      const onBIP = (e: any) => { e.preventDefault(); setInstallEvt(e) }
      const onInstalled = () => { setInstallEvt(null); setIsStandalone(true) }
      window.addEventListener('beforeinstallprompt', onBIP as any)
      window.addEventListener('appinstalled', onInstalled as any)
      setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent))
      return () => {
        try{ window.matchMedia('(display-mode: standalone)').removeEventListener('change', onChange) }catch{}
        window.removeEventListener('beforeinstallprompt', onBIP as any)
        window.removeEventListener('appinstalled', onInstalled as any)
      }
    }catch{}
  }, [])

  async function handleInstall(){
    try{
      setInstallMode(isIOS ? 'ios' : 'android')
      setShowInstall(true)
    }catch{}
  }

  // Allow natural page scroll (no viewport locking)

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    try {
      await fetch('/request_password_reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      })
    } catch {}
    setResetSent(true)
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white p-5">
      <div className="w-full max-w-xs border border-white/10 rounded-xl p-6 bg-white/5 backdrop-blur">
        <div className="text-center mb-5">
          <h1 className="text-lg font-semibold">C.Point</h1>
          <p className="text-xs text-white/60 mt-1">Sign in to your account</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500 text-red-400 bg-red-500/10 px-3 py-2 text-sm text-center">
            {error}
          </div>
        )}

        <form method="POST" action="/" className="space-y-3">
          <div>
            <input
              type="text"
              name="username"
              placeholder="Username"
              required
              className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-3 text-base outline-none focus:border-teal-400/70"
            />
          </div>
          <button type="submit" className="w-full rounded-lg bg-teal-400 text-white py-2 text-sm font-medium active:opacity-90">Sign In</button>
        </form>

        <div className="text-center mt-3">
          <button onClick={() => { setShowForgot(true); setResetSent(false) }} className="text-teal-300 text-sm">Forgot Password?</button>
        </div>

        <div className="flex items-center gap-3 my-4 text-white/40 text-[12px]">
          <div className="flex-1 h-px bg-white/10" />
          <span>or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <a href="/signup" className="block w-full text-center rounded-lg border border-white/10 bg-white/5 py-2 text-sm">Create Account</a>

        <div className="flex items-center gap-3 my-4 text-white/40 text-[12px]">
          <div className="flex-1 h-px bg-white/10" />
          <span>get the app</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {(!isStandalone) ? (
          <button type="button" onClick={handleInstall} className="block w-full text-center rounded-lg border border-white/10 bg-white/5 py-2 text-sm">Install App</button>
        ) : null}
      </div>

      {showForgot && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-[90%] max-w-sm bg-[#1a1a1a] border border-[#333] rounded-xl">
            <div className="flex items-center justify-between p-4 border-b border-[#333]">
              <h2 className="text-white text-base font-semibold">Reset Password</h2>
              <button className="text-[#999] text-2xl" onClick={() => setShowForgot(false)}>&times;</button>
            </div>
            <div className="p-4">
              {!resetSent ? (
                <>
                  <p className="text-white/70 text-sm mb-4">Enter your email address. We'll send you a link to reset your password.</p>
                  <form onSubmit={submitReset} className="space-y-3">
                    <input
                      type="email"
                      placeholder="Email address"
                      value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      required
                      className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none focus:border-teal-400/70"
                    />
                    <button type="submit" className="w-full rounded-lg bg-teal-400 text-white py-2 text-sm font-medium active:opacity-90">Send Reset Link</button>
                  </form>
                </>
              ) : (
                <>
                  <div className="w-full rounded-md border border-teal-500 text-teal-400 bg-teal-500/10 px-3 py-2 text-sm text-center">Reset link sent! Check your email.</div>
                  <p className="text-white/70 text-sm mt-4 text-center">If an account exists with the provided information, you will receive an email with instructions to reset your password.</p>
                  <button className="w-full mt-4 rounded-lg border border-white/10 bg-white/5 py-2 text-sm" onClick={() => setShowForgot(false)}>Close</button>
                </>
              )}

  {/* Install modal */}
  {showInstall && (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowInstall(false)}>
      <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] text-white shadow-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-base font-semibold">Install C.Point</div>
          <button aria-label="Close" className="text-white/60 hover:text-white" onClick={()=> setShowInstall(false)}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        {installMode === 'android' ? (
          <div>
            <p className="text-sm text-white/75 mb-3">Add the app to your home screen for a faster, full-screen experience.</p>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button type="button" className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/5 text-sm" onClick={()=> setShowInstall(false)}>Maybe later</button>
              <button type="button" className={`px-3 py-2 rounded-lg ${installEvt? 'bg-[#4db6ac] hover:brightness-110 text-black' : 'bg-white/10 text-white/50 cursor-not-allowed'} text-sm`}
                onClick={async()=>{
                  try{
                    if (installEvt && typeof installEvt.prompt === 'function'){
                      await installEvt.prompt()
                      try{ await installEvt.userChoice }catch{}
                      setInstallEvt(null)
                    }
                  }finally{
                    setShowInstall(false)
                  }
                }}
                disabled={!installEvt}
              >Install now</button>
            </div>
            {!installEvt && (
              <div className="mt-3 text-xs text-white/60">
                Install prompt not available yet. Try reloading the page, or use the browser menu → <strong>Add to Home screen</strong>.
              </div>
            )}
          </div>
        ) : null}
        {installMode === 'ios' ? (
          <div>
            <p className="text-sm text-white/75 mb-3">On iPhone/iPad:</p>
            <ol className="space-y-2 text-sm text-white/85">
              <li className="flex items-center gap-2">
                <i className="fa-solid fa-share-from-square text-[#4db6ac]" />
                <span>Tap <strong>Share</strong> in Safari</span>
              </li>
              <li className="flex items-center gap-2">
                <i className="fa-solid fa-plus text-[#4db6ac]" />
                <span>Select <strong>Add to Home Screen</strong></span>
              </li>
            </ol>
            <div className="text-xs text-white/60 mt-3">Tip: If you don’t see the option, scroll the sheet to find it.</div>
            <div className="flex items-center justify-end mt-4">
              <button className="px-3 py-2 rounded-lg border border-white/15 hover:bg-white/5 text-sm" onClick={()=> setShowInstall(false)}>Got it</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

