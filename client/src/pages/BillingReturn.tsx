import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'

export default function BillingReturn() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const returnPath = safeReturnPath(params.get('return_path'))
  const target = params.get('target') || 'personal'
  const id = params.get('id') || ''
  const deepLink = `cpoint://billing_return?target=${encodeURIComponent(target)}&id=${encodeURIComponent(id)}&return_path=${encodeURIComponent(returnPath)}`

  const openApp = () => {
    window.location.href = deepLink
  }

  const continueWeb = () => {
    navigate(returnPath)
  }

  return (
    <div className="min-h-screen bg-black px-5 py-10 text-white">
      <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
        <div className="rounded-[28px] border border-white/12 bg-white/[0.04] p-7 shadow-2xl shadow-black/40">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#00CEC8]">Billing</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Return to C-Point</h1>
          <p className="mt-3 text-sm leading-6 text-white/65">
            Your Stripe billing page is closed. Open the app to continue, or continue on web if this browser is already logged in.
          </p>
          <div className="mt-7 space-y-3">
            {!Capacitor.isNativePlatform() && (
              <button
                type="button"
                onClick={openApp}
                className="w-full rounded-full bg-[#00CEC8] px-5 py-3 text-sm font-bold text-black"
              >
                Return to C-Point app
              </button>
            )}
            <button
              type="button"
              onClick={continueWeb}
              className="w-full rounded-full border border-white/15 px-5 py-3 text-sm font-bold text-white"
            >
              Continue on web
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/premium_dashboard'
  return value
}
