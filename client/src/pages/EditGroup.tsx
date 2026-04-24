import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

interface CommunityBilling {
  tier: string
  member_count: number
  member_cap: number | null
  subscription_status: string | null
  current_period_end: string | null
  has_stripe_customer: boolean
  stripe_mode: 'test' | 'live'
}

const TIER_LABEL: Record<string, string> = {
  free: 'Free',
  paid_l1: 'Paid L1',
  paid_l2: 'Paid L2',
  paid_l3: 'Paid L3',
  enterprise: 'Enterprise',
}

export default function EditGroup(){
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [name, setName] = useState('')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string|null>(null)
  const [billing, setBilling] = useState<CommunityBilling | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string|null>(null)

  useEffect(() => { setTitle('Manage Group') }, [setTitle])

  useEffect(() => {
    let mounted = true
    async function init(){
      try {
        const r = await fetch(`/api/group_settings/${group_id}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) {
          setName(j.group.name || '')
          setApprovalRequired(!!j.group.approval_required)
          setIsOwner(j.is_owner)
          if (!j.can_edit) setError('You do not have permission to manage this group.')
        } else {
          setError(j?.error || 'Failed to load group')
        }
      } catch {
        if (mounted) setError('Failed to load group')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    init()
    return () => { mounted = false }
  }, [group_id])

  // Billing snapshot — only fetched once we know the user is the owner.
  useEffect(() => {
    if (!isOwner || !group_id) return
    let mounted = true
    async function loadBilling() {
      try {
        const r = await fetch(`/api/communities/${group_id}/billing`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) {
          setBilling({
            tier: String(j.tier || 'free'),
            member_count: Number(j.member_count || 0),
            member_cap: j.member_cap === null || j.member_cap === undefined
              ? null
              : Number(j.member_cap),
            subscription_status: j.subscription_status || null,
            current_period_end: j.current_period_end || null,
            has_stripe_customer: !!j.has_stripe_customer,
            stripe_mode: j.stripe_mode === 'live' ? 'live' : 'test',
          })
        }
      } catch {
        // Billing column may not exist yet on older schemas — fail soft.
      }
    }
    loadBilling()
    return () => { mounted = false }
  }, [isOwner, group_id])

  async function handleOpenPortal(){
    setPortalLoading(true)
    setPortalError(null)
    try {
      const r = await fetch(`/api/me/billing/portal?community_id=${group_id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ return_path: `/edit_group/${group_id}` }),
      })
      const j = await r.json()
      if (!r.ok || !j?.success || !j?.url) {
        throw new Error(j?.error || 'Unable to open billing portal')
      }
      window.location.assign(j.url)
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Unable to open billing portal')
      setPortalLoading(false)
    }
  }

  async function handleSave(){
    if (!name.trim()) { alert('Group name is required'); return }
    setSaving(true)
    try {
      const r = await fetch(`/api/group_settings/${group_id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), approval_required: approvalRequired }),
      })
      const j = await r.json()
      if (j?.success) {
        setSuccessMsg('Group updated')
        setTimeout(() => setSuccessMsg(null), 2000)
      } else {
        alert(j?.error || 'Failed to save')
      }
    } catch { alert('Failed to save') }
    setSaving(false)
  }

  async function handleDelete(){
    if (!confirm('Are you sure you want to delete this group? This cannot be undone.')) return
    if (!confirm('This will remove all group posts and members. Continue?')) return
    try {
      const fd = new URLSearchParams({ group_id: String(group_id) })
      const r = await fetch('/api/groups/delete', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json()
      if (j?.success) {
        navigate('/communities')
      } else {
        alert(j?.error || 'Failed to delete group')
      }
    } catch { alert('Failed to delete group') }
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return (
    <div className="p-4">
      <div className="text-red-400 mb-3">{error}</div>
      <button className="px-3 py-1.5 rounded-lg border border-white/10 text-sm text-white hover:bg-white/5" onClick={() => navigate(-1)}>← Back</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-3 py-4 space-y-4" style={{ paddingTop: '12px' }}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={() => navigate(`/group_feed_react/${group_id}`)}>
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="text-lg font-semibold">Manage Group</div>
        </div>

        {successMsg && (
          <div className="px-4 py-2 rounded-lg bg-[#4db6ac]/20 text-[#4db6ac] text-sm text-center">{successMsg}</div>
        )}

        {/* Group Name */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="text-sm font-medium text-white">Group Name</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white placeholder-[#6f7c81] focus:outline-none focus:border-[#4db6ac]"
            placeholder="Enter group name"
          />
        </div>

        {/* Approval Required */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">Require Approval to Join</div>
              <div className="text-xs text-[#6f7c81] mt-0.5">New members need approval before joining</div>
            </div>
            <button
              type="button"
              onClick={() => setApprovalRequired(!approvalRequired)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${approvalRequired ? 'bg-[#4db6ac]' : 'bg-white/20'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${approvalRequired ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* Billing — owner only */}
        {isOwner && billing && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
                  Billing
                </div>
                <div className="mt-2 text-sm font-medium text-white">
                  Community plan
                </div>
                {billing.current_period_end && (
                  <div className="mt-1 text-xs text-white/40">
                    Next renewal: {billing.current_period_end}
                  </div>
                )}
                {billing.subscription_status && billing.subscription_status !== 'active' && (
                  <div className="mt-1 text-xs text-amber-300/80">
                    Status: {billing.subscription_status}
                  </div>
                )}
              </div>
              <span className="inline-flex items-center rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-1 text-[11px] font-medium text-cpoint-turquoise">
                {TIER_LABEL[billing.tier] || billing.tier}
              </span>
            </div>

            {billing.member_cap !== null && billing.member_cap > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between text-xs text-white/60">
                  <span>Members</span>
                  <span>
                    {billing.member_count} / {billing.member_cap}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-cpoint-turquoise"
                    style={{
                      width: `${Math.min(
                        100,
                        (billing.member_count / billing.member_cap) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {portalError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                {portalError}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => navigate(`/subscription_plans?community_id=${group_id}#community-tier`)}
                className="inline-flex w-full items-center justify-center rounded-full bg-cpoint-turquoise px-5 py-2.5 text-xs font-semibold text-black hover:bg-cpoint-turquoise/90 transition"
              >
                Upgrade / change tier
              </button>
              {billing.has_stripe_customer && (
                <button
                  type="button"
                  onClick={handleOpenPortal}
                  disabled={portalLoading}
                  className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-5 py-2.5 text-xs font-semibold text-white hover:bg-white/5 transition disabled:opacity-50"
                >
                  {portalLoading ? 'Opening portal…' : 'Open billing portal'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        {/* Danger Zone — owner only */}
        {isOwner && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3 mt-6">
            <div className="text-sm font-medium text-red-400">Danger Zone</div>
            <div className="text-xs text-[#9fb0b5]">Deleting this group will permanently remove all posts, members, and data.</div>
            <button
              onClick={handleDelete}
              className="w-full py-2.5 rounded-lg border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors"
            >
              Delete Group
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
