import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { useUserProfile } from '../contexts/UserProfileContext'

type PersonalInfo = {
  display_name?: string | null
  date_of_birth?: string | null
  gender?: string | null
  country?: string | null
  city?: string | null
}

type ProfessionalInfo = {
  role?: string | null
  company?: string | null
  industry?: string | null
  linkedin?: string | null
  degree?: string | null
  school?: string | null
  skills?: string | null
  experience?: string | null
  about?: string | null
  interests?: string[] | null
  share_community_id?: number | null
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
}

export default function PublicProfile() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const { profile: currentUser } = useUserProfile()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [followStatus, setFollowStatus] = useState<'none' | 'pending' | 'accepted'>('none')
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [followLoading, setFollowLoading] = useState(false)
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
        const response = await fetch(`/api/profile/${encodeURIComponent(username)}`, { credentials: 'include' })
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
            setError(payload?.error || 'Profile not found')
          }
        }
      } catch {
        if (!cancelled) setError('Unable to load profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [username])

  useEffect(() => {
    const titleText = profile?.personal?.display_name || profile?.display_name || (username ? `@${username}` : 'Profile')
    setTitle(titleText)
  }, [profile, setTitle, username])

  const handleFollowToggle = async () => {
    if (!profile || !currentUsername) return
    if (followLoading) return
    setFollowLoading(true)
    try {
      const shouldDelete = followStatus === 'accepted' || followStatus === 'pending'
      const method = shouldDelete ? 'DELETE' : 'POST'
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
        const nextFollowers = Number(data.followers_count ?? followersCount)
        const nextFollowing = Number(data.following_count ?? followingCount)
        setFollowStatus(normalizedStatus)
        setFollowersCount(nextFollowers)
        setFollowingCount(nextFollowing)
        setProfile(prev => prev ? {
          ...prev,
          followers_count: nextFollowers,
          following_count: nextFollowing,
          is_following: normalizedStatus === 'accepted',
          follow_status: normalizedStatus,
          has_pending_follow_request: normalizedStatus === 'pending'
        } : prev)
      } else {
        const errMsg = data?.error || 'Failed to update follow status'
        alert(errMsg)
      }
    } catch (err) {
      console.error('Follow toggle error', err)
      alert('Failed to update follow status. Please try again.')
    } finally {
      setFollowLoading(false)
    }
  }

  if (loading) return <div className="glass-page min-h-screen text-white px-4">Loading…</div>
  if (error || !profile) return <div className="glass-page min-h-screen text-white px-4 text-red-400">{error || 'Profile not found'}</div>

  const personal = profile.personal || {}
  const professional = profile.professional || {}
  const isSelf = Boolean(profile.is_self) || (currentUsername && currentUsername.toLowerCase() === profile.username.toLowerCase())
  const bioText = (profile.bio || '').trim()
  const isFollowing = followStatus === 'accepted'
  const isPending = followStatus === 'pending'
  const followButtonLabel = followLoading
    ? (isFollowing ? 'Unfollowing…' : isPending ? 'Cancelling…' : 'Following…')
    : (isFollowing ? 'Following' : isPending ? 'Requested' : 'Follow')
  const followButtonClasses =
    followStatus === 'accepted'
      ? 'px-3 py-1.5 rounded-md text-sm font-medium transition border border-white/15 bg-white/15 text-white hover:bg-white/20'
      : isPending
        ? 'px-3 py-1.5 rounded-md text-sm font-medium transition border border-white/20 bg-white/5 text-[#9fb0b5]'
        : 'px-3 py-1.5 rounded-md text-sm font-medium transition bg-[#4db6ac] text-black hover:brightness-110'

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

  const hasProfessional =
    professional.role ||
    professional.company ||
    professional.industry ||
    professional.degree ||
    professional.school ||
    professional.skills ||
    professional.experience ||
    professional.about ||
    professional.linkedin
  const hasInterests = interestTags.length > 0

  const resolveMediaUrl = (value?: string | null) => {
    if (!value) return null
    if (value.startsWith('http')) return value
    if (value.startsWith('/uploads') || value.startsWith('/static')) return value
    if (value.startsWith('uploads')) return `/${value}`
    return `/uploads/${value}`
  }

  const profilePictureUrl = resolveMediaUrl(profile.profile_picture)

  return (
    <div className="glass-page min-h-screen text-white pb-10">
      <div className="glass-card glass-card--plain max-w-3xl mx-auto px-4 py-4 space-y-4">

        <section className="glass-section">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="rounded-full focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
              onClick={() => {
                if (profilePictureUrl) setPreviewImage(profilePictureUrl)
              }}
              aria-label="View profile picture"
            >
              <Avatar username={profile.username} url={profile.profile_picture || undefined} size={64} />
            </button>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-semibold text-lg leading-tight break-words">{profile.display_name || profile.username}</div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-[#cfd8dc]">
                <span className="truncate">@{profile.username}</span>
                {profile.subscription ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs uppercase tracking-wide text-white/80">
                    <i className="fa-solid fa-gem text-[10px]" />
                    {profile.subscription}
                  </span>
                ) : null}
              </div>
              {location ? (
                <div className="flex flex-wrap items-center gap-1 text-xs text-[#9fb0b5]">
                  <i className="fa-solid fa-location-dot" />
                  <span className="truncate">{location}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#9fb0b5]">
                <span><span className="text-white font-semibold">{followersCount}</span> followers</span>
                <span><span className="text-white font-semibold">{followingCount}</span> following</span>
              </div>
            </div>
              {isSelf ? (
                <button
                  className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-sm"
                  onClick={() => navigate('/profile')}
                >
                  <i className="fa-solid fa-pen-to-square mr-2" />
                  Edit profile
                </button>
              ) : (
                currentUsername && (
                  <div className="flex flex-col w-full gap-2 sm:flex-row sm:w-auto sm:items-center sm:gap-3">
                    <button
                      className={followButtonClasses}
                      disabled={followLoading}
                      onClick={handleFollowToggle}
                    >
                      {followButtonLabel}
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-sm"
                      onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(profile.username)}`)}
                    >
                      <i className="fa-regular fa-paper-plane mr-2" />
                      Send message
                    </button>
                  </div>
                )
              )}
            </div>
          </section>

        {(bioText || formattedDob || location) ? (
          <section className="glass-section space-y-3">
            <div className="font-semibold">Personal information</div>
            <div className="space-y-2 text-sm text-white/90">
              {bioText ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Bio:</span>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-white/90">{bioText}</p>
                </div>
              ) : null}
              {formattedDob ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Date of birth:</span>
                  {formattedDob}
                </div>
              ) : null}
              {location ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Location:</span>
                  {location}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {hasProfessional ? (
          <section className="glass-section space-y-3">
            <div className="font-semibold">Professional</div>
            <div className="space-y-2 text-sm text-white/90">
              {professional.about ? (
                <div className="text-white/90 leading-relaxed whitespace-pre-wrap">
                  {professional.about}
                </div>
              ) : null}
              {professional.role ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Current position:</span>
                  {professional.role}
                </div>
              ) : null}
              {professional.company ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Company:</span>
                  {professional.company}
                </div>
              ) : null}
              {professional.industry ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Industry:</span>
                  {professional.industry}
                </div>
              ) : null}
              {professional.degree ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Degree:</span>
                  {professional.degree}
                </div>
              ) : null}
              {professional.school ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">School:</span>
                  {professional.school}
                </div>
              ) : null}
              {professional.skills ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Skills:</span>
                  {professional.skills}
                </div>
              ) : null}
              {professional.experience ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Experience:</span>
                  {professional.experience}
                </div>
              ) : null}
              {professional.linkedin ? (
                <a
                  className="text-[#4db6ac] underline break-all"
                  href={professional.linkedin.startsWith('http') ? professional.linkedin : `https://${professional.linkedin}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  LinkedIn
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {hasInterests ? (
          <section className="glass-section space-y-2">
            <div className="font-semibold">Personal interests</div>
            <div className="flex flex-wrap gap-2">
              {interestTags.map(tag => (
                <span key={tag} className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs text-white">
                  #{tag}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {(profile.website || profile.instagram || profile.twitter) ? (
          <section className="glass-section space-y-2">
            <div className="font-semibold">Links</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {profile.website ? (
                <a
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/15 bg-white/10 text-[#4db6ac]"
                  href={profile.website.startsWith('http') ? profile.website : `http://${profile.website}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="fa-solid fa-globe" />
                  Website
                </a>
              ) : null}
              {profile.instagram ? (
                <a
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/15 bg-white/10 text-[#f58529]"
                  href={`https://instagram.com/${profile.instagram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="fa-brands fa-instagram" />
                  Instagram
                </a>
              ) : null}
              {profile.twitter ? (
                <a
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/15 bg-white/10 text-[#1d9bf0]"
                  href={`https://twitter.com/${profile.twitter.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <i className="fa-brands fa-x-twitter" />
                  Twitter / X
                </a>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
      {previewImage ? (
        <div
          className="fixed inset-0 z-[1200] bg-black/90 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewImage(null)
          }}
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center"
            onClick={() => setPreviewImage(null)}
            aria-label="Close preview"
          >
            <i className="fa-solid fa-xmark" />
          </button>
          <div className="w-[90vw] max-w-3xl">
            <ImageLoader
              src={previewImage}
              alt="Profile"
              className="w-full h-full object-contain rounded-lg border border-white/10"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
