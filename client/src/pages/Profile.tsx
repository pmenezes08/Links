import React, { useEffect, useMemo, useRef, useState } from 'react'
import Avatar from '../components/Avatar'

type CountryOption = { name: string; iso2?: string }

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
  const fileInputRef = React.useRef<HTMLInputElement>(null)

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
    const matchName = countries.find(
      c => c.name.toLowerCase() === rawCountry.toLowerCase()
    )?.name
    if (!matchName) {
      setCities([])
      return
    }
    const resolvedCountry = matchName
    const cacheKey = resolvedCountry.toLowerCase()
    const cached = cityCacheRef.current[cacheKey]
    if (cached) {
      setCities(cached)
      return
    }
    let cancelled = false
    async function fetchCities() {
      setCitiesLoading(true)
      try {
          const r = await fetch(`/api/geo/cities?country=${encodeURIComponent(resolvedCountry)}`, { credentials: 'include' })
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

  const displayName = personalForm.display_name || data?.display_name || data?.username || ''
  const subscriptionLabel = data?.subscription || 'free'
  const locationPreview = useMemo(() => {
    if (personalForm.city || personalForm.country) {
      return [personalForm.city, personalForm.country].filter(Boolean).join(', ')
    }
    return data?.location || ''
  }, [personalForm.city, personalForm.country, data?.location])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error || !data) return <div className="p-4 text-red-400">{error || 'Something went wrong'}</div>

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto p-3 space-y-3">
        {data.cover_photo ? (
          <div className="rounded-xl overflow-hidden border border-white/10">
            <img
              src={(data.cover_photo.startsWith('http') || data.cover_photo.startsWith('/static'))
                ? data.cover_photo
                : `/static/${data.cover_photo}`}
              alt="Cover"
              className="w-full h-auto"
            />
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            className="relative group cursor-pointer"
            onClick={() => setShowPhotoModal(true)}
            aria-label="Change profile picture"
          >
            <Avatar username={data.username} url={data.profile_picture || undefined} size={56} />
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <i className="fa-solid fa-camera text-white text-lg" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#4db6ac] rounded-full flex items-center justify-center">
              <i className="fa-solid fa-plus text-xs text-white" />
            </div>
          </button>
          <div className="min-w-0">
            <div className="text-lg font-semibold truncate">{displayName}</div>
            <div className="text-sm text-[#9fb0b5] truncate">@{data.username} • {subscriptionLabel}</div>
            {locationPreview ? (
              <div className="text-xs text-[#9fb0b5] truncate mt-1 flex items-center gap-1">
                <i className="fa-solid fa-location-dot" />
                <span>{locationPreview}</span>
              </div>
            ) : null}
          </div>
          <a
            className="ml-auto px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm whitespace-nowrap"
            href={`/profile/${encodeURIComponent(data.username)}`}
          >
            Preview Profile
          </a>
        </div>

        {/* Personal Information */}
        <div className="rounded-xl border border-white/10 p-3 bg-black">
          <div className="font-semibold mb-2">Personal Information</div>
          <form className="space-y-3" onSubmit={handlePersonalSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                Display Name
                <input
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={personalForm.display_name}
                  onChange={e => setPersonalForm(prev => ({ ...prev, display_name: e.target.value }))}
                  placeholder="Name shown publicly"
                />
              </label>
              <label className="text-sm">
                Date of Birth
                <input
                  type="date"
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={personalForm.date_of_birth}
                  onChange={e => setPersonalForm(prev => ({ ...prev, date_of_birth: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Gender
                <select
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={personalForm.gender}
                  onChange={e => setPersonalForm(prev => ({ ...prev, gender: e.target.value }))}
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
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={personalForm.country}
                  onChange={e => setPersonalForm(prev => ({ ...prev, country: e.target.value }))}
                  placeholder="Search country"
                  autoComplete="off"
                />
              </label>
              <label className="text-sm">
                City
                <input
                  list="city-options"
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={personalForm.city}
                  onChange={e => setPersonalForm(prev => ({ ...prev, city: e.target.value }))}
                  placeholder={personalForm.country ? (citiesLoading ? 'Loading cities…' : 'Search city') : 'Select a country first'}
                  autoComplete="off"
                  disabled={!personalForm.country}
                />
                {citiesLoading ? <div className="text-xs text-[#9fb0b5] mt-1">Fetching cities…</div> : null}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110 transition"
              >
                Save Personal Information
              </button>
              {locationPreview ? (
                <span className="text-xs text-[#9fb0b5]">Public location is shown as "{locationPreview}"</span>
              ) : null}
            </div>
          </form>
        </div>

        {/* Professional Information */}
        <div className="rounded-xl border border-white/10 p-3 bg-black">
          <div className="font-semibold mb-2">Professional Information</div>
          <form className="space-y-3" onSubmit={handleProfessionalSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                Current position
                <input
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={professionalForm.role}
                  onChange={e => setProfessionalForm(prev => ({ ...prev, role: e.target.value }))}
                  placeholder="e.g. Product Manager"
                />
              </label>
              <label className="text-sm">
                Company
                <input
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={professionalForm.company}
                  onChange={e => setProfessionalForm(prev => ({ ...prev, company: e.target.value }))}
                  placeholder="Company name"
                />
              </label>
              <label className="text-sm">
                Industry
                <select
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={professionalForm.industry}
                  onChange={e => setProfessionalForm(prev => ({ ...prev, industry: e.target.value }))}
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
                  className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-3 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]"
                  value={professionalForm.linkedin}
                  onChange={e => setProfessionalForm(prev => ({ ...prev, linkedin: e.target.value }))}
                  placeholder="https://www.linkedin.com/in/username"
                />
              </label>
            </div>
            <button
              type="submit"
              className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110 transition"
            >
              Save Professional Information
            </button>
          </form>
        </div>
      </div>

      <datalist id="country-options">
        {countries.map(country => (
          <option key={country.name} value={country.name} />
        ))}
      </datalist>
      <datalist id="city-options">
        {cities.map(city => (
          <option key={city} value={city} />
        ))}
      </datalist>

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full shadow-lg border text-sm z-[120] ${
            toast.type === 'success'
              ? 'bg-[#4db6ac] text-black border-[#4db6ac]/50'
              : 'bg-red-500 text-white border-red-300'
          }`}
        >
          {toast.message}
        </div>
      )}

      {showPhotoModal && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center"
          onClick={e => e.currentTarget === e.target && setShowPhotoModal(false)}
        >
          <div className="w-[90%] max-w-md rounded-2xl border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold">Change Profile Picture</div>
              <button
                className="px-2 py-1 rounded-full border border-white/10"
                onClick={() => setShowPhotoModal(false)}
              >
                ✕
              </button>
            </div>

            {photoPreview ? (
              <div className="mb-4">
                <div className="relative w-32 h-32 mx-auto mb-2">
                  <img
                    src={photoPreview}
                    alt="Preview"
                    className="w-full h-full rounded-full object-cover border-2 border-white/20"
                  />
                </div>
                <div className="text-center">
                  <button
                    onClick={uploadProfilePicture}
                    disabled={uploadingPhoto}
                    className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110 disabled:opacity-50"
                  >
                    {uploadingPhoto ? 'Uploading…' : 'Update Profile Picture'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <button
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <i className="fa-solid fa-file-image text-[#4db6ac]" />
                <span>Choose from gallery</span>
              </button>

              <button
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5"
                onClick={handleCameraCapture}
                type="button"
              >
                <i className="fa-solid fa-camera text-[#4db6ac]" />
                <span>Take photo</span>
              </button>

              <button
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5 text-red-400"
                onClick={() => {
                  setShowPhotoModal(false)
                  setSelectedPhoto(null)
                  setPhotoPreview(null)
                }}
                type="button"
              >
                <i className="fa-solid fa-times" />
                <span>Cancel</span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              className="hidden"
            />
          </div>
        </div>
      )}
    </div>
  )
}
