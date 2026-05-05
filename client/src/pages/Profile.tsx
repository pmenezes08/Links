import { useEffect, useRef, useState, useCallback } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import Avatar, { clearImageCache } from '../components/Avatar'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useNavigate } from 'react-router-dom'
import { clearAvatarCache } from '../utils/avatarCache'
import type { SelectOption } from '../components/profile/ProfileSelectField'
import { ProfileDetailsModal, type WorkExperienceRow, type EducationRow } from '../components/profile/ProfileDetailsModal'

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
  personal_answer_five_minutes: string
  personal_answer_outside_work: string
  personal_answer_cpoint_goals: string
}

type ProfessionalForm = {
  role: string
  company: string
  company_intel: string
  industry: string
  linkedin: string
  about: string
  interests: string[]
  current_role_start: string
  work_history: WorkExperienceRow[]
  education: EducationRow[]
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
  personal_answer_five_minutes: '',
  personal_answer_outside_work: '',
  personal_answer_cpoint_goals: '',
}

const PROFESSIONAL_DEFAULT: ProfessionalForm = {
  role: '',
  company: '',
  company_intel: '',
  industry: '',
  linkedin: '',
  about: '',
  interests: [],
  current_role_start: '',
  work_history: [],
  education: [],
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

function personalAnswersFromHighlights(highlights: unknown): Pick<
  PersonalForm,
  'personal_answer_five_minutes' | 'personal_answer_outside_work' | 'personal_answer_cpoint_goals'
> {
  const base = {
    personal_answer_five_minutes: '',
    personal_answer_outside_work: '',
    personal_answer_cpoint_goals: '',
  }
  if (!Array.isArray(highlights)) return base
  for (const raw of highlights) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { id?: string; answer?: string }
    const ans = typeof item.answer === 'string' ? item.answer : ''
    if (item.id === 'five_minutes') base.personal_answer_five_minutes = ans
    else if (item.id === 'outside_work') base.personal_answer_outside_work = ans
    else if (item.id === 'cpoint_goals') base.personal_answer_cpoint_goals = ans
  }
  return base
}

function mapWorkHistoryFromApi(items: unknown): WorkExperienceRow[] {
  if (!Array.isArray(items)) return []
  return items.map((raw: Record<string, unknown>) => ({
    title: typeof raw?.title === 'string' ? raw.title : '',
    company: typeof raw?.company === 'string' ? raw.company : '',
    location: typeof raw?.location === 'string' ? raw.location : '',
    start: typeof raw?.start === 'string' ? raw.start : '',
    end: typeof raw?.end === 'string' ? raw.end : '',
    description: typeof raw?.description === 'string' ? raw.description : '',
  }))
}

function mapEducationFromApi(items: unknown): EducationRow[] {
  if (!Array.isArray(items)) return []
  return items.map((raw: Record<string, unknown>) => ({
    school: typeof raw?.school === 'string' ? raw.school : '',
    degree: typeof raw?.degree === 'string' ? raw.degree : '',
    start: typeof raw?.start === 'string' ? raw.start : '',
    end: typeof raw?.end === 'string' ? raw.end : '',
    description: typeof raw?.description === 'string' ? raw.description : '',
  }))
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
  const [detailsModalOpen, setDetailsModalOpen] = useState(false)
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

  /** Warm / refetch public profile API so /profile/:username shows latest data after saves (server cache is busted separately). */
  const prefetchPublicProfileApi = useCallback(async () => {
    const u = summary?.username?.trim()
    if (!u) return
    try {
      await fetch(`/api/profile/${encodeURIComponent(u)}?_warm=${Date.now()}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
    } catch {
      /* non-fatal */
    }
  }, [summary?.username])

  const isPersonalDirty = useCallback(() => {
    const s = serverPersonalRef.current
    return personal.first_name !== s.first_name || personal.last_name !== s.last_name ||
      personal.bio !== s.bio || personal.display_name !== s.display_name ||
      personal.date_of_birth !== s.date_of_birth || personal.gender !== s.gender ||
      personal.country !== s.country || personal.city !== s.city ||
      personal.personal_answer_five_minutes !== s.personal_answer_five_minutes ||
      personal.personal_answer_outside_work !== s.personal_answer_outside_work ||
      personal.personal_answer_cpoint_goals !== s.personal_answer_cpoint_goals
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
      form.append('personal_answer_five_minutes', personal.personal_answer_five_minutes)
      form.append('personal_answer_outside_work', personal.personal_answer_outside_work)
      form.append('personal_answer_cpoint_goals', personal.personal_answer_cpoint_goals)
      const response = await fetch('/update_personal_info', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        serverPersonalRef.current = { ...personal }
        try { sessionStorage.removeItem(PROFILE_DRAFT_KEY) } catch {}
        try {
          await refreshUserProfile()
          await prefetchPublicProfileApi()
        } catch {}
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
  }, [personal, navigate, refreshUserProfile, prefetchPublicProfileApi])

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
    const hlAnswers = personalAnswersFromHighlights(personalInfo.highlights)
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
      ...hlAnswers,
    }
    serverPersonalRef.current = loadedPersonal
    // Restore draft if it exists and differs from server data
    let finalPersonal = loadedPersonal
    try {
      const raw = sessionStorage.getItem(PROFILE_DRAFT_KEY)
      if (raw) {
        const draft = JSON.parse(raw) as Partial<PersonalForm>
        const merged = { ...loadedPersonal, ...draft }
        const differs = (Object.keys(loadedPersonal) as (keyof PersonalForm)[]).some(
          k => merged[k] !== loadedPersonal[k],
        )
        if (differs) {
          finalPersonal = merged
        } else {
          sessionStorage.removeItem(PROFILE_DRAFT_KEY)
        }
      }
    } catch {}
    setPersonal(finalPersonal)
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
      company_intel: coalesceString(
        professionalInfo.company_intel,
        professionalInfo.companyIntel,
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
      current_role_start: coalesceString(
        professionalInfo.current_role_start,
        professionalInfo.currentRoleStart,
      ),
      work_history: mapWorkHistoryFromApi(professionalInfo.work_history),
      education: mapEducationFromApi(professionalInfo.education),
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
      form.append('personal_answer_five_minutes', personal.personal_answer_five_minutes)
      form.append('personal_answer_outside_work', personal.personal_answer_outside_work)
      form.append('personal_answer_cpoint_goals', personal.personal_answer_cpoint_goals)
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
          await prefetchPublicProfileApi()
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
      form.append('company_intel', professional.company_intel)
      form.append('industry', professional.industry)
      form.append('linkedin', professional.linkedin)
      form.append('about', professional.about)
      form.append('interests', JSON.stringify(interestList))
      form.append('current_role_start_ym', professional.current_role_start)
      form.append('work_history_json', JSON.stringify(professional.work_history))
      form.append('education_json', JSON.stringify(professional.education))
      const response = await fetch('/update_professional', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        setFeedback('Professional information saved')
        try {
          await refreshUserProfile()
          await prefetchPublicProfileApi()
        } catch {}
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
      form.append('company_intel', professional.company_intel)
      form.append('industry', professional.industry)
      form.append('linkedin', professional.linkedin)
      form.append('about', professional.about)
      form.append('interests', JSON.stringify(interestList))
      form.append('current_role_start_ym', professional.current_role_start)
      form.append('work_history_json', JSON.stringify(professional.work_history))
      form.append('education_json', JSON.stringify(professional.education))
      const response = await fetch('/update_professional', { method: 'POST', credentials: 'include', body: form })
      const payload = await response.json().catch(() => null)
      if (payload?.success) {
        setFeedback('Personal interests saved')
        try {
          await refreshUserProfile()
          await prefetchPublicProfileApi()
        } catch {}
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
        void prefetchPublicProfileApi()
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
          {showOnboardingReturn ? (
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
          ) : (
            <button
              type="button"
              className="w-full rounded-xl border border-dashed border-[#4db6ac]/40 bg-[#4db6ac]/5 hover:bg-[#4db6ac]/10 px-4 py-3 flex items-center gap-3 transition-colors"
              onClick={handleReturnToOnboarding}
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#4db6ac]/20 text-[#4db6ac] text-sm">
                <i className="fa-solid fa-robot" />
              </span>
              <div className="text-left">
                <div className="text-sm font-medium text-white">Let Steve build your profile</div>
                <div className="text-[11px] text-white/50">Answer a few quick questions instead of filling in fields manually</div>
              </div>
              <i className="fa-solid fa-chevron-right text-white/30 ml-auto text-xs" />
            </button>
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">Profile details</div>
              <p className="text-xs text-[#9fb0b5]">
                Personal story, location, professional background, and history. Opens in a two-step editor with tips from Steve.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-[#4db6ac]/50 bg-[#4db6ac]/10 px-4 py-2 text-sm font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20"
              onClick={() => setDetailsModalOpen(true)}
            >
              Edit details
            </button>
          </div>
          {personal.bio.trim() ? (
            <p className="text-sm text-[#cfd8dc] line-clamp-4 whitespace-pre-wrap">{personal.bio}</p>
          ) : (
            <p className="text-xs text-[#9fb0b5]">No bio yet — use Edit details to add your story and highlights.</p>
          )}
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
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingInterests}
            >
              {savingInterests ? 'Saving…' : 'Save personal interests'}
            </button>
          </form>
        </section>

        <ProfileDetailsModal
          open={detailsModalOpen}
          onClose={() => setDetailsModalOpen(false)}
          personal={personal}
          setPersonal={setPersonal}
          professional={professional}
          setProfessional={setProfessional}
          genderOptions={genderOptions}
          countryOptions={countryOptions}
          cityOptions={cityOptions}
          industryOptions={industryOptions}
          citySelectDisabled={citySelectDisabled}
          cityPlaceholder={cityPlaceholder}
          citiesLoading={citiesLoading}
          onSavePersonal={handlePersonalSubmit}
          onSaveProfessional={handleProfessionalSubmit}
          savingPersonal={savingPersonal}
          savingProfessional={savingProfessional}
        />

        {feedback ? (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full border border-white/10 bg-white/10 text-sm text-white">
            {feedback}
          </div>
        ) : null}

        {showLeaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111] p-5 space-y-4">
              <h3 className="text-base font-semibold text-white">Unsaved changes</h3>
              <p className="text-sm text-[#a7b8be]">
                You have unsaved profile changes. Would you like to save before leaving?
              </p>
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
