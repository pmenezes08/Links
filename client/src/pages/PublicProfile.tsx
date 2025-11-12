import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

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
}

export default function PublicProfile() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null)

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

  if (loading) return <div className="min-h-screen pt-16 bg-black text-white px-4">Loading…</div>
  if (error || !profile) return <div className="min-h-screen pt-16 bg-black text-white px-4 text-red-400">{error || 'Profile not found'}</div>

  const personal = profile.personal || {}
  const professional = profile.professional || {}
  const isSelf = Boolean(profile.is_self)
  const bioText = (profile.bio || '').trim()

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
    interestTags.length ||
    professional.linkedin

  return (
    <div className="min-h-screen bg-black text-white pt-16 pb-10">
      <div className="max-w-3xl mx-auto px-4 space-y-4">
        <button
          className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 hover:bg-white/10 text-sm"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <i className="fa-solid fa-arrow-left" />
          Back
        </button>

          <section className="rounded-xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar username={profile.username} url={profile.profile_picture || undefined} size={64} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-lg truncate">{profile.display_name || profile.username}</div>
                <div className="text-sm text-[#9fb0b5] truncate">
                  @{profile.username}{profile.subscription ? ` • ${profile.subscription}` : ''}
                </div>
                {location ? (
                  <div className="text-xs text-[#9fb0b5] flex items-center gap-1">
                    <i className="fa-solid fa-location-dot" />
                    <span>{location}</span>
                  </div>
                ) : null}
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
                <button
                  className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-sm"
                  onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(profile.username)}`)}
                >
                  <i className="fa-regular fa-paper-plane mr-2" />
                  Send message
                </button>
              )}
            </div>
          </section>

        {(bioText || formattedDob || personal.gender || location) ? (
          <section className="rounded-xl border border-white/10 p-4 space-y-3">
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
              {personal.gender ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Gender:</span>
                  {personal.gender}
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
          <section className="rounded-xl border border-white/10 p-4 space-y-3">
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
              {interestTags.length ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Personal interests:</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {interestTags.map(tag => (
                      <span key={tag} className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs text-white">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {(profile.website || profile.instagram || profile.twitter) ? (
          <section className="rounded-xl border border-white/10 p-4 space-y-2">
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
    </div>
  )
}
