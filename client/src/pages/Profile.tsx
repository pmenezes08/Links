import { useEffect, useRef, useState, useCallback } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import Avatar, { clearImageCache } from '../components/Avatar'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useNavigate } from 'react-router-dom'
import { clearAvatarCache } from '../utils/avatarCache'

const PROFILE_DRAFT_KEY = 'cpoint_profile_personal_draft'

const ONBOARDING_PROFILE_HINT_KEY = 'cpoint_onboarding_profile_hint'
const ONBOARDING_RESUME_KEY = 'cpoint_onboarding_resume_step'

type PersonalForm = {
  first_name: string
  last_name: string
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
  first_name: '',
  last_name: '',
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

const INTEREST_SUGGESTIONS = [
  'Artificial Intelligence',
  'Design',
  'Entrepreneurship',
  'Fitness',
  'Investing',
  'Marketing',
  'Photography',
  'Product Management',
  'Software Engineering',
  'Startups',
  'Travel',
  'Wellness',
]

function coalesceString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return ''
}

type SelectOption = {
  value: string
  label: string
}

type SelectFieldProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  searchable?: boolean
  allowCustomOption?: boolean
  emptyMessage?: string
}

function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  loading = false,
  searchable = false,
  allowCustomOption = false,
  emptyMessage = 'No options available',
}: SelectFieldProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const mergedOptions = options.map(option => ({
    value: option.value,
    label: option.label || option.value,
  }))

  const selectedOption = mergedOptions.find(option => option.value === value)
  const buttonLabel = selectedOption?.label || value || placeholder || 'Select…'
  const filteredOptions =
    searchable && query
      ? mergedOptions.filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
      : mergedOptions
  const showCreateOption =
    allowCustomOption &&
    query.trim().length > 0 &&
    !mergedOptions.some(option => option.label.toLowerCase() === query.trim().toLowerCase())

  function handleSelect(nextValue: string) {
    onChange(nextValue)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} className={`relative ${disabled ? 'opacity-60' : ''}`}>
      <button
        type="button"
        className={`flex w-full items-center justify-between rounded-lg border border-white/12 bg-[#10131a] px-3 py-1.5 text-left transition ${
          disabled ? 'cursor-not-allowed text-white/40' : 'text-white/80 hover:border-[#4db6ac]/60'
        }`}
        onClick={() => {
          if (!disabled) setOpen(prev => !prev)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className={`truncate ${value ? 'text-white' : 'text-white/40'}`}>{buttonLabel}</span>
        <i
          className={`fa-solid fa-chevron-down text-[10px] transition-transform ${
            open ? 'rotate-180 text-[#4db6ac]' : 'text-white/50'
          }`}
        />
      </button>
      {open ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-lg border border-white/12 bg-[#0b0d11] shadow-[0_16px_35px_rgba(2,4,8,0.55)]">
          {searchable ? (
            <div className="p-2">
              <input
                className="w-full rounded-md border border-white/10 bg-[#12141a] px-2 py-1 text-xs text-white/80 outline-none focus:border-[#4db6ac]"
                placeholder="Search…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                autoFocus
              />
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-white/60">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-[#4db6ac]" />
              Loading…
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto py-1">
              {filteredOptions.length ? (
                filteredOptions.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`flex w-full items-center justify-between px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 ${
                      option.value === value ? 'text-[#4db6ac]' : ''
                    }`}
                    onClick={() => handleSelect(option.value)}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.value === value ? <i className="fa-solid fa-check text-[10px]" /> : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-xs text-white/40">{emptyMessage}</div>
              )}
              {showCreateOption ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#4db6ac] transition hover:bg-[#4db6ac]/10"
                  onClick={() => handleSelect(query.trim())}
                >
                  <i className="fa-solid fa-plus text-[10px]" />
                  Add “{query.trim()}”
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function Profile() {
  const navigate = useNavigate()
  const [showOnboardingReturn, setShowOnboardingReturn] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const flag = sessionStorage.getItem(ONBOARDING_PROFILE_HINT_KEY)
      if (flag === '1') setShowOnboardingReturn(true)
    } catch {}
  }, [])

  const handleReturnToOnboarding = () => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(ONBOARDING_RESUME_KEY, '4')
        sessionStorage.removeItem(ONBOARDING_PROFILE_HINT_KEY)
      }
    } catch {}
    navigate('/premium_dashboard')
  }

  const [summary, setSummary] = useState<ProfileSummary | null>(null)
  const [personal, setPersonal] = useState<PersonalForm>(PERSONAL_DEFAULT)
  const [professional, setProfessional] = useState<ProfessionalForm>(PROFESSIONAL_DEFAULT)
  const [countries, setCountries] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingPersonal, setSavingPersonal] = useState(false)
  const [savingProfessional, setSavingProfessional] = useState(false)
  const [savingInterests, setSavingInterests] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [citiesLoading, setCitiesLoading] = useState(false)
  const cityCache = useRef<Map<string, string[]>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const bioRef = useRef<HTMLTextAreaElement | null>(null)
  const [interestInput, setInterestInput] = useState('')
  const serverPersonalRef = useRef<PersonalForm>(PERSONAL_DEFAULT)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const {
    profile: cachedProfile,
    setProfile: setContextProfile,
    loading: cachedProfileLoading,
    error: cachedProfileError,
    refresh: refreshUserProfile,
  } = useUserProfile()

  const [aiSuggestions, setAiSuggestions] = useState<Record<string, any> | null>(null)
  const [aiAccepted, setAiAccepted] = useState<Set<string>>(new Set())
  const [aiEdits, setAiEdits] = useState<Record<string, string>>({})
  const [aiReviewStatus, setAiReviewStatus] = useState<string | null>(null)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiEditingSection, setAiEditingSection] = useState<string | null>(null)

  const isPersonalDirty = useCallback(() => {
    const s = serverPersonalRef.current
    return personal.first_name !== s.first_name || personal.last_name !== s.last_name ||
      personal.bio !== s.bio || personal.display_name !== s.display_name ||
      personal.date_of_birth !== s.date_of_birth || personal.gender !== s.gender ||
      personal.country !== s.country || personal.city !== s.city
  }, [personal])

  // Persist personal form as draft on every change
  useEffect(() => {
    if (!summary?.username) return
    if (!isPersonalDirty()) return
    try { sessionStorage.setItem(PROFILE_DRAFT_KEY, JSON.stringify(personal)) } catch {}
  }, [personal, summary?.username, isPersonalDirty])

  // Browser tab close / refresh warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isPersonalDirty()) { e.preventDefault() }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isPersonalDirty])

  // In-app back-button navigation blocker (works with BrowserRouter)
  const pendingNavRef = useRef<string | null>(null)
  const isPersonalDirtyRef = useRef(isPersonalDirty)
  isPersonalDirtyRef.current = isPersonalDirty

  useEffect(() => {
    const onPopState = () => {
      if (isPersonalDirtyRef.current()) {
        window.history.pushState(null, '', window.location.href)
        setShowLeaveModal(true)
        pendingNavRef.current = '__back__'
      }
    }
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const handleDiscardAndLeave = useCallback(() => {
    try { sessionStorage.removeItem(PROFILE_DRAFT_KEY) } catch {}
    setShowLeaveModal(false)
    if (pendingNavRef.current === '__back__') {
      window.history.back()
    } else if (pendingNavRef.current) {
      navigate(pendingNavRef.current)
    }
    pendingNavRef.current = null
  }, [navigate])

  const handleSaveAndLeave = useCallback(async () => {
    if (!navigator.onLine) { alert('Go back online to save changes'); setShowLeaveModal(false); return }
    setSavingPersonal(true)
    try {
      const form = new FormData()
      form.append('first_name', personal.first_name)
      form.append('last_name', personal.last_name)
      form.append('bio', personal.bio)
      form.append('display_name', personal.display_name)
      if (personal.date_of_birth) form.append('date_of_birth', personal.date_of_birth)
      form.append('gender', personal.gender)
      form.append('country', personal.country)
      form.append('city', personal.city)
      const response = await fetch('/update_personal_info', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        serverPersonalRef.current = { ...personal }
        try { sessionStorage.removeItem(PROFILE_DRAFT_KEY) } catch {}
        try { await refreshUserProfile() } catch {}
      }
    } catch {}
    setSavingPersonal(false)
    setShowLeaveModal(false)
    if (pendingNavRef.current === '__back__') {
      window.history.back()
    } else if (pendingNavRef.current) {
      navigate(pendingNavRef.current)
    }
    pendingNavRef.current = null
  }, [personal, navigate, refreshUserProfile])

  const handleCancelLeave = useCallback(() => {
    setShowLeaveModal(false)
    pendingNavRef.current = null
  }, [])

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
    if (cachedProfileLoading) {
      setLoading(true)
      return
    }

    if (!cachedProfile) {
      setLoading(false)
      if (cachedProfileError) {
        setError(cachedProfileError)
      } else {
        setError('Unable to load profile')
      }
      return
    }

    const profile = cachedProfile as Record<string, any>
    const personalInfo =
      profile.personal ??
      profile.personal_info ??
      profile.personalInfo ??
      profile.personal_details ??
      profile.personalDetails ??
      {}
    const professionalInfo =
      profile.professional ??
      profile.professional_info ??
      profile.professionalInfo ??
      profile.professional_details ??
      profile.professionalDetails ??
      {}
    const locationInfo = profile.location ?? personalInfo.location ?? {}
    const rawInterests =
      professionalInfo.interests ??
      profile.interests ??
      profile.personal_interests ??
      profile.personalInterests ??
      []
    const interestList = Array.isArray(rawInterests)
      ? rawInterests.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
      : typeof rawInterests === 'string' && rawInterests
        ? rawInterests
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
        : []
    const sanitizedInterests = normalizeInterests(interestList)
    const cityValue = coalesceString(
      personalInfo.city,
      locationInfo.city,
      profile.city,
      profile.personal_city,
      profile.personalCity,
    )
    const countryValue = coalesceString(
      personalInfo.country,
      locationInfo.country,
      profile.country,
      profile.personal_country,
      profile.personalCountry,
    )
    // Add cache-buster to profile picture URL to ensure fresh image loads
    // BUT if we just uploaded a new picture, use that instead of the (potentially stale) server data
    let profilePicToUse: string | null
    if (justUploadedPicRef.current) {
      profilePicToUse = justUploadedPicRef.current
      // Clear the ref after using it once (so future syncs work normally)
      justUploadedPicRef.current = null
    } else {
      const rawProfilePic = coalesceString(profile.profile_picture, profile.profilePicture) || null
      profilePicToUse = rawProfilePic 
        ? (rawProfilePic.includes('?') ? rawProfilePic : `${rawProfilePic}?v=${Date.now()}`)
        : null
    }
    
    setSummary({
      username: coalesceString(profile.username),
      subscription: coalesceString(profile.subscription, profile.plan),
      profile_picture: profilePicToUse,
      cover_photo: coalesceString(profile.cover_photo, profile.coverPhoto) || null,
      display_name:
        coalesceString(
          personalInfo.display_name,
          personalInfo.displayName,
          profile.display_name,
          profile.displayName,
        ) || coalesceString(profile.username),
      location:
        coalesceString(
          typeof profile.location === 'string' ? profile.location : '',
          typeof locationInfo === 'string' ? locationInfo : '',
          locationInfo.formatted,
        ) || [cityValue, countryValue].filter(Boolean).join(', '),
      bio: coalesceString(profile.bio, personalInfo.bio, personalInfo.about, profile.summary, profile.about),
    })
    const loadedPersonal: PersonalForm = {
      first_name: coalesceString(profile.first_name, personalInfo.first_name, personalInfo.firstName),
      last_name: coalesceString(profile.last_name, personalInfo.last_name, personalInfo.lastName),
      bio: coalesceString(profile.bio, personalInfo.bio, personalInfo.about),
      display_name: coalesceString(
        personalInfo.display_name,
        personalInfo.displayName,
        profile.display_name,
        profile.displayName,
      ),
      date_of_birth: (() => {
        const dobValue =
          personalInfo.date_of_birth ??
          personalInfo.dateOfBirth ??
          personalInfo.dob ??
          profile.date_of_birth ??
          profile.dateOfBirth
        if (typeof dobValue === 'string') return dobValue.slice(0, 10)
        if (dobValue instanceof Date) return dobValue.toISOString().slice(0, 10)
        return ''
      })(),
      gender: coalesceString(personalInfo.gender, profile.gender),
      country: countryValue,
      city: cityValue,
    }
    serverPersonalRef.current = loadedPersonal
    // Restore draft if it exists and differs from server data
    let finalPersonal = loadedPersonal
    try {
      const raw = sessionStorage.getItem(PROFILE_DRAFT_KEY)
      if (raw) {
        const draft = JSON.parse(raw) as PersonalForm
        if (draft && typeof draft.bio === 'string') {
          const differs = Object.keys(loadedPersonal).some(
            k => (draft as any)[k] !== (loadedPersonal as any)[k]
          )
          if (differs) {
            finalPersonal = draft
          } else {
            sessionStorage.removeItem(PROFILE_DRAFT_KEY)
          }
        }
      }
    } catch {}
    setPersonal(finalPersonal)
    if (bioRef.current && bioRef.current.value !== finalPersonal.bio) {
      bioRef.current.value = finalPersonal.bio
    }
    setProfessional({
      role: coalesceString(
        professionalInfo.role,
        professionalInfo.current_position,
        professionalInfo.currentPosition,
        professionalInfo.position,
        professionalInfo.job_title,
        professionalInfo.jobTitle,
        profile.role,
      ),
      company: coalesceString(
        professionalInfo.company,
        professionalInfo.organization,
        professionalInfo.employer,
        profile.company,
      ),
      industry: coalesceString(
        professionalInfo.industry,
        professionalInfo.field,
        professionalInfo.sector,
        profile.industry,
      ),
      linkedin: coalesceString(
        professionalInfo.linkedin,
        professionalInfo.linkedin_url,
        professionalInfo.linkedinUrl,
        profile.linkedin,
        profile.linkedinUrl,
      ),
      about: coalesceString(
        professionalInfo.about,
        professionalInfo.summary,
        professionalInfo.bio,
        profile.professional_summary,
        profile.professionalSummary,
      ),
      interests: sanitizedInterests,
    })
    setInterestInput('')
    setError(null)
    setLoading(false)
  }, [cachedProfile, cachedProfileLoading, cachedProfileError])

  useEffect(() => {
    let cancelled = false
    async function loadCountries() {
      try {
        const cached = sessionStorage.getItem('geo_countries')
        if (cached) {
          const names = JSON.parse(cached) as string[]
          // Use cached data only if we have a reasonable number of countries
          if (!cancelled && names.length >= 50) {
            setCountries(names)
            return
          }
        }
      } catch {}

      try {
        const response = await fetch('/api/geo/countries', {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
          // Add cache-busting for fresh data
          cache: 'no-cache'
        })
        const payload = await response.json().catch(() => null)
        if (!cancelled) {
          if (payload?.success && Array.isArray(payload.countries)) {
            const names = payload.countries
              .map((item: { name?: string }) => typeof item?.name === 'string' ? item.name : null)
              .filter(Boolean) as string[]
            setCountries(names)
            try { sessionStorage.setItem('geo_countries', JSON.stringify(names)) } catch {}
          } else {
            // Fallback to expanded static list if API fails
            const fallbackCountries = [
              'United States', 'Mexico', 'Canada', 'United Kingdom', 'Germany', 'France',
              'Spain', 'Italy', 'Brazil', 'India', 'Japan', 'Australia', 'China',
              'South Korea', 'Russia', 'Netherlands', 'Switzerland', 'South Africa',
              'United Arab Emirates', 'Turkey', 'Portugal', 'Ireland', 'Norway',
              'Denmark', 'Sweden', 'Belgium', 'New Zealand', 'Singapore', 'Saudi Arabia',
              'Thailand', 'Indonesia', 'Argentina', 'Colombia', 'Chile', 'Peru',
              'Egypt', 'Nigeria', 'Kenya', 'Philippines', 'Vietnam', 'Malaysia',
              'Austria', 'Czech Republic', 'Poland', 'Hungary', 'Greece', 'Romania'
            ]
            setCountries(fallbackCountries)
          }
        }
      } catch {
        if (!cancelled) {
          // Final fallback with comprehensive list
          const fallbackCountries = [
            'United States', 'Mexico', 'Canada', 'United Kingdom', 'Germany', 'France',
            'Spain', 'Italy', 'Brazil', 'India', 'Japan', 'Australia', 'China',
            'South Korea', 'Russia', 'Netherlands', 'Switzerland', 'South Africa'
          ]
          setCountries(fallbackCountries)
        }
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
    const memCached = cityCache.current.get(cacheKey)
    if (memCached) {
      setCities(memCached)
      return
    }
    try {
      const stored = sessionStorage.getItem(`geo_cities:${cacheKey}`)
      if (stored) {
        const list = JSON.parse(stored) as string[]
        cityCache.current.set(cacheKey, list)
        setCities(list)
        return
      }
    } catch {}
    let cancelled = false
    async function loadCities() {
      setCitiesLoading(true)
      try {
        const response = await fetch(`/api/geo/cities?country=${encodeURIComponent(exactMatch)}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const payload = await response.json().catch(() => null)
        if (!cancelled) {
          if (payload?.success && Array.isArray(payload.cities)) {
            const list = payload.cities.map((item: string) => item?.trim()).filter(Boolean)
            cityCache.current.set(cacheKey, list)
            try { sessionStorage.setItem(`geo_cities:${cacheKey}`, JSON.stringify(list)) } catch {}
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

  useEffect(() => {
    let cancelled = false
    fetch('/api/profile/ai_suggestions', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.success && d.suggestions) {
          setAiSuggestions(d.suggestions)
          setAiAccepted(new Set(d.acceptedSections || []))
          setAiReviewStatus(d.userReview?.status || null)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const locationPreview = personal.city || personal.country
    ? [personal.city, personal.country].filter(Boolean).join(', ')
    : summary?.location || ''

  const normalizedCountries = personal.country
    ? countries.some(country => country.toLowerCase() === personal.country.toLowerCase())
      ? countries
      : [personal.country, ...countries.filter(country => country.toLowerCase() !== personal.country.toLowerCase())]
    : countries

  const normalizedCities = personal.city
    ? cities.some(city => city.toLowerCase() === personal.city.toLowerCase())
      ? cities
      : [personal.city, ...cities.filter(city => city.toLowerCase() !== personal.city.toLowerCase())]
    : cities

  const genderOptions: SelectOption[] = GENDERS.map(option => ({ value: option, label: option }))
  const countryOptions: SelectOption[] = normalizedCountries.map(country => ({ value: country, label: country }))
  const cityOptions: SelectOption[] = normalizedCities.map(city => ({ value: city, label: city }))
  const industryOptions: SelectOption[] = INDUSTRIES.map(industry => ({ value: industry, label: industry }))

  const citySelectDisabled = !personal.country
  const cityPlaceholder = personal.country
    ? citiesLoading
      ? 'Loading cities…'
      : normalizedCities.length
        ? 'Select a city'
        : 'Type to add a city'
    : 'Select a country first'

  async function handlePersonalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!navigator.onLine) { alert('Go back online to save changes'); return }
    if (savingPersonal) return
    setSavingPersonal(true)
    try {
      const form = new FormData()
      form.append('first_name', personal.first_name)
      form.append('last_name', personal.last_name)
      form.append('bio', personal.bio)
      form.append('display_name', personal.display_name)
      if (personal.date_of_birth) form.append('date_of_birth', personal.date_of_birth)
      form.append('gender', personal.gender)
      form.append('country', personal.country)
      form.append('city', personal.city)
      const response = await fetch('/update_personal_info', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        serverPersonalRef.current = { ...personal }
        try { sessionStorage.removeItem(PROFILE_DRAFT_KEY) } catch {}
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
        try {
          await refreshUserProfile()
        } catch {}
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
    if (!navigator.onLine) { alert('Go back online to save changes'); return }
    if (savingProfessional) return
    setSavingProfessional(true)
    try {
      let interestList = normalizeInterests(professional.interests)
      if (
        interestList.length !== professional.interests.length ||
        interestList.some((interest, index) => interest !== professional.interests[index])
      ) {
        setProfessional(prev => ({ ...prev, interests: interestList }))
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
        try {
          await refreshUserProfile()
        } catch {
          // Ignore refresh errors; context will retry on navigation
        }
      } else {
        setFeedback(payload?.error || 'Unable to save professional information')
      }
    } catch {
      setFeedback('Unable to save professional information')
    } finally {
      setSavingProfessional(false)
    }
  }

  async function handleInterestsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!navigator.onLine) { alert('Go back online to save changes'); return }
    if (savingInterests) return
    setSavingInterests(true)
    try {
      const pendingInterest = interestInput.trim()
      if (
        pendingInterest &&
        professional.interests.length >= MAX_INTERESTS &&
        !professional.interests.some(item => item.toLowerCase() === pendingInterest.toLowerCase())
      ) {
        setFeedback(`You can list up to ${MAX_INTERESTS} interests. Remove one to add more.`)
        return
      }
      let interestList = professional.interests
      if (pendingInterest) {
        interestList = normalizeInterests([...interestList, pendingInterest])
      } else {
        interestList = normalizeInterests(interestList)
      }
      if (
        interestList.length !== professional.interests.length ||
        interestList.some((interest, index) => interest !== professional.interests[index])
      ) {
        setProfessional(prev => ({ ...prev, interests: interestList }))
      }
      if (pendingInterest) {
        setInterestInput('')
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
        setFeedback('Personal interests saved')
        try {
          await refreshUserProfile()
        } catch {
          // Ignore refresh errors; context will retry on navigation
        }
      } else {
        setFeedback(payload?.error || 'Unable to save personal interests')
      }
    } catch {
      setFeedback('Unable to save personal interests')
    } finally {
      setSavingInterests(false)
    }
  }

  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [localPhotoPreview, setLocalPhotoPreview] = useState<string | null>(null)
  // Track when we've just uploaded to prevent useEffect from overwriting our new picture
  const justUploadedPicRef = useRef<string | null>(null)

  async function handlePhotoUpload(file: File) {
    if (!navigator.onLine) { alert('Go back online to upload a photo'); return }
    // Show immediate local preview
    const previewUrl = URL.createObjectURL(file)
    setLocalPhotoPreview(previewUrl)
    setUploadingPhoto(true)
    
    const form = new FormData()
    form.append('profile_picture', file)
    try {
      const response = await fetch('/upload_profile_picture', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success && payload.profile_picture) {
        // Clear ALL avatar caches so the new image loads fresh everywhere
        if (summary?.username) {
          clearAvatarCache(summary.username)
          clearImageCache(summary.username)
        }
        // Add cache-busting timestamp to force avatar refresh across the app
        const cacheBustedUrl = `${payload.profile_picture}?v=${Date.now()}`
        
        // Mark that we just uploaded - this prevents useEffect from overwriting
        justUploadedPicRef.current = cacheBustedUrl
        
        setSummary(prev => prev ? { ...prev, profile_picture: cacheBustedUrl } : prev)
        setLocalPhotoPreview(null) // Clear local preview, use server URL
        setFeedback('Profile picture updated')
        
        // Directly update the context profile with new picture URL
        // This avoids refetching from potentially stale server cache
        setContextProfile(prev => {
          if (!prev) return prev
          return { ...prev, profile_picture: cacheBustedUrl }
        })
      } else {
        setLocalPhotoPreview(null) // Revert to old image on error
        setFeedback(payload?.error || 'Unable to upload picture')
      }
    } catch {
      setLocalPhotoPreview(null) // Revert to old image on error
      setFeedback('Unable to upload picture')
    } finally {
      setUploadingPhoto(false)
      // Clean up the blob URL
      URL.revokeObjectURL(previewUrl)
    }
  }

  function onSelectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) handlePhotoUpload(file)
  }

  function toggleAiSection(key: string) {
    setAiAccepted(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function renderAiCard(key: string, label: string) {
    if (!aiSuggestions || !(key in aiSuggestions) || aiSuggestions[key] === null) return null
    const val = aiSuggestions[key]
    const accepted = aiAccepted.has(key)
    const editing = aiEditingSection === key
    const editValue = aiEdits[key] ?? getAiSectionText(key, val)
    return (
      <div className={`mt-2 rounded-lg border p-2.5 transition-all ${
        accepted ? 'border-[#4db6ac]/30 bg-[#4db6ac]/5' : 'border-dashed border-white/10 bg-white/[0.02]'
      }`}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#4db6ac] flex items-center gap-1">
            <i className="fa-solid fa-wand-magic-sparkles text-[8px]" />
            {label}
          </span>
          <div className="flex items-center gap-1.5">
            {accepted && !editing && (
              <button type="button" onClick={() => setAiEditingSection(key)} className="text-[10px] text-[#4db6ac]/60 hover:text-[#4db6ac]">edit</button>
            )}
            <button
              type="button"
              onClick={() => toggleAiSection(key)}
              className={`relative w-8 h-4 rounded-full transition-colors ${accepted ? 'bg-[#4db6ac]' : 'bg-white/15'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${accepted ? 'translate-x-4' : ''}`} />
            </button>
          </div>
        </div>
        {editing ? (
          <div className="mt-1.5">
            <textarea
              value={editValue}
              onChange={e => setAiEdits(prev => ({ ...prev, [key]: e.target.value }))}
              rows={2}
              className="w-full rounded-md border border-white/10 bg-black/50 px-2 py-1.5 text-xs text-white outline-none focus:border-[#4db6ac]/50 resize-none"
            />
            <button type="button" onClick={() => setAiEditingSection(null)} className="text-[10px] text-[#4db6ac] mt-1">done</button>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-[#a7b8be] leading-relaxed">{key in aiEdits ? aiEdits[key] : getAiSectionText(key, val)}</p>
        )}
      </div>
    )
  }

  function getAiSectionText(key: string, val: any): string {
    if (typeof val === 'string') return val
    if (key === 'interests' && typeof val === 'object' && !Array.isArray(val))
      return Object.keys(val).join(', ')
    if (key === 'professional' && typeof val === 'object') {
      const parts: string[] = []
      if (val.company?.description) parts.push(`${val.company.name}: ${val.company.description}`)
      if (val.role?.title) parts.push(`${val.role.title}${val.role.implication ? ' — ' + val.role.implication : ''}`)
      if (val.education) parts.push(val.education)
      if (val.location?.context) parts.push(val.location.context)
      if (val.webFindings) parts.push(val.webFindings)
      return parts.join('. ')
    }
    if (key === 'personal' && typeof val === 'object') {
      const parts: string[] = []
      if (val.lifestyle) parts.push(val.lifestyle)
      if (val.interests?.length) parts.push(`Interests: ${val.interests.join(', ')}`)
      if (val.webFindings) parts.push(val.webFindings)
      return parts.join('. ')
    }
    if (key === 'identity' && typeof val === 'object')
      return [val.bridgeInsight, val.drivingForces].filter(Boolean).join(' — ')
    if (key === 'conversationStarters' && Array.isArray(val))
      return val.join('; ')
    return typeof val === 'object' ? JSON.stringify(val) : String(val)
  }

  async function saveAiReview() {
    setAiSaving(true)
    try {
      const hasEdits = Object.keys(aiEdits).length > 0
      const status = hasEdits ? 'edited' : 'confirmed'
      const res = await fetch('/api/profile/ai_review', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, acceptedSections: Array.from(aiAccepted), edits: aiEdits }),
      })
      const d = await res.json()
      if (d.success) {
        setAiReviewStatus(status)
        setAiEditingSection(null)
        setFeedback('Profile enhancements saved!')
        try { invalidate_user_cache() } catch {}
      } else {
        setFeedback(d.error || 'Failed to save')
      }
    } catch {
      setFeedback('Failed to save enhancements')
    } finally {
      setAiSaving(false)
    }
  }

  function invalidate_user_cache() {
    fetch('/api/profile_me', { credentials: 'include', headers: { 'Cache-Control': 'no-cache' } })
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error || !summary) return <div className="p-4 text-red-400">{error || 'Something went wrong'}</div>

  return (
    <div className="glass-page min-h-screen text-white">
      <div className="glass-card glass-card--plain max-w-3xl mx-auto px-4 py-4 space-y-4">
        {summary.cover_photo ? (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <img
              src={summary.cover_photo.startsWith('http') ? summary.cover_photo : `/static/${summary.cover_photo}`}
              alt="Cover"
              className="w-full h-40 object-cover"
            />
          </div>
        ) : null}
          {showOnboardingReturn && (
            <div className="rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-white">
                Finished updating your profile? Jump back to onboarding to complete the setup.
              </div>
              <button
                type="button"
                className="rounded-full border border-[#4db6ac]/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white hover:bg-[#4db6ac]/20"
                onClick={handleReturnToOnboarding}
              >
                Return to onboarding
              </button>
            </div>
          )}

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            {/* Show local preview immediately, then server URL after upload */}
            {localPhotoPreview ? (
              <div 
                className="rounded-full overflow-hidden bg-white/10 border border-white/10 flex items-center justify-center"
                style={{ width: 64, height: 64 }}
              >
                <img src={localPhotoPreview} alt="Preview" className="w-full h-full object-cover" />
                {uploadingPhoto && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-full">
                    <i className="fa-solid fa-spinner fa-spin text-white" />
                  </div>
                )}
              </div>
            ) : (
              <Avatar username={summary.username} url={summary.profile_picture || undefined} size={64} />
            )}
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
          <div className="min-w-0 flex-1 space-y-1">
            <div className="font-semibold text-lg leading-tight break-words">{summary.display_name || summary.username}</div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[#cfd8dc]">
              <span className="truncate">@{summary.username}</span>
              {summary.subscription ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs uppercase tracking-wide text-white/80">
                  <i className="fa-solid fa-gem text-[10px]" />
                  {summary.subscription}
                </span>
              ) : null}
            </div>
            {locationPreview ? (
              <div className="flex flex-wrap items-center gap-1 text-xs text-[#9fb0b5]">
                <i className="fa-solid fa-location-dot" />
                <span className="truncate">{locationPreview}</span>
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
              Personal Bio
              <textarea
                ref={bioRef}
                className="mt-1 w-full min-h-[100px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                style={{ userSelect: 'text', WebkitUserSelect: 'text' } as React.CSSProperties}
                defaultValue={personal.bio}
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
              <label className="text-sm min-w-0">
                First name
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.first_name}
                  onChange={event => setPersonal(prev => ({ ...prev, first_name: event.target.value }))}
                />
              </label>
              <label className="text-sm min-w-0">
                Last name
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.last_name}
                  onChange={event => setPersonal(prev => ({ ...prev, last_name: event.target.value }))}
                />
              </label>
              <label className="text-sm min-w-0">
                Display name
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.display_name}
                  onChange={event => setPersonal(prev => ({ ...prev, display_name: event.target.value }))}
                />
              </label>
              <label className="text-sm min-w-0">
                Date of birth
                <input
                  type="date"
                  className="mt-1 w-full min-w-0 rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.date_of_birth}
                  onChange={event => setPersonal(prev => ({ ...prev, date_of_birth: event.target.value }))}
                />
              </label>
                <label className="text-sm min-w-0">
                  Gender
                  <div className="mt-1">
                    <SelectField
                      value={personal.gender}
                      onChange={nextValue => setPersonal(prev => ({ ...prev, gender: nextValue }))}
                      options={genderOptions}
                      placeholder="Select a value"
                    />
                  </div>
                </label>
                <label className="text-sm min-w-0">
                  Country
                  <div className="mt-1">
                    <SelectField
                      value={personal.country}
                      onChange={nextValue => setPersonal(prev => ({ ...prev, country: nextValue, city: '' }))}
                      options={countryOptions}
                      placeholder="Select a country"
                      searchable
                      allowCustomOption
                      emptyMessage="No countries match your search"
                    />
                  </div>
                </label>
                <label className="text-sm min-w-0">
                  City
                  <div className="mt-1">
                    <SelectField
                      value={personal.city}
                      onChange={nextValue => setPersonal(prev => ({ ...prev, city: nextValue }))}
                      options={cityOptions}
                      placeholder={cityPlaceholder}
                      disabled={citySelectDisabled}
                      loading={citiesLoading}
                      searchable
                      allowCustomOption
                      emptyMessage={personal.country ? 'No cities found, type to add your own' : 'Select a country first'}
                    />
                  </div>
                </label>
            </div>
            {renderAiCard('summary', 'Steve found a professional summary for you')}
            {renderAiCard('identity', 'Steve identified what makes you unique')}
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingPersonal}
            >
              {savingPersonal ? 'Saving…' : 'Save bio and personal info'}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-white/10 p-4">
          <form className="space-y-4" onSubmit={handleProfessionalSubmit}>
            <header>
              <div className="font-semibold">Professional information</div>
              <p className="text-xs text-[#9fb0b5]">Let others know how to collaborate with you.</p>
            </header>
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
                <div className="mt-1">
                  <SelectField
                    value={professional.industry}
                    onChange={nextValue => setProfessional(prev => ({ ...prev, industry: nextValue }))}
                    options={industryOptions}
                    placeholder="Select an industry"
                    searchable
                    allowCustomOption
                    emptyMessage="No industries match your search"
                  />
                </div>
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
            {renderAiCard('professional', 'Steve found insights about your professional background')}
            {renderAiCard('personal', 'Steve discovered personal context from public sources')}
            {renderAiCard('networkingValue', 'Steve identified your networking value')}
            {renderAiCard('conversationStarters', 'Conversation starters Steve suggests')}
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingProfessional}
            >
              {savingProfessional ? 'Saving…' : 'Save professional info'}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-white/10 p-4">
          <form className="space-y-3" onSubmit={handleInterestsSubmit}>
            <div>
              <div className="text-sm font-semibold text-white">Personal interests</div>
              <p className="text-xs text-[#9fb0b5]">Press enter after each interest to add it.</p>
              <div className="mt-2 space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-white/40">Popular suggestions</div>
                <div className="flex flex-wrap gap-2">
                  {INTEREST_SUGGESTIONS.map(suggestion => {
                    const alreadySelected = professional.interests.some(
                      interest => interest.toLowerCase() === suggestion.toLowerCase(),
                    )
                    return (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => !alreadySelected && addInterest(suggestion)}
                        className={`rounded-full border px-3 py-1 text-[11px] transition ${
                          alreadySelected
                            ? 'border-[#4db6ac]/60 bg-[#4db6ac]/20 text-[#4db6ac] cursor-default'
                            : 'border-white/15 bg-white/[0.08] text-white/80 hover:border-[#4db6ac] hover:text-[#4db6ac]'
                        }`}
                        disabled={alreadySelected}
                      >
                        {suggestion}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
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
                  placeholder={professional.interests.length ? 'Add another interest' : 'Add an interest…'}
                  className="flex-1 min-w-[140px] bg-transparent text-xs text-white placeholder:text-[#9fb0b5] outline-none"
                />
              ) : null}
            </div>
            {renderAiCard('interests', 'Steve identified interests from your profile')}
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingInterests}
            >
              {savingInterests ? 'Saving…' : 'Save personal interests'}
            </button>
          </form>
        </section>

        {aiSuggestions && aiAccepted.size > 0 && (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={saveAiReview}
              disabled={aiSaving}
              className="px-6 py-2 rounded-full bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50 transition flex items-center gap-2"
            >
              <i className="fa-solid fa-wand-magic-sparkles" />
              {aiSaving ? 'Saving…' : `Save ${aiAccepted.size} enhancement${aiAccepted.size !== 1 ? 's' : ''} to profile`}
            </button>
            {aiReviewStatus && aiReviewStatus !== 'pending' && (
              <span className="text-[10px] text-[#4db6ac]/60">{aiReviewStatus === 'confirmed' ? 'Saved' : aiReviewStatus === 'edited' ? 'Saved (edited)' : ''}</span>
            )}
          </div>
        )}

        {feedback ? (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full border border-white/10 bg-white/10 text-sm text-white">
            {feedback}
          </div>
        ) : null}

        {showLeaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111] p-5 space-y-4">
              <h3 className="text-base font-semibold text-white">Unsaved changes</h3>
              <p className="text-sm text-[#a7b8be]">You have unsaved profile changes. Would you like to save before leaving?</p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleSaveAndLeave}
                  disabled={savingPersonal}
                  className="w-full py-2.5 rounded-lg bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
                >
                  {savingPersonal ? 'Saving…' : 'Save and leave'}
                </button>
                <button
                  onClick={handleDiscardAndLeave}
                  className="w-full py-2.5 rounded-lg border border-white/15 text-sm text-white hover:bg-white/5"
                >
                  Discard changes
                </button>
                <button
                  onClick={handleCancelLeave}
                  className="w-full py-2 text-sm text-[#9fb0b5] hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
