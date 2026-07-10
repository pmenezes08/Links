import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SkeletonList } from '../SkeletonRow'
import { useModalUX } from '../../hooks/useModalUX'
import { triggerHaptic } from '../../utils/haptics'
import type { OwnerPendingInvitee } from './types'

type PendingInvitesSheetProps = {
  open: boolean
  communityId: number
  scope: 'network' | 'self'
  onClose: () => void
}

/**
 * Drill-in behind Steve's "N invites haven't been answered" action: who is
 * still waiting, so the owner knows exactly whom to nudge personally.
 * Owner-only — the backend 404s anyone else.
 */
export default function PendingInvitesSheet({ open, communityId, scope, onClose }: PendingInvitesSheetProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [invitees, setInvitees] = useState<OwnerPendingInvitee[] | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useModalUX({ open, onClose, containerRef: sheetRef })

  const revoke = async (inv: OwnerPendingInvitee) => {
    void triggerHaptic('warning')
    setRevoking(inv.display)
    try {
      const resp = await fetch(`/api/community/${communityId}/analytics/pending-invites/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: inv.display, scope }),
      })
      const j = await resp.json().catch(() => null)
      if (j?.success) {
        setInvitees(prev => (prev ?? []).filter(p => p.display !== inv.display))
      }
    } catch {
      // row stays; the owner can retry
    } finally {
      setRevoking(null)
    }
  }

  useEffect(() => {
    if (!open) {
      setInvitees(null)
      return
    }
    void triggerHaptic('light')
    let mounted = true
    fetch(`/api/community/${communityId}/analytics/pending-invites?scope=${scope}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(j => { if (mounted) setInvitees(Array.isArray(j?.invitees) ? j.invitees : []) })
      .catch(() => { if (mounted) setInvitees([]) })
    return () => { mounted = false }
  }, [open, communityId, scope])

  const fmtDate = (iso?: string | null) => {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleDateString()
    } catch {
      return null
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[1300] flex items-end bg-black/60 transition-opacity duration-300 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onClick={onClose}
      aria-hidden={!open}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        className={`max-h-[75dvh] w-full overflow-y-auto overscroll-contain rounded-t-[2rem] border border-c-border bg-c-bg-elevated px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-3 text-c-text-primary shadow-[0_-28px_80px_rgba(0,0,0,0.72)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1 w-11 rounded-full bg-c-text-tertiary" />
        <h2 className="text-xl font-bold tracking-[-0.02em] text-c-text-primary">{t('owner.pending_invites_title')}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-c-text-secondary">{t('owner.pending_invites_body')}</p>

        <div className="mt-4">
          {invitees === null ? (
            <SkeletonList count={4} />
          ) : invitees.length === 0 ? (
            <div className="py-8 text-center text-sm text-c-text-tertiary">{t('owner.pending_invites_empty')}</div>
          ) : (
            <div className="space-y-1">
              {invitees.map(inv => {
                const date = fmtDate(inv.invited_at)
                const busy = revoking === inv.display
                return (
                  <div key={`${inv.type}:${inv.display}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                    <i
                      className={`${inv.type === 'email' ? 'fa-regular fa-envelope' : 'fa-regular fa-user'} w-4 text-center text-[13px] text-c-text-tertiary`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-c-text-primary">{inv.display}</span>
                    {date && <span className="shrink-0 text-[11px] text-c-text-tertiary">{t('owner.invited_on', { date })}</span>}
                    <button
                      type="button"
                      disabled={busy || revoking != null}
                      onClick={() => void revoke(inv)}
                      aria-label={t('owner.revoke_invite', { name: inv.display })}
                      title={t('owner.revoke_invite', { name: inv.display })}
                      className="shrink-0 rounded-lg p-1.5 text-[13px] text-c-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    >
                      <i className={`fa-regular ${busy ? 'fa-hourglass-half' : 'fa-trash-can'}`} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => { onClose(); navigate(`/community/${communityId}/members`) }}
          className="mt-5 w-full rounded-2xl bg-cpoint-turquoise px-4 py-3 text-center text-[13px] font-semibold text-c-text-on-accent"
        >
          {t('owner.invite_more')}
        </button>
      </div>
    </div>
  )
}
