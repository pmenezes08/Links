import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import ProfileUnavailable from '../components/profile/ProfileUnavailable'
import { useUserProfile } from '../contexts/UserProfileContext'
import { renderTextWithSourceLinks } from '../utils/linkUtils'
import { profileIndustryLabel } from '../utils/profileOptionLabel'
import TranslateGlobeButton from '../components/TranslateGlobeButton'
import { useEntitlements } from '../hooks/useEntitlements'
import { SkeletonProfileShell } from '../components/SkeletonRow'
import { hapticImpactLight } from '../utils/haptics'
import { optimizeStoryImage, optimizeAvatar } from '../utils/imageOptimizer'
import { SEP_EM_DASH, formatDateRange } from '../utils/typography'
import { handleBasicProfileRequired } from '../utils/basicProfileGate'

type PersonalHighlight = {
  id?: string | null
  question?: string | null
  answer?: string | null
}

type StructuredWork = {
  title?: string | null
  company?: string | null
  location?: string | null
  start?: string | null
  end?: string | null
  description?: string | null
}

type StructuredEducation = {
  school?: string | null
  degree?: string | null
  start?: string | null
  end?: string | null
  description?: string | null
}

/** Parse a "YYYY-MM" (or looser "YYYY", "YYYY/M") value to a comparable month ordinal; -1 if absent. */
function ymToOrdinal(value?: string | null): number {
  const s = String(value || '').trim()
  const m = s.match(/(\d{4})(?:[-/](\d{1,2}))?/)
  if (!m) return -1
  const year = Number(m[1])
  const month = m[2] ? Math.min(12, Math.max(1, Number(m[2]))) : 12
  return year * 12 + month
}

/**
 * Standardise a career/education timeline to most-recent-first regardless of the
 * order the CV import produced (some CVs list oldest-first). Ongoing rows (no end,
 * or a "present"/"current" marker) float to the top; otherwise sort by end date
 * desc, then start date desc. Stable for equal keys so identical dates keep their
 * relative order. Pure (does not mutate the input).
 */
function sortTimelineByRecency<T extends { start?: string | null; end?: string | null }>(rows: T[]): T[] {
  const isOngoing = (r: T) => {
    const end = String(r.end || '').trim()
    return !end || /present|current|now|ongoing|atual|presente/i.test(end)
  }
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const ao = isOngoing(a.row)
      const bo = isOngoing(b.row)
      if (ao !== bo) return ao ? -1 : 1
      const endDiff = ymToOrdinal(b.row.end) - ymToOrdinal(a.row.end)
      if (endDiff !== 0) return endDiff
      const startDiff = ymToOrdinal(b.row.start) - ymToOrdinal(a.row.start)
      if (startDiff !== 0) return startDiff
      return a.idx - b.idx
    })
    .map(x => x.row)
}

function formatYmLabel(ym: string): string {
  if (!ym || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return ym || ''
  const [yStr, mStr] = ym.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym
  const d = new Date(y, m - 1, 1)
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(d)
}

function formatYmRange(start: string, end: string, presentLabel: string): string {
  const left = start ? formatYmLabel(start) : ''
  const right = end ? formatYmLabel(end) : presentLabel
  if (!left) return end ? right : ''
  return formatDateRange(left, right)
}

type PersonalInfo = {
  display_name?: string | null
  first_name?: string | null
  last_name?: string | null
  date_of_birth?: string | null
  gender?: string | null
  country?: string | null
  city?: string | null
  highlights?: PersonalHighlight[] | null
}

type ProfessionalInfo = {
  role?: string | null
  company?: string | null
  company_intel?: string | null
  industry?: string | null
  linkedin?: string | null
  degree?: string | null
  school?: string | null
  skills?: string | null
  experience?: string | null
  about?: string | null
  interests?: string[] | null
  share_community_id?: number | null
  current_role_start?: string | null
  work_history?: StructuredWork[] | null
  education?: StructuredEducation[] | null
}

type PublicProfileResponse = {
  username: string
  display_name?: string | null
  bio?: string | null
  location?: string | null
  subscription?: string | null
  profile_picture?: string | null
  cover_photo?: string | null
  personal?: PersonalInfo
  professional?: ProfessionalInfo
  website?: string | null
  instagram?: string | null
  twitter?: string | null
  is_self?: boolean
  followers_count?: number
  following_count?: number
  is_following?: boolean
  follow_status?: 'none' | 'pending' | 'accepted' | 'self'
  has_pending_follow_request?: boolean
  ai_enhanced?: Record<string, any>
}

type ManageableCommunity = {
  id: number
  name: string
  parent_community_id?: number | null
  target_is_member?: boolean
}

export default function PublicProfile() {
  const { t } = useTranslation()
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const { profile: currentUser } = useUserProfile()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const previewImgRef = useRef<HTMLImageElement>(null)

  // A browser-cached full image may be `complete` before onLoad fires — reveal it immediately so it never stays hidden behind the placeholder.
  useEffect(() => {
    if (!previewImage) return
    const img = previewImgRef.current
    if (img && img.complete && img.naturalWidth > 0) setPreviewLoaded(true)
  }, [previewImage])
  const [followStatus, setFollowStatus] = useState<'none' | 'pending' | 'accepted'>('none')
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [followLoading, setFollowLoading] = useState(false)
  const [manageableCommunities, setManageableCommunities] = useState<ManageableCommunity[]>([])
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [selectedInviteCommunityIds, setSelectedInviteCommunityIds] = useState<number[]>([])
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [personalTranslated, setPersonalTranslated] = useState<string | null>(null)
  const [professionalTranslated, setProfessionalTranslated] = useState<string | null>(null)
  const { entitlements } = useEntitlements()
  const canTranslateProfile = Boolean(entitlements?.can_use_steve)
  const currentUsername = useMemo(() => {
    if (!currentUser || typeof currentUser !== 'object') return ''
    const record = currentUser as Record<string, any>
    const direct = typeof record.username === 'string' ? record.username : ''
    if (direct) return direct
    const nested = record.profile
    if (nested && typeof nested === 'object' && typeof (nested as any).username === 'string') {
      return (nested as any).username
    }
    return ''
  }, [currentUser])

  useEffect(() => {
    if (!username) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch(`/api/profile/${encodeURIComponent(username)}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const payload = await response.json().catch(() => null)
        if (!cancelled) {
          if (payload?.success && payload.profile) {
            setProfile(payload.profile)
            const rawStatus = (payload.profile.follow_status as string | undefined) || (payload.profile.is_following ? 'accepted' : 'none')
            const normalizedStatus: 'none' | 'pending' | 'accepted' =
              rawStatus === 'accepted' ? 'accepted' : rawStatus === 'pending' ? 'pending' : 'none'
            setFollowStatus(normalizedStatus)
            setFollowersCount(Number(payload.profile.followers_count || 0))
            setFollowingCount(Number(payload.profile.following_count || 0))
            setError(null)
          } else {
            setError(payload?.error || t('profile.error.not_found'))
          }
        }
      } catch {
        if (!cancelled) setError(t('profile.error.load_failed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [username, t])

  useEffect(() => {
    setPersonalTranslated(null)
    setProfessionalTranslated(null)
  }, [username])

  useEffect(() => {
    setTitle(t('profile.page_title'))
  }, [setTitle, t])

  useEffect(() => {
    if (!profile || !currentUsername || profile.is_self) {
      setManageableCommunities([])
      return
    }

    const profileUsername = profile.username
    let cancelled = false
    async function loadManageableCommunities() {
      try {
        const resp = await fetch(`/api/community/manageable?target_username=${encodeURIComponent(profileUsername)}`, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        })
        const data = await resp.json().catch(() => null)
        if (cancelled) return
        if (data?.success && Array.isArray(data.communities)) {
          setManageableCommunities(data.communities)
        } else {
          setManageableCommunities([])
        }
      } catch {
        if (!cancelled) setManageableCommunities([])
      }
    }

    loadManageableCommunities()
    return () => {
      cancelled = true
    }
  }, [currentUsername, profile])

  const handleFollowToggle = async () => {
    if (!profile || !currentUsername) return
    if (followLoading) return
    const shouldDelete = followStatus === 'accepted' || followStatus === 'pending'
    const method = shouldDelete ? 'DELETE' : 'POST'

    // Snapshot for rollback if the request fails.
    const prevStatus = followStatus
    const prevFollowers = followersCount
    const prevFollowing = followingCount

    // Optimistic: flip the button and the viewed profile's follower count NOW so the
    // tap feels native. We can't yet know public(accepted) vs private(pending) on a
    // new follow, so guess 'accepted' (the common case) and reconcile from the server
    // response below — a private account corrects to 'pending' on success.
    const wasAccepted = prevStatus === 'accepted'
    const optimisticStatus: 'none' | 'pending' | 'accepted' = shouldDelete ? 'none' : 'accepted'
    const optimisticFollowers = shouldDelete
      ? Math.max(0, prevFollowers - (wasAccepted ? 1 : 0))
      : prevFollowers + 1
    const applyState = (
      status: 'none' | 'pending' | 'accepted',
      followers: number,
      following: number,
    ) => {
      setFollowStatus(status)
      setFollowersCount(followers)
      setFollowingCount(following)
      setProfile(prev => prev ? {
        ...prev,
        followers_count: followers,
        following_count: following,
        is_following: status === 'accepted',
        follow_status: status,
        has_pending_follow_request: status === 'pending',
      } : prev)
    }
    applyState(optimisticStatus, optimisticFollowers, prevFollowing)

    setFollowLoading(true)
    try {
      const resp = await fetch(`/api/follow/${encodeURIComponent(profile.username)}`, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await resp.json().catch(() => null)
      if (data?.success) {
        const nextStatusRaw = typeof data.status === 'string' ? data.status : (shouldDelete ? 'none' : 'pending')
        const normalizedStatus: 'none' | 'pending' | 'accepted' =
          nextStatusRaw === 'accepted' ? 'accepted' : nextStatusRaw === 'pending' ? 'pending' : 'none'
        // Reconcile with authoritative server counts.
        applyState(
          normalizedStatus,
          Number(data.followers_count ?? optimisticFollowers),
          Number(data.following_count ?? prevFollowing),
        )
      } else {
        applyState(prevStatus, prevFollowers, prevFollowing) // roll back
        alert(data?.error || t('profile.public.follow_failed'))
      }
    } catch (err) {
      console.error('Follow toggle error', err)
      applyState(prevStatus, prevFollowers, prevFollowing) // roll back
      alert(t('profile.public.follow_failed_retry'))
    } finally {
      setFollowLoading(false)
    }
  }

  const handleOpenInviteModal = () => {
    const available = manageableCommunities.filter(c => !c.parent_community_id && !c.target_is_member)
    setSelectedInviteCommunityIds(available.length > 0 ? [available[0].id] : [])
    setInviteError('')
    setInviteSuccess('')
    setInviteModalOpen(true)
  }

  const handleSendProfileInvite = async () => {
    if (!profile) return
    if (selectedInviteCommunityIds.length === 0) {
      setInviteError(t('profile.invite.select_at_least_one'))
      return
    }

    setInviteSubmitting(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      const results = await Promise.all(selectedInviteCommunityIds.map(async communityId => {
        const resp = await fetch('/api/community/invite_username', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ community_id: communityId, username: profile.username })
        })
        const data = await resp.json().catch(() => null)
        if (handleBasicProfileRequired(data)) {
          throw new Error('__basic_profile_required__')
        }
        if (!resp.ok || !data?.success) {
          throw new Error(data?.error || t('profile.invite.send_failed'))
        }
        return data
      }))

      setInviteSuccess(
        results.length === 1
          ? (results[0]?.message || t('profile.invite.sent_if_exists'))
          : t('profile.invite.sent_multiple_generic', { count: results.length })
      )
      setSelectedInviteCommunityIds([])
    } catch (err) {
      if (err instanceof Error && err.message === '__basic_profile_required__') return
      setInviteError(err instanceof Error ? err.message : t('profile.invite.send_failed'))
    } finally {
      setInviteSubmitting(false)
    }
  }

  const presentLabel = t('profile.public.present')

  if (loading) return (
    <div className="glass-page min-h-screen bg-c-bg-app text-c-text-primary pb-10">
      <div className="max-w-3xl mx-auto px-4 pt-2 pb-2">
        <button
          className="flex items-center gap-2 text-c-text-tertiary hover:text-c-text-primary transition-colors"
          onClick={() => { hapticImpactLight(); navigate(-1) }}
          aria-label={t('profile.aria.go_back')}
        >
          <i className="fa-solid fa-arrow-left" />
          <span className="text-sm">{t('profile.public.back')}</span>
        </button>
      </div>
      <div className="glass-card glass-card--plain max-w-3xl mx-auto px-4 py-4">
        <SkeletonProfileShell />
      </div>
    </div>
  )
  if (error || !profile) return <ProfileUnavailable />

  const personal = profile.personal || {}
  const professional = profile.professional || {}
  const isSelf = Boolean(profile.is_self) || (currentUsername && currentUsername.toLowerCase() === profile.username.toLowerCase())
  const bioText = (profile.bio || '').trim()
  const isFollowing = followStatus === 'accepted'
  const isPending = followStatus === 'pending'
  const rootManageableCommunities = manageableCommunities.filter(c => !c.parent_community_id)
  const inviteableCommunities = rootManageableCommunities.filter(c => !c.target_is_member)
  const followButtonLabel = followLoading
    ? (isFollowing ? t('profile.public.unfollowing_loading') : isPending ? t('profile.public.cancelling_loading') : t('profile.public.following_loading'))
    : (isFollowing ? t('profile.public.following') : isPending ? t('profile.public.requested') : t('profile.public.follow'))
  const followButtonClasses =
    followStatus === 'accepted'
      ? 'px-3 py-1.5 rounded-md text-sm font-medium transition border border-c-border bg-c-hover-bg text-c-text-primary hover:bg-c-hover-bg'
      : isPending
        ? 'px-3 py-1.5 rounded-md text-sm font-medium transition border border-c-border bg-c-hover-bg text-c-text-tertiary'
        : 'px-3 py-1.5 rounded-md text-sm font-medium transition bg-cpoint-turquoise text-black hover:brightness-110'

  let formattedDob = ''
  if (personal.date_of_birth) {
    const date = new Date(personal.date_of_birth)
    if (!Number.isNaN(date.getTime())) {
      formattedDob = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date)
    }
  }

  const location = personal.city || personal.country
    ? [personal.city, personal.country].filter(Boolean).join(', ')
    : profile.location || ''

  const interestTags = Array.isArray(professional.interests)
    ? professional.interests
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : []

  const workTimeline = sortTimelineByRecency(
    Array.isArray(professional.work_history) ? professional.work_history : [],
  )
  const eduTimeline = sortTimelineByRecency(
    Array.isArray(professional.education) ? professional.education : [],
  )
  const highlightItems = Array.isArray(personal.highlights)
    ? personal.highlights.filter(h => h && String(h.answer || '').trim())
    : []
  const hasPersonalHighlights = highlightItems.length > 0
  const hasStructuredWork = workTimeline.some(
    w => w && (String(w.title || '').trim() || String(w.company || '').trim() || String(w.description || '').trim()),
  )
  const hasStructuredEdu = eduTimeline.some(
    e => e && (String(e.school || '').trim() || String(e.degree || '').trim() || String(e.description || '').trim()),
  )
  const currentRoleStartYm = professional.current_role_start ? String(professional.current_role_start).trim() : ''

  const hasProfessional =
    professional.role ||
    professional.company ||
    (professional.company_intel && String(professional.company_intel).trim()) ||
    professional.industry ||
    professional.degree ||
    professional.school ||
    professional.skills ||
    professional.experience ||
    professional.about ||
    professional.linkedin ||
    currentRoleStartYm ||
    hasStructuredWork ||
    hasStructuredEdu
  const hasInterests = interestTags.length > 0

  const personalSourceText = [
    bioText,
    ...highlightItems.map(h => String(h.answer || '').trim()),
  ].filter(Boolean).join('\n\n')

  const professionalSourceText = [
    professional.about ? String(professional.about).trim() : '',
    professional.role ? `${t('profile.public.current_position')}: ${professional.role}` : '',
    professional.company ? `${t('profile.public.company')}: ${professional.company}` : '',
    professional.experience ? String(professional.experience).trim() : '',
    professional.skills ? String(professional.skills).trim() : '',
  ].filter(Boolean).join('\n\n')

  const resolveMediaUrl = (value?: string | null) => {
    if (!value) return null
    if (value.startsWith('http')) return value
    if (value.startsWith('/uploads') || value.startsWith('/static')) return value
    if (value.startsWith('uploads')) return `/${value}`
    return `/uploads/${value}`
  }

  const profilePictureUrl = resolveMediaUrl(profile.profile_picture)

  return (
    <div className="glass-page min-h-screen bg-c-bg-app text-c-text-primary pb-10">
      {/* Back button header */}
      <div className="max-w-3xl mx-auto px-4 pt-2 pb-2">
        <button 
          className="flex items-center gap-2 text-c-text-tertiary hover:text-c-text-primary transition-colors"
          onClick={() => { hapticImpactLight(); navigate(-1) }}
          aria-label={t('profile.aria.go_back')}
        >
          <i className="fa-solid fa-arrow-left" />
          <span className="text-sm">{t('profile.public.back')}</span>
        </button>
      </div>
      <div className="glass-card glass-card--plain max-w-3xl mx-auto px-4 py-4 space-y-4">

        <section className="glass-section">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="rounded-full focus:outline-none focus:ring-2 focus:ring-cpoint-turquoise"
              onClick={() => {
                if (profilePictureUrl) { setPreviewLoaded(false); setPreviewImage(profilePictureUrl) }
              }}
              aria-label={t('profile.aria.view_profile_picture')}
            >
              <Avatar username={profile.username} url={profile.profile_picture || undefined} size={64} />
            </button>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-semibold text-lg leading-tight break-words">{profile.display_name || profile.username}</div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-c-text-secondary">
                <span className="truncate">@{profile.username}</span>
                {profile.subscription ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-c-active-bg px-2 py-0.5 text-xs uppercase tracking-wide text-c-text-secondary">
                    <i className="fa-solid fa-gem text-[10px]" />
                    {profile.subscription}
                  </span>
                ) : null}
              </div>
              {(personal.first_name || personal.last_name) ? (
                <div className="text-sm text-c-text-secondary font-medium">
                  {[personal.first_name, personal.last_name].filter(Boolean).join(' ')}
                </div>
              ) : null}
              {location ? (
                <div className="flex flex-wrap items-center gap-1 text-xs text-c-text-tertiary">
                  <i className="fa-solid fa-location-dot" />
                  <span className="truncate">{location}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-c-text-tertiary">
                <span><span className="text-c-text-primary font-semibold">{followersCount}</span> {t('profile.public.followers')}</span>
                <span><span className="text-c-text-primary font-semibold">{followingCount}</span> {t('profile.public.following_count')}</span>
              </div>
            </div>
              {!isSelf && currentUsername && (
                <div className="flex flex-col w-full gap-2 sm:flex-row sm:w-auto sm:items-center sm:gap-3">
                  <button
                    className={followButtonClasses}
                    disabled={followLoading}
                    onClick={handleFollowToggle}
                  >
                    {followButtonLabel}
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-md border border-c-border hover:bg-c-hover-bg text-sm"
                    onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(profile.username)}`)}
                  >
                    <i className="fa-regular fa-paper-plane mr-2" />
                    {t('profile.public.send_message')}
                  </button>
                  {inviteableCommunities.length > 0 ? (
                    <button
                      className="px-3 py-1.5 rounded-md bg-cpoint-turquoise/15 border border-cpoint-turquoise/35 text-cpoint-turquoise hover:bg-cpoint-turquoise/25 text-sm"
                      onClick={handleOpenInviteModal}
                    >
                      <i className="fa-solid fa-user-plus mr-2" />
                      {t('profile.public.invite_to_community')}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

        {isSelf ? (
          <button
            className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium bg-c-bg-app border border-c-border rounded hover:bg-c-hover-bg transition"
            onClick={() => navigate('/profile')}
          >
            <i className="fa-solid fa-pen-to-square" />
            {t('profile.public.edit_profile')}
          </button>
        ) : null}

        {(bioText || formattedDob || location || hasPersonalHighlights) ? (
          <section className="glass-section space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{t('profile.personal.title')}</div>
              {canTranslateProfile && personalSourceText ? (
                <div className="flex items-center gap-1">
                  {personalTranslated ? (
                    <button
                      type="button"
                      className="text-cpoint-turquoise hover:text-cpoint-turquoise/80 text-xs px-1"
                      title={t('feed.show_original')}
                      onClick={() => setPersonalTranslated(null)}
                    >
                      <i className="fa-solid fa-rotate-left" />
                    </button>
                  ) : null}
                  <TranslateGlobeButton
                    text={personalSourceText}
                    context="profile"
                    onTranslated={setPersonalTranslated}
                  />
                </div>
              ) : null}
            </div>
            {personalTranslated ? (
              <p className="text-sm text-c-text-primary whitespace-pre-wrap leading-relaxed">{personalTranslated}</p>
            ) : (
            <div className="space-y-2 text-sm text-c-text-primary">
              {bioText ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.bio')}</span>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-c-text-primary">{renderTextWithSourceLinks(bioText)}</p>
                </div>
              ) : null}
              {formattedDob ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.date_of_birth')}</span>
                  {formattedDob}
                </div>
              ) : null}
              {location ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.location')}</span>
                  {location}
                </div>
              ) : null}
              {hasPersonalHighlights ? (
                <details className="group mt-2 rounded-lg border border-c-border bg-c-hover-bg open:bg-c-bg-surface">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-c-text-primary select-none [&::-webkit-details-marker]:hidden">
                    <span className="text-c-text-primary">{t('profile.public.spotlight_answers')}</span>
                    <i className="fa-solid fa-chevron-down text-xs text-c-text-tertiary transition-transform group-open:rotate-180" aria-hidden={true} />
                  </summary>
                  <div className="space-y-4 border-t border-c-border px-3 py-3 text-sm">
                    {highlightItems.map(h => (
                      <div key={h.id || `${h.question}-${h.answer}`}>
                        <div className="text-c-text-tertiary text-xs mb-1">{h.question || ''}</div>
                        <p className="whitespace-pre-wrap leading-relaxed text-c-text-primary">
                          {renderTextWithSourceLinks(String(h.answer || '').trim())}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
            )}
          </section>
        ) : null}

        {hasProfessional ? (
          <section className="glass-section space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{t('profile.public.professional')}</div>
              {canTranslateProfile && professionalSourceText ? (
                <div className="flex items-center gap-1">
                  {professionalTranslated ? (
                    <button
                      type="button"
                      className="text-cpoint-turquoise hover:text-cpoint-turquoise/80 text-xs px-1"
                      title={t('feed.show_original')}
                      onClick={() => setProfessionalTranslated(null)}
                    >
                      <i className="fa-solid fa-rotate-left" />
                    </button>
                  ) : null}
                  <TranslateGlobeButton
                    text={professionalSourceText}
                    context="profile"
                    onTranslated={setProfessionalTranslated}
                  />
                </div>
              ) : null}
            </div>
            {professionalTranslated ? (
              <p className="text-sm text-c-text-primary whitespace-pre-wrap leading-relaxed">{professionalTranslated}</p>
            ) : (
            <div className="space-y-2 text-sm text-c-text-primary">
              {professional.about ? (
                <div className="text-c-text-primary leading-relaxed whitespace-pre-wrap">
                  {professional.about}
                </div>
              ) : null}
              {professional.role ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.current_position')}</span>
                  {professional.role}
                </div>
              ) : null}
              {professional.company ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.company')}</span>
                  {professional.company}
                </div>
              ) : null}
              {professional.company_intel?.trim() ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.company_intel')}</span>
                  <span className="whitespace-pre-wrap leading-relaxed">{renderTextWithSourceLinks(professional.company_intel.trim())}</span>
                </div>
              ) : null}
              {professional.industry ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.industry')}</span>
                  {profileIndustryLabel(professional.industry, t)}
                </div>
              ) : null}
              {(currentRoleStartYm && (professional.role || professional.company)) || hasStructuredWork || hasStructuredEdu ? (
                <details className="group mt-2 rounded-lg border border-c-border bg-c-hover-bg open:bg-c-bg-surface">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-c-text-primary select-none [&::-webkit-details-marker]:hidden">
                    <span className="text-c-text-primary">{t('profile.public.career_timeline')}</span>
                    <i className="fa-solid fa-chevron-down text-xs text-c-text-tertiary transition-transform group-open:rotate-180" aria-hidden={true} />
                  </summary>
                  <div className="space-y-3 border-t border-c-border px-3 py-3 text-sm text-c-text-primary">
                    {currentRoleStartYm && (professional.role || professional.company) ? (
                      <div>
                        <span className="text-c-text-tertiary mr-2">{t('profile.public.in_role_since')}</span>
                        {formatYmRange(currentRoleStartYm, '', presentLabel)}
                      </div>
                    ) : null}
                    {hasStructuredWork ? (
                      <div className="space-y-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-c-text-tertiary">{t('profile.public.experience')}</div>
                        {workTimeline.map((w, idx) => {
                          if (!w) return null
                          const title = String(w.title || '').trim()
                          const company = String(w.company || '').trim()
                          const loc = String(w.location || '').trim()
                          const desc = String(w.description || '').trim()
                          const start = String(w.start || '').trim()
                          const end = String(w.end || '').trim()
                          if (!title && !company && !desc) return null
                          return (
                            <div key={idx} className="border-l-2 border-cpoint-turquoise/35 pl-3 space-y-1">
                              <div className="font-medium text-c-text-primary">
                                {[title, company].filter(Boolean).join(' · ') || company || title || t('profile.public.role_fallback')}
                              </div>
                              {loc ? <div className="text-xs text-c-text-tertiary">{loc}</div> : null}
                              {start || end ? (
                                <div className="text-xs text-c-text-tertiary">{formatYmRange(start, end, presentLabel)}</div>
                              ) : null}
                              {desc ? (
                                <p className="whitespace-pre-wrap leading-relaxed text-c-text-primary">{desc}</p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                    {hasStructuredEdu ? (
                      <div className="space-y-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-c-text-tertiary">{t('profile.public.education')}</div>
                        {eduTimeline.map((e, idx) => {
                          if (!e) return null
                          const school = String(e.school || '').trim()
                          const degree = String(e.degree || '').trim()
                          const desc = String(e.description || '').trim()
                          const start = String(e.start || '').trim()
                          const end = String(e.end || '').trim()
                          if (!school && !degree && !desc) return null
                          return (
                            <div key={idx} className="border-l-2 border-c-border pl-3 space-y-1">
                              <div className="font-medium text-c-text-primary">{[school, degree].filter(Boolean).join(' · ')}</div>
                              {start || end ? (
                                <div className="text-xs text-c-text-tertiary">{formatYmRange(start, end, presentLabel)}</div>
                              ) : null}
                              {desc ? (
                                <p className="whitespace-pre-wrap leading-relaxed text-c-text-primary">{desc}</p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
              {professional.degree ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.degree')}</span>
                  {professional.degree}
                </div>
              ) : null}
              {professional.school ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.school')}</span>
                  {professional.school}
                </div>
              ) : null}
              {professional.skills ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.skills')}</span>
                  {professional.skills}
                </div>
              ) : null}
              {professional.experience ? (
                <div>
                  <span className="text-c-text-tertiary mr-2">{t('profile.public.experience_legacy')}</span>
                  {professional.experience}
                </div>
              ) : null}
              {professional.linkedin ? (
                <a
                  className="text-cpoint-turquoise underline break-all"
                  href={professional.linkedin.startsWith('http') ? professional.linkedin : `https://${professional.linkedin}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('profile.public.linkedin')}
                </a>
              ) : null}
            </div>
            )}
          </section>
        ) : null}

        {hasInterests ? (
          <section className="glass-section space-y-2">
            <div className="font-semibold">{t('profile.interests.title')}</div>
            <div className="flex flex-wrap gap-2">
              {interestTags.map(tag => (
                <span key={tag} className="inline-flex items-center rounded-full bg-c-hover-bg px-3 py-1 text-xs text-c-text-primary">
                  #{tag}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {(profile.website || profile.instagram || profile.twitter) ? (
          <section className="glass-section space-y-2">
            <div className="font-semibold">{t('profile.public.links')}</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {profile.website ? (
                <a
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-c-border bg-c-active-bg text-cpoint-turquoise"
                  href={profile.website.startsWith('http') ? profile.website : `http://${profile.website}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="fa-solid fa-globe" />
                  {t('profile.public.website')}
                </a>
              ) : null}
              {profile.instagram ? (
                <a
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-c-border bg-c-active-bg text-[#f58529]"
                  href={`https://instagram.com/${profile.instagram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="fa-brands fa-instagram" />
                  {t('profile.public.instagram')}
                </a>
              ) : null}
              {profile.twitter ? (
                <a
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-c-border bg-c-active-bg text-[#1d9bf0]"
                  href={`https://twitter.com/${profile.twitter.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="fa-brands fa-x-twitter" />
                  {t('profile.public.twitter')}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {profile.ai_enhanced && Object.keys(profile.ai_enhanced).length > 0 ? (
          <section className="glass-section space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <i className="fa-solid fa-wand-magic-sparkles text-cpoint-turquoise text-sm" />
              {t('profile.public.ai_about')}
            </div>
            <div className="space-y-2">
              {Object.entries(profile.ai_enhanced).map(([key, val]) => {
                if (!val) return null
                const labelKey: Record<string, string> = {
                  summary: 'profile.public.ai_summary',
                  identity: 'profile.public.ai_identity',
                  professional: 'profile.public.ai_professional',
                  personal: 'profile.public.ai_personal',
                  networkingValue: 'profile.public.ai_networking',
                  interests: 'profile.public.ai_interests',
                  conversationStarters: 'profile.public.ai_conversation_starters',
                }
                let text = ''
                if (typeof val === 'string') text = val
                else if (key === 'identity' && typeof val === 'object')
                  text = [val.bridgeInsight, val.drivingForces].filter(Boolean).join(SEP_EM_DASH)
                else if (key === 'professional' && typeof val === 'object') {
                  const parts: string[] = []
                  if (val.company?.description) parts.push(`${val.company.name}: ${val.company.description}`)
                  if (val.role?.title) parts.push(val.role.title + (val.role.implication ? `${SEP_EM_DASH}${val.role.implication}` : ''))
                  if (val.education) parts.push(val.education)
                  if (val.location?.context) parts.push(val.location.context)
                  text = parts.join('. ')
                }
                else if (key === 'personal' && typeof val === 'object') {
                  const parts: string[] = []
                  if (val.lifestyle) parts.push(val.lifestyle)
                  if (val.interests?.length) parts.push(val.interests.join(', '))
                  text = parts.join('. ')
                }
                else if (key === 'interests' && typeof val === 'object' && !Array.isArray(val))
                  text = Object.keys(val).join(', ')
                else if (key === 'conversationStarters' && Array.isArray(val))
                  text = val.join('. ')
                else text = typeof val === 'object' ? '' : String(val)
                if (!text) return null
                return (
                  <div key={key} className="text-sm text-c-text-primary">
                    <span className="text-c-text-secondary text-xs font-medium">{labelKey[key] ? t(labelKey[key]) : key}</span>
                    <p className="mt-0.5 leading-relaxed">{renderTextWithSourceLinks(text)}</p>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
      {previewImage ? (
        <div
          className="fixed inset-0 z-[1200] overflow-hidden bg-black/90 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewImage(null)
          }}
        >
          {/* Instant blurred backdrop from the already-cached avatar — fills the gap while the full image streams in */}
          {profilePictureUrl ? (
            <img
              src={optimizeAvatar(profilePictureUrl, 64)}
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 w-full h-full object-cover scale-125 blur-3xl transition-opacity duration-500 ${previewLoaded ? 'opacity-0' : 'opacity-50'}`}
            />
          ) : null}
          <button
            type="button"
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-c-active-bg hover:bg-c-hover-bg border border-c-border text-c-text-primary flex items-center justify-center"
            onClick={() => setPreviewImage(null)}
            aria-label={t('profile.aria.close_preview')}
          >
            <i className="fa-solid fa-xmark" />
          </button>
          <div
            className="relative flex items-center justify-center w-[90vw] max-w-3xl"
            style={{ maxHeight: 'calc(100vh - 6rem)' }}
          >
            <img
              ref={previewImgRef}
              src={optimizeStoryImage(previewImage)}
              alt={t('profile.alt.profile')}
              onLoad={() => setPreviewLoaded(true)}
              className={`max-w-full max-h-full object-contain rounded-lg border border-c-border transition-opacity duration-300 ${previewLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
        </div>
      ) : null}
      {inviteModalOpen ? (
        <div
          className="fixed inset-0 z-50 bg-c-bg-overlay backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => e.currentTarget === e.target && setInviteModalOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl border border-c-border bg-c-bg-surface p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{t('profile.invite.title', { username: profile.username })}</h2>
                <p className="text-xs text-c-text-tertiary">{t('profile.invite.subtitle')}</p>
              </div>
              <button className="p-2 rounded-lg hover:bg-c-hover-bg" onClick={() => setInviteModalOpen(false)} aria-label={t('profile.aria.close_invite_modal')}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            {inviteSuccess ? (
              <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                {inviteSuccess}
              </div>
            ) : null}
            {inviteError ? (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {inviteError}
              </div>
            ) : null}

            <div className="max-h-72 overflow-y-auto space-y-2">
              {rootManageableCommunities.map(community => {
                const disabled = !!community.target_is_member
                const selected = selectedInviteCommunityIds.includes(community.id)
                return (
                  <button
                    key={community.id}
                    type="button"
                    disabled={disabled || inviteSubmitting}
                    onClick={() => {
                      setInviteError('')
                      setInviteSuccess('')
                      setSelectedInviteCommunityIds(prev =>
                        prev.includes(community.id)
                          ? prev.filter(id => id !== community.id)
                          : [...prev, community.id]
                      )
                    }}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-45 disabled:cursor-not-allowed ${
                      selected
                        ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/15 text-c-text-primary'
                        : 'border-c-border bg-c-bg-surface text-c-text-secondary hover:bg-c-hover-bg'
                    }`}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-c-border bg-c-bg-elevated text-[10px] text-c-text-secondary">
                      {selected ? <i className="fa-solid fa-check text-cpoint-turquoise" /> : null}
                    </span>
                    <span className="ml-2">{community.name}</span>
                    {disabled ? <span className="ml-2 text-xs text-c-text-tertiary">{t('profile.invite.already_member')}</span> : null}
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 rounded-lg bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50"
                disabled={inviteSubmitting || selectedInviteCommunityIds.length === 0}
                onClick={handleSendProfileInvite}
              >
                {inviteSubmitting ? t('profile.invite.sending') : t('profile.invite.send')}
              </button>
              <button
                className="px-4 py-2 rounded-lg border border-c-border bg-c-hover-bg text-sm hover:bg-c-hover-bg"
                disabled={inviteSubmitting}
                onClick={() => setInviteModalOpen(false)}
              >
                {t('profile.close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
