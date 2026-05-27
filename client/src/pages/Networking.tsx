import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useComposerKeyboardLift } from '../hooks/useComposerKeyboardLift'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import { useNavigate } from 'react-router-dom'
import { renderTextWithSourceLinks } from '../utils/linkUtils'
import { useNetwork } from '../contexts/NetworkContext'

type Community = { id: number; name: string }
type MemberProfile = {
  username: string
  display_name?: string | null
  profile_picture?: string | null
  city?: string | null
  country?: string | null
  industry?: string | null
  role?: string | null
  company?: string | null
  professional_interests?: string | null
  bio?: string | null
}
type FilterOptions = { locations: string[]; industries: string[]; interests: string[] }
type SteveDebugTrace = {
  planner?: Record<string, unknown>
  retrieval?: Record<string, unknown>
  fusion?: Record<string, unknown>
  context?: Record<string, unknown>
  final_answer?: Record<string, unknown>
}

const DEBUG_TABS = [
  { key: 'planner', labelKey: 'networking.debug.tab_planner' },
  { key: 'retrieval', labelKey: 'networking.debug.tab_retrieval' },
  { key: 'fusion', labelKey: 'networking.debug.tab_fusion' },
  { key: 'context', labelKey: 'networking.debug.tab_context' },
  { key: 'final_answer', labelKey: 'networking.debug.tab_final' },
] as const
type DebugTabKey = (typeof DEBUG_TABS)[number]['key']

const SECTION_DEFINITIONS = [
  { key: 'steve' },
  { key: 'personal' },
] as const
type SectionKey = (typeof SECTION_DEFINITIONS)[number]['key']

type ProfileFieldId = 'first_name' | 'last_name' | 'current_position' | 'company' | 'identity'

function profileFieldLabel(id: ProfileFieldId, t: (key: string) => string): string {
  switch (id) {
    case 'first_name':
      return t('profile.personal.first_name')
    case 'last_name':
      return t('profile.personal.last_name')
    case 'current_position':
      return t('profile.professional.current_position')
    case 'company':
      return t('profile.professional.company')
    case 'identity':
      return t('networking.field_identity')
    default:
      return id
  }
}

/** Sends enough turns for backend NETWORKING_GROK_PRIOR_MESSAGES_CAP (30). */
const NETWORKING_CHAT_HISTORY_SEND_CAP = 50

function DebugJsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="max-h-[58vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/70 p-3 text-[11px] leading-relaxed text-[#c8d6db]">
      {JSON.stringify(data ?? {}, null, 2)}
    </pre>
  )
}

function SteveDebugModal({
  trace,
  activeTab,
  onTabChange,
  onClose,
}: {
  trace: SteveDebugTrace
  activeTab: DebugTabKey
  onTabChange: (tab: DebugTabKey) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm px-3 py-6" role="dialog" aria-modal="true" aria-label={t('networking.debug.modal_aria')}>
      <div className="mx-auto flex max-h-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#4db6ac]/25 bg-[#050707] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#4db6ac]">{t('networking.debug.staging_label')}</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{t('networking.debug.title')}</h2>
            <p className="mt-1 text-xs text-[#8ca0a8]">{t('networking.debug.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:border-white/35"
          >
            {t('networking.debug.close')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-white/10 p-3">
          {DEBUG_TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${activeTab === tab.key ? 'border-[#4db6ac]/60 bg-[#4db6ac]/10 text-[#4db6ac]' : 'border-white/15 text-[#a7b8be] hover:border-white/35'}`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <div className="overflow-auto p-4">
          <DebugJsonBlock data={trace[activeTab]} />
        </div>
      </div>
    </div>
  )
}

/** Steve empty-thread welcome (variant A) — community name + active member count from networking API */
function SteveWelcomeCopy({ communityName, activeMemberCount }: { communityName: string; activeMemberCount: number }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-[#c8d6db]">
      <p>
        {t(activeMemberCount === 1 ? 'networking.welcome_members_one' : 'networking.welcome_members_other', {
          community: communityName,
          count: activeMemberCount,
        })}
      </p>
      <p>
        <span className="font-semibold text-white/95">{t('networking.welcome_prompt_bold')}</span>
        {' '}
        {t('networking.welcome_prompt_rest')}
      </p>
    </div>
  )
}

export default function Networking() {
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const { isOnline } = useNetwork()
  useEffect(() => { setTitle(t('networking.page_title')) }, [setTitle, t])

  const [activeSection, setActiveSection] = useState<SectionKey>('steve')
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [profileGateLoading, setProfileGateLoading] = useState(true)
  const [profileReadyForNetworking, setProfileReadyForNetworking] = useState(false)
  const [missingProfileFields, setMissingProfileFields] = useState<ProfileFieldId[]>([])

  // Steve state
  const [steveCommunity, setSteveCommunity] = useState<number | null>(null)
  const [steveMessages, setSteveMessages] = useState<Array<{ role: 'user' | 'steve'; text: string }>>([])
  const [steveInput, setSteveInput] = useState('')
  const [steveSending, setSteveSending] = useState(false)
  const [autoMatching, setAutoMatching] = useState(false)
  const steveEndRef = useRef<HTMLDivElement>(null)
  const [steveSessionId, setSteveSessionId] = useState<number | null>(null)
  const [steveSessions, setSteveSessions] = useState<Array<{ id: number; created_at: string; first_message: string }>>([])
  const [showSessionList, setShowSessionList] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null)
  const [steveFeedback, setSteveFeedback] = useState<Record<string, { feedback: 'up' | 'down'; reasoning?: string }>>({})
  const [steveMemberCount, setSteveMemberCount] = useState<number | null>(null)
  const [steveMembersLoading, setSteveMembersLoading] = useState(false)
  const [isAppAdmin, setIsAppAdmin] = useState(false)
  const [steveDebugEnabled, setSteveDebugEnabled] = useState(false)
  const [lastSteveDebugTrace, setLastSteveDebugTrace] = useState<SteveDebugTrace | null>(null)
  const [showDebugModal, setShowDebugModal] = useState(false)
  const [debugTab, setDebugTab] = useState<DebugTabKey>('planner')
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressActiveRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    steveEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const { keyboardLift, showKeyboard, safeBottomPx } = useComposerKeyboardLift({
    onKeyboardOpen: scrollToBottom,
  })

  // Personal state
  const [personalCommunity, setPersonalCommunity] = useState<number | null>(null)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ locations: [], industries: [], interests: [] })
  const [selectedLocation, setSelectedLocation] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState('')
  const [selectedInterest, setSelectedInterest] = useState('')
  const [personalMembers, setPersonalMembers] = useState<MemberProfile[]>([])
  const [personalLoading, setPersonalLoading] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')

  useEffect(() => {
    let mounted = true
    const hasValue = (value?: string | null) => typeof value === 'string' && value.trim().length > 0
    fetch('/api/profile_me', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (!mounted) return
        const profile = data?.success ? data.profile : null
        const currentPosition = profile?.professional?.role ?? profile?.role
        const company = profile?.professional?.company ?? profile?.company
        const missing = [
          !hasValue(profile?.first_name) ? 'first_name' : null,
          !hasValue(profile?.last_name) ? 'last_name' : null,
          !hasValue(currentPosition) ? 'current_position' : null,
          !hasValue(company) ? 'company' : null,
          !hasValue(profile?.bio) ? 'identity' : null,
        ].filter(Boolean) as ProfileFieldId[]
        setMissingProfileFields(missing)
        setProfileReadyForNetworking(missing.length === 0)
      })
      .catch(() => {
        if (!mounted) return
        setMissingProfileFields(['first_name', 'last_name', 'current_position', 'company', 'identity'])
        setProfileReadyForNetworking(false)
      })
      .finally(() => {
        if (mounted) setProfileGateLoading(false)
      })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (profileGateLoading) return
    if (!profileReadyForNetworking) {
      setLoading(false)
      return
    }
    fetch('/api/networking/communities', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.communities?.length) {
          setCommunities(data.communities)
          setSteveCommunity(data.communities[0].id)
          setPersonalCommunity(data.communities[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [profileGateLoading, profileReadyForNetworking])

  useEffect(() => {
    let cancelled = false
    fetch('/api/check_admin', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setIsAppAdmin(Boolean(data?.is_admin))
      })
      .catch(() => {
        if (!cancelled) setIsAppAdmin(false)
      })
    return () => { cancelled = true }
  }, [])

  const loadSessions = useCallback((communityId: number, options: { openLatest?: boolean } = {}) => {
    const { openLatest = true } = options
    setSessionsLoading(true)
    fetch(`/api/networking/steve_sessions?community_id=${communityId}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setSteveSessions(data.sessions || [])
          if (openLatest && data.sessions?.length > 0) {
            const latest = data.sessions[0]
            setSteveSessionId(latest.id)
            setLastSteveDebugTrace(null)
            setShowDebugModal(false)
            fetch(`/api/networking/steve_session/${latest.id}/messages`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
              .then(r => r.json())
              .then(d => { if (d.success) setSteveMessages(d.messages || []) })
              .catch(() => {})
          } else {
            setSteveSessionId(null)
            setSteveMessages([])
            setLastSteveDebugTrace(null)
            setShowDebugModal(false)
          }
        }
      })
      .catch(() => {})
      .finally(() => setSessionsLoading(false))
  }, [])

  useEffect(() => {
    if (steveCommunity) loadSessions(steveCommunity)
  }, [steveCommunity, loadSessions])

  useEffect(() => {
    if (!steveCommunity) return
    let cancelled = false
    setSteveMembersLoading(true)
    setSteveMemberCount(null)
    fetch(`/api/networking/community_members/${steveCommunity}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.success) setSteveMemberCount((data.members || []).length)
        else setSteveMemberCount(0)
      })
      .catch(() => { if (!cancelled) setSteveMemberCount(0) })
      .finally(() => { if (!cancelled) setSteveMembersLoading(false) })
    return () => { cancelled = true }
  }, [steveCommunity])

  const startNewChat = useCallback(() => {
    if (!steveCommunity) return
    fetch('/api/networking/steve_session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ community_id: steveCommunity })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setSteveSessionId(data.session_id)
          setSteveMessages([])
          setSteveFeedback({})
          setLastSteveDebugTrace(null)
          setShowDebugModal(false)
          setShowSessionList(false)
          loadSessions(steveCommunity)
        }
      })
      .catch(() => {})
  }, [steveCommunity, loadSessions])

  const loadSession = useCallback((sessionId: number) => {
    setSteveSessionId(sessionId)
    setShowSessionList(false)
    setLastSteveDebugTrace(null)
    setShowDebugModal(false)
    fetch(`/api/networking/steve_session/${sessionId}/messages`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setSteveMessages(d.messages || [])
          // Support both old string format and new object format with reasoning
          const normalizedFeedback: Record<string, { feedback: 'up' | 'down'; reasoning?: string }> = {}
          Object.entries(d.feedback || {}).forEach(([key, value]) => {
            if (typeof value === 'string') {
              normalizedFeedback[key] = { feedback: value as 'up' | 'down' }
            } else if (value && typeof value === 'object') {
              normalizedFeedback[key] = value as { feedback: 'up' | 'down'; reasoning?: string }
            }
          })
          setSteveFeedback(normalizedFeedback)
        }
      })
      .catch(() => {})
  }, [])

  const saveMessage = useCallback((sessionId: number, role: 'user' | 'steve', text: string) => {
    fetch(`/api/networking/steve_session/${sessionId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ role, text })
    }).catch(() => {})
  }, [])

  useEffect(() => { steveEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [steveMessages, steveMemberCount, steveMembersLoading])

  // Personal: load filters + members
  useEffect(() => {
    if (!personalCommunity) return
    setPersonalLoading(true)
    fetch(`/api/networking/community_members/${personalCommunity}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setFilterOptions({ locations: data.filters?.locations || [], industries: data.filters?.industries || [], interests: data.filters?.interests || [] })
          setPersonalMembers(data.members || [])
        }
      })
      .catch(() => {})
      .finally(() => setPersonalLoading(false))
    setSelectedLocation(''); setSelectedIndustry(''); setSelectedInterest('')
  }, [personalCommunity])

  // Personal: filter
  useEffect(() => {
    if (!personalCommunity) return
    const params = new URLSearchParams()
    if (selectedLocation) params.set('location', selectedLocation)
    if (selectedIndustry) params.set('industry', selectedIndustry)
    if (selectedInterest) params.set('interests', selectedInterest)
    fetch(`/api/networking/community_members/${personalCommunity}?${params}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => { if (data.success) setPersonalMembers(data.members || []) })
      .catch(() => {})
  }, [selectedLocation, selectedIndustry, selectedInterest, personalCommunity])

  const ensureSession = useCallback(async (): Promise<number | null> => {
    if (steveSessionId) return steveSessionId
    if (!steveCommunity) return null
    try {
      const res = await fetch('/api/networking/steve_session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ community_id: steveCommunity })
      })
      const data = await res.json()
      if (data.success) {
        setSteveSessionId(data.session_id)
        return data.session_id
      }
    } catch {}
    return null
  }, [steveSessionId, steveCommunity])

  const handleMentionClick = useCallback((username: string) => {
    navigate(`/profile/${username}`)
  }, [navigate])

  const extractMentions = useCallback((text: string): string[] => {
    const matches = text.match(/@([a-zA-Z0-9_]+)/g)
    return matches ? [...new Set(matches.map(m => m.slice(1)))] : []
  }, [])

  const submitFeedback = useCallback((recUsername: string, feedback: 'up' | 'down', reasoning?: string) => {
    if (!steveSessionId) return
    const current = steveFeedback[recUsername]
    const newFeedback = current?.feedback === feedback ? null : feedback
    setSteveFeedback(prev => {
      const next = { ...prev }
      if (newFeedback) {
        next[recUsername] = { feedback: newFeedback, reasoning }
      } else {
        delete next[recUsername]
      }
      return next
    })
    fetch('/api/networking/steve_feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ 
        session_id: steveSessionId, 
        recommended_username: recUsername, 
        feedback: newFeedback,
        reasoning 
      })
    }).catch(() => {})
  }, [steveSessionId, steveFeedback])

  const deleteSession = useCallback((sessionId: number) => {
    if (!steveCommunity) return
    fetch(`/api/networking/steve_session/${sessionId}`, {
      method: 'DELETE', credentials: 'include'
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setDeletingSessionId(null)
          if (steveSessionId === sessionId) {
            setSteveSessionId(null)
            setSteveMessages([])
            setSteveFeedback({})
            setLastSteveDebugTrace(null)
            setShowDebugModal(false)
          }
          loadSessions(steveCommunity, { openLatest: false })
        }
      })
      .catch(() => {})
      .finally(() => setDeletingSessionId(null))
  }, [steveCommunity, steveSessionId, loadSessions])

  const handleSessionLongPressStart = useCallback((sessionId: number) => {
    longPressActiveRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressActiveRef.current = true
      setDeletingSessionId(sessionId)
    }, 600)
  }, [])

  const handleSessionLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const sendSteveMessage = async () => {
    if (!steveInput.trim() || !steveCommunity || steveSending) return
    if (!isOnline) {
      setSteveMessages(prev => [...prev, { role: 'user', text: steveInput.trim() }, { role: 'steve', text: t('networking.offline_reply') }])
      setSteveInput('')
      return
    }
    const msg = steveInput.trim()
    setSteveInput('')
    setSteveMessages(prev => [...prev, { role: 'user', text: msg }])
    setSteveSending(true)
    const sid = await ensureSession()
    if (sid) saveMessage(sid, 'user', msg)
    try {
      const history = steveMessages.slice(-NETWORKING_CHAT_HISTORY_SEND_CAP).map(m => ({ role: m.role === 'steve' ? 'assistant' : 'user', content: m.text }))
      const res = await fetch('/api/networking/steve_match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ community_id: steveCommunity, message: msg, history, debug: isAppAdmin && steveDebugEnabled }),
      })
      const data = await res.json()
      const reply = data.success ? data.response : (data.error || t('networking.error_generic'))
      setSteveMessages(prev => [...prev, { role: 'steve', text: reply }])
      setLastSteveDebugTrace(data.debug_trace || null)
      if (!data.debug_trace) setShowDebugModal(false)
      if (sid) saveMessage(sid, 'steve', reply)
    } catch {
      const errMsg = t('networking.error_network')
      setSteveMessages(prev => [...prev, { role: 'steve', text: errMsg }])
      if (sid) saveMessage(sid, 'steve', errMsg)
    }
    setSteveSending(false)
  }

  const triggerAutoMatch = async () => {
    if (!steveCommunity || autoMatching) return
    if (!isOnline) {
      setSteveMessages(prev => [...prev, { role: 'steve', text: t('networking.offline_auto_match') }])
      return
    }
    setAutoMatching(true)
    const userMsg = t('networking.auto_match_message')
    setSteveMessages(prev => [...prev, { role: 'user', text: userMsg }])
    const sid = await ensureSession()
    if (sid) saveMessage(sid, 'user', userMsg)
    try {
      const res = await fetch('/api/networking/steve_auto_match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ community_id: steveCommunity }) })
      const data = await res.json()
      const reply = data.success ? data.response : (data.error || t('networking.error_generic'))
      setSteveMessages(prev => [...prev, { role: 'steve', text: reply }])
      if (sid) saveMessage(sid, 'steve', reply)
    } catch {
      const errMsg = t('networking.error_network')
      setSteveMessages(prev => [...prev, { role: 'steve', text: errMsg }])
      if (sid) saveMessage(sid, 'steve', errMsg)
    }
    setAutoMatching(false)
  }

  const sectionTabLabel = (key: SectionKey) =>
    key === 'steve' ? t('steve.recommendations') : t('networking.tab_personal')

  if (loading || profileGateLoading) return <div className="glass-page min-h-screen text-white flex items-center justify-center"><span className="text-[#9fb0b5]">{t('networking.loading')}</span></div>

  if (!profileReadyForNetworking) {
    return (
      <div className="glass-page min-h-screen text-white">
        <div className="max-w-xl mx-auto px-4 pt-10">
          <div className="rounded-2xl border border-[#4db6ac]/25 bg-[#4db6ac]/10 p-5 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#4db6ac]/15 border border-[#4db6ac]/25 flex items-center justify-center">
              <i className="fa-solid fa-user-check text-[#4db6ac] text-lg" />
            </div>
            <div className="space-y-2">
              <div className="text-lg font-semibold text-white">{t('networking.profile_gate_title')}</div>
              <div className="text-sm text-white/70 leading-relaxed">
                {t('networking.profile_gate_body')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {missingProfileFields.map(field => (
                <span key={field} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/80">
                  {profileFieldLabel(field, t)}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="rounded-full bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:brightness-110 transition"
            >
              {t('networking.complete_profile')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-page min-h-screen text-white">
      {/* Fixed sub-nav tabs — same as Followers page */}
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }}
      >
        <div className="max-w-3xl mx-auto h-full flex items-center px-2">
          <div className="flex-1 h-full flex">
            {SECTION_DEFINITIONS.map(section => {
              const isActive = section.key === activeSection
              return (
                <button
                  key={section.key}
                  type="button"
                  className={`flex-1 text-center text-sm font-medium ${isActive ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`}
                  onClick={() => setActiveSection(section.key)}
                >
                  <div className="pt-2">{sectionTabLabel(section.key)}</div>
                  <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${isActive ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div
        className="app-subnav-offset max-w-3xl mx-auto px-1 sm:px-3 pb-2 overflow-y-auto overscroll-auto"
        style={{ WebkitOverflowScrolling: 'touch' as any }}
      >
        {/* ── Steve Recommendations ── */}
        {activeSection === 'steve' && (
          <div className="space-y-3">
            <section className="rounded-xl border border-white/10 bg-black p-3 space-y-2.5">
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">{t('networking.steve_kicker')}</p>
                <h1 className="text-xl font-semibold tracking-tight text-white">{t('networking.steve_headline')}</h1>
                <p className="text-[13px] leading-relaxed text-[#a7b8be]">
                  {t('steve.networking_helper')}
                </p>
              </div>

              {/* Community selector */}
              <select
                value={steveCommunity || ''}
                onChange={e => {
                  setSteveCommunity(Number(e.target.value))
                  setSteveMessages([])
                  setSteveSessionId(null)
                  setShowSessionList(false)
                  setSteveFeedback({})
                  setLastSteveDebugTrace(null)
                  setShowDebugModal(false)
                }}
                className="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white focus:outline-none focus:border-[#4db6ac]"
              >
                {communities.map(c => <option key={c.id} value={c.id} className="bg-black">{c.name}</option>)}
              </select>

              {/* Session controls */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={startNewChat}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white hover:border-white/35 transition"
                >
                  <i className="fa-solid fa-plus text-[10px] text-[#4db6ac]" />
                  {t('networking.new_chat')}
                </button>
                <button
                  onClick={() => setShowSessionList(prev => !prev)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${showSessionList ? 'border-[#4db6ac]/50 text-[#4db6ac]' : 'border-white/15 text-white hover:border-white/35'}`}
                >
                  <i className="fa-solid fa-clock-rotate-left text-[10px]" />
                  {t('networking.history')}
                  {steveSessions.length > 0 && <span className="text-[10px] text-[#6f7c81]">({steveSessions.length})</span>}
                </button>
                {isAppAdmin && (
                  <button
                    type="button"
                    onClick={() => setSteveDebugEnabled(prev => !prev)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${steveDebugEnabled ? 'border-[#4db6ac]/60 bg-[#4db6ac]/10 text-[#4db6ac]' : 'border-white/15 text-white hover:border-white/35'}`}
                    title={t('networking.debug_toggle_title')}
                  >
                    <i className="fa-solid fa-bug text-[10px]" />
                    {steveDebugEnabled ? t('networking.debug_on') : t('networking.debug_off')}
                  </button>
                )}
                {isAppAdmin && lastSteveDebugTrace && (
                  <button
                    type="button"
                    onClick={() => { setDebugTab('planner'); setShowDebugModal(true) }}
                    className="flex items-center gap-1.5 rounded-lg border border-[#4db6ac]/50 px-3 py-1.5 text-xs text-[#4db6ac] hover:bg-[#4db6ac]/10 transition"
                  >
                    <i className="fa-solid fa-magnifying-glass-chart text-[10px]" />
                    {t('networking.view_reasoning')}
                  </button>
                )}
              </div>

              {/* Session history list */}
              {showSessionList && (
                <div className="rounded-xl border border-white/10 bg-black/60 p-2 max-h-[200px] overflow-y-auto space-y-1">
                  {sessionsLoading ? (
                    <div className="text-xs text-[#6f7c81] py-2 text-center">{t('networking.loading')}</div>
                  ) : steveSessions.length === 0 ? (
                    <div className="text-xs text-[#6f7c81] py-2 text-center">{t('networking.no_previous_chats')}</div>
                  ) : (
                    steveSessions.map(s => (
                      <div key={s.id} className="relative">
                        <button
                          onClick={() => { if (!longPressActiveRef.current) loadSession(s.id) }}
                          onTouchStart={() => handleSessionLongPressStart(s.id)}
                          onTouchEnd={handleSessionLongPressEnd}
                          onTouchCancel={handleSessionLongPressEnd}
                          onContextMenu={e => { e.preventDefault(); setDeletingSessionId(s.id) }}
                          className={`w-full text-left rounded-lg px-3 py-2 text-xs transition select-none ${s.id === steveSessionId ? 'bg-white/10 text-white' : 'text-[#a7b8be] hover:bg-white/5'}`}
                        >
                          <div className="truncate font-medium">{s.first_message || t('networking.session_new_chat')}</div>
                          <div className="text-[10px] text-[#6f7c81] mt-0.5">{new Date(s.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                        </button>
                        {deletingSessionId === s.id && (
                          <div
                            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/90 border border-red-500/30 backdrop-blur-sm"
                            onClick={e => e.stopPropagation()}
                            onPointerDown={e => e.stopPropagation()}
                            onTouchStart={e => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-[#a7b8be]">{t('networking.delete_confirm')}</span>
                              <button
                                type="button"
                                onClick={e => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  deleteSession(s.id)
                                }}
                                className="rounded-md bg-red-500/20 border border-red-500/40 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/30 transition"
                              >
                                {t('common.delete')}
                              </button>
                              <button
                                type="button"
                                onClick={e => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setDeletingSessionId(null)
                                }}
                                className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-medium text-[#a7b8be] hover:bg-white/5 transition"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Chat area */}
              <div className="rounded-xl border border-white/10 bg-black/50 p-3 min-h-[280px] max-h-[50vh] overflow-y-auto space-y-3">
                {steveMessages.length === 0 ? (
                  (sessionsLoading || steveMembersLoading || steveMemberCount === null) ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <p className="text-sm text-[#9fb0b5]">{t('networking.loading')}</p>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2 text-[13px] leading-relaxed bg-transparent text-[#c8d6db]">
                        <SteveWelcomeCopy
                          communityName={communities.find(c => c.id === steveCommunity)?.name ?? t('networking.welcome_community_fallback')}
                          activeMemberCount={steveMemberCount}
                        />
                      </div>
                    </div>
                  )
                ) : (
                  steveMessages.map((msg, i) => {
                    const mentions = msg.role === 'steve' ? extractMentions(msg.text) : []
                    return (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-white/10 text-white rounded-br-md'
                            : 'bg-transparent text-[#c8d6db] rounded-bl-md'
                        }`}>
                          {msg.role === 'steve' ? (
                            <>
                              <div className="whitespace-pre-wrap">{renderTextWithSourceLinks(msg.text, false, handleMentionClick)}</div>
                              {mentions.length > 0 && (
                                <div className="mt-2 pt-1.5 border-t border-white/[0.06] flex flex-wrap gap-x-3 gap-y-1">
                                  {mentions.map(u => (
                                    <span key={u} className="inline-flex items-center gap-1 text-[11px] text-white/40">
                                      <span className="text-white/25">@{u}</span>
                                      <button
                                        onClick={() => submitFeedback(u, 'up')}
                                        className={`p-0.5 rounded transition ${steveFeedback[u]?.feedback === 'up' ? 'text-[#4db6ac]' : 'text-white/20 hover:text-white/50'}`}
                                        title={t('networking.feedback_good')}
                                      ><i className="fa-solid fa-thumbs-up text-[10px]" /></button>
                                      <button
                                        onClick={() => submitFeedback(u, 'down')}
                                        className={`p-0.5 rounded transition ${steveFeedback[u]?.feedback === 'down' ? 'text-red-400/80' : 'text-white/20 hover:text-white/50'}`}
                                        title={t('networking.feedback_not_relevant')}
                                      ><i className="fa-solid fa-thumbs-down text-[10px]" /></button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : msg.text}
                        </div>
                      </div>
                    )
                  })
                )}
                {(steveSending || autoMatching) && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-[#9fb0b5]">
                      <span>{t('networking.steve_thinking')}</span>
                      <span className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </div>
                  </div>
                )}
                <div ref={steveEndRef} />
              </div>

            </section>
            {/* Spacer for fixed input bar */}
            <div className="h-16" />
          </div>
        )}

        {/* Steve input bar — fixed at viewport bottom, lifted above keyboard */}
        {activeSection === 'steve' && (
          <div
            className="fixed left-0 right-0 z-50 bg-black border-t border-white/10 px-3 py-2"
            style={{
              bottom: showKeyboard ? `${keyboardLift}px` : 0,
              paddingBottom: showKeyboard ? '4px' : `calc(${safeBottomPx}px + 8px)`,
              transition: 'bottom 0.1s ease-out',
            }}
          >
            <div className="max-w-3xl mx-auto flex items-center gap-2">
              <button
                onClick={triggerAutoMatch}
                disabled={autoMatching || steveSending || !steveCommunity}
                className="w-9 h-9 rounded-lg border border-white/15 flex items-center justify-center flex-shrink-0 hover:border-white/35 disabled:opacity-40 transition"
                title={t('networking.auto_match_title')}
              >
                <i className="fa-solid fa-wand-magic-sparkles text-xs text-[#4db6ac]" />
              </button>
              <textarea
                value={steveInput}
                onChange={e => { setSteveInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSteveMessage() } }}
                placeholder={t('networking.input_placeholder')}
                rows={1}
                className="flex-1 rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white placeholder-[#6f7c81] focus:outline-none focus:border-[#4db6ac] resize-none overflow-y-auto"
                style={{ maxHeight: 120 }}
                disabled={steveSending || autoMatching}
              />
              <button
                onClick={sendSteveMessage}
                disabled={!steveInput.trim() || steveSending || autoMatching}
                className="w-9 h-9 rounded-lg border border-white/15 flex items-center justify-center flex-shrink-0 hover:border-white/35 disabled:opacity-40 transition"
              >
                <i className="fa-solid fa-arrow-up text-xs text-white" />
              </button>
            </div>
          </div>
        )}

        {/* ── Personal ── */}
        {activeSection === 'personal' && (
          <div className="space-y-3">
            <section className="rounded-xl border border-white/10 bg-black p-3 space-y-2.5">
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">{t('networking.personal_kicker')}</p>
                <h1 className="text-xl font-semibold tracking-tight text-white">{t('networking.personal_headline')}</h1>
                <p className="text-[13px] leading-relaxed text-[#a7b8be]">
                  {t('networking.personal_intro')}
                </p>
              </div>

              {/* Community selector */}
              <select
                value={personalCommunity || ''}
                onChange={e => setPersonalCommunity(Number(e.target.value))}
                className="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white focus:outline-none focus:border-[#4db6ac]"
              >
                {communities.map(c => <option key={c.id} value={c.id} className="bg-black">{c.name}</option>)}
              </select>

              {/* Filters */}
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={selectedLocation}
                  onChange={e => setSelectedLocation(e.target.value)}
                  className="rounded-lg border border-white/15 bg-transparent px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-black">{t('networking.filter_location')}</option>
                  {filterOptions.locations.filter(Boolean).sort().map(loc => (
                    <option key={loc} value={loc} className="bg-black">{loc}</option>
                  ))}
                </select>
                <select
                  value={selectedIndustry}
                  onChange={e => setSelectedIndustry(e.target.value)}
                  className="rounded-lg border border-white/15 bg-transparent px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-black">{t('networking.filter_industry')}</option>
                  {filterOptions.industries.filter(Boolean).sort().map(ind => (
                    <option key={ind} value={ind} className="bg-black">{ind}</option>
                  ))}
                </select>
                <select
                  value={selectedInterest}
                  onChange={e => setSelectedInterest(e.target.value)}
                  className="rounded-lg border border-white/15 bg-transparent px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-black">{t('networking.filter_interests')}</option>
                  {filterOptions.interests.filter(Boolean).sort().map(int => (
                    <option key={int} value={int} className="bg-black">{int}</option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-[#6f7c81]" />
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder={t('networking.search_placeholder')}
                  className="w-full rounded-lg border border-white/15 bg-transparent pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#6f7c81] focus:outline-none focus:border-[#4db6ac]"
                />
              </div>

              {/* Results */}
              <div className="rounded-xl border border-white/10 bg-black/50 p-3">
                {personalLoading ? (
                  <div className="text-[#9fb0b5]">{t('networking.loading')}</div>
                ) : (() => {
                  const q = memberSearch.trim().toLowerCase()
                  const filtered = q
                    ? personalMembers.filter(m =>
                        (m.display_name || '').toLowerCase().includes(q) ||
                        m.username.toLowerCase().includes(q))
                    : personalMembers
                  return filtered.length === 0 ? (
                    <div className="text-[#9fb0b5]">{t('networking.no_members_match')}</div>
                  ) : (
                  <div>
                    <div className="text-[11px] text-[#6f7c81] mb-2">
                      {t(filtered.length === 1 ? 'networking.member_count_one' : 'networking.member_count_other', { count: filtered.length })}
                    </div>
                    <div className="divide-y divide-white/5">
                      {filtered.map(m => (
                        <div
                          key={m.username}
                          className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-white/[0.02] -mx-1 px-1 rounded-lg transition"
                          onClick={() => navigate(`/profile/${m.username}`)}
                        >
                          <Avatar username={m.username} url={m.profile_picture || undefined} size={40} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate text-white">{m.display_name || m.username}</div>
                            <div className="text-[11px] text-[#6f7c81]">@{m.username}</div>
                            {(m.city || m.country) && (
                              <div className="text-[11px] text-[#6f7c81] flex items-center gap-1">
                                <i className="fa-solid fa-location-dot text-[8px]" />
                                {[m.city, m.country].filter(Boolean).join(', ')}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
                            <button
                              className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white hover:border-white/40"
                              onClick={(e) => { e.stopPropagation(); navigate(`/profile/${m.username}`) }}
                            >
                              {t('networking.view')}
                            </button>
                            <button
                              className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white hover:border-white/40"
                              onClick={(e) => { e.stopPropagation(); navigate(`/user_chat/chat/${m.username}`) }}
                            >
                              {t('networking.message')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  )
                })()}
              </div>
            </section>
          </div>
        )}
      </div>
      {isAppAdmin && showDebugModal && lastSteveDebugTrace && (
        <SteveDebugModal
          trace={lastSteveDebugTrace}
          activeTab={debugTab}
          onTabChange={setDebugTab}
          onClose={() => setShowDebugModal(false)}
        />
      )}
    </div>
  )
}
