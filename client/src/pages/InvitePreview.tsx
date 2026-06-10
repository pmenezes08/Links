import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import { refreshDashboardCommunities } from '../utils/dashboardCache'
import { triggerDashboardServerPull } from '../utils/serverPull'
import { useUserProfile } from '../contexts/UserProfileContext'

type InvitePreviewPayload = {
  success?: boolean
  error?: string
  error_code?: string
  message_key?: string
  community_id?: number
  community_name?: string
  invited_by_username?: string
  expires_at?: string
  expired?: boolean
  used?: boolean
  status?: string
  already_member?: boolean
  recipient_bound?: boolean
}

function formatExpiry(value?: string) {
  if (!value) return ''
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function InvitePreview() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { profile, refresh } = useUserProfile()
  const [invite, setInvite] = useState<InvitePreviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')

  const encodedToken = useMemo(() => encodeURIComponent(token), [token])
  const isAuthenticated = Boolean((profile as any)?.username)
  const expiryText = formatExpiry(invite?.expires_at)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setErrorCode('')
    fetch(`/api/invite_preview/${encodedToken}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async response => {
        const data = await response.json().catch(() => null)
        if (!cancelled) {
          setInvite(data || { success: false, error: t('communities.invite_preview.load_failed') })
        }
      })
      .catch(() => {
        if (!cancelled) setInvite({ success: false, error: t('communities.invite_preview.load_failed') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [encodedToken, t])

  async function acceptInvite() {
    if (!isAuthenticated) {
      navigate(`/login?invite=${encodedToken}`)
      return
    }
    setWorking(true)
    setError('')
    setErrorCode('')
    try {
      const response = await fetch(`/api/community/invites/token/${encodedToken}/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) {
        setError(data?.error || data?.message || t('communities.invite_preview.accept_failed'))
        setErrorCode(data?.error_code || data?.message_key || '')
        return
      }
      await triggerDashboardServerPull()
      await refreshDashboardCommunities()
      await refresh()
      navigate(data.next_url || `/community_feed_react/${data.community_id}`, { replace: true })
    } catch {
      setError(t('communities.invite_preview.accept_retry'))
      setErrorCode('')
    } finally {
      setWorking(false)
    }
  }

  async function declineInvite() {
    if (!isAuthenticated) {
      navigate('/welcome', { replace: true })
      return
    }
    setWorking(true)
    try {
      await fetch(`/api/community/invites/token/${encodedToken}/decline`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      navigate('/premium_dashboard', { replace: true })
    } finally {
      setWorking(false)
    }
  }

  const expired = invite?.expired || invite?.error_code === 'invite_expired'
  const emailMismatch =
    errorCode === 'communities.invite.email_mismatch' || error.toLowerCase().includes('different email')
  const unavailable = !invite?.success || expired || invite?.used || (invite?.status && invite.status !== 'pending')

  return (
    <div className="min-h-screen bg-c-bg-app px-4 py-8 text-c-text-primary flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-c-border bg-c-bg-elevated/95 p-6 shadow-2xl">
        <div className="mb-6 flex justify-center">
          <BrandLogo className="h-10 w-auto" />
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-28 rounded-2xl bg-c-hover-bg animate-pulse" />
            <div className="h-5 rounded bg-c-hover-bg animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-c-hover-bg animate-pulse" />
          </div>
        ) : unavailable ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-c-hover-bg">
              <i className="fa-regular fa-envelope-open text-xl text-c-text-tertiary" />
            </div>
            <h1 className="text-xl font-semibold">
              {expired ? t('communities.invite_preview.expired_title') : t('communities.invite_preview.unavailable_title')}
            </h1>
            <p className="mt-2 text-sm text-c-text-secondary">
              {expired
                ? t('communities.invite_preview.expired_body')
                : invite?.error || t('communities.invite_preview.unavailable_body_fallback')}
            </p>
            {expiryText ? (
              <p className="mt-3 text-xs text-c-text-tertiary">
                {t('communities.invite_preview.expired_at', { date: expiryText })}
              </p>
            ) : null}
            <button
              className="mt-6 w-full rounded-xl border border-c-border bg-c-hover-bg px-4 py-3 text-sm font-semibold"
              onClick={() => navigate('/welcome', { replace: true })}
            >
              {t('communities.invite_preview.back_to_c_point')}
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 rounded-2xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/10 p-5 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-cpoint-turquoise/20 text-cpoint-turquoise">
                <i className="fa-solid fa-user-plus text-2xl" />
              </div>
              <p className="text-xs uppercase tracking-wide text-c-text-tertiary">{t('communities.invite_preview.invitation_label')}</p>
              <h1 className="mt-2 text-2xl font-semibold">{invite.community_name}</h1>
              <p className="mt-2 text-sm text-c-text-secondary">
                {invite.invited_by_username
                  ? t('communities.invite_preview.invited_by', { username: invite.invited_by_username })
                  : t('communities.invite_preview.invited_generic')}
              </p>
            </div>

            {invite.already_member ? (
              <button
                className="w-full rounded-xl bg-cpoint-turquoise px-4 py-3 text-sm font-semibold text-black"
                onClick={() => navigate(`/community_feed_react/${invite.community_id}`, { replace: true })}
              >
                {t('communities.invite_preview.open_community')}
              </button>
            ) : (
              <div className="space-y-3">
                {expiryText ? (
                  <p className="text-center text-xs text-c-text-tertiary">
                    {t('communities.invite_preview.valid_until', { date: expiryText })}
                  </p>
                ) : null}
                {error ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {emailMismatch ? t('communities.invite_preview.email_mismatch') : error}
                  </div>
                ) : null}
                <button
                  className="w-full rounded-xl bg-cpoint-turquoise px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                  disabled={working}
                  onClick={acceptInvite}
                >
                  {working
                    ? t('communities.invite_preview.joining')
                    : isAuthenticated
                      ? t('communities.invite_preview.join_named', { name: invite.community_name })
                      : t('communities.invite_preview.sign_in_to_accept')}
                </button>
                {!isAuthenticated ? (
                  <button
                    className="w-full rounded-xl border border-c-border bg-c-hover-bg px-4 py-3 text-sm font-semibold text-c-text-primary"
                    onClick={() => navigate(`/signup?invite=${encodedToken}`)}
                  >
                    {t('communities.invite_preview.create_account')}
                  </button>
                ) : (
                  <button
                    className="w-full rounded-xl border border-c-border bg-c-hover-bg px-4 py-3 text-sm text-c-text-primary disabled:opacity-50"
                    disabled={working}
                    onClick={declineInvite}
                  >
                    {t('communities.invite_preview.not_now')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
