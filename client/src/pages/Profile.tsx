import { useEffect, useRef, useState, useCallback } from 'react'
import type { ChangeEvent, CSSProperties, FormEvent, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar, { clearImageCache } from '../components/Avatar'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import { clearAvatarCache } from '../utils/avatarCache'
import { profileGenderLabel, profileIndustryLabel, profileInterestLabel } from '../utils/profileOptionLabel'
import { ProfileSelectField, type SelectOption } from '../components/profile/ProfileSelectField'
import { ProfileDetailsModal, type WorkExperienceRow, type EducationRow } from '../components/profile/ProfileDetailsModal'
import { SkeletonProfileShell } from '../components/SkeletonRow'

const PROFILE_DRAFT_KEY = 'cpoint_profile_personal_draft'

const ONBOARDING_PROFILE_HINT_KEY = 'cpoint_onboarding_profile_hint'
const ONBOARDING_RESUME_KEY = 'cpoint_onboarding_resume_step'

export type PersonalForm = {
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

export type ProfessionalForm = {
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
  cv_uploaded_at?: string
  cv_original_filename?: string
  has_stored_cv?: boolean
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
  cv_uploaded_at: '',
  cv_original_filename: '',
  has_stored_cv: false,
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
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [showOnboardingReturn, setShowOnboardingReturn] = useState(false)

  useEffect(() => {
    setTitle(t('profile.page_title'))
  }, [setTitle, t])
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
  const [cvModalOpen, setCvModalOpen] = useState(false)
  const [cvParsing, setCvParsing] = useState(false)
  const [cvApplying, setCvApplying] = useState(false)
  const [cvPending, setCvPending] = useState<{
    role: string
    company: string
    current_role_start_ym: string
    professional_about: string
    work_history: WorkExperienceRow[]
    cv_stored?: boolean
  } | null>(null)
  const cvFileInputRef = useRef<HTMLInputElement | null>(null)
  const [interestInput, setInterestInput] = useState('')
  const serverPersonalRef = useRef<PersonalForm>(PERSONAL_DEFAULT)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const {
    profile: cachedProfile,
    setProfile: setContextProfile,
    loading: cachedProfileLoading,
    error: cachedProfileError,
    refresh: refreshUserProfile,
    applyProfileFromServer,
  } = useUserProfile()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/profile_me?_nocache=${Date.now()}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        const j = await r.json().catch(() => null)
        if (cancelled || !j?.success || !j.profile) return
        applyProfileFromServer(j.profile as Record<string, unknown>)
      } catch {
        /* non-fatal — keep context profile */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyProfileFromServer])

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
    if (!navigator.onLine) { alert(t('profile.alert.offline_save')); setShowLeaveModal(false); return }
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
      setFeedback(t('profile.feedback.interests_max', { max: MAX_INTERESTS }))
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
        setError(t('profile.error.load_failed'))
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
        profile.professional_about,
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
      cv_uploaded_at: coalesceString(professionalInfo.cv_uploaded_at),
      cv_original_filename: coalesceString(professionalInfo.cv_original_filename),
      has_stored_cv: Boolean(professionalInfo.has_stored_cv),
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

  const genderOptions: SelectOption[] = GENDERS.map(option => ({ value: option, label: profileGenderLabel(option, t) }))
  const countryOptions: SelectOption[] = normalizedCountries.map(country => ({ value: country, label: country }))
  const cityOptions: SelectOption[] = normalizedCities.map(city => ({ value: city, label: city }))
  const industryOptions: SelectOption[] = INDUSTRIES.map(industry => ({ value: industry, label: profileIndustryLabel(industry, t) }))

  const citySelectDisabled = !personal.country
  const cityPlaceholder = personal.country
    ? citiesLoading
      ? t('profile.personal.city_loading')
      : normalizedCities.length
        ? t('profile.personal.city_select')
        : t('profile.personal.city_type_custom')
    : t('profile.personal.city_select_country_first')

  async function handlePersonalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!navigator.onLine) { alert(t('profile.alert.offline_save')); return }
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
        setFeedback(t('profile.feedback.personal_saved'))
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
        setFeedback(payload?.error || t('profile.feedback.personal_save_failed'))
      }
    } catch {
      setFeedback(t('profile.feedback.personal_save_failed'))
    } finally {
      setSavingPersonal(false)
    }
  }

  async function handleProfessionalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!navigator.onLine) { alert(t('profile.alert.offline_save')); return }
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
        setFeedback(t('profile.feedback.professional_saved'))
        try {
          await refreshUserProfile()
          await prefetchPublicProfileApi()
        } catch {}
      } else {
        setFeedback(payload?.error || t('profile.feedback.professional_save_failed'))
      }
    } catch {
      setFeedback(t('profile.feedback.professional_save_failed'))
    } finally {
      setSavingProfessional(false)
    }
  }

  async function parseCvUpload(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setFeedback(t('profile.feedback.cv_pdf_only'))
      return
    }
    setCvParsing(true)
    setFeedback(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/onboarding/parse_cv?persist=1', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        setFeedback((j?.error as string) || t('profile.feedback.cv_read_failed'))
        return
      }
      const wh: WorkExperienceRow[] = Array.isArray(j.work_history)
        ? j.work_history.map((row: Record<string, unknown>) => ({
            title: String(row.title ?? ''),
            company: String(row.company ?? ''),
            location: String(row.location ?? ''),
            start: String(row.start ?? ''),
            end: String(row.end ?? ''),
            description: String(row.description ?? ''),
          }))
        : []
      const roleDesc = String(j.current_role_description || '').trim()
      setCvPending({
        role: String(j.role || ''),
        company: String(j.company || ''),
        current_role_start_ym: String(j.current_role_start_ym || ''),
        professional_about: roleDesc,
        work_history: wh,
        cv_stored: Boolean(j.cv_stored),
      })
      setCvModalOpen(true)
    } catch {
      setFeedback(t('profile.feedback.cv_upload_network_error'))
    } finally {
      setCvParsing(false)
      try {
        if (cvFileInputRef.current) cvFileInputRef.current.value = ''
      } catch { /* ignore */ }
    }
  }

  async function applyCvStructured(mode: 'replace' | 'merge') {
    if (!cvPending || cvApplying) return
    setCvApplying(true)
    setFeedback(null)
    try {
      const r = await fetch('/api/onboarding/apply_professional_structured', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          role: cvPending.role,
          company: cvPending.company,
          current_role_start_ym: cvPending.current_role_start_ym,
          work_history: cvPending.work_history,
          professional_about: cvPending.professional_about,
        }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        setFeedback((j?.error as string) || t('profile.feedback.cv_update_failed'))
        return
      }
      setFeedback(mode === 'merge' ? t('profile.feedback.cv_merged') : t('profile.feedback.cv_replaced'))
      setCvModalOpen(false)
      setCvPending(null)
      try {
        const pr = await fetch(`/api/profile_me?_nocache=${Date.now()}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        const pj = await pr.json().catch(() => null)
        if (pj?.success && pj.profile) {
          applyProfileFromServer(pj.profile as Record<string, unknown>)
        } else {
          await refreshUserProfile()
        }
        await prefetchPublicProfileApi()
      } catch {}
    } catch {
      setFeedback(t('profile.feedback.cv_apply_failed'))
    } finally {
      setCvApplying(false)
    }
  }

  async function downloadStoredCv() {
    setFeedback(null)
    try {
      const r = await fetch('/api/profile/cv', { credentials: 'include' })
      if (!r.ok) {
        setFeedback(t('profile.feedback.cv_download_unavailable'))
        return
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = professional.cv_original_filename?.trim() || 'cv.pdf'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setFeedback(t('profile.feedback.cv_download_failed'))
    }
  }

  async function handleInterestsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!navigator.onLine) { alert(t('profile.alert.offline_save')); return }
    if (savingInterests) return
    setSavingInterests(true)
    try {
      const pendingInterest = interestInput.trim()
      if (
        pendingInterest &&
        professional.interests.length >= MAX_INTERESTS &&
        !professional.interests.some(item => item.toLowerCase() === pendingInterest.toLowerCase())
      ) {
        setFeedback(t('profile.feedback.interests_max', { max: MAX_INTERESTS }))
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
        setFeedback(t('profile.feedback.interests_saved'))
        try {
          await refreshUserProfile()
          await prefetchPublicProfileApi()
        } catch {}
      } else {
        setFeedback(payload?.error || t('profile.feedback.interests_save_failed'))
      }
    } catch {
      setFeedback(t('profile.feedback.interests_save_failed'))
    } finally {
      setSavingInterests(false)
    }
  }

  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [localPhotoPreview, setLocalPhotoPreview] = useState<string | null>(null)
  // Track when we've just uploaded to prevent useEffect from overwriting our new picture
  const justUploadedPicRef = useRef<string | null>(null)

  async function handlePhotoUpload(file: File) {
    if (!navigator.onLine) { alert(t('profile.alert.offline_upload')); return }
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
        setFeedback(t('profile.feedback.photo_updated'))
        
        // Directly update the context profile with new picture URL
        // This avoids refetching from potentially stale server cache
        setContextProfile(prev => {
          if (!prev) return prev
          return { ...prev, profile_picture: cacheBustedUrl }
        })
        void prefetchPublicProfileApi()
      } else {
        setLocalPhotoPreview(null) // Revert to old image on error
        setFeedback(payload?.error || t('profile.feedback.photo_upload_failed'))
      }
    } catch {
      setLocalPhotoPreview(null) // Revert to old image on error
      setFeedback(t('profile.feedback.photo_upload_failed'))
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

  if (loading) return (
    <div className="glass-page min-h-screen text-white">
      <div className="glass-card glass-card--plain max-w-3xl mx-auto px-4 py-4">
        <SkeletonProfileShell />
      </div>
    </div>
  )
  if (error || !summary) return <div className="p-4 text-red-400">{error || t('profile.error.generic')}</div>

  return (
    <div className="glass-page min-h-screen text-white">
      <div className="glass-card glass-card--plain max-w-3xl mx-auto px-4 py-4 space-y-4">
        {summary.cover_photo ? (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <img
              src={summary.cover_photo.startsWith('http') ? summary.cover_photo : `/static/${summary.cover_photo}`}
              alt={t('profile.alt.cover')}
              className="w-full h-40 object-cover"
            />
          </div>
        ) : null}
        {showOnboardingReturn ? (
            <div className="rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-white">
                {t('profile.onboarding_return.message')}
              </div>
              <button
                type="button"
                className="rounded-full border border-[#4db6ac]/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white hover:bg-[#4db6ac]/20"
                onClick={handleReturnToOnboarding}
              >
                {t('profile.onboarding_return.button')}
              </button>
            </div>
          ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            {/* Show local preview immediately, then server URL after upload */}
            {localPhotoPreview ? (
              <div 
                className="rounded-full overflow-hidden bg-white/10 border border-white/10 flex items-center justify-center"
                style={{ width: 64, height: 64 }}
              >
                <img src={localPhotoPreview} alt={t('profile.alt.preview')} className="w-full h-full object-cover" />
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
              aria-label={t('profile.aria.change_profile_picture')}
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
            {t('profile.preview_profile')}
          </a>
        </div>

        <section className="rounded-xl border border-white/10 p-4 space-y-3">
          <form className="space-y-3" onSubmit={handlePersonalSubmit}>
            <header>
              <div className="font-semibold">{t('profile.personal.title')}</div>
              <p className="text-xs text-[#9fb0b5]">{t('profile.personal.subtitle')}</p>
            </header>
            <label className="text-sm block">
              {t('profile.personal.bio_label')}
              <textarea
                className="mt-1 w-full min-h-[100px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                style={{ userSelect: 'text', WebkitUserSelect: 'text' } as CSSProperties}
                value={personal.bio}
                onChange={event => setPersonal(prev => ({ ...prev, bio: event.target.value }))}
                placeholder={t('profile.personal.bio_placeholder')}
              />
            </label>
            {personal.bio.trim() ? null : (
              <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-[#9fb0b5]">
                <p className="text-white/80 font-medium">
                  {t('profile.personal.bio_empty_title')}
                </p>
                <p>{t('profile.personal.bio_empty_subtitle')}</p>
                <p className="mt-2 whitespace-pre-line">
                  {t('profile.personal.bio_empty_example_label')}
                  {"\n"}{t('profile.personal.bio_empty_example_text')}
                </p>
                <p className="mt-2 text-white/70">{t('profile.personal.bio_empty_cta')}</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm min-w-0">
                {t('profile.personal.first_name')}
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.first_name}
                  onChange={event => setPersonal(prev => ({ ...prev, first_name: event.target.value }))}
                />
              </label>
              <label className="text-sm min-w-0">
                {t('profile.personal.last_name')}
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.last_name}
                  onChange={event => setPersonal(prev => ({ ...prev, last_name: event.target.value }))}
                />
              </label>
              <label className="text-sm min-w-0">
                {t('profile.personal.display_name')}
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.display_name}
                  onChange={event => setPersonal(prev => ({ ...prev, display_name: event.target.value }))}
                />
              </label>
              <label className="text-sm min-w-0">
                {t('profile.personal.date_of_birth')}
                <input
                  type="date"
                  className="mt-1 w-full min-w-0 rounded-md bg-black border border-white/10 px-3 py-2 text-sm leading-tight outline-none focus:border-[#4db6ac]"
                  value={personal.date_of_birth}
                  onChange={event => setPersonal(prev => ({ ...prev, date_of_birth: event.target.value }))}
                />
              </label>
              <label className="text-sm min-w-0">
                {t('profile.personal.gender')}
                <div className="mt-1">
                  <ProfileSelectField
                    value={personal.gender}
                    onChange={nextValue => setPersonal(prev => ({ ...prev, gender: nextValue }))}
                    options={genderOptions}
                    placeholder={t('profile.personal.gender_placeholder')}
                  />
                </div>
              </label>
              <label className="text-sm min-w-0">
                {t('profile.personal.country')}
                <div className="mt-1">
                  <ProfileSelectField
                    value={personal.country}
                    onChange={nextValue => setPersonal(prev => ({ ...prev, country: nextValue, city: '' }))}
                    options={countryOptions}
                    placeholder={t('profile.personal.country_placeholder')}
                    searchable
                    allowCustomOption
                    emptyMessage={t('profile.personal.country_empty')}
                  />
                </div>
              </label>
              <label className="text-sm min-w-0 sm:col-span-2">
                {t('profile.personal.city')}
                <div className="mt-1">
                  <ProfileSelectField
                    value={personal.city}
                    onChange={nextValue => setPersonal(prev => ({ ...prev, city: nextValue }))}
                    options={cityOptions}
                    placeholder={cityPlaceholder}
                    disabled={citySelectDisabled}
                    loading={citiesLoading}
                    searchable
                    allowCustomOption
                    emptyMessage={personal.country ? t('profile.personal.city_empty') : t('profile.personal.city_select_country_first')}
                  />
                </div>
              </label>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingPersonal}
            >
              {savingPersonal ? t('profile.saving') : t('profile.personal.save')}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-white/10 p-4">
          <form className="space-y-4" onSubmit={handleProfessionalSubmit}>
            <header>
              <div className="font-semibold">{t('profile.professional.title')}</div>
              <p className="text-xs text-[#9fb0b5]">{t('profile.professional.subtitle')}</p>
            </header>
            <input
              ref={cvFileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void parseCvUpload(f)
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
                disabled={cvParsing}
                onClick={() => cvFileInputRef.current?.click()}
              >
                {cvParsing ? t('profile.professional.reading_cv') : t('profile.professional.upload_cv')}
              </button>
              {professional.has_stored_cv ? (
                <button
                  type="button"
                  className="rounded-md border border-[#4db6ac]/50 bg-[#4db6ac]/10 px-3 py-1.5 text-xs font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20"
                  onClick={() => void downloadStoredCv()}
                >
                  {t('profile.professional.download_last_cv')}
                </button>
              ) : null}
            </div>
            {professional.cv_uploaded_at ? (
              <p className="text-[11px] text-[#9fb0b5]">
                {t('profile.professional.last_cv_on_file')}{' '}
                {(() => {
                  try {
                    const d = new Date(professional.cv_uploaded_at)
                    return Number.isNaN(d.getTime()) ? professional.cv_uploaded_at : d.toLocaleString()
                  } catch {
                    return professional.cv_uploaded_at
                  }
                })()}
                {professional.cv_original_filename ? ` · ${professional.cv_original_filename}` : ''}
              </p>
            ) : null}
            <p className="text-[11px] text-[#9fb0b5]">
              {t('profile.professional.cv_storage_hint')}
            </p>
            <label className="text-sm block">
              {t('profile.professional.about_label')}
              <textarea
                className="mt-1 w-full min-h-[96px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                value={professional.about}
                onChange={event => setProfessional(prev => ({ ...prev, about: event.target.value }))}
                placeholder={t('profile.professional.about_placeholder')}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                {t('profile.professional.current_position')}
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.role}
                  onChange={event => setProfessional(prev => ({ ...prev, role: event.target.value }))}
                  placeholder={t('profile.professional.current_position_placeholder')}
                />
              </label>
              <label className="text-sm">
                {t('profile.professional.company')}
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.company}
                  onChange={event => setProfessional(prev => ({ ...prev, company: event.target.value }))}
                  placeholder={t('profile.professional.company_placeholder')}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                {t('profile.professional.company_description')}
                <span className="block text-[11px] text-[#9fb0b5] font-normal mt-0.5 mb-1">
                  {t('profile.professional.company_description_hint')}
                </span>
                <textarea
                  className="mt-1 w-full min-h-[72px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.company_intel}
                  onChange={event => setProfessional(prev => ({ ...prev, company_intel: event.target.value }))}
                  placeholder={t('profile.professional.company_description_placeholder')}
                />
              </label>
              <label className="text-sm">
                {t('profile.professional.industry')}
                <div className="mt-1">
                  <ProfileSelectField
                    value={professional.industry}
                    onChange={nextValue => setProfessional(prev => ({ ...prev, industry: nextValue }))}
                    options={industryOptions}
                    placeholder={t('profile.professional.industry_placeholder')}
                    searchable
                    allowCustomOption
                    emptyMessage={t('profile.professional.industry_empty')}
                  />
                </div>
              </label>
              <label className="text-sm">
                {t('profile.professional.linkedin')}
                <input
                  className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.linkedin}
                  onChange={event => setProfessional(prev => ({ ...prev, linkedin: event.target.value }))}
                  placeholder={t('profile.professional.linkedin_placeholder')}
                />
              </label>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingProfessional}
            >
              {savingProfessional ? t('profile.saving') : t('profile.professional.save')}
            </button>
          </form>

          {cvModalOpen && cvPending ? (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cv-modal-title"
            >
              <div className="max-w-lg w-full rounded-xl border border-white/15 bg-[#0d1619] p-4 shadow-xl space-y-3">
                <div id="cv-modal-title" className="font-semibold text-white">
                  {t('profile.cv_modal.title')}
                </div>
                <p className="text-xs text-[#9fb0b5]">
                  {t('profile.cv_modal.description')}
                </p>
                {cvPending.cv_stored === false ? (
                  <p className="text-xs text-amber-200/90">
                    {t('profile.cv_modal.not_stored_warning')}
                  </p>
                ) : null}
                <ul className="text-xs text-[#c8d8dc] list-disc pl-4 space-y-1 max-h-40 overflow-y-auto">
                  <li>{t('profile.cv_modal.current_role')} {cvPending.role.trim() || t('profile.cv_modal.empty_value')}</li>
                  <li>{t('profile.cv_modal.company')} {cvPending.company.trim() || t('profile.cv_modal.empty_value')}</li>
                  <li>{t('profile.cv_modal.start_ym')} {cvPending.current_role_start_ym.trim() || t('profile.cv_modal.empty_value')}</li>
                  <li>{t('profile.cv_modal.past_roles_count')} {cvPending.work_history.length}</li>
                  {cvPending.professional_about ? (
                    <li className="list-none -ml-4 mt-2 text-[#9fb0b5]">
                      {t('profile.cv_modal.bio')} {cvPending.professional_about.length > 220 ? `${cvPending.professional_about.slice(0, 220)}…` : cvPending.professional_about}
                    </li>
                  ) : null}
                </ul>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    className="rounded-md bg-[#4db6ac] text-black text-sm font-medium py-2.5 hover:brightness-110 disabled:opacity-50"
                    disabled={cvApplying}
                    onClick={() => void applyCvStructured('replace')}
                  >
                    {cvApplying ? t('profile.cv_modal.applying') : t('profile.cv_modal.replace_all')}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-white/20 bg-white/5 text-white text-sm font-medium py-2.5 hover:bg-white/10 disabled:opacity-50"
                    disabled={cvApplying}
                    onClick={() => void applyCvStructured('merge')}
                  >
                    {cvApplying ? t('profile.cv_modal.applying') : t('profile.cv_modal.merge')}
                  </button>
                </div>
                <p className="text-[11px] text-[#7a8f94]">
                  {t('profile.cv_modal.merge_hint')}
                </p>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    className="rounded-md border border-white/15 px-3 py-2 text-sm text-[#9fb0b5] hover:bg-white/5 disabled:opacity-50"
                    disabled={cvApplying}
                    onClick={() => {
                      setCvModalOpen(false)
                      setCvPending(null)
                    }}
                  >
                    {t('profile.cancel')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-white/10 p-4 space-y-3">
          <div className="font-semibold">{t('profile.spotlight.title')}</div>
          <p className="text-xs text-[#9fb0b5]">
            {t('profile.spotlight.subtitle')}
          </p>
          <button
            type="button"
            className="rounded-md border border-[#4db6ac]/50 bg-[#4db6ac]/10 px-4 py-2 text-sm font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20"
            onClick={() => setDetailsModalOpen(true)}
          >
            {t('profile.spotlight.open')}
          </button>
        </section>

        <section className="rounded-xl border border-white/10 p-4">
          <form className="space-y-3" onSubmit={handleInterestsSubmit}>
            <div>
              <div className="text-sm font-semibold text-white">{t('profile.interests.title')}</div>
              <p className="text-xs text-[#9fb0b5]">{t('profile.interests.subtitle')}</p>
              <div className="mt-2 space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-white/40">{t('profile.interests.popular_suggestions')}</div>
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
                        {profileInterestLabel(suggestion, t)}
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
                  aria-label={t('profile.interests.remove_aria', { interest })}
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
                  placeholder={professional.interests.length ? t('profile.interests.add_another') : t('profile.interests.add_first')}
                  className="flex-1 min-w-[140px] bg-transparent text-xs text-white placeholder:text-[#9fb0b5] outline-none"
                />
              ) : null}
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              disabled={savingInterests}
            >
              {savingInterests ? t('profile.saving') : t('profile.interests.save')}
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
              <h3 className="text-base font-semibold text-white">{t('profile.leave_modal.title')}</h3>
              <p className="text-sm text-[#a7b8be]">
                {t('profile.leave_modal.message')}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleSaveAndLeave}
                  disabled={savingPersonal}
                  className="w-full py-2.5 rounded-lg bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
                >
                  {savingPersonal ? t('profile.saving') : t('profile.leave_modal.save_and_leave')}
                </button>
                <button
                  onClick={handleDiscardAndLeave}
                  className="w-full py-2.5 rounded-lg border border-white/15 text-sm text-white hover:bg-white/5"
                >
                  {t('profile.leave_modal.discard')}
                </button>
                <button
                  onClick={handleCancelLeave}
                  className="w-full py-2 text-sm text-[#9fb0b5] hover:text-white"
                >
                  {t('profile.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
