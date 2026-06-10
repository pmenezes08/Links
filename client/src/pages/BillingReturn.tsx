import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'

export default function BillingReturn() {
  const { t } = useTranslation()
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
    navigate(returnPath, { replace: true })
  }

  return (
    <div className="min-h-screen bg-c-bg-app px-5 py-10 text-c-text-primary">
      <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
        <div className="rounded-[28px] border border-c-border bg-c-bg-surface p-7 shadow-2xl shadow-black/40">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#00CEC8]">{t('billing.return_page.badge')}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{t('billing.return_page.title')}</h1>
          <p className="mt-3 text-sm leading-6 text-c-text-tertiary">{t('billing.return_page.body')}</p>
          <div className="mt-7 space-y-3">
            {!Capacitor.isNativePlatform() ? (
              <button
                type="button"
                onClick={openApp}
                className="w-full rounded-full bg-[#00CEC8] px-5 py-3 text-sm font-bold text-black"
              >
                {t('billing.return_page.open_app')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={continueWeb}
              className="w-full rounded-full border border-c-border px-5 py-3 text-sm font-bold text-c-text-primary"
            >
              {t('billing.return_page.continue_web')}
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
