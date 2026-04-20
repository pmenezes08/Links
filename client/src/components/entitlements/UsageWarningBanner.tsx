import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EntitlementsUsage } from '../../hooks/useEntitlements'

interface Props {
  usage: EntitlementsUsage | null
  /** Optional scope hint (e.g. "dm" or "group") for future A/B copy. */
  surface?: string
  /** Where the "See my usage" CTA routes to. */
  manageUrl?: string
}

const DISMISS_KEY_PREFIX = 'entitlement-warn-dismissed:'

/**
 * Proactive banner surfaced at the top of Steve-enabled surfaces (DM list,
 * group chat header, feed) when the user is approaching their monthly
 * Steve allowance.
 *
 * - 80–95% → soft amber banner with a "see my usage" CTA.
 * - 95–99% → harder amber banner with heavier copy.
 * - ≥100%  → hidden (the real block surface is the modal/bubble).
 *
 * Dismissing a threshold stashes it in localStorage, scoped to the month,
 * so we don't re-nag the user within the same cycle.
 */
export default function UsageWarningBanner({ usage, surface = 'global', manageUrl = '/settings/membership/ai-usage' }: Props) {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)

  const pctMonthly = usage?.monthly_steve_pct ?? null
  const pctDaily = usage?.daily_pct ?? null
  const pct = Math.max(pctMonthly ?? 0, pctDaily ?? 0)

  const threshold: 80 | 95 | null = useMemo(() => {
    if (pct >= 100) return null
    if (pct >= 95) return 95
    if (pct >= 80) return 80
    return null
  }, [pct])

  const storageKey = useMemo(() => {
    if (!threshold) return null
    const cycle = usage?.resets_at_monthly || 'unknown'
    return `${DISMISS_KEY_PREFIX}${surface}:${threshold}:${cycle}`
  }, [threshold, surface, usage?.resets_at_monthly])

  const alreadyDismissed = useMemo(() => {
    if (!storageKey) return false
    try { return !!localStorage.getItem(storageKey) } catch { return false }
  }, [storageKey])

  if (!usage || threshold == null || alreadyDismissed || dismissed) return null

  const handleDismiss = () => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, '1') } catch {}
    }
    setDismissed(true)
  }

  const amber = threshold === 95 ? '#ff8a65' : '#ffb74d'
  const title = threshold === 95
    ? `You’ve used ${Math.floor(pct)}% of your Steve allowance`
    : `Heads-up: ${Math.floor(pct)}% of your Steve allowance used`
  const body = threshold === 95
    ? 'You’re almost at your monthly limit. Once you hit 100% Steve will pause until next month.'
    : 'You’re approaching your monthly limit. Track remaining credits to avoid being paused.'

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        margin: '8px 12px',
        borderRadius: 10,
        background: `${amber}1a`,
        border: `1px solid ${amber}66`,
        color: 'rgba(255,255,255,0.92)',
      }}
    >
      <i className="fa-solid fa-triangle-exclamation" style={{ color: amber, fontSize: 14, flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{body}</div>
      </div>
      <button
        onClick={() => navigate(manageUrl)}
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.08)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        See my usage
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4 }}
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  )
}
