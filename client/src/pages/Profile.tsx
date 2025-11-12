import { useEffect, useRef, useState } from 'react'
import Avatar from '../components/Avatar'

type PersonalForm = {
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
}

type ProfileSummary = {
  username: string
  subscription?: string
  profile_picture?: string | null
  cover_photo?: string | null
  display_name?: string | null
  location?: string | null
}

const PERSONAL_DEFAULT: PersonalForm = {
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
}

const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other']

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
            setSummary({
              username: profile.username,
              subscription: profile.subscription,
              profile_picture: profile.profile_picture || null,
              cover_photo: profile.cover_photo || null,
              display_name: profile.display_name || profile.personal?.display_name || profile.username,
              location: profile.location || '',
            })
            setPersonal({
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
            })
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

  async function handlePersonalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingPersonal) return
    setSavingPersonal(true)
    try {
      const form = new FormData()
      form.append('display_name', personal.display_name)
      if (personal.date_of_birth) form.append('date_of_birth', personal.date_of_birth)
      form.append('gender', personal.gender)
      form.append('country', personal.country)
      form.append('city', personal.city)
      const response = await fetch('/update_personal_info', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        setFeedback('Personal information saved')
        setSummary(prev => prev ? { ...prev, display_name: personal.display_name || prev.display_name, location: locationPreview } : prev)
      } else {
        setFeedback(payload?.error || 'Unable to save personal information')
      }
    } catch {
      setFeedback('Unable to save personal information')
    } finally {
      setSavingPersonal(false)
    }
  }

  async function handleProfessionalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingProfessional) return
    setSavingProfessional(true)
    try {
      const form = new FormData()
      form.append('role', professional.role)
      form.append('company', professional.company)
      form.append('industry', professional.industry)
      form.append('linkedin', professional.linkedin)
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

  function onSelectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
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
          <header>
            <div className="font-semibold">Personal information</div>
            <p className="text-xs text-[#9fb0b5]">These details are visible to other members.</p>
          </header>
          <form className="space-y-3" onSubmit={handlePersonalSubmit}>
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
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
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
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
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
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingProfessional}
            >
              {savingProfessional ? 'Saving…' : 'Save professional info'}
            </button>
          </form>
        </section>

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
