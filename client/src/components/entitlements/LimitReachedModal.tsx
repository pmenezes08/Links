import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EntitlementsError } from '../../utils/entitlementsError'

interface Props {
  err: EntitlementsError
  onClose: () => void
}

/**
 * Full-screen modal shown when a user triggers an action via a button
 * (feed reply, post summary, voice summary) and the backend denies it
 * due to entitlements. This is the "hard" surface — contrast with
 * `LimitReachedBubble` used inside ongoing chats.
 *
 * Maps each `reason` to a title + icon while the body text and CTA are
 * pulled straight from the backend so operators can edit them from the
 * Knowledge Base without a client deploy.
 */
export default function LimitReachedModal({ err, onClose }: Props) {
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
        return 'Steve is a Premium feature'
      case 'daily_cap':
        return '24-hour limit reached'
      case 'monthly_steve_cap':
        return 'Monthly Steve allowance reached'
      case 'monthly_whisper_cap':
        return 'Voice transcription limit reached'
      case 'community_pool_exhausted':
        return 'Community Steve pool exhausted'
      case 'community_suspended':
        return 'Community temporarily paused'
      case 'grace_expired':
        return 'Enterprise seat ended'
      default:
        return "You've hit a limit"
    }
  }

  const iconForReason = (): string => {
    switch (err.reason) {
      case 'premium_required':
        return 'fa-crown'
      case 'daily_cap':
        return 'fa-clock'
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
    const u = err.usage || {}
    const rows: { label: string; used: number | null; cap: number | null }[] = []
    if (u.monthly_steve_used != null || u.monthly_steve_cap != null) {
      rows.push({
        label: 'Steve uses this month',
        used: u.monthly_steve_used ?? 0,
        cap: u.monthly_steve_cap ?? null,
      })
    }
    if (u.daily_used != null || u.daily_cap != null) {
      rows.push({
        label: 'Steve uses (last 24h)',
        used: u.daily_used ?? 0,
        cap: u.daily_cap ?? null,
      })
    }
    if (u.whisper_minutes_used != null || u.whisper_minutes_cap != null) {
      rows.push({
        label: 'Voice minutes this month',
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
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
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
                  color: 'rgba(255,255,255,0.7)',
                  marginBottom: 4,
                }}
              >
                <span>{r.label}</span>
                <span>
                  {r.used ?? 0} / {r.cap == null ? '∞' : r.cap}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: pct >= 100 ? '#e57373' : pct >= 80 ? '#ffb74d' : '#4db6ac',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

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
          background: 'rgba(0,0,0,0.6)',
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
          border: '1px solid rgba(255,255,255,0.1)',
          background: '#111',
          padding: 24,
          color: '#fff',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
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
              background: 'rgba(77,182,172,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <i className={`fa-solid ${iconForReason()}`} style={{ color: '#4db6ac', fontSize: 24 }} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{titleForReason()}</h3>
        </div>

        <p
          style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.78)',
            textAlign: 'center',
            margin: '0 0 8px',
            lineHeight: 1.55,
          }}
        >
          {err.message}
        </p>

        {renderUsage()}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
          {err.cta?.label ? (
            <button
              onClick={handleCta}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 12,
                background: '#4db6ac',
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
            onClick={onClose}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
