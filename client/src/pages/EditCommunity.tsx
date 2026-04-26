import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ContentGenerationModal from '../components/ContentGenerationModal'
import { clearDeviceCache } from '../utils/deviceCache'
import { invalidateDashboardCache } from '../utils/dashboardCache'

// Tiers and Stripe state live exclusively on the root community. The
// API now also returns a payload for sub-community owners with
// ``is_inherited=true`` so we can render a small read-only badge on
// Manage Community. Keep this struct in sync with
// ``backend/blueprints/subscriptions.py::api_community_billing``.
interface CommunityBilling {
  tier: string
  tier_label: string
  is_inherited: boolean
  inherited_from_root_id: number | null
  inherited_from_root_name: string | null
  member_count: number
  member_cap: number | null
  subscription_status: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  is_canceling: boolean
  days_remaining: number | null
  benefits_end_at: string | null
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

export default function EditCommunity(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  // NOTE: public/private/closed type dropdown was removed April 2026.
  // The `type` column on `communities` is overloaded — it stores the
  // functional category (Gym / University / Business / General) set at
  // creation, not an access-control flag. The old dropdown was
  // cosmetic-only and could silently overwrite the category on save.
  // See bodybuilding_app.py::update_community for the fallback that
  // preserves the stored type when the client no longer sends it.
  const [networkType, setNetworkType] = useState('professional')
  const [imageFile, setImageFile] = useState<File|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [allowed, setAllowed] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [isChild, setIsChild] = useState(false)
  const [parentOptions, setParentOptions] = useState<Array<{ id:number; name:string; type?:string }>>([])
  const [selectedParentId, setSelectedParentId] = useState<string>('none')
  const [notifyOnNewMember, setNotifyOnNewMember] = useState(false)
  const [maxMembers, setMaxMembers] = useState<string>('')
  const [currentBackgroundPath, setCurrentBackgroundPath] = useState<string | null>(null)
  const [removeBackground, setRemoveBackground] = useState(false)
  const [aiPersonality, setAiPersonality] = useState('friendly')
  const [aiPersonalities, setAiPersonalities] = useState<Array<{key: string, name: string}>>([])
  const [savingAiPersonality, setSavingAiPersonality] = useState(false)
  const [showContentGeneration, setShowContentGeneration] = useState(false)
  const [billing, setBilling] = useState<CommunityBilling | null>(null)
  const [isFrozen, setIsFrozen] = useState(false)
  const [freezeLoading, setFreezeLoading] = useState(false)
  const formRef = useRef<HTMLFormElement|null>(null)

  useEffect(() => {
    let mounted = true
    async function init(){
      try{
        // Check permissions via members endpoint
        const fd = new URLSearchParams({ community_id: String(community_id) })
        const r = await fetch('/get_community_members', { method:'POST', credentials:'include', body: fd })
        const j = await r.json()
        if (!mounted) return
        const role = (j?.current_user_role || '').toLowerCase()
        const can = role === 'owner' || role === 'app_admin' || role === 'admin'
        const owner = role === 'owner'
        setAllowed(!!can)
        setIsOwner(!!owner)
        if (!can){ setError('You do not have permission to manage this community.'); setLoading(false); return }
        // Load current community info
        const rc = await fetch(`/api/community_feed/${community_id}`, { credentials:'include', headers: { 'Accept': 'application/json' } })
        const jc = await rc.json().catch(()=>null)
        if (jc?.success && jc.community){
          setName(jc.community.name || '')
          setNetworkType(jc.community.network_type || 'professional')
          const pid = jc.community.parent_community_id
          if (pid){ setIsChild(true); setSelectedParentId(String(pid)) }
          setNotifyOnNewMember(!!jc.community.notify_on_new_member)
          if (jc.community.max_members){ setMaxMembers(String(jc.community.max_members)) }
          if (jc.community.background_path){ setCurrentBackgroundPath(jc.community.background_path) }
          setIsFrozen(!!jc.community.is_frozen)
        }
        // Load available parents for dropdown
        try{
          const pr = await fetch('/get_available_parent_communities', { credentials:'include' })
          const pj = await pr.json().catch(()=>null)
          if (pj?.success && Array.isArray(pj.communities)) setParentOptions(pj.communities)
        }catch{}
        
        // Load AI personalities list
        try {
          const persResp = await fetch('/api/ai/personalities', { credentials: 'include', headers: { 'Accept': 'application/json' } })
          const persData = await persResp.json()
          if (persData?.success && Array.isArray(persData.personalities)) {
            setAiPersonalities(persData.personalities)
          }
        } catch {}
        
        // Load current AI personality for this community
        try {
          const aiResp = await fetch(`/api/community/${community_id}/ai_personality`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
          const aiData = await aiResp.json()
          if (aiData?.success && aiData.ai_personality) {
            setAiPersonality(aiData.ai_personality)
          }
        } catch {}
        
        setLoading(false)
      }catch{
        if (mounted){ setError('Failed to load community'); setLoading(false) }
      }
    }
    init()
    return () => { mounted = false }
  }, [community_id])

  // Billing snapshot — fetched for any community owner. Root owners see
  // the full panel (status, renewal, portal CTA); sub-community owners
  // see a small read-only "inherited from <root>" badge. The server
  // resolves the parent chain for us and returns ``is_inherited=true``
  // on children with everything Stripe-mutating cleared to null.
  useEffect(() => {
    if (!isOwner || !community_id) return
    let mounted = true
    async function loadBilling(){
      try {
        const r = await fetch(`/api/communities/${community_id}/billing`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) {
          setBilling({
            tier: String(j.tier || 'free'),
            tier_label: String(j.tier_label || TIER_LABEL[j.tier] || j.tier || 'Free'),
            is_inherited: !!j.is_inherited,
            inherited_from_root_id: j.inherited_from_root_id == null
              ? null
              : Number(j.inherited_from_root_id),
            inherited_from_root_name: j.inherited_from_root_name || null,
            member_count: Number(j.member_count || 0),
            member_cap: j.member_cap === null || j.member_cap === undefined
              ? null
              : Number(j.member_cap),
            subscription_status: j.subscription_status || null,
            current_period_end: j.current_period_end || null,
            cancel_at_period_end: !!j.cancel_at_period_end,
            canceled_at: j.canceled_at || null,
            is_canceling: !!j.is_canceling,
            days_remaining: j.days_remaining === null || j.days_remaining === undefined
              ? null
              : Number(j.days_remaining),
            benefits_end_at: j.benefits_end_at || null,
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
  }, [isOwner, community_id])

  async function onSubmit(e: React.FormEvent){
    e.preventDefault()
    if (!allowed) return
    const fd = new FormData()
    fd.append('community_id', String(community_id))
    fd.append('name', name.trim())
    // Intentionally no `type` field — see comment next to the state init.
    // The backend preserves the existing category when omitted.
    fd.append('network_type', networkType)
    // Parent setting
    fd.append('parent_community_id', isChild && selectedParentId !== 'none' ? selectedParentId : 'none')
    fd.append('notify_on_new_member', notifyOnNewMember ? 'true' : 'false')
    if (maxMembers.trim()) fd.append('max_members', maxMembers.trim())
    if (imageFile) fd.append('background_file', imageFile)
    if (removeBackground) fd.append('remove_background', 'true')
    const r = await fetch('/update_community', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      // Clear device cache to ensure fresh data is loaded
      clearDeviceCache(`community-feed:${community_id}`)
      navigate(`/community_feed_react/${community_id}`)
    } else {
      alert(j?.error || 'Failed to update community')
    }
  }

  async function onDelete(){
    if (!isOwner) return
    if (!window.confirm(`Are you sure you want to delete this community? This action cannot be undone.`)) return

    await submitDelete(false)
  }

  async function submitDelete(confirmActiveSubscription: boolean){
    try {
      const fd = new URLSearchParams({ community_id: String(community_id) })
      if (confirmActiveSubscription) fd.set('confirm_active_subscription', 'true')
      const r = await fetch('/delete_community', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        // Server-side deletion is now transactional and honest; one dashboard
        // invalidation is enough before leaving the deleted community.
        invalidateDashboardCache()
        alert('Community deleted successfully')
        window.location.href = '/premium_dashboard'
      } else if (r.status === 409 && j?.reason === 'active_subscription_requires_confirmation') {
        const warning = [
          'This community has an active subscription.',
          'If you delete it, the subscription will be cancelled automatically and remain active until the end of the current billing period.',
          'No further action is needed from your side.',
          '',
          'Delete this community and schedule the subscription cancellation?',
        ].join('\n')
        if (window.confirm(warning)) {
          await submitDelete(true)
        }
      } else {
        alert(j?.error || 'Failed to delete community')
      }
    } catch {
      alert('Failed to delete community')
    }
  }

  async function onToggleFreeze(){
    if (!isOwner || !community_id || freezeLoading) return
    const freezing = !isFrozen
    const warning = freezing
      ? [
          'Freeze this community?',
          'Members will still see it on their dashboard, but only the owner and admins will be able to access it.',
          billing?.has_stripe_customer
            ? 'The community subscription will remain active while the community is frozen.'
            : '',
        ].filter(Boolean).join('\n\n')
      : 'Unfreeze this community and restore member access?'
    if (!window.confirm(warning)) return
    setFreezeLoading(true)
    try {
      const r = await fetch(`/api/communities/${community_id}/${freezing ? 'freeze' : 'unfreeze'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: freezing ? JSON.stringify({ reason: 'owner_requested' }) : '{}',
      })
      const j = await r.json().catch(()=>null)
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Unable to update community')
      setIsFrozen(!!j.is_frozen)
      invalidateDashboardCache()
      alert(freezing ? 'Community frozen.' : 'Community unfrozen.')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to update community')
    } finally {
      setFreezeLoading(false)
    }
  }

  async function saveAiPersonality(newPersonality: string) {
    setSavingAiPersonality(true)
    try {
      const resp = await fetch(`/api/community/${community_id}/ai_personality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ai_personality: newPersonality })
      })
      const data = await resp.json()
      if (data?.success) {
        setAiPersonality(newPersonality)
      } else {
        alert(data?.error || 'Failed to update AI personality')
      }
    } catch {
      alert('Failed to update AI personality')
    } finally {
      setSavingAiPersonality(false)
    }
  }

  const renderBillingCard = () => {
    if (!isOwner || !billing) return null

    if (billing.is_inherited) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            Billing
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-1 text-[11px] font-medium text-cpoint-turquoise">
              {billing.tier_label || TIER_LABEL[billing.tier] || billing.tier}
            </span>
            <span className="text-xs text-white/60">
              {billing.inherited_from_root_name
                ? <>inherited from <span className="text-white/80">{billing.inherited_from_root_name}</span></>
                : 'inherited from parent community'}
            </span>
          </div>
        </div>
      )
    }

    const hasPaidTier = billing.tier !== 'free' && billing.tier !== ''
    const actionLabel = billing.has_stripe_customer
      ? billing.is_canceling
        ? 'Renew subscription'
        : 'Upgrade Community Tier'
      : 'Choose paid tier'
    const action = () => navigate(`/subscription_plans?mode=choose&open=community_plans&community_id=${community_id}`)

    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
              Billing
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              Community plan
            </div>
            {billing.is_canceling && billing.days_remaining !== null && (
              <div className="mt-1 text-xs font-medium text-amber-200">
                Cancels in {billing.days_remaining} {billing.days_remaining === 1 ? 'day' : 'days'}
              </div>
            )}
            {billing.current_period_end && (
              <div className="mt-1 text-xs text-white/40">
                {billing.is_canceling ? 'Benefits active until' : 'Next renewal'}: {formatBillingDate(billing.current_period_end)}
              </div>
            )}
            {billing.subscription_status && billing.subscription_status !== 'active' && (
              <div className="mt-1 text-xs text-amber-300/80">
                Status: {billing.subscription_status}
              </div>
            )}
          </div>
          <span className="inline-flex items-center rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-1 text-[11px] font-medium text-cpoint-turquoise">
            {billing.tier_label || TIER_LABEL[billing.tier] || billing.tier}
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

        <button
          type="button"
          onClick={action}
          className="inline-flex w-full items-center justify-center rounded-full bg-cpoint-turquoise px-5 py-2.5 text-xs font-semibold text-black hover:bg-cpoint-turquoise/90 transition disabled:opacity-50"
        >
          {actionLabel}
        </button>

        {hasPaidTier && !billing.has_stripe_customer && (
          <div className="text-xs text-white/40">
            This tier has no Stripe customer attached yet. Use checkout to reconnect billing.
          </div>
        )}
      </div>
    )
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>
  if (!allowed) return <div className="p-4 text-[#9fb0b5]">No access.</div>

  return (
    <div className="min-h-screen bg-black text-white">
      <div
        className="fixed left-0 right-0 h-12 border-b border-white/10 bg-black/70 backdrop-blur flex items-center px-3 z-40"
        style={{
          top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))',
          '--app-subnav-height': '48px',
        } as CSSProperties}
      >
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> navigate(-1)}>
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="ml-2 font-semibold">Manage Community</div>
      </div>

      <div className="app-subnav-offset max-w-2xl mx-auto px-3 pb-24" style={{ '--app-subnav-height': '48px' } as CSSProperties}>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Community name</label>
            <input className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" value={name} onChange={e=> setName(e.target.value)} required />
          </div>
          {renderBillingCard()}
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Network Type <span className="text-[#4db6ac] text-xs">(Parent owners &amp; @Admin only)</span></label>
            <select 
              className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" 
              value={networkType} 
              onChange={e => setNetworkType(e.target.value)}
            >
              <option value="professional">Professional / Industry</option>
              <option value="social">Social / Community</option>
              <option value="sports">Sports &amp; Recreation</option>
              <option value="alumni">Alumni &amp; Classmates</option>
              <option value="corporate">Corporate / Internal</option>
              <option value="interest">Interest &amp; Hobby</option>
              <option value="geographic">Geographic / Local</option>
              <option value="cause">Cause &amp; Advocacy</option>
              <option value="hybrid">Hybrid (Mixed Purpose)</option>
            </select>
            <div className="text-xs text-[#9fb0b5] mt-1">This controls Steve&apos;s insights, content recommendations, and group suggestions for the network.</div>
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-2">Notifications</label>
            <label className="flex items-center justify-between px-4 py-3 rounded-lg border border-white/15 bg-black hover:bg-white/5 cursor-pointer">
              <div className="flex-1">
                <div className="text-sm font-medium text-white">Notify on new members</div>
                <div className="text-xs text-[#9fb0b5] mt-0.5">Send a notification to all members when someone new joins</div>
              </div>
              <div className="ml-3">
                <button
                  type="button"
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notifyOnNewMember ? 'bg-[#4db6ac]' : 'bg-white/20'}`}
                  onClick={() => setNotifyOnNewMember(!notifyOnNewMember)}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifyOnNewMember ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </label>
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Member limit (optional)</label>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="e.g., 100"
              className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none"
              value={maxMembers}
              onChange={e=> setMaxMembers(e.target.value.replace(/[^0-9]/g,''))}
            />
            <div className="text-xs text-[#9fb0b5] mt-1">When set, new joins are blocked once the limit is reached.</div>
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Hierarchy</label>
            <div className="inline-flex rounded-full border border-white/15 overflow-hidden bg-black">
              <button
                type="button"
                className={`px-4 py-2 text-sm whitespace-nowrap ${!isChild ? 'bg-[#4db6ac] text-black' : 'text-[#cfd8dc] hover:bg-white/5'}`}
                onClick={()=> setIsChild(false)}
                aria-pressed={!isChild}
              >
                Parent Community
              </button>
              <button
                type="button"
                className={`px-4 py-2 text-sm whitespace-nowrap ${isChild ? 'bg-[#4db6ac] text-black' : 'text-[#cfd8dc] hover:bg-white/5'}`}
                onClick={()=> setIsChild(true)}
                aria-pressed={isChild}
              >
                Child Community
              </button>
            </div>
            {isChild && (
              <div className="mt-2">
                <label className="block text-xs text-[#9fb0b5] mb-1">Select parent community</label>
                <select className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" value={selectedParentId} onChange={e=> setSelectedParentId(e.target.value)}>
                  <option value="none">None</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={String(p.id)}>{p.name}{p.type?` (${p.type})`:''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Community image</label>
            
            {/* Current image preview */}
            {currentBackgroundPath && !removeBackground && !imageFile && (
              <div style={{ position: 'relative' }} className="mb-3 rounded-lg border border-white/10 overflow-hidden">
                <img 
                  src={`/uploads/${currentBackgroundPath}`} 
                  alt="Current community image" 
                  className="w-full max-h-48 object-cover"
                />
                <button
                  type="button"
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: 'rgba(255,255,255,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                  }}
                  onClick={() => setRemoveBackground(true)}
                  title="Remove image"
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
              </div>
            )}
            
            {/* New image preview */}
            {imageFile && (
              <div style={{ position: 'relative' }} className="mb-3 rounded-lg border border-white/10 overflow-hidden">
                <img 
                  src={URL.createObjectURL(imageFile)} 
                  alt="New community image" 
                  className="w-full max-h-48 object-cover"
                />
                <button
                  type="button"
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: 'rgba(255,255,255,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                  }}
                  onClick={() => setImageFile(null)}
                  title="Remove new image"
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
              </div>
            )}
            
            {removeBackground && !imageFile && (
              <div className="mb-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10 flex items-center justify-between">
                <span className="text-sm text-red-400">Image will be removed</span>
                <button
                  type="button"
                  className="text-xs text-[#9fb0b5] hover:text-white"
                  onClick={() => setRemoveBackground(false)}
                >
                  Undo
                </button>
              </div>
            )}
            
            <input 
              type="file" 
              accept="image/*" 
              onChange={e => {
                setImageFile(e.target.files?.[0] || null)
                if (e.target.files?.[0]) setRemoveBackground(false)
              }} 
              className="block w-full text-sm" 
            />
          </div>
          
          {/* AI Assistant Personality */}
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-2">AI Assistant Personality (@Steve)</label>
            <div className="rounded-lg border border-white/15 bg-black p-4">
              <p className="text-xs text-[#9fb0b5] mb-3">
                Choose how Steve (the AI assistant) responds when members mention @Steve in comments.
              </p>
              <select 
                className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none"
                value={aiPersonality}
                onChange={e => saveAiPersonality(e.target.value)}
                disabled={savingAiPersonality}
              >
                {aiPersonalities.map(p => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
              </select>
              {savingAiPersonality && (
                <div className="mt-2 text-xs text-[#4db6ac]">
                  <i className="fa-solid fa-spinner fa-spin mr-1" /> Saving...
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#9fb0b5] mb-2">Content Generation</label>
            <div className="rounded-lg border border-white/15 bg-black p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-white">Steve automations</div>
                <div className="text-xs text-[#9fb0b5] mt-1">
                  Configure saved jobs for Steve to publish community content. Schedules are stored now and can be automated later.
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110 whitespace-nowrap"
                onClick={() => setShowContentGeneration(true)}
              >
                Open
              </button>
            </div>
          </div>
          
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-2 rounded-md border border-white/10 hover:bg-white/5" onClick={()=> navigate(-1)}>Cancel</button>
            <button type="submit" className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110">Save Changes</button>
          </div>
        </form>

        {/* Steve welcome post — Only for owners */}
        {isOwner && (
          <div className="mt-8 pt-6 border-t border-white/10">
            <div className="bg-[#4db6ac]/10 border border-[#4db6ac]/30 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-[#4db6ac] mb-2">Steve's welcome post</h3>
              <p className="text-sm text-[#9fb0b5] mb-4">
                When this community was created, Steve published a welcome post explaining what's inside. If it was deleted, or you'd like a fresh copy, republish it here. Existing posts are not duplicated.
              </p>
              <button
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/communities/${community_id}/republish_welcome_post`, {
                      method: 'POST', credentials: 'include',
                    })
                    const j = await r.json().catch(() => null)
                    if (j?.success) {
                      alert('Welcome post is back in your feed.')
                    } else {
                      alert(j?.error === 'forbidden' ? 'Only the owner or admins can do this.' : 'Could not republish the welcome post.')
                    }
                  } catch {
                    alert('Could not republish the welcome post.')
                  }
                }}
                className="px-4 py-2 bg-[#4db6ac] hover:brightness-110 text-black rounded-md font-medium transition-colors"
              >
                Republish welcome post
              </button>
            </div>
          </div>
        )}

        {/* Delete Community Section - Only for owners */}
        {isOwner && (
          <div className="mt-8 pt-6 border-t border-white/10">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h3>
              <p className="text-sm text-[#9fb0b5] mb-4">
                Deleting this community will permanently remove all posts, messages, and member data. This action cannot be undone.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={onToggleFreeze}
                  disabled={freezeLoading}
                  className="px-4 py-2 border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15 text-amber-100 rounded-md font-medium transition-colors disabled:opacity-50"
                >
                  {freezeLoading ? 'Updating…' : isFrozen ? 'Unfreeze Community' : 'Freeze Community'}
                </button>
                <button 
                  onClick={onDelete}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors"
                >
                  Delete Community
                </button>
              </div>
              <p className="mt-3 text-xs text-[#9fb0b5]">
                {isFrozen
                  ? 'This community is frozen. Members can still see it on their dashboard but cannot open it.'
                  : 'Freezing keeps the community visible on dashboards but blocks member access until you unfreeze it.'}
              </p>
            </div>
          </div>
        )}
      </div>
      <ContentGenerationModal
        communityId={String(community_id || '')}
        open={showContentGeneration}
        onClose={() => setShowContentGeneration(false)}
      />
    </div>
  )
}

function formatBillingDate(value: string) {
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? value.split(' ')[0] : date.toLocaleDateString()
}