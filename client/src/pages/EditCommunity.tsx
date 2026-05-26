import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ContentGenerationModal from '../components/ContentGenerationModal'
import DeleteCommunityModal, { type DeleteCommunityResult } from '../components/DeleteCommunityModal'
import { clearDeviceCache } from '../utils/deviceCache'
import { invalidateDashboardCache } from '../utils/dashboardCache'
import { openExternalBillingUrl, providerBadge, providerLabel } from '../utils/mobileStoreBilling'
import { resolveCommunityBackgroundUrl } from '../utils/communityBackgroundUrl'

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
  billing_provider: string | null
  stripe_mode: 'test' | 'live'
  media_limit_gb: number | null
  media_limit_bytes: number | null
  media_usage: {
    active_bytes: number
    tracked_bytes: number
    asset_count: number
  }
  steve_package_subscription_active: boolean
  steve_package_current_period_end: string | null
  steve_pool_cap: number | null
  steve_pool_used: number
  steve_pool_remaining: number | null
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
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
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
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showManageSubscriptionModal, setShowManageSubscriptionModal] = useState(false)
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
        if (!can){ setError(t('communities.no_permission_manage')); setLoading(false); return }
        // Load current community info
        const rc = await fetch(`/api/community_feed/${community_id}`, { credentials:'include', headers: { 'Accept': 'application/json' } })
        const jc = await rc.json().catch(()=>null)
        if (jc?.success && jc.community){
          setName(jc.community.name || '')
          setDescription(jc.community.description || '')
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
        if (mounted){ setError(t('communities.failed_load_community')); setLoading(false) }
      }
    }
    init()
    return () => { mounted = false }
  }, [community_id, t])

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
            billing_provider: j.billing_provider || 'stripe',
            stripe_mode: j.stripe_mode === 'live' ? 'live' : 'test',
            media_limit_gb: j.media_limit_gb === null || j.media_limit_gb === undefined
              ? null
              : Number(j.media_limit_gb),
            media_limit_bytes: j.media_limit_bytes === null || j.media_limit_bytes === undefined
              ? null
              : Number(j.media_limit_bytes),
            media_usage: {
              active_bytes: Number(j.media_usage?.active_bytes || 0),
              tracked_bytes: Number(j.media_usage?.tracked_bytes || 0),
              asset_count: Number(j.media_usage?.asset_count || 0),
            },
            steve_package_subscription_active: !!j.steve_package_subscription_active,
            steve_package_current_period_end: j.steve_package_current_period_end || null,
            steve_pool_cap: j.steve_pool_cap === null || j.steve_pool_cap === undefined
              ? null
              : Number(j.steve_pool_cap),
            steve_pool_used: Number(j.steve_pool_used || 0),
            steve_pool_remaining: j.steve_pool_remaining === null || j.steve_pool_remaining === undefined
              ? null
              : Number(j.steve_pool_remaining),
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
    fd.append('description', description.trim())
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
      clearDeviceCache(`community-feed:${community_id}`)
      invalidateDashboardCache()
      navigate(`/community_feed_react/${community_id}`)
    } else {
      alert(j?.error || t('communities.failed_update_community'))
    }
  }

  async function onDelete(){
    if (!isOwner) return
    setShowDeleteModal(true)
  }

  async function submitDelete(confirmActiveSubscription: boolean): Promise<DeleteCommunityResult>{
    try {
      const fd = new URLSearchParams({ community_id: String(community_id) })
      if (confirmActiveSubscription) fd.set('confirm_active_subscription', 'true')
      const r = await fetch('/delete_community', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        // Server-side deletion is now transactional and honest; one dashboard
        // invalidation is enough before leaving the deleted community.
        invalidateDashboardCache()
        alert(t('communities.community_deleted_success'))
        window.location.href = '/premium_dashboard'
        return { success: true }
      } else if (r.status === 409 && j?.reason === 'active_subscription_requires_confirmation') {
        return {
          success: false,
          activeSubscription: true,
          error: j?.error || t('communities.active_subscription_on_delete'),
          subscriptions: Array.isArray(j?.subscriptions) ? j.subscriptions : [],
        }
      } else {
        return { success: false, error: j?.error || t('communities.delete_failed') }
      }
    } catch {
      return { success: false, error: t('communities.delete_failed') }
    }
  }

  async function onToggleFreeze(){
    if (!isOwner || !community_id || freezeLoading) return
    const freezing = !isFrozen
    const warning = freezing
      ? [
          t('communities.freeze_confirm_title'),
          t('communities.freeze_confirm_body'),
          billing?.has_stripe_customer ? t('communities.freeze_confirm_billing_note') : '',
        ].filter(Boolean).join('\n\n')
      : t('communities.unfreeze_confirm')
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
      if (!r.ok || !j?.success) throw new Error(j?.error || t('communities.unable_update_community'))
      setIsFrozen(!!j.is_frozen)
      invalidateDashboardCache()
      alert(freezing ? t('communities.community_frozen') : t('communities.community_unfrozen'))
    } catch (err) {
      alert(err instanceof Error ? err.message : t('communities.unable_update_community'))
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
        alert(data?.error || t('communities.failed_update_ai_personality'))
      }
    } catch {
      alert(t('communities.failed_update_ai_personality'))
    } finally {
      setSavingAiPersonality(false)
    }
  }

  async function openCommunityBillingPortal() {
    if (!community_id) return
    try {
      const returnPath = `/community/${community_id}/edit`
      const res = await fetch(`/api/me/billing/portal?community_id=${community_id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ return_path: returnPath }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success && data?.url) {
        window.location.assign(data.url)
        return
      }
      alert(data?.error || t('communities.unable_open_billing_portal'))
    } catch {
      alert(t('communities.unable_open_billing_portal'))
    }
  }

  const renderBillingCard = () => {
    if (!isOwner || !billing) return null

    if (billing.is_inherited) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
            {t('communities.billing_label')}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-1 text-[11px] font-medium text-cpoint-turquoise">
              {billing.tier_label || TIER_LABEL[billing.tier] || billing.tier}
            </span>
            <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/60">
              {providerBadge(billing.billing_provider || 'stripe')}
            </span>
            <span className="text-xs text-white/60">
              {billing.inherited_from_root_name
                ? t('communities.inherited_from_named', { name: billing.inherited_from_root_name })
                : t('communities.inherited_from_parent')}
            </span>
          </div>
          {billing.inherited_from_root_id != null && billing.inherited_from_root_id > 0 && (
            <div className="mt-3 space-y-2 text-xs text-white/60">
              <p>
                {t('communities.inherited_billing_on_root', {
                  name: billing.inherited_from_root_name || t('communities.inherited_from_parent'),
                  provider: providerLabel(String(billing.billing_provider || 'stripe').toLowerCase()),
                })}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/community/${billing.inherited_from_root_id}/edit`)}
                className="text-cpoint-turquoise underline hover:text-cpoint-turquoise/90"
              >
                {t('communities.manage_billing_on_root')}
              </button>
            </div>
          )}
          {billing.steve_package_subscription_active && billing.steve_pool_cap !== null && billing.steve_pool_cap > 0 && (
            <div className="mt-4 rounded-lg border border-[#00CEC8]/25 bg-[#00CEC8]/5 p-3 text-xs text-white/70">
              <div className="font-medium text-[#00CEC8]">{t('communities.steve_community_calls')}</div>
              <div className="mt-1">
                {t('communities.steve_pool_available', { remaining: billing.steve_pool_remaining ?? 0, cap: billing.steve_pool_cap })}
                <span className="text-white/35"> ({t('communities.steve_pool_used', { used: billing.steve_pool_used })})</span>
              </div>
            </div>
          )}
        </div>
      )
    }

    const hasPaidTier = billing.tier !== 'free' && billing.tier !== ''
    const showManageSubscription = hasPaidTier || billing.has_stripe_customer
    const billingProvider = String(billing.billing_provider || 'stripe').toLowerCase()
    const isStoreBilled = billingProvider === 'apple' || billingProvider === 'google'
    const mediaLimitBytes = billing.media_limit_bytes
    const activeMediaBytes = billing.media_usage.active_bytes
    const mediaPercent = mediaLimitBytes && mediaLimitBytes > 0
      ? Math.min(100, (activeMediaBytes / mediaLimitBytes) * 100)
      : 0
    const mediaTone = !mediaLimitBytes || mediaPercent < 75
      ? t('communities.media_healthy')
      : mediaPercent < 100
        ? t('communities.media_getting_full')
        : t('communities.media_over_limit')

    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-cpoint-turquoise">
              {t('communities.billing_label')}
            </div>
            <div className="mt-2 text-sm font-medium text-white">
              {t('communities.community_plan')}
            </div>
            {billing.is_canceling && billing.days_remaining !== null && (
              <div className="mt-1 text-xs font-medium text-amber-200">
                {t('communities.cancels_in_days', { count: billing.days_remaining })}
              </div>
            )}
            {billing.current_period_end && (
              <div className="mt-1 text-xs text-white/40">
                {billing.is_canceling ? t('communities.benefits_active_until') : t('communities.next_renewal')}: {formatBillingDate(billing.current_period_end)}
              </div>
            )}
            {billing.subscription_status && billing.subscription_status !== 'active' && (
              <div className="mt-1 text-xs text-amber-300/80">
                {t('communities.status_label', { status: billing.subscription_status })}
              </div>
            )}
          </div>
          <span className="inline-flex items-center rounded-full border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-1 text-[11px] font-medium text-cpoint-turquoise">
            {billing.tier_label || TIER_LABEL[billing.tier] || billing.tier}
          </span>
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/60">
            {providerBadge(billing.billing_provider || 'stripe')}
          </span>
        </div>

        {billing.member_cap !== null && billing.member_cap > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-xs text-white/60">
              <span>{t('communities.members_label')}</span>
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

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs text-white/60">
            <span>{t('communities.media_storage')}</span>
            <span>
              {formatBytes(activeMediaBytes)}
              {mediaLimitBytes ? ` / ${formatBytes(mediaLimitBytes)}` : ''}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full ${mediaPercent >= 100 ? 'bg-amber-300' : 'bg-cpoint-turquoise'}`}
              style={{ width: `${mediaLimitBytes ? mediaPercent : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/40">
            <span>{mediaTone}</span>
            <span>{t('communities.tracked_media_items', { count: billing.media_usage.asset_count })}</span>
          </div>
          <div className="text-[11px] leading-relaxed text-white/35">
            {t('communities.storage_tracking_note')}
          </div>
        </div>

        {billing.steve_package_subscription_active && billing.steve_pool_cap !== null && billing.steve_pool_cap > 0 && (
          <div className="rounded-lg border border-[#00CEC8]/25 bg-[#00CEC8]/5 p-3">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-[#00CEC8]">{t('communities.steve_community_calls')}</span>
              <span className="text-white/70">
                {t('communities.steve_pool_available_short', { remaining: billing.steve_pool_remaining ?? 0, cap: billing.steve_pool_cap })}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-[#00CEC8]"
                style={{
                  width: `${Math.min(
                    100,
                    ((billing.steve_pool_remaining ?? 0) / billing.steve_pool_cap) * 100,
                  )}%`,
                }}
              />
            </div>
            <div className="mt-1 text-[11px] text-white/40">
              {t('communities.steve_used_this_month', { used: billing.steve_pool_used })}
              {billing.steve_package_current_period_end
                ? ` · ${t('communities.steve_renews', { date: formatBillingDate(billing.steve_package_current_period_end) })}`
                : ''}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (showManageSubscription) {
              setShowManageSubscriptionModal(true)
            } else {
              navigate(`/subscription_plans?mode=choose&open=community_plans&community_id=${community_id}`)
            }
          }}
          className="inline-flex w-full items-center justify-center rounded-full bg-cpoint-turquoise px-5 py-2.5 text-xs font-semibold text-black hover:bg-cpoint-turquoise/90 transition disabled:opacity-50"
        >
          {showManageSubscription ? t('communities.manage_subscription') : t('communities.choose_paid_tier')}
        </button>

        {hasPaidTier && isStoreBilled && (
          <div className="text-xs text-white/40">
            {t('communities.store_billed_note', { provider: providerLabel(billingProvider) })}
          </div>
        )}

        {hasPaidTier && !billing.has_stripe_customer && !isStoreBilled && (
          <div className="text-xs text-white/40">
            {t('communities.no_stripe_customer_note')}
          </div>
        )}
      </div>
    )
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">{t('communities.loading')}</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>
  if (!allowed) return <div className="p-4 text-[#9fb0b5]">{t('communities.no_access')}</div>
  const modalBillingProvider = String(billing?.billing_provider || 'stripe').toLowerCase()
  const modalStoreBilled = modalBillingProvider === 'apple' || modalBillingProvider === 'google'

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
        <div className="ml-2 font-semibold">{t('communities.manage_community')}</div>
      </div>

      <div className="app-subnav-offset max-w-2xl mx-auto px-3 pb-24" style={{ '--app-subnav-height': '48px' } as CSSProperties}>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">{t('communities.community_name')}</label>
            <input className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" value={name} onChange={e=> setName(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">{t('communities.description')}</label>
            <textarea
              className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none min-h-[96px]"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('communities.description_placeholder')}
              rows={3}
            />
            <div className="text-xs text-[#9fb0b5] mt-1">{t('communities.description_feed_hint')}</div>
          </div>
          {renderBillingCard()}
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">{t('communities.network_type_label')} <span className="text-[#4db6ac] text-xs">{t('communities.network_type_admin_only')}</span></label>
            <select 
              className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" 
              value={networkType} 
              onChange={e => setNetworkType(e.target.value)}
            >
              <option value="professional">{t('communities.network_professional')}</option>
              <option value="social">{t('communities.network_social')}</option>
              <option value="sports">{t('communities.network_sports')}</option>
              <option value="alumni">{t('communities.network_alumni')}</option>
              <option value="corporate">{t('communities.network_corporate')}</option>
              <option value="interest">{t('communities.network_interest')}</option>
              <option value="geographic">{t('communities.network_geographic')}</option>
              <option value="cause">{t('communities.network_cause')}</option>
              <option value="hybrid">{t('communities.network_hybrid')}</option>
            </select>
            <div className="text-xs text-[#9fb0b5] mt-1">{t('communities.network_type_hint')}</div>
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-2">{t('communities.notifications_label')}</label>
            <label className="flex items-center justify-between px-4 py-3 rounded-lg border border-white/15 bg-black hover:bg-white/5 cursor-pointer">
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{t('communities.notify_new_members')}</div>
                <div className="text-xs text-[#9fb0b5] mt-0.5">{t('communities.notify_new_members_hint')}</div>
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
            <label className="block text-sm text-[#9fb0b5] mb-1">{t('communities.member_limit_optional')}</label>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder={
                billing?.member_cap != null && billing.member_cap > 0
                  ? t('communities.member_limit_example', { count: billing.member_cap })
                  : t('communities.member_limit_example', { count: 25 })
              }
              className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none"
              value={maxMembers}
              onChange={e=> setMaxMembers(e.target.value.replace(/[^0-9]/g,''))}
            />
            <div className="text-xs text-[#9fb0b5] mt-1">
              {billing?.member_cap != null && billing.member_cap > 0 ? (
                <>
                  {t('communities.member_limit_plan_cap', { cap: billing.member_cap })}
                </>
              ) : (
                <>{t('communities.member_limit_when_set')}</>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">{t('communities.hierarchy_label')}</label>
            <div className="inline-flex rounded-full border border-white/15 overflow-hidden bg-black">
              <button
                type="button"
                className={`px-4 py-2 text-sm whitespace-nowrap ${!isChild ? 'bg-[#4db6ac] text-black' : 'text-[#cfd8dc] hover:bg-white/5'}`}
                onClick={()=> setIsChild(false)}
                aria-pressed={!isChild}
              >
                {t('communities.parent_community_button')}
              </button>
              <button
                type="button"
                className={`px-4 py-2 text-sm whitespace-nowrap ${isChild ? 'bg-[#4db6ac] text-black' : 'text-[#cfd8dc] hover:bg-white/5'}`}
                onClick={()=> setIsChild(true)}
                aria-pressed={isChild}
              >
                {t('communities.child_community_button')}
              </button>
            </div>
            {isChild && (
              <div className="mt-2">
                <label className="block text-xs text-[#9fb0b5] mb-1">{t('communities.select_parent_community')}</label>
                <select className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" value={selectedParentId} onChange={e=> setSelectedParentId(e.target.value)}>
                  <option value="none">{t('communities.none_option')}</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={String(p.id)}>{p.name}{p.type?` (${p.type})`:''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">{t('communities.community_image')}</label>
            
            {/* Current image preview */}
            {currentBackgroundPath && !removeBackground && !imageFile && (
              <div style={{ position: 'relative' }} className="mb-3 rounded-lg border border-white/10 overflow-hidden">
                <img 
                  src={resolveCommunityBackgroundUrl(currentBackgroundPath)} 
                  alt={t('communities.current_community_image_alt')} 
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
                  title={t('communities.remove_image')}
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
                  alt={t('communities.new_community_image_alt')} 
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
                  title={t('communities.remove_new_image')}
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
              </div>
            )}
            
            {removeBackground && !imageFile && (
              <div className="mb-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10 flex items-center justify-between">
                <span className="text-sm text-red-400">{t('communities.image_will_be_removed')}</span>
                <button
                  type="button"
                  className="text-xs text-[#9fb0b5] hover:text-white"
                  onClick={() => setRemoveBackground(false)}
                >
                  {t('communities.undo')}
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
          
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-2">{t('communities.steve_personality_label')}</label>
            <div className="rounded-lg border border-white/15 bg-black p-4">
              <p className="text-xs text-[#9fb0b5] mb-3">
                {t('communities.steve_personality_hint')}
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
                  <i className="fa-solid fa-spinner fa-spin mr-1" /> {t('communities.saving')}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#9fb0b5] mb-2">{t('communities.content_generation_label')}</label>
            <div className="rounded-lg border border-white/15 bg-black p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-white">{t('communities.steve_automations')}</div>
                <div className="text-xs text-[#9fb0b5] mt-1">
                  {t('communities.steve_automations_hint')}
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110 whitespace-nowrap"
                onClick={() => setShowContentGeneration(true)}
              >
                {t('communities.open_action')}
              </button>
            </div>
          </div>
          
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-2 rounded-md border border-white/10 hover:bg-white/5" onClick={()=> navigate(-1)}>{t('common.cancel')}</button>
            <button type="submit" className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110">{t('communities.save_changes')}</button>
          </div>
        </form>

        {/* Steve welcome post — Only for owners */}
        {isOwner && (
          <div className="mt-8 pt-6 border-t border-white/10">
            <div className="bg-[#4db6ac]/10 border border-[#4db6ac]/30 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-[#4db6ac] mb-2">{t('communities.welcome_post_title')}</h3>
              <p className="text-sm text-[#9fb0b5] mb-4">
                {t('communities.welcome_post_body')}
              </p>
              <button
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/communities/${community_id}/republish_welcome_post`, {
                      method: 'POST', credentials: 'include',
                    })
                    const j = await r.json().catch(() => null)
                    if (j?.success) {
                      alert(t('communities.welcome_post_republished'))
                    } else {
                      alert(j?.error === 'forbidden' ? t('communities.welcome_post_forbidden') : t('communities.welcome_post_failed'))
                    }
                  } catch {
                    alert(t('communities.welcome_post_failed'))
                  }
                }}
                className="px-4 py-2 bg-[#4db6ac] hover:brightness-110 text-black rounded-md font-medium transition-colors"
              >
                {t('communities.republish_welcome_post')}
              </button>
            </div>
          </div>
        )}

        {/* Delete Community Section - Only for owners */}
        {isOwner && (
          <div className="mt-8 pt-6 border-t border-white/10">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-red-400 mb-2">{t('communities.danger_zone_title')}</h3>
              <p className="text-sm text-[#9fb0b5] mb-4">
                {t('communities.danger_zone_body')}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={onToggleFreeze}
                  disabled={freezeLoading}
                  className="px-4 py-2 border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15 text-amber-100 rounded-md font-medium transition-colors disabled:opacity-50"
                >
                  {freezeLoading ? t('communities.updating') : isFrozen ? t('communities.unfreeze_community') : t('communities.freeze_community')}
                </button>
                <button 
                  type="button"
                  onClick={onDelete}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors"
                >
                  {t('communities.delete_community')}
                </button>
              </div>
              <p className="mt-3 text-xs text-[#9fb0b5]">
                {isFrozen
                  ? t('communities.frozen_member_note')
                  : t('communities.freeze_member_note')}
              </p>
            </div>
          </div>
        )}
      </div>
      {billing && showManageSubscriptionModal && !billing.is_inherited && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('communities.manage_subscription_modal_label')}
          onClick={() => setShowManageSubscriptionModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border-2 border-[#00CEC8] bg-black p-6 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#00CEC8]">{t('communities.billing_label')}</p>
                <h3 className="mt-2 text-lg font-semibold">{t('communities.manage_subscription')}</h3>
                <p className="mt-1 text-sm text-white/55">
                  {modalStoreBilled
                    ? t('communities.manage_subscription_modal_body_store', { provider: providerLabel(modalBillingProvider) })
                    : t('communities.manage_subscription_modal_body_stripe')}
                </p>
              </div>
              <button
                type="button"
                aria-label={t('common.close')}
                className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white"
                onClick={() => setShowManageSubscriptionModal(false)}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={modalStoreBilled}
                className="rounded-full bg-[#00CEC8] px-4 py-2.5 text-xs font-semibold text-black hover:bg-[#00CEC8]/90"
                onClick={() => {
                  setShowManageSubscriptionModal(false)
                  navigate(`/subscription_plans?mode=choose&open=community_plans&community_id=${community_id}`)
                }}
              >
                {t('communities.upgrade_community_tier')}
              </button>
              {['paid_l1', 'paid_l2', 'paid_l3'].includes(String(billing.tier || '').toLowerCase()) && (
                <button
                  type="button"
                  className="rounded-full border border-[#00CEC8]/50 px-4 py-2.5 text-xs font-semibold text-[#00CEC8] hover:bg-[#00CEC8]/10"
                  onClick={() => {
                    setShowManageSubscriptionModal(false)
                    navigate(`/subscription_plans?mode=choose&open=community_addons&community_id=${community_id}`)
                  }}
                >
                  {t('communities.subscribe_community_addon')}
                </button>
              )}
              <button
                type="button"
                disabled={!billing.has_stripe_customer && !modalStoreBilled}
                className="rounded-full border border-white/20 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  if (modalStoreBilled) {
                    openExternalBillingUrl(
                      modalBillingProvider === 'apple'
                        ? 'https://apps.apple.com/account/subscriptions'
                        : 'https://play.google.com/store/account/subscriptions',
                    )
                    return
                  }
                  void openCommunityBillingPortal()
                }}
              >
                {modalStoreBilled ? t('communities.open_store_subscriptions', { provider: providerLabel(modalBillingProvider) }) : t('communities.cancel_community_tier')}
              </button>
              <button
                type="button"
                className="mt-1 text-xs text-white/40 hover:text-white/70"
                onClick={() => setShowManageSubscriptionModal(false)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ContentGenerationModal
        communityId={String(community_id || '')}
        open={showContentGeneration}
        onClose={() => setShowContentGeneration(false)}
      />
      <DeleteCommunityModal
        open={showDeleteModal}
        communityName={name}
        onClose={() => setShowDeleteModal(false)}
        onSubmit={submitDelete}
      />
    </div>
  )
}

function formatBillingDate(value: string) {
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? value.split(' ')[0] : date.toLocaleDateString()
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = value >= 10 || unitIndex < 2 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}