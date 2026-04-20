import { useNavigate } from 'react-router-dom'
import type { EntitlementsError } from '../../utils/entitlementsError'

interface Props {
  err: EntitlementsError
  onClose?: () => void
  /** When true, render with tighter spacing suited for a chat bubble rail. */
  compact?: boolean
}

/**
 * Inline system bubble surfaced in DM Steve and group chat threads when
 * the user's Steve limit is hit. Renders the canonical `entitlements_error`
 * payload with a single CTA button.
 *
 * Used for ongoing conversational surfaces — contrasts with
 * `LimitReachedModal` which full-screens the user for button-triggered
 * actions (feed / post summary / voice summary).
 */
export default function LimitReachedBubble({ err, onClose, compact = false }: Props) {
  const navigate = useNavigate()

  const handleCta = () => {
    const url = err.cta?.url
    if (url && url.startsWith('/')) {
      navigate(url)
    } else if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    onClose?.()
  }

  const iconForReason = () => {
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

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: compact ? 12 : 14,
        margin: compact ? '6px 0' : '10px 0',
        borderRadius: 12,
        background: 'rgba(77, 182, 172, 0.08)',
        border: '1px solid rgba(77, 182, 172, 0.25)',
        color: 'rgba(255,255,255,0.88)',
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(77, 182, 172, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#4db6ac',
        }}
      >
        <i className={`fa-solid ${iconForReason()}`} style={{ fontSize: 15 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          Steve limit reached
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: 'rgba(255,255,255,0.75)' }}>
          {err.message}
        </div>
        {err.cta?.label ? (
          <button
            onClick={handleCta}
            style={{
              marginTop: 10,
              padding: '8px 14px',
              borderRadius: 10,
              background: '#4db6ac',
              color: '#000',
              fontWeight: 600,
              fontSize: 13,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {err.cta.label}
          </button>
        ) : null}
      </div>
      {onClose ? (
        <button
          onClick={onClose}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      ) : null}
    </div>
  )
}
