import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import Avatar from '../components/Avatar'

type PersonalForm = {
  bio: string
  display_name: string
  date_of_birth: string
  gender: string
  country: string
  city: string
}

type ProfessionalForm = {
  role: string
  company: string
  industry: string
  linkedin: string
  about: string
  interests: string[]
}

type ProfileSummary = {
  username: string
  subscription?: string
  profile_picture?: string | null
  cover_photo?: string | null
  display_name?: string | null
  location?: string | null
  bio?: string | null
}

const PERSONAL_DEFAULT: PersonalForm = {
  bio: '',
  display_name: '',
  date_of_birth: '',
  gender: '',
  country: '',
  city: '',
}

const PROFESSIONAL_DEFAULT: ProfessionalForm = {
  role: '',
  company: '',
  industry: '',
  linkedin: '',
  about: '',
  interests: [],
}

const GENDERS = ['Female', 'Male', 'Prefer not to say', 'Other']

const INDUSTRIES = [
  'Accounting',
  'Advertising & Marketing',
  'Aerospace',
  'Agriculture',
  'Automotive',
  'Biotechnology',
  'Construction',
  'Consulting',
  'Consumer Goods',
  'Education',
  'Energy & Utilities',
  'Financial Services',
  'Government',
  'Healthcare',
  'Hospitality',
  'Information Technology',
  'Insurance',
  'Legal Services',
  'Manufacturing',
  'Media & Entertainment',
  'Nonprofit',
  'Professional Services',
  'Real Estate',
  'Retail',
  'Telecommunications',
  'Transportation & Logistics',
  'Travel & Tourism',
  'Other',
]

const MAX_INTERESTS = 12

export default function Profile() {
  const [summary, setSummary] = useState<ProfileSummary | null>(null)
  const [personal, setPersonal] = useState<PersonalForm>(PERSONAL_DEFAULT)
  const [professional, setProfessional] = useState<ProfessionalForm>(PROFESSIONAL_DEFAULT)
  const [countries, setCountries] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingPersonal, setSavingPersonal] = useState(false)
  const [savingProfessional, setSavingProfessional] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [citiesLoading, setCitiesLoading] = useState(false)
  const cityCache = useRef<Map<string, string[]>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [interestInput, setInterestInput] = useState('')

  function normalizeInterests(list: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of list) {
      const trimmed = item.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(trimmed)
      if (result.length >= MAX_INTERESTS) break
    }
    return result
  }

  function addInterest(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const exists = professional.interests.some(existing => existing.toLowerCase() === trimmed.toLowerCase())
    if (professional.interests.length >= MAX_INTERESTS && !exists) {
      setFeedback(`You can list up to ${MAX_INTERESTS} interests. Remove one to add more.`)
      setInterestInput('')
      return
    }
    setProfessional(prev => {
      const normalized = normalizeInterests([...prev.interests, trimmed])
      if (normalized.length === prev.interests.length && normalized.every((interest, index) => interest === prev.interests[index])) {
        return prev
      }
      return { ...prev, interests: normalized }
    })
    setInterestInput('')
  }

  function removeInterest(index: number) {
    setProfessional(prev => ({
      ...prev,
      interests: prev.interests.filter((_, idx) => idx !== index),
    }))
  }

  function handleInterestKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (interestInput.trim()) addInterest(interestInput)
    } else if (event.key === 'Backspace' && !interestInput && professional.interests.length) {
      event.preventDefault()
      setProfessional(prev => ({
        ...prev,
        interests: prev.interests.slice(0, prev.interests.length - 1),
      }))
    }
  }

  function handleInterestBlur() {
    if (interestInput.trim()) addInterest(interestInput)
  }

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      setLoading(true)
      try {
        const response = await fetch('/api/profile_me', { credentials: 'include' })
        const payload = await response.json().catch(() => null)
        if (!cancelled) {
          if (payload?.success && payload.profile) {
            const profile = payload.profile
            const rawInterests = profile.professional?.interests
            const interestList = Array.isArray(rawInterests)
              ? rawInterests
                  .map(item => (typeof item === 'string' ? item.trim() : ''))
                  .filter(Boolean)
              : typeof rawInterests === 'string' && rawInterests
                ? rawInterests
                    .split(',')
                    .map(item => item.trim())
                    .filter(Boolean)
                : []
            const sanitizedInterests = normalizeInterests(interestList)
            setSummary({
              username: profile.username,
              subscription: profile.subscription,
              profile_picture: profile.profile_picture || null,
              cover_photo: profile.cover_photo || null,
              display_name: profile.display_name || profile.personal?.display_name || profile.username,
              location: profile.location || '',
              bio: profile.bio || '',
            })
            setPersonal({
              bio: profile.bio || '',
              display_name: profile.personal?.display_name || profile.display_name || '',
              date_of_birth: profile.personal?.date_of_birth ? String(profile.personal.date_of_birth).slice(0, 10) : '',
              gender: profile.personal?.gender || '',
              country: profile.personal?.country || '',
              city: profile.personal?.city || '',
            })
            setProfessional({
              role: profile.professional?.role || '',
              company: profile.professional?.company || '',
              industry: profile.professional?.industry || '',
              linkedin: profile.professional?.linkedin || '',
              about: profile.professional?.about || '',
              interests: sanitizedInterests,
            })
            setInterestInput('')
            setError(null)
          } else {
            setError(payload?.error || 'Unable to load profile')
          }
        }
      } catch {
        if (!cancelled) setError('Unable to load profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadProfile()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadCountries() {
      try {
        const response = await fetch('/api/geo/countries', { credentials: 'include' })
        const payload = await response.json().catch(() => null)
        if (!cancelled) {
          if (payload?.success && Array.isArray(payload.countries)) {
            const names = payload.countries
              .map((item: { name?: string }) => typeof item?.name === 'string' ? item.name : null)
              .filter(Boolean) as string[]
            setCountries(names)
          } else {
            setCountries([])
          }
        }
      } catch {
        if (!cancelled) setCountries([])
      }
    }
    loadCountries()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const countryName = personal.country.trim()
    if (!countryName) {
      setCities([])
      return
    }
    const exactMatch = countries.find(name => name.toLowerCase() === countryName.toLowerCase()) || countryName
    const cacheKey = exactMatch.toLowerCase()
    const cached = cityCache.current.get(cacheKey)
    if (cached) {
      setCities(cached)
      return
    }
    let cancelled = false
    async function loadCities() {
      setCitiesLoading(true)
      try {
        const response = await fetch(`/api/geo/cities?country=${encodeURIComponent(exactMatch)}`, { credentials: 'include' })
        const payload = await response.json().catch(() => null)
        if (!cancelled) {
          if (payload?.success && Array.isArray(payload.cities)) {
            const list = payload.cities.map((item: string) => item?.trim()).filter(Boolean)
            cityCache.current.set(cacheKey, list)
            setCities(list)
          } else {
            cityCache.current.set(cacheKey, [])
            setCities([])
          }
        }
      } catch {
        if (!cancelled) {
          cityCache.current.set(cacheKey, [])
          setCities([])
        }
      } finally {
        if (!cancelled) setCitiesLoading(false)
      }
    }
    loadCities()
    return () => {
      cancelled = true
    }
  }, [personal.country, countries])

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 3000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const locationPreview = personal.city || personal.country
    ? [personal.city, personal.country].filter(Boolean).join(', ')
    : summary?.location || ''

  const personalDobLabel = (() => {
    if (!personal.date_of_birth) return ''
    const parsed = new Date(personal.date_of_birth)
    if (Number.isNaN(parsed.getTime())) return personal.date_of_birth
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(parsed)
  })()

  const personalBioText = personal.bio.trim()

  async function handlePersonalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingPersonal) return
    setSavingPersonal(true)
    try {
      const form = new FormData()
      form.append('bio', personal.bio)
      form.append('display_name', personal.display_name)
      if (personal.date_of_birth) form.append('date_of_birth', personal.date_of_birth)
      form.append('gender', personal.gender)
      form.append('country', personal.country)
      form.append('city', personal.city)
      const response = await fetch('/update_personal_info', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        setFeedback('Personal information saved')
        setSummary(prev => {
          if (!prev) return prev
          const updatedLocation = [personal.city, personal.country].filter(Boolean).join(', ')
          return {
            ...prev,
            display_name: personal.display_name || prev.display_name,
            location: updatedLocation,
            bio: personal.bio,
          }
        })
      } else {
        setFeedback(payload?.error || 'Unable to save personal information')
      }
    } catch {
      setFeedback('Unable to save personal information')
    } finally {
      setSavingPersonal(false)
    }
  }

  async function handleProfessionalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingProfessional) return
    setSavingProfessional(true)
    try {
      let interestList = professional.interests
      const pendingInterest = interestInput.trim()
      if (pendingInterest && professional.interests.length >= MAX_INTERESTS && !professional.interests.some(item => item.toLowerCase() === pendingInterest.toLowerCase())) {
        setFeedback(`You can list up to ${MAX_INTERESTS} interests. Remove one to add more.`)
        setSavingProfessional(false)
        return
      }
      if (pendingInterest) {
        interestList = normalizeInterests([...interestList, pendingInterest])
        setProfessional(prev => ({ ...prev, interests: interestList }))
        setInterestInput('')
      } else {
        const normalized = normalizeInterests(interestList)
        if (normalized.length !== interestList.length || normalized.some((interest, index) => interest !== interestList[index])) {
          interestList = normalized
          setProfessional(prev => ({ ...prev, interests: interestList }))
        }
      }
      const form = new FormData()
      form.append('role', professional.role)
      form.append('company', professional.company)
      form.append('industry', professional.industry)
      form.append('linkedin', professional.linkedin)
      form.append('about', professional.about)
      form.append('interests', JSON.stringify(interestList))
      const response = await fetch('/update_professional', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        setFeedback('Professional information saved')
      } else {
        setFeedback(payload?.error || 'Unable to save professional information')
      }
    } catch {
      setFeedback('Unable to save professional information')
    } finally {
      setSavingProfessional(false)
    }
  }

  async function handlePhotoUpload(file: File) {
    const form = new FormData()
    form.append('profile_picture', file)
    try {
      const response = await fetch('/upload_profile_picture', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success && payload.profile_picture) {
        setSummary(prev => prev ? { ...prev, profile_picture: payload.profile_picture } : prev)
        setFeedback('Profile picture updated')
      } else {
        setFeedback(payload?.error || 'Unable to upload picture')
      }
    } catch {
      setFeedback('Unable to upload picture')
    }
  }

  function onSelectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) handlePhotoUpload(file)
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error || !summary) return <div className="p-4 text-red-400">{error || 'Something went wrong'}</div>

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 overflow-y-auto bg-black text-white">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {summary.cover_photo ? (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <img
              src={summary.cover_photo.startsWith('http') ? summary.cover_photo : `/static/${summary.cover_photo}`}
              alt="Cover"
              className="w-full h-40 object-cover"
            />
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar username={summary.username} url={summary.profile_picture || undefined} size={64} />
            <button
              className="absolute -right-1 -bottom-1 w-7 h-7 rounded-full bg-[#4db6ac] text-black text-xs flex items-center justify-center border border-black"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change profile picture"
              type="button"
            >
              <i className="fa-solid fa-camera" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onSelectPhoto}
            />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-lg truncate">{summary.display_name || summary.username}</div>
            <div className="text-sm text-[#9fb0b5] truncate">
              @{summary.username}{summary.subscription ? ` • ${summary.subscription}` : ''}
            </div>
            {locationPreview ? (
              <div className="text-xs text-[#9fb0b5] flex items-center gap-1">
                <i className="fa-solid fa-location-dot" />
                <span>{locationPreview}</span>
              </div>
            ) : null}
          </div>
          <a
            className="ml-auto px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm"
            href={`/profile/${encodeURIComponent(summary.username)}`}
          >
            Preview Profile
          </a>
        </div>

        <section className="rounded-xl border border-white/10 p-4 space-y-3">
          <form className="space-y-3" onSubmit={handlePersonalSubmit}>
            <label className="text-sm block">
              Bio
              <textarea
                className="mt-1 w-full min-h-[100px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                value={personal.bio}
                onChange={event => setPersonal(prev => ({ ...prev, bio: event.target.value }))}
                placeholder={`💼 Your bio is currently consulting its therapist.\nDrop one polished line to lure it back.`}
              />
            </label>
            {personal.bio.trim() ? null : (
              <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-[#9fb0b5]">
                <p className="text-white/80 font-medium">
                  💼 Your bio is currently consulting its therapist.
                </p>
                <p>Drop one polished line to lure it back.</p>
                <p className="mt-2 whitespace-pre-line">
                  Example:
                  {"\n"}"Owned by a sassy rescue cat named Pickles 🐱{'\n'}Excel wizard by day,{'\n'}jazz vinyl curator by night"
                </p>
                <p className="mt-2 text-white/70">Impress us—bonus points for zero typos. 🖋️</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Display name
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={personal.display_name}
                  onChange={event => setPersonal(prev => ({ ...prev, display_name: event.target.value }))}
                />
              </label>
              <label className="text-sm">
                Date of birth
                <input
                  type="date"
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={personal.date_of_birth}
                  onChange={event => setPersonal(prev => ({ ...prev, date_of_birth: event.target.value }))}
                />
              </label>
              <label className="text-sm">
                Gender
                <select
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[13px] outline-none focus:border-[#4db6ac]"
                  value={personal.gender}
                  onChange={event => setPersonal(prev => ({ ...prev, gender: event.target.value }))}
                >
                  <option value="">Select a value</option>
                  {GENDERS.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Country
                <input
                  list="country-options"
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={personal.country}
                  onChange={event => setPersonal(prev => ({ ...prev, country: event.target.value }))}
                  placeholder="Type to search"
                  autoComplete="off"
                />
              </label>
              <label className="text-sm">
                City
                <input
                  list="city-options"
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={personal.city}
                  onChange={event => setPersonal(prev => ({ ...prev, city: event.target.value }))}
                  placeholder={personal.country ? (citiesLoading ? 'Loading cities…' : 'Type to search') : 'Select a country first'}
                  autoComplete="off"
                  disabled={!personal.country}
                />
              </label>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingPersonal}
            >
              {savingPersonal ? 'Saving…' : 'Save personal info'}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-white/10 p-4 space-y-3">
          <header>
            <div className="font-semibold">Professional information</div>
            <p className="text-xs text-[#9fb0b5]">Let others know how to collaborate with you.</p>
          </header>
          <form className="space-y-3" onSubmit={handleProfessionalSubmit}>
            <label className="text-sm block">
              About
              <textarea
                className="mt-1 w-full min-h-[96px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                value={professional.about}
                onChange={event => setProfessional(prev => ({ ...prev, about: event.target.value }))}
                placeholder="Share a short summary about your professional background"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Current position
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.role}
                  onChange={event => setProfessional(prev => ({ ...prev, role: event.target.value }))}
                  placeholder="e.g. Product Manager"
                />
              </label>
              <label className="text-sm">
                Company
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.company}
                  onChange={event => setProfessional(prev => ({ ...prev, company: event.target.value }))}
                  placeholder="Company name"
                />
              </label>
              <label className="text-sm">
                Industry
                <select
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[13px] outline-none focus:border-[#4db6ac]"
                  value={professional.industry}
                  onChange={event => setProfessional(prev => ({ ...prev, industry: event.target.value }))}
                >
                  <option value="">Select an industry</option>
                  {INDUSTRIES.map(industry => (
                    <option key={industry} value={industry}>{industry}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                LinkedIn URL
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.linkedin}
                  onChange={event => setProfessional(prev => ({ ...prev, linkedin: event.target.value }))}
                  placeholder="https://www.linkedin.com/in/username"
                />
              </label>
            </div>
            <div className="text-sm">
              <div className="mb-1 text-[#9fb0b5] font-medium">Personal interests</div>
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black px-2 py-2">
                {professional.interests.map((interest, index) => (
                  <button
                    key={`${interest}-${index}`}
                    type="button"
                    className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs text-white hover:bg-white/25 transition"
                    onClick={() => removeInterest(index)}
                    aria-label={`Remove ${interest}`}
                  >
                    <span>{interest}</span>
                    <i className="fa-solid fa-xmark text-[10px]" />
                  </button>
                ))}
                {professional.interests.length < MAX_INTERESTS ? (
                  <input
                    value={interestInput}
                    onChange={event => setInterestInput(event.target.value)}
                    onKeyDown={handleInterestKeyDown}
                    onBlur={handleInterestBlur}
                    placeholder={professional.interests.length ? 'Add another interest' : 'Tap, yoga, AI ethics…'}
                    className="flex-1 min-w-[140px] bg-transparent text-xs text-white placeholder:text-[#9fb0b5] outline-none"
                  />
                ) : null}
              </div>
              <p className="mt-1 text-xs text-[#9fb0b5]">
                Press enter after each interest to add it.
              </p>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingProfessional}
            >
              {savingProfessional ? 'Saving…' : 'Save professional info'}
            </button>
          </form>
        </section>

        {(personalBioText || personalDobLabel || personal.gender || locationPreview) ? (
          <section className="rounded-xl border border-white/10 p-4 space-y-3">
            <div className="font-semibold">Personal information</div>
            <div className="space-y-2 text-sm text-white/90">
              {personalBioText ? (
                <div className="whitespace-pre-wrap leading-relaxed text-white/90">{personalBioText}</div>
              ) : null}
              {personalDobLabel ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Date of birth:</span>
                  {personalDobLabel}
                </div>
              ) : null}
              {personal.gender ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Gender:</span>
                  {personal.gender}
                </div>
              ) : null}
              {locationPreview ? (
                <div>
                  <span className="text-[#9fb0b5] mr-2">Location:</span>
                  {locationPreview}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <datalist id="country-options">
          {countries.map(country => (
            <option key={country} value={country} />
          ))}
        </datalist>
        <datalist id="city-options">
          {cities.map(city => (
            <option key={city} value={city} />
          ))}
        </datalist>

        {feedback ? (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full border border-white/10 bg-white/10 text-sm text-white">
            {feedback}
          </div>
        ) : null}
      </div>
    </div>
  )
}
