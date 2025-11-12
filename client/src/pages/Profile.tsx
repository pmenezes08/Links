import React, { useEffect, useMemo, useRef, useState } from 'react'
import Avatar from '../components/Avatar'

type CountryOption = { name: string; iso2?: string }
type SearchSelectOption = { label: string; value: string }

type SearchSelectProps = {
  label: string
  selectedValue: string
  onSelect: (value: string) => void
  options: SearchSelectOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  allowCustom?: boolean
}

function SearchSelect({ label, selectedValue, onSelect, options, placeholder, disabled, loading, allowCustom }: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open) setQuery('')
  }, [open, selectedValue])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const list = options || []
    if (!term) return list.slice(0, 16)
    return list.filter(opt => opt.label.toLowerCase().includes(term)).slice(0, 16)
  }, [options, query])

  const displayLabel = selectedValue || placeholder || `Select ${label}`
  const isDisabled = Boolean(disabled)
  const showAddRow = allowCustom && query.trim().length > 0 && !filtered.some(opt => opt.label.toLowerCase() === query.trim().toLowerCase())

  const handleSelect = (value: string) => {
    onSelect(value)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative space-y-1 text-sm">
      <div className="text-[#9fb0b5] font-medium">{label}</div>
      <button
        type="button"
        disabled={isDisabled}
        className={`w-full px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-left text-[15px] flex items-center justify-between gap-2 transition ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#4db6ac]/70'
        }`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selectedValue ? 'text-white' : 'text-[#9fb0b5]'}>{displayLabel}</span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-[#9fb0b5]`} />
      </button>
      {open && !isDisabled && (
        <div className="absolute left-0 right-0 z-[140] mt-2 rounded-2xl border border-white/10 bg-[#070b17]/95 backdrop-blur-xl shadow-2xl">
          <div className="p-3 border-b border-white/10">
            <input
              autoFocus
              className="w-full rounded-lg bg-black/40 text-white px-3 py-2 text-sm outline-none border border-white/10 focus:border-[#4db6ac]"
              placeholder={`Search ${label.toLowerCase()}`}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto custom-scroll">
            {loading ? (
              <div className="px-3 py-3 text-xs text-[#9fb0b5] flex items-center gap-2">
                <i className="fa-solid fa-spinner-third animate-spin" />
                Loading…
              </div>
            ) : filtered.length > 0 ? (
              filtered.map(opt => {
                const selected = selectedValue && selectedValue.toLowerCase() === opt.value.toLowerCase()
                return (
                  <button
                    type="button"
                    key={opt.value}
                    className={`w-full px-3 py-2 text-left text-sm transition flex items-center justify-between ${
                      selected ? 'bg-[#4db6ac]/15 text-[#4db6ac]' : 'hover:bg-white/8 text-white'
                    }`}
                    onClick={() => handleSelect(opt.value)}
                  >
                    <span>{opt.label}</span>
                    {selected ? <i className="fa-solid fa-check text-xs" /> : null}
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-3 text-xs text-[#9fb0b5]">No matches found.</div>
            )}
            {showAddRow ? (
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-xs uppercase tracking-wide text-[#4db6ac] hover:bg-[#4db6ac]/10 flex items-center gap-2"
                onClick={() => handleSelect(query.trim())}
              >
                <i className="fa-solid fa-plus" />
                Add “{query.trim()}”
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

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

type ToastState = { message: string; type: 'success' | 'error' } | null

type ProfileData = {
  username: string
  subscription?: string
  profile_picture?: string | null
  cover_photo?: string | null
  display_name?: string | null
  location?: string | null
  personal?: {
    display_name?: string | null
    date_of_birth?: string | null
    gender?: string | null
    country?: string | null
    city?: string | null
  }
  professional?: {
    role?: string | null
    company?: string | null
    industry?: string | null
    linkedin?: string | null
  }
}

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

const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other']

const EMPTY_PERSONAL_FORM: PersonalForm = {
  display_name: '',
  date_of_birth: '',
  gender: '',
  country: '',
  city: '',
}

const EMPTY_PROFESSIONAL_FORM: ProfessionalForm = {
  role: '',
  company: '',
  industry: '',
  linkedin: '',
}

export default function Profile() {
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [personalForm, setPersonalForm] = useState<PersonalForm>(EMPTY_PERSONAL_FORM)
  const [professionalForm, setProfessionalForm] = useState<ProfessionalForm>(EMPTY_PROFESSIONAL_FORM)
  const [countries, setCountries] = useState<CountryOption[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [citiesLoading, setCitiesLoading] = useState(false)
  const cityCacheRef = useRef<Record<string, string[]>>({})
  const [toast, setToast] = useState<ToastState>(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let mounted = true
    async function loadProfile() {
      setLoading(true)
      try {
        const response = await fetch('/api/profile_me', { credentials: 'include' })
        const payload = await response.json().catch(() => null)
        if (!mounted) return
        if (payload?.success && payload.profile) {
          const profile: ProfileData = payload.profile
          setData(profile)
          const personal = profile.personal || {}
          const professional = profile.professional || {}
          setPersonalForm({
            display_name: personal.display_name || profile.display_name || '',
            date_of_birth: personal.date_of_birth ? String(personal.date_of_birth).split('T')[0] : '',
            gender: personal.gender || '',
            country: personal.country || '',
            city: personal.city || '',
          })
          setProfessionalForm({
            role: professional.role || '',
            company: professional.company || '',
            industry: professional.industry || '',
            linkedin: professional.linkedin || '',
          })
          setError(null)
        } else {
          setError(payload?.error || 'Failed to load profile')
        }
      } catch {
        if (mounted) setError('Failed to load profile')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    loadProfile()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadCountries() {
      try {
        const r = await fetch('/api/geo/countries', { credentials: 'include' })
        const j = await r.json().catch(() => null)
        if (!cancelled && j?.success && Array.isArray(j.countries)) {
          setCountries(j.countries)
        } else if (!cancelled) {
          setCountries([])
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
    const rawCountry = personalForm.country.trim()
    if (!rawCountry) {
      setCities([])
      return
    }
    const matchName = countries.find(country => country.name.toLowerCase() === rawCountry.toLowerCase())?.name
    if (!matchName) {
      setCities([])
      return
    }
    const resolvedName: string = matchName
    const cacheKey = resolvedName.toLowerCase()
    const cached = cityCacheRef.current[cacheKey]
    if (cached) {
      setCities(cached)
      return
    }
    let cancelled = false
    async function fetchCities() {
      setCitiesLoading(true)
      try {
        const r = await fetch(`/api/geo/cities?country=${encodeURIComponent(resolvedName)}`, { credentials: 'include' })
        const j = await r.json().catch(() => null)
        if (!cancelled && j?.success && Array.isArray(j.cities)) {
          const list = j.cities.map((city: string) => city.trim()).filter(Boolean)
          cityCacheRef.current[cacheKey] = list
          setCities(list)
        } else if (!cancelled) {
          cityCacheRef.current[cacheKey] = []
          setCities([])
        }
      } catch {
        if (!cancelled) {
          cityCacheRef.current[cacheKey] = []
          setCities([])
        }
      } finally {
        if (!cancelled) setCitiesLoading(false)
      }
    }
    fetchCities()
    return () => {
      cancelled = true
    }
  }, [personalForm.country, countries])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const countryOptions = useMemo(() => countries.map(country => ({ label: country.name, value: country.name })), [countries])
  const cityOptions = useMemo(() => cities.map(city => ({ label: city, value: city })), [cities])

  const displayName = personalForm.display_name || data?.display_name || data?.username || ''
  const subscriptionLabel = data?.subscription || 'free'
  const locationPreview = useMemo(() => {
    if (personalForm.city || personalForm.country) {
      return [personalForm.city, personalForm.country].filter(Boolean).join(', ')
    }
    return data?.location || ''
  }, [personalForm.city, personalForm.country, data?.location])

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
  }

  function handlePhotoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedPhoto(file)
      const reader = new FileReader()
      reader.onload = e => {
        setPhotoPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  async function handleCameraCapture() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      const video = document.createElement('video')
      video.srcObject = stream
      await video.play()

      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 300
      const ctx = canvas.getContext('2d')

      await new Promise(resolve => {
        video.onloadeddata = resolve
      })

      ctx?.drawImage(video, 0, 0, 300, 300)
      canvas.toBlob(blob => {
        if (blob) {
          const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' })
          setSelectedPhoto(file)
          setPhotoPreview(canvas.toDataURL())
        }
      }, 'image/jpeg', 0.85)

      stream.getTracks().forEach(track => track.stop())
    } catch {
      showToast('Camera access denied or not available', 'error')
    }
  }

  async function uploadProfilePicture() {
    if (!selectedPhoto) return
    setUploadingPhoto(true)
    try {
      const fd = new FormData()
      fd.append('profile_picture', selectedPhoto)
      const response = await fetch('/upload_profile_picture', { method: 'POST', credentials: 'include', body: fd })
      const payload = await response.json().catch(() => null)
      if (payload?.success && payload.profile_picture) {
        setData(prev => prev ? { ...prev, profile_picture: payload.profile_picture } : prev)
        showToast('Profile picture updated')
        setShowPhotoModal(false)
        setSelectedPhoto(null)
        setPhotoPreview(null)
      } else {
        showToast(payload?.error || 'Upload failed', 'error')
      }
    } catch {
      showToast('Upload failed', 'error')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function handlePersonalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const fd = new FormData()
      fd.append('display_name', personalForm.display_name)
      if (personalForm.date_of_birth) fd.append('date_of_birth', personalForm.date_of_birth)
      fd.append('gender', personalForm.gender)
      fd.append('country', personalForm.country)
      fd.append('city', personalForm.city)
      const response = await fetch('/update_personal_info', { method: 'POST', credentials: 'include', body: fd })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        const location = [personalForm.city, personalForm.country].filter(Boolean).join(', ')
        setData(prev => prev ? {
          ...prev,
          display_name: personalForm.display_name || prev.display_name,
          location,
          personal: {
            ...(prev.personal || {}),
            display_name: personalForm.display_name,
            date_of_birth: personalForm.date_of_birth,
            gender: personalForm.gender,
            country: personalForm.country,
            city: personalForm.city,
          }
        } : prev)
        showToast('Personal information updated')
      } else {
        showToast(payload?.error || 'Failed to update personal information', 'error')
      }
    } catch {
      showToast('Failed to update personal information', 'error')
    }
  }

  async function handleProfessionalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const fd = new FormData()
      fd.append('role', professionalForm.role)
      fd.append('company', professionalForm.company)
      fd.append('industry', professionalForm.industry)
      fd.append('linkedin', professionalForm.linkedin)
      const response = await fetch('/update_professional', { method: 'POST', credentials: 'include', body: fd })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        setData(prev => prev ? {
          ...prev,
          professional: {
            ...(prev.professional || {}),
            role: professionalForm.role,
            company: professionalForm.company,
            industry: professionalForm.industry,
            linkedin: professionalForm.linkedin,
          }
        } : prev)
        showToast('Professional information updated')
      } else {
        showToast(payload?.error || 'Failed to update professional information', 'error')
      }
    } catch {
      showToast('Failed to update professional information', 'error')
    }
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error || !data) return <div className="p-4 text-red-400">{error || 'Something went wrong'}</div>

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050b14] via-[#03060d] to-black text-white pt-16 pb-12">
      <div className="max-w-5xl mx-auto px-4 space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_35px_120px_-60px_rgba(0,0,0,0.75)]">
          <div className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_top_right,rgba(77,182,172,0.25),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.18),transparent_40%)]" />
          <div className="relative p-6 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4 md:gap-6">
                <button
                  className="relative group cursor-pointer"
                  onClick={() => setShowPhotoModal(true)}
                  aria-label="Change profile picture"
                >
                  <Avatar username={data.username} url={data.profile_picture || undefined} size={80} />
                  <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <i className="fa-solid fa-camera text-white text-lg" />
                  </div>
                  <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-[#4db6ac] rounded-full flex items-center justify-center shadow-lg shadow-[#4db6ac]/30">
                    <i className="fa-solid fa-pen text-xs text-black" />
                  </div>
                </button>
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-semibold tracking-tight truncate">{displayName}</h1>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-widest text-[#9fb0b5]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4db6ac]" />
                      {subscriptionLabel}
                    </span>
                  </div>
                  <div className="text-sm text-[#9fb0b5] flex items-center gap-2 flex-wrap">
                    <span>@{data.username}</span>
                    {locationPreview ? (
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-location-dot text-xs" />
                        {locationPreview}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-white/10 hover:bg-white/20 text-sm font-medium transition"
                  href={`/profile/${encodeURIComponent(data.username)}`}
                >
                  <i className="fa-regular fa-eye" />
                  Preview Public Profile
                </a>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 space-y-5 shadow-[0_25px_80px_-50px_rgba(77,182,172,0.55)]">
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Personal Information</h2>
              <p className="text-sm text-[#9fb0b5]">Manage details that other members can see on your profile.</p>
            </div>
            <form className="space-y-5" onSubmit={handlePersonalSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm space-y-1 sm:col-span-2">
                  <span className="text-[#9fb0b5] font-medium">Display Name</span>
                  <input
                    className="w-full rounded-xl bg-white/[0.03] text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]/60 transition"
                    value={personalForm.display_name}
                    onChange={e => setPersonalForm(prev => ({ ...prev, display_name: e.target.value }))}
                    placeholder="Name shown on your profile"
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-[#9fb0b5] font-medium">Date of Birth</span>
                  <input
                    type="date"
                    className="w-full rounded-xl bg-white/[0.03] text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]/60 transition"
                    value={personalForm.date_of_birth}
                    onChange={e => setPersonalForm(prev => ({ ...prev, date_of_birth: e.target.value }))}
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-[#9fb0b5] font-medium">Gender</span>
                  <select
                    className="w-full rounded-xl bg-white/[0.03] text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]/60 transition"
                    value={personalForm.gender}
                    onChange={e => setPersonalForm(prev => ({ ...prev, gender: e.target.value }))}
                  >
                    <option value="">Prefer not to say</option>
                    {GENDERS.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <SearchSelect
                  label="Country"
                  options={countryOptions}
                  selectedValue={personalForm.country}
                  onSelect={value => setPersonalForm(prev => ({ ...prev, country: value, city: '' }))}
                  placeholder="Select country"
                />
                <SearchSelect
                  label="City"
                  options={cityOptions}
                  selectedValue={personalForm.city}
                  onSelect={value => setPersonalForm(prev => ({ ...prev, city: value }))}
                  placeholder={personalForm.country ? 'Select city' : 'Select a country first'}
                  disabled={!personalForm.country}
                  loading={citiesLoading}
                  allowCustom
                />
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#4db6ac] text-black px-4 py-2.5 text-sm font-semibold hover:brightness-110 transition shadow-[0_10px_35px_-12px_rgba(77,182,172,0.55)]"
                >
                  <i className="fa-solid fa-floppy-disk" />
                  Save Personal Info
                </button>
              </div>
            </form>
          </section>

          <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 space-y-5 shadow-[0_25px_80px_-50px_rgba(59,130,246,0.45)]">
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Professional Information</h2>
              <p className="text-sm text-[#9fb0b5]">Share how you collaborate and where people can connect with you.</p>
            </div>
            <form className="space-y-5" onSubmit={handleProfessionalSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm space-y-1 sm:col-span-2">
                  <span className="text-[#9fb0b5] font-medium">Current Position</span>
                  <input
                    className="w-full rounded-xl bg-white/[0.03] text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]/60 transition"
                    placeholder="e.g. Product Manager at Orbit"
                    value={professionalForm.role}
                    onChange={e => setProfessionalForm(prev => ({ ...prev, role: e.target.value }))}
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-[#9fb0b5] font-medium">Company</span>
                  <input
                    className="w-full rounded-xl bg-white/[0.03] text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]/60 transition"
                    placeholder="Company name"
                    value={professionalForm.company}
                    onChange={e => setProfessionalForm(prev => ({ ...prev, company: e.target.value }))}
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-[#9fb0b5] font-medium">Industry</span>
                  <select
                    className="w-full rounded-xl bg-white/[0.03] text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]/60 transition"
                    value={professionalForm.industry}
                    onChange={e => setProfessionalForm(prev => ({ ...prev, industry: e.target.value }))}
                  >
                    <option value="">Select industry</option>
                    {INDUSTRIES.map(industry => (
                      <option key={industry} value={industry}>{industry}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm space-y-1 sm:col-span-2">
                  <span className="text-[#9fb0b5] font-medium">LinkedIn URL</span>
                  <input
                    className="w-full rounded-xl bg-white/[0.03] text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]/60 transition"
                    placeholder="https://www.linkedin.com/in/username"
                    value={professionalForm.linkedin}
                    onChange={e => setProfessionalForm(prev => ({ ...prev, linkedin: e.target.value }))}
                  />
                </label>
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-white text-black px-4 py-2.5 text-sm font-semibold hover:bg-white/90 transition shadow-[0_10px_35px_-12px_rgba(255,255,255,0.35)]"
                >
                  <i className="fa-solid fa-circle-check" />
                  Save Professional Info
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full border text-sm z-[150] shadow-lg ${
            toast.type === 'success'
              ? 'bg-[#4db6ac] text-black border-[#4db6ac]/60'
              : 'bg-red-500 text-white border-red-300/80'
          }`}
        >
          {toast.message}
        </div>
      )}

      {showPhotoModal && (
        <div
          className="fixed inset-0 z-[160] bg-black/70 backdrop-blur flex items-center justify-center px-3"
          onClick={e => e.currentTarget === e.target && setShowPhotoModal(false)}
        >
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#060a14]/95 backdrop-blur-xl p-5 shadow-[0_35px_120px_-60px_rgba(0,0,0,0.85)]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold">Update profile picture</div>
              <button className="px-2 py-1 rounded-full border border-white/10 hover:bg-white/10" onClick={() => setShowPhotoModal(false)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            {photoPreview ? (
              <div className="mb-4">
                <div className="relative w-32 h-32 mx-auto mb-3">
                  <img src={photoPreview} alt="Preview" className="w-full h-full rounded-full object-cover border-2 border-white/20 shadow-lg" />
                </div>
                <div className="text-center">
                  <button
                    onClick={uploadProfilePicture}
                    disabled={uploadingPhoto}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition"
                  >
                    {uploadingPhoto ? (
                      <>
                        <i className="fa-solid fa-spinner-third animate-spin" />
                        Uploading…
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-arrow-up-from-bracket" />
                        Update photo
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="space-y-3">
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-2xl border border-white/10 hover:bg-white/8 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                <i className="fa-solid fa-image text-[#4db6ac]" />
                <span>Choose from gallery</span>
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-2xl border border-white/10 hover:bg-white/8 transition"
                onClick={handleCameraCapture}
              >
                <i className="fa-solid fa-camera text-[#4db6ac]" />
                <span>Take a quick photo</span>
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-2xl border border-white/10 hover:bg-white/8 transition text-red-400"
                onClick={() => {
                  setShowPhotoModal(false)
                  setSelectedPhoto(null)
                  setPhotoPreview(null)
                }}
              >
                <i className="fa-solid fa-times" />
                <span>Cancel</span>
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
          </div>
        </div>
      )}
    </div>
  )
}
