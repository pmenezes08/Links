import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { EntitlementsError } from '../../utils/entitlementsError'

interface Props {
  err: EntitlementsError
  onClose: () => void
}

/** Keep aligned with `backend/blueprints/subscriptions.py` `_PREMIUM_FEATURE_BULLETS` / Personal card on Subscription Plans. */
const PREMIUM_BULLET_KEYS = [
  'entitlements.limit_modal.premium_bullet_1',
  'entitlements.limit_modal.premium_bullet_2',
  'entitlements.limit_modal.premium_bullet_3',
  'entitlements.limit_modal.premium_bullet_4',
] as const

/** Confirms current plan for Steve upgrade prompts (aligned with `err.tier` from the API). */
function planTierNotice(err: EntitlementsError, tr: (key: string) => string): string | null {
  if (err.reason !== 'premium_required') return null
  const tier = (err.tier || '').toLowerCase()
  if (tier === 'trial') return tr('entitlements.limit_modal.tier_trial')
  if (!tier || tier === 'free' || tier === 'anonymous' || tier === 'unknown') {
    return tr('entitlements.limit_modal.tier_free')
  }
  return null
}

function PremiumBenefitsList({ err }: { err: EntitlementsError }) {
  const { t } = useTranslation()
  if (err.reason !== 'premium_required') return null
  return (
    <div style={{ marginTop: 14, textAlign: 'left' }}>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--c-text-tertiary)',
          marginBottom: 8,
        }}
      >
        {t('entitlements.limit_modal.with_premium')}
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 13,
          color: 'var(--c-text-primary)',
          lineHeight: 1.55,
        }}
      >
        {PREMIUM_BULLET_KEYS.map((key) => (
          <li key={key} style={{ marginBottom: 6 }}>
            {t(key)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Full-screen modal shown when a user triggers an action via a button
 * (feed reply, post summary, voice summary) and the backend denies it
 * due to entitlements. This is the "hard" surface — contrast with
 * `LimitReachedBubble` used inside ongoing chats.
 *
 * Maps each `reason` to a title + icon. Body copy comes from the backend
 * (KB-editable) except `premium_required`, where we show your plan line plus the
 * subscription-aligned bullet list instead of the long default message.
 */
export default function LimitReachedModal({ err, onClose }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCta = () => {
    const url = err.cta?.url
    if (url && url.startsWith('/')) {
      navigate(url)
    } else if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    onClose()
  }

  const titleForReason = (): string => {
    switch (err.reason) {
      case 'premium_required':
        return t('entitlements.limit_modal.title_premium_required')
      case 'daily_cap':
        return t('entitlements.limit_modal.title_daily_cap')
      case 'upload_daily_limit':
        return 'Daily media limit reached'
      case 'upload_size_limit':
        return 'Media is too large'
      case 'monthly_steve_cap':
        return t('entitlements.limit_modal.title_monthly_steve_cap')
      case 'monthly_whisper_cap':
        return t('entitlements.limit_modal.title_monthly_whisper_cap')
      case 'community_pool_exhausted':
        return t('entitlements.limit_modal.title_community_pool_exhausted')
      case 'community_suspended':
        return t('entitlements.limit_modal.title_community_suspended')
      case 'grace_expired':
        return t('entitlements.limit_modal.title_grace_expired')
      default:
        return t('entitlements.limit_modal.title_default')
    }
  }

  const iconForReason = (): string => {
    switch (err.reason) {
      case 'premium_required':
        return 'fa-crown'
      case 'daily_cap':
      case 'upload_daily_limit':
        return 'fa-clock'
      case 'upload_size_limit':
        return 'fa-file-video'
      case 'monthly_steve_cap':
      case 'monthly_whisper_cap':
        return 'fa-hourglass-half'
      case 'community_pool_exhausted':
        return 'fa-users-slash'
      case 'community_suspended':
        return 'fa-ban'
      case 'grace_expired':
        return 'fa-hourglass-end'
      default:
        return 'fa-circle-exclamation'
    }
  }

  const renderUsage = () => {
    if (err.reason === 'premium_required') return null
    const u = err.usage || {}
    const rows: { label: string; used: number | null; cap: number | null }[] = []
    if (u.monthly_steve_used != null || u.monthly_steve_cap != null) {
      rows.push({
        label: t('entitlements.limit_modal.usage_steve_month'),
        used: u.monthly_steve_used ?? 0,
        cap: u.monthly_steve_cap ?? null,
      })
    }
    if (u.daily_used != null || u.daily_cap != null) {
      rows.push({
        label: t('entitlements.limit_modal.usage_steve_24h'),
        used: u.daily_used ?? 0,
        cap: u.daily_cap ?? null,
      })
    }
    if (u.whisper_minutes_used != null || u.whisper_minutes_cap != null) {
      rows.push({
        label: t('entitlements.limit_modal.usage_voice_month'),
        used: Math.round(u.whisper_minutes_used ?? 0),
        cap: u.whisper_minutes_cap ?? null,
      })
    }
    if (rows.length === 0) return null
    return (
      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 10,
          background: 'var(--c-skeleton-subtle)',
          border: '1px solid var(--c-border-default)',
        }}
      >
        {rows.map((r, i) => {
          const pct = r.cap && r.cap > 0 ? Math.min(100, Math.round(((r.used ?? 0) / r.cap) * 100)) : 100
          return (
            <div key={i} style={{ marginBottom: i === rows.length - 1 ? 0 : 10 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: 'var(--c-text-secondary)',
                  marginBottom: 4,
                }}
              >
                <span>{r.label}</span>
                <span>
                  {r.used ?? 0} / {r.cap == null ? '∞' : r.cap}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--c-skeleton-strong)' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: pct >= 100 ? '#e57373' : pct >= 80 ? '#ef5350' : 'var(--c-accent)',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const tierLine = planTierNotice(err, t)

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 999998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--c-bg-overlay)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 400,
          borderRadius: 16,
          border: '1px solid var(--c-accent)',
          background: 'var(--c-bg-app)',
          padding: 24,
          color: 'var(--c-text-primary)',
          boxShadow: 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 12px',
              borderRadius: '50%',
              background: 'var(--c-accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <i className={`fa-solid ${iconForReason()}`} style={{ color: 'var(--c-accent)', fontSize: 24 }} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{titleForReason()}</h3>
        </div>

        {tierLine ? (
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--c-text-primary)',
              textAlign: 'center',
              margin: '0 0 12px',
              lineHeight: 1.45,
            }}
          >
            {tierLine}
          </p>
        ) : null}

        {err.reason !== 'premium_required' ? (
          <p
            style={{
              fontSize: 14,
              color: 'var(--c-text-secondary)',
              textAlign: 'center',
              margin: '0 0 8px',
              lineHeight: 1.55,
            }}
          >
            {err.message}
          </p>
        ) : null}

        <PremiumBenefitsList err={err} />

        {renderUsage()}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
          {err.cta?.label ? (
            <button
              type="button"
              onClick={handleCta}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 12,
                background: 'var(--c-accent)',
                color: '#000',
                fontWeight: 600,
                fontSize: 14,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {err.cta.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 12,
              background: 'var(--c-hover-bg)',
              color: 'var(--c-text-secondary)',
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {t('entitlements.limit_modal.not_now')}
          </button>
        </div>
      </div>
    </div>
  )
}
