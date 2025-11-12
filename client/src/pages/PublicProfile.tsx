import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'

export default function PublicProfile() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => {
    const displayLabel = profile?.personal?.display_name || profile?.display_name || (username ? `@${username}` : 'Profile')
    setTitle(displayLabel)
  }, [profile, setTitle, username])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const response = await fetch(`/api/profile/${encodeURIComponent(username)}`)
        const payload = await response.json().catch(() => null)
        if (!mounted) return
        if (payload?.success) {
          setProfile(payload.profile)
          setError(null)
        } else {
          setError(payload?.error || 'Profile not found')
        }
      } catch {
        if (mounted) setError('Error loading profile')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    if (username) load()
    return () => {
      mounted = false
    }
  }, [username])

  if (loading) return <div className="min-h-screen pt-16 bg-gradient-to-b from-[#050b14] via-[#03060d] to-black text-white px-4">Loading…</div>
  if (error) return <div className="min-h-screen pt-16 bg-gradient-to-b from-[#050b14] via-[#03060d] to-black text-white px-4 text-red-400">{error}</div>
  if (!profile) return <div className="min-h-screen pt-16 bg-gradient-to-b from-[#050b14] via-[#03060d] to-black text-white px-4">No profile.</div>

  const personal = profile.personal || {}
  const professional = profile.professional || {}
  const isSelf = Boolean(profile.is_self)

  const formattedDob = useMemo(() => {
    const dob = personal.date_of_birth
    if (!dob) return null
    try {
      const date = new Date(dob)
      if (Number.isNaN(date.getTime())) return null
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
    } catch {
      return null
    }
  }, [personal.date_of_birth])

  const locationLabel = useMemo(() => {
    if (personal.city || personal.country) {
      return [personal.city, personal.country].filter(Boolean).join(', ')
    }
    return profile.location || ''
  }, [personal.city, personal.country, profile.location])

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050b14] via-[#03060d] to-black text-white pt-16 pb-12">
      <div className="max-w-4xl mx-auto px-4 space-y-6">
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center justify-center h-10 w-10 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/10 transition"
            aria-label="Back"
            onClick={() => navigate(-1)}
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
        </div>

        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_35px_120px_-60px_rgba(0,0,0,0.75)]">
          <div className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_top_right,rgba(77,182,172,0.2),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.15),transparent_40%)]" />
          {profile.cover_photo ? (
            <div className="relative h-40 w-full overflow-hidden border-b border-white/10">
              <ImageLoader
                src={profile.cover_photo.startsWith('http') ? profile.cover_photo : `/uploads/${profile.cover_photo}`}
                alt="Cover"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#050b14]/80 via-transparent" />
            </div>
          ) : null}
          <div className="relative p-6 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4 md:gap-6">
                <Avatar username={profile.username} url={profile.profile_picture || undefined} size={80} />
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-semibold tracking-tight truncate">{profile.display_name || profile.username}</h1>
                    {profile.subscription ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-widest text-[#9fb0b5]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#4db6ac]" />
                        {profile.subscription}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-[#9fb0b5] flex items-center gap-3 flex-wrap">
                    <span>@{profile.username}</span>
                    {locationLabel ? (
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-location-dot text-xs" />
                        {locationLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {isSelf ? (
                  <button
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-white/10 hover:bg-white/20 text-sm font-medium transition"
                    onClick={() => navigate('/profile')}
                  >
                    <i className="fa-solid fa-pen-to-square" />
                    Edit Profile
                  </button>
                ) : (
                  <button
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition shadow-[0_10px_35px_-12px_rgba(77,182,172,0.55)]"
                    onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(profile.username)}`)}
                  >
                    <i className="fa-regular fa-paper-plane" />
                    Send Message
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {profile.bio ? (
          <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-[0_25px_80px_-60px_rgba(0,0,0,0.65)]">
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(77,182,172,0.12),transparent_55%)]" />
            <div className="relative space-y-2">
              <h2 className="text-lg font-semibold">About</h2>
              <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed">{profile.bio}</p>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          {(personal.gender || personal.country || personal.city || formattedDob) ? (
            <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 space-y-3">
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_bottom_left,rgba(77,182,172,0.15),transparent_55%)]" />
              <div className="relative space-y-1.5">
                <h3 className="text-lg font-semibold">Personal Information</h3>
                <p className="text-sm text-[#9fb0b5]">Visible to community members.</p>
              </div>
              <div className="relative space-y-3 text-sm text-white/90">
                {formattedDob ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[#9fb0b5] min-w-[110px]">Date of birth</span>
                    <span>{formattedDob}</span>
                  </div>
                ) : null}
                {personal.gender ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[#9fb0b5] min-w-[110px]">Gender</span>
                    <span>{personal.gender}</span>
                  </div>
                ) : null}
                {(personal.city || personal.country) ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[#9fb0b5] min-w-[110px]">Location</span>
                    <span>{[personal.city, personal.country].filter(Boolean).join(', ')}</span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {(professional.role || professional.company || professional.industry || professional.linkedin) ? (
            <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 space-y-3">
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_55%)]" />
              <div className="relative space-y-1.5">
                <h3 className="text-lg font-semibold">Professional</h3>
                <p className="text-sm text-[#9fb0b5]">How {profile.display_name || profile.username} collaborates.</p>
              </div>
              <div className="relative space-y-3 text-sm text-white/90">
                {professional.role ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[#9fb0b5] min-w-[120px]">Current position</span>
                    <span>{professional.role}</span>
                  </div>
                ) : null}
                {professional.company ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[#9fb0b5] min-w-[120px]">Company</span>
                    <span>{professional.company}</span>
                  </div>
                ) : null}
                {professional.industry ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[#9fb0b5] min-w-[120px]">Industry</span>
                    <span>{professional.industry}</span>
                  </div>
                ) : null}
                {professional.linkedin ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[#9fb0b5] min-w-[120px]">LinkedIn</span>
                    <a
                      className="text-[#4db6ac] underline break-all"
                      href={professional.linkedin.startsWith('http') ? professional.linkedin : `https://${professional.linkedin}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View profile
                    </a>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        {(profile.website || profile.instagram || profile.twitter) ? (
          <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6">
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,rgba(77,182,172,0.12),transparent_60%)]" />
            <div className="relative space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">Social Links</h3>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {profile.website ? (
                  <a
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[#4db6ac] hover:bg-white/20 transition"
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
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[#f58529] hover:bg-white/20 transition"
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
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[#1d9bf0] hover:bg-white/20 transition"
                    href={`https://twitter.com/${profile.twitter.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <i className="fa-brands fa-x-twitter" />
                    Twitter / X
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}