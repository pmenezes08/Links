import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { useEntitlements } from '../hooks/useEntitlements'

interface MonthlyUsageBreakdown {
  steve_dm?: number
  steve_group?: number
  steve_feed?: number
  post_summary?: number
  voice_summary?: number
  whisper_minutes?: number
}

interface AiUsageResponse {
  success: boolean
  month_start?: string
  month_end?: string
  total_calls?: number
  total_whisper_minutes?: number
  by_surface?: MonthlyUsageBreakdown
  by_day?: Array<{ date: string; calls: number }>
  recent?: Array<{ ts: string; surface: string; request_type: string; tokens_in?: number; tokens_out?: number; duration_seconds?: number }>
}

/**
 * Fallback "See my usage" page surfaced by entitlements CTAs before the
 * full Manage Membership modal (Wave 3) lands. Minimal read-only view of
 * `GET /api/me/ai-usage` + the cached entitlements snapshot so users
 * always have somewhere to land from a limit modal.
 */
export default function MembershipAIUsage() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const { entitlements, usage } = useEntitlements()
  const [data, setData] = useState<AiUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setTitle('Steve & Voice usage')
  }, [setTitle])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch('/api/me/ai-usage', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const body = (await r.json()) as AiUsageResponse
        if (!cancelled) setData(body)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const renderBar = (label: string, used: number, cap: number | null) => {
    const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : used > 0 ? 100 : 0
    const color = pct >= 100 ? '#e57373' : pct >= 95 ? '#ff8a65' : pct >= 80 ? '#ffb74d' : '#4db6ac'
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#fff', marginBottom: 6 }}>
          <span>{label}</span>
          <span style={{ color: 'rgba(255,255,255,0.7)' }}>
            {used} / {cap == null ? '∞' : cap}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.08)' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: color }} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, color: '#fff', maxWidth: 520, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>Current plan</div>
        <div style={{ fontSize: 18, fontWeight: 600, textTransform: 'capitalize' }}>
          {entitlements?.tier || 'Unknown'}
          {entitlements?.is_special ? (
            <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, background: 'rgba(77,182,172,0.2)', color: '#4db6ac', fontSize: 12 }}>
              Special
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>This month</div>
        {renderBar('Steve uses', usage?.monthly_steve_used ?? 0, usage?.monthly_steve_cap ?? null)}
        {renderBar('Voice minutes', Math.round(usage?.whisper_minutes_used ?? 0), usage?.whisper_minutes_cap ?? null)}
        {entitlements?.ai_daily_limit != null
          ? renderBar('Steve uses today', usage?.daily_used ?? 0, usage?.daily_cap ?? entitlements.ai_daily_limit)
          : null}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8 }}>
          {usage?.resets_at_monthly ? `Resets ${new Date(usage.resets_at_monthly).toLocaleDateString()}` : ''}
        </div>
      </div>

      {loading ? (
        <div style={{ marginTop: 24, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>Loading history…</div>
      ) : err ? (
        <div style={{ marginTop: 24, textAlign: 'center', color: '#e57373' }}>{err}</div>
      ) : data?.by_surface ? (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Breakdown by surface</div>
          {Object.entries(data.by_surface).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'rgba(255,255,255,0.75)', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
              <span>{v ?? 0}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
        <button
          onClick={() => navigate('/settings')}
          style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: 'rgba(255,255,255,0.05)', color: '#fff', fontWeight: 500, border: 'none', cursor: 'pointer' }}
        >
          Back to settings
        </button>
        {entitlements?.tier === 'free' || entitlements?.tier === 'trial' ? (
          <button
            onClick={() => navigate('/subscription')}
            style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: '#4db6ac', color: '#000', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            Upgrade
          </button>
        ) : null}
      </div>
    </div>
  )
}
