import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useComposerKeyboardLift } from '../hooks/useComposerKeyboardLift'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import { SkeletonList } from '../components/SkeletonRow'
import MatchesSheet from '../components/networking/MatchesSheet'
import HistorySheet from '../components/networking/HistorySheet'
import SteveEmptyState from '../components/networking/SteveEmptyState'
import SteveThinking from '../components/networking/SteveThinking'
import SteveDebugModal, { type DebugTabKey, type SteveDebugTrace } from '../components/networking/SteveDebugModal'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { renderTextWithSourceLinks } from '../utils/linkUtils'
import { useNetwork } from '../contexts/NetworkContext'
import { CHAT_KEYBOARD_ANIMATION_MS, CPOINT_EASE_OUT } from '../design/motion'

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
  location?: string | null
  professional_interests?: string[] | null
  bio?: string | null
}
type FilterOptions = { locations: string[]; industries: string[]; interests: string[] }

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

export default function Networking() {
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const { isOnline } = useNetwork()
  const [searchParams, setSearchParams] = useSearchParams()
  // ?session=<id>&community=<id> restore: read once on mount; both must be
  // present so a multi-network member's session never loads under the wrong
  // community selector. Invalid/foreign ids fall back silently to latest.
  const pendingUrlSessionRef = useRef<number | null>(
    /^\d+$/.test(searchParams.get('session') || '') ? Number(searchParams.get('session')) : null,
  )
  const pendingUrlCommunityRef = useRef<number | null>(
    /^\d+$/.test(searchParams.get('community') || '') ? Number(searchParams.get('community')) : null,
  )
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
  const [historySheetOpen, setHistorySheetOpen] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [steveFeedback, setSteveFeedback] = useState<Record<string, { feedback: 'up' | 'down'; reasoning?: string }>>({})
  const [steveMembers, setSteveMembers] = useState<MemberProfile[]>([])
  const [steveMemberCount, setSteveMemberCount] = useState<number | null>(null)
  // Introductions sheet: usernames persist through the close transition.
  const [matchSheetUsers, setMatchSheetUsers] = useState<string[]>([])
  const [matchSheetOpen, setMatchSheetOpen] = useState(false)
  const [steveMembersLoading, setSteveMembersLoading] = useState(false)
  const [isAppAdmin, setIsAppAdmin] = useState(false)
  const [steveDebugEnabled, setSteveDebugEnabled] = useState(false)
  const [lastSteveDebugTrace, setLastSteveDebugTrace] = useState<SteveDebugTrace | null>(null)
  const [showDebugModal, setShowDebugModal] = useState(false)
  const [debugTab, setDebugTab] = useState<DebugTabKey>('planner')

  const scrollToBottom = useCallback(() => {
    // Align the END marker to the bottom of the viewport (not the default
    // 'start', which parks it at the top and scrolls the latest message off
    // under the header). The end marker is the bottom spacer, which grows with
    // the keyboard, so this lands the latest message just above the lifted bar.
    steveEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [])

  const { keyboardLift, showKeyboard, safeBottomPx } = useComposerKeyboardLift({
    // Smoothly lift the content above the keyboard on open. Safe for BOTH the
    // empty landing and a conversation now that /networking self-manages the
    // keyboard (no global <main> inset double-counting) and the bottom anchor
    // grows with keyboardLift: scroll-to-end lands the content just above the
    // lifted bar instead of flinging it off-screen. (The earlier messages-only
    // guard was a band-aid for the old double-handling; with that fixed it just
    // left the landing's content stranded behind the keyboard.)
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
          const urlCommunity = pendingUrlCommunityRef.current
          const restored = urlCommunity && data.communities.some((c: Community) => c.id === urlCommunity)
            ? urlCommunity
            : data.communities[0].id
          setSteveCommunity(restored)
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
          const sessions = data.sessions || []
          setSteveSessions(sessions)
          // URL restore wins over auto-open-latest, once, when valid.
          const pending = pendingUrlSessionRef.current
          pendingUrlSessionRef.current = null
          const target = pending && sessions.some((s: { id: number }) => s.id === pending)
            ? pending
            : openLatest && sessions.length > 0 ? sessions[0].id : null
          if (target) {
            setSteveSessionId(target)
            setLastSteveDebugTrace(null)
            setShowDebugModal(false)
            fetch(`/api/networking/steve_session/${target}/messages`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
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

  // Mirror the active thread into ?session/?community so refresh and
  // deep-links restore what's on screen. Always replace, never push —
  // hardware back must leave /networking, not walk through session
  // switches (Capacitor WebView back-trap). Ref dodges the unstable
  // setSearchParams identity across navigations.
  const setSearchParamsRef = useRef(setSearchParams)
  useEffect(() => { setSearchParamsRef.current = setSearchParams })
  useEffect(() => {
    setSearchParamsRef.current(params => {
      const next = new URLSearchParams(params)
      if (steveSessionId && steveCommunity) {
        next.set('session', String(steveSessionId))
        next.set('community', String(steveCommunity))
      } else {
        next.delete('session')
        next.delete('community')
      }
      return next
    }, { replace: true })
  }, [steveSessionId, steveCommunity])

  useEffect(() => {
    if (!steveCommunity) return
    let cancelled = false
    setSteveMembersLoading(true)
    setSteveMemberCount(null)
    fetch(`/api/networking/community_members/${steveCommunity}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.success) {
          const members = data.members || []
          setSteveMembers(members)
          setSteveMemberCount(members.length)
        } else {
          setSteveMembers([])
          setSteveMemberCount(0)
        }
      })
      .catch(() => { if (!cancelled) { setSteveMembers([]); setSteveMemberCount(0) } })
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
          setHistorySheetOpen(false)
          loadSessions(steveCommunity)
        }
      })
      .catch(() => {})
  }, [steveCommunity, loadSessions])

  const loadSession = useCallback((sessionId: number) => {
    setSteveSessionId(sessionId)
    setHistorySheetOpen(false)
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

  useEffect(() => { scrollToBottom() }, [scrollToBottom, steveMessages, steveMemberCount, steveMembersLoading])

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

  // Personal: filter in memory. The initial payload already carries every
  // field the dropdowns filter on, so changing a filter never needs a server
  // round-trip (matching semantics: location is exact "City, Country" or a
  // substring of the space-joined parts; industry/interest are substrings).
  const filteredPersonalMembers = useMemo(() => {
    const loc = selectedLocation.trim().toLowerCase()
    const ind = selectedIndustry.trim().toLowerCase()
    const int = selectedInterest.trim().toLowerCase()
    if (!loc && !ind && !int) return personalMembers
    return personalMembers.filter(m => {
      if (loc) {
        const combined = (m.location || '').toLowerCase()
        if (loc !== combined && !combined.replace(/, /g, ' ').includes(loc)) return false
      }
      if (ind && !(m.industry || '').toLowerCase().includes(ind)) return false
      if (int) {
        const interests = m.professional_interests || []
        if (!interests.some(i => (i || '').toLowerCase().includes(int))) return false
      }
      return true
    })
  }, [personalMembers, selectedLocation, selectedIndustry, selectedInterest])

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

  const steveMemberByName = useMemo(() => {
    const map: Record<string, MemberProfile> = {}
    for (const member of steveMembers) {
      map[member.username.toLowerCase()] = member
    }
    return map
  }, [steveMembers])

  const extractMentions = useCallback((text: string): string[] => {
    const matches = text.match(/@([a-zA-Z0-9_]+)/g)
    return matches ? [...new Set(matches.map(m => m.slice(1)))] : []
  }, [])

  // Render-time name resolution: the name shown next to each @mention comes
  // from the members endpoint (DB truth keyed by username), never from the
  // model's prose. Steve is prompted not to write names at all; this puts
  // the verified one back for the reader.
  const mentionLabel = useCallback((username: string): string | null => {
    const member = steveMemberByName[username.toLowerCase()]
    return member?.display_name || null
  }, [steveMemberByName])

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
    fetch(`/api/networking/steve_session/${sessionId}`, {
      method: 'DELETE', credentials: 'include'
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setSteveSessions(prev => prev.filter(s => s.id !== sessionId))
          if (steveSessionId === sessionId) {
            setSteveSessionId(null)
            setSteveMessages([])
            setSteveFeedback({})
            setLastSteveDebugTrace(null)
            setShowDebugModal(false)
          }
        }
      })
      .catch(() => {})
  }, [steveSessionId])

  // Map a networking denial to a Steve-voice line. The B2B "needs a Steve
  // Package" wall and the reduced trial cap join the existing weekly cap; all
  // stay in Steve's voice rather than surfacing the backend's English text.
  const steveDenialReply = (data: { reason?: string; error?: string; usage?: { limit?: number } }): string => {
    switch (data.reason) {
      case 'steve_package_required':
        return t('networking.package_required_reply')
      case 'networking_trial_cap':
        return t('networking.trial_limit_reply', { limit: data?.usage?.limit ?? 5 })
      case 'weekly_networking_prompt_cap':
        return t('networking.weekly_limit_reply')
      default:
        return data.error || t('networking.error_generic')
    }
  }

  const sendSteveMessage = async (overrideText?: string) => {
    const msg = (overrideText ?? steveInput).trim()
    if (!msg || !steveCommunity || steveSending) return
    if (!isOnline) {
      setSteveMessages(prev => [...prev, { role: 'user', text: msg }, { role: 'steve', text: t('networking.offline_reply') }])
      setSteveInput('')
      return
    }
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
      const reply = data.success ? data.response : steveDenialReply(data)
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
      const reply = data.success ? data.response : steveDenialReply(data)
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
    key === 'steve' ? t('networking.tab_steve') : t('networking.tab_personal')

  if (loading || profileGateLoading) return (
    <div className="glass-page min-h-screen text-c-text-primary px-4 pt-6">
      <div className="h-9 w-40 rounded skeleton-box mb-5" />
      <SkeletonList count={5} />
    </div>
  )

  if (!profileReadyForNetworking) {
    return (
      <div className="glass-page min-h-screen bg-c-bg-app text-c-text-primary">
        <div className="max-w-xl mx-auto px-4 pt-10">
          <div className="rounded-2xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/10 p-5 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-cpoint-turquoise/15 border border-cpoint-turquoise/25 flex items-center justify-center">
              <i className="fa-solid fa-user-check text-cpoint-turquoise text-lg" />
            </div>
            <div className="space-y-2">
              <div className="text-lg font-semibold text-c-text-primary">{t('networking.profile_gate_title')}</div>
              <div className="text-sm text-c-text-secondary leading-relaxed">
                {t('networking.profile_gate_body')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {missingProfileFields.map(field => (
                <span key={field} className="rounded-full border border-c-border bg-c-hover-bg px-3 py-1 text-xs text-c-text-secondary">
                  {profileFieldLabel(field, t)}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate('/profile?return=/networking')}
              className="rounded-full bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black hover:brightness-110 transition"
            >
              {t('networking.complete_profile')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-page min-h-screen bg-c-bg-app text-c-text-primary">
      {/* Fixed sub-nav tabs — same as Followers page */}
      <div
        className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40"
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
                  className={`flex-1 text-center text-sm font-medium ${isActive ? 'text-c-text-secondary' : 'text-c-text-tertiary hover:text-c-text-secondary'}`}
                  onClick={() => setActiveSection(section.key)}
                >
                  <div className="pt-2">{sectionTabLabel(section.key)}</div>
                  <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${isActive ? 'bg-cpoint-turquoise' : 'bg-transparent'}`} />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div
        className="app-subnav-offset max-w-3xl mx-auto px-1 sm:px-3 pb-2 overflow-y-auto overscroll-auto"
        style={{ WebkitOverflowScrolling: 'touch' as any, ['--app-subnav-gap' as any]: '4px' }}
      >
        {/* ── Steve Recommendations ── */}
        {activeSection === 'steve' && (
          <div>
            {/* Slim utility row: community pill (multi-network only) + icon
                actions. The old intro card (kicker/headline/helper) is gone —
                Steve's welcome bubble carries the value proposition. */}
            <div className="flex items-center justify-between gap-2 px-2 pt-1">
              {communities.length > 1 ? (
                <select
                  value={steveCommunity || ''}
                  onChange={e => {
                    setSteveCommunity(Number(e.target.value))
                    setSteveMessages([])
                    setSteveSessionId(null)
                    setHistorySheetOpen(false)
                    setSteveFeedback({})
                    setLastSteveDebugTrace(null)
                    setShowDebugModal(false)
                  }}
                  className="h-11 min-w-0 flex-1 max-w-[75%] truncate rounded-full border border-c-border bg-transparent px-4 text-sm leading-tight text-c-text-primary focus:border-cpoint-turquoise focus:outline-none"
                >
                  {communities.map(c => <option key={c.id} value={c.id} className="bg-c-bg-app">{c.name}</option>)}
                </select>
              ) : (
                <div />
              )}
              <div className="flex items-center">
                <button
                  onClick={startNewChat}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-c-text-secondary transition hover:bg-c-hover-bg"
                  title={t('networking.new_chat')}
                  aria-label={t('networking.new_chat')}
                >
                  <i className="fa-solid fa-plus text-sm" />
                </button>
                {steveSessions.length > 0 && (
                  <button
                    onClick={() => setHistorySheetOpen(true)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-c-text-secondary transition hover:bg-c-hover-bg"
                    title={t('networking.history')}
                    aria-label={t('networking.history')}
                  >
                    <i className="fa-solid fa-clock-rotate-left text-sm" />
                  </button>
                )}
                {isAppAdmin && (
                  <button
                    type="button"
                    onClick={() => setSteveDebugEnabled(prev => !prev)}
                    className={`flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-c-hover-bg ${steveDebugEnabled ? 'text-cpoint-turquoise' : 'text-c-text-secondary'}`}
                    title={t('networking.debug_toggle_title')}
                    aria-label={t('networking.debug_toggle_title')}
                  >
                    <i className="fa-solid fa-bug text-sm" />
                  </button>
                )}
                {isAppAdmin && lastSteveDebugTrace && (
                  <button
                    type="button"
                    onClick={() => { setDebugTab('planner'); setShowDebugModal(true) }}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-cpoint-turquoise transition hover:bg-cpoint-turquoise/10"
                    title={t('networking.view_reasoning')}
                    aria-label={t('networking.view_reasoning')}
                  >
                    <i className="fa-solid fa-magnifying-glass-chart text-sm" />
                  </button>
                )}
              </div>
            </div>

            {/* Conversation — full-bleed; the page scroller is the only
                scroller (the old bordered box capped the chat at 50vh and
                created scroll-within-scroll). */}
            <div className="px-2 pt-2 space-y-3">
              {steveMessages.length === 0 ? (
                (sessionsLoading || steveMembersLoading || steveMemberCount === null) ? (
                  <div className="px-2 py-6">
                    <SkeletonList count={3} />
                  </div>
                ) : (
                  <SteveEmptyState
                    communityName={communities.find(c => c.id === steveCommunity)?.name ?? t('networking.welcome_community_fallback')}
                    activeMemberCount={steveMemberCount}
                    disabled={steveSending || autoMatching}
                    onAutoMatch={triggerAutoMatch}
                    onSuggestion={text => void sendSteveMessage(text)}
                  />
                )
              ) : (
                steveMessages.map((msg, i) => {
                  const mentions = msg.role === 'steve' ? extractMentions(msg.text) : []
                  return (
                    <div key={i} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                      {msg.role === 'user' ? (
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-c-active-bg px-3.5 py-2 text-[13px] leading-relaxed text-c-text-primary">
                          {msg.text}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="max-w-[92%] whitespace-pre-wrap text-[13px] leading-relaxed text-c-text-secondary">
                            {renderTextWithSourceLinks(msg.text, false, handleMentionClick, undefined, false, mentionLabel)}
                          </div>
                          {mentions.length > 0 && (
                            <button
                              type="button"
                              onClick={() => { setMatchSheetUsers(mentions); setMatchSheetOpen(true) }}
                              aria-label={t('networking.matches_affordance_aria')}
                              className="group flex min-h-[44px] items-center gap-2.5 text-left"
                            >
                              <span className="flex -space-x-2">
                                {mentions.slice(0, 3).map(u => (
                                  <span key={u} className="rounded-full ring-2 ring-c-bg-app">
                                    <Avatar username={u} url={steveMemberByName[u.toLowerCase()]?.profile_picture || undefined} size={24} />
                                  </span>
                                ))}
                              </span>
                              <span className="text-[13px] font-medium text-c-accent-ink">
                                {t(mentions.length === 1 ? 'networking.matches_affordance_one' : 'networking.matches_affordance_other', { count: mentions.length })}
                              </span>
                              <i className="fa-solid fa-chevron-right text-[9px] text-c-text-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
              {(steveSending || autoMatching) && <SteveThinking />}
            </div>
            {/* Bottom spacer + scroll-to-bottom anchor. Grows with the keyboard
                so the latest message can scroll clear above the lifted input bar
                instead of hiding behind it (the bar itself sits at keyboardLift). */}
            <div
              ref={steveEndRef}
              style={{ height: showKeyboard ? `${keyboardLift + 72}px` : '80px' }}
            />
          </div>
        )}

        {/* Steve input bar — fixed at viewport bottom, lifted above keyboard */}
        {activeSection === 'steve' && (
          <div
            className="fixed left-0 right-0 z-50 bg-c-bg-app border-t border-c-border px-3 py-2"
            style={{
              bottom: showKeyboard ? `${keyboardLift}px` : 0,
              paddingBottom: showKeyboard ? '4px' : `calc(${safeBottomPx}px + 8px)`,
              transition: `bottom ${CHAT_KEYBOARD_ANIMATION_MS}ms ${CPOINT_EASE_OUT}`,
            }}
          >
            <div className="max-w-3xl mx-auto flex items-center gap-2">
              <textarea
                value={steveInput}
                onChange={e => { setSteveInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendSteveMessage() } }}
                placeholder={t('networking.input_placeholder')}
                rows={1}
                className="flex-1 rounded-lg border border-c-border bg-transparent px-3 py-2.5 text-sm text-c-text-primary placeholder-c-text-tertiary focus:outline-none focus:border-cpoint-turquoise resize-none overflow-y-auto"
                style={{ maxHeight: 120 }}
                disabled={steveSending || autoMatching}
              />
              {/* App-canonical send button (ChatThread spec: 40px paper-plane,
                  filled states, spinner) inside a transparent 44px hit area. */}
              <button
                onClick={() => void sendSteveMessage()}
                disabled={!steveInput.trim() || steveSending || autoMatching}
                className="h-11 w-11 flex items-center justify-center flex-shrink-0"
                aria-label={t('networking.send')}
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
              >
                <span className={`w-10 h-10 rounded-[14px] flex items-center justify-center active:scale-95 ${
                  steveSending || autoMatching
                    ? 'bg-c-active-bg text-c-text-tertiary'
                    : steveInput.trim()
                      ? 'bg-cpoint-turquoise text-black'
                      : 'bg-c-active-bg text-c-text-secondary'
                }`}>
                  {steveSending || autoMatching ? (
                    <i className="fa-solid fa-spinner fa-spin text-base pointer-events-none" />
                  ) : (
                    <i className="fa-solid fa-paper-plane text-base pointer-events-none" />
                  )}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ── Personal directory ── */}
        {activeSection === 'personal' && (
          <div className="space-y-2.5 px-2 pt-1">
              {/* The old kicker/headline/intro narrated the visible filters
                  below — removed. Selector only shows with several networks. */}
              {communities.length > 1 && (
                <select
                  value={personalCommunity || ''}
                  onChange={e => setPersonalCommunity(Number(e.target.value))}
                  className="h-9 w-full rounded-full border border-c-border bg-transparent px-3 text-xs text-c-text-primary focus:outline-none focus:border-cpoint-turquoise"
                >
                  {communities.map(c => <option key={c.id} value={c.id} className="bg-c-bg-app">{c.name}</option>)}
                </select>
              )}

              {/* Filters */}
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={selectedLocation}
                  onChange={e => setSelectedLocation(e.target.value)}
                  className="rounded-lg border border-c-border bg-transparent px-2.5 py-1.5 text-[11px] text-c-text-primary focus:outline-none focus:border-cpoint-turquoise"
                >
                  <option value="" className="bg-c-bg-app">{t('networking.filter_location')}</option>
                  {filterOptions.locations.filter(Boolean).sort().map(loc => (
                    <option key={loc} value={loc} className="bg-c-bg-app">{loc}</option>
                  ))}
                </select>
                <select
                  value={selectedIndustry}
                  onChange={e => setSelectedIndustry(e.target.value)}
                  className="rounded-lg border border-c-border bg-transparent px-2.5 py-1.5 text-[11px] text-c-text-primary focus:outline-none focus:border-cpoint-turquoise"
                >
                  <option value="" className="bg-c-bg-app">{t('networking.filter_industry')}</option>
                  {filterOptions.industries.filter(Boolean).sort().map(ind => (
                    <option key={ind} value={ind} className="bg-c-bg-app">{ind}</option>
                  ))}
                </select>
                <select
                  value={selectedInterest}
                  onChange={e => setSelectedInterest(e.target.value)}
                  className="rounded-lg border border-c-border bg-transparent px-2.5 py-1.5 text-[11px] text-c-text-primary focus:outline-none focus:border-cpoint-turquoise"
                >
                  <option value="" className="bg-c-bg-app">{t('networking.filter_interests')}</option>
                  {filterOptions.interests.filter(Boolean).sort().map(int => (
                    <option key={int} value={int} className="bg-c-bg-app">{int}</option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-c-text-tertiary" />
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder={t('networking.search_placeholder')}
                  className="w-full rounded-lg border border-c-border bg-transparent pl-8 pr-3 py-1.5 text-xs text-c-text-primary placeholder-c-text-tertiary focus:outline-none focus:border-cpoint-turquoise"
                />
              </div>

              {/* Results — full-bleed list; the old bordered card added
                  chrome without elevation. */}
              <div className="pt-1">
                {personalLoading ? (
                  <div className="text-c-text-tertiary">{t('networking.loading')}</div>
                ) : (() => {
                  const q = memberSearch.trim().toLowerCase()
                  const filtered = q
                    ? filteredPersonalMembers.filter(m =>
                        (m.display_name || '').toLowerCase().includes(q) ||
                        m.username.toLowerCase().includes(q))
                    : filteredPersonalMembers
                  return filtered.length === 0 ? (
                    <div className="py-4 text-center">
                      <p className="text-[13px] text-c-text-tertiary">{t('networking.no_members_handoff')}</p>
                      <button
                        type="button"
                        onClick={() => setActiveSection('steve')}
                        className="mt-2 min-h-[44px] rounded-full border border-cpoint-turquoise/30 px-4 text-xs font-semibold text-c-accent-ink transition hover:bg-cpoint-turquoise/10"
                      >
                        {t('networking.ask_steve')}
                      </button>
                    </div>
                  ) : (
                  <div>
                    <div className="text-[11px] text-c-text-tertiary mb-2">
                      {t(filtered.length === 1 ? 'networking.member_count_one' : 'networking.member_count_other', { count: filtered.length })}
                    </div>
                    <div className="divide-y divide-c-border-subtle">
                      {filtered.map(m => (
                        <div
                          key={m.username}
                          className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-c-hover-bg -mx-1 px-1 rounded-lg transition"
                          onClick={() => navigate(`/profile/${m.username}`)}
                        >
                          <Avatar username={m.username} url={m.profile_picture || undefined} size={40} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate text-c-text-primary">{m.display_name || m.username}</div>
                            <div className="text-[11px] text-c-text-tertiary">@{m.username}</div>
                            {(m.city || m.country) && (
                              <div className="text-[11px] text-c-text-tertiary flex items-center gap-1">
                                <i className="fa-solid fa-location-dot text-[8px]" />
                                {[m.city, m.country].filter(Boolean).join(', ')}
                              </div>
                            )}
                          </div>
                          {/* Row tap already opens the profile — the old
                              duplicate "View" pill is gone. */}
                          <button
                            className="min-h-[44px] shrink-0 rounded-full border border-c-border px-3.5 text-xs font-medium text-c-text-primary hover:border-c-border-strong"
                            onClick={(e) => { e.stopPropagation(); navigate(`/user_chat/chat/${m.username}`) }}
                          >
                            {t('networking.message')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  )
                })()}
              </div>
          </div>
        )}
      </div>
      <HistorySheet
        open={historySheetOpen}
        sessions={steveSessions}
        activeSessionId={steveSessionId}
        onSelect={loadSession}
        onDelete={deleteSession}
        onClose={() => setHistorySheetOpen(false)}
      />
      <MatchesSheet
        open={matchSheetOpen}
        usernames={matchSheetUsers}
        memberByName={steveMemberByName}
        feedback={steveFeedback}
        onFeedback={(u, value) => submitFeedback(u, value)}
        onOpenProfile={u => { setMatchSheetOpen(false); handleMentionClick(u) }}
        onMessage={u => {
          // A Message tap is the strongest positive signal this surface has —
          // record it as implicit thumbs-up (unless the member already voted)
          // and carry attribution so conversion from Steve matches is
          // measurable in chat analytics.
          if (!steveFeedback[u]) submitFeedback(u, 'up', 'implicit_message_tap')
          setMatchSheetOpen(false)
          navigate(`/user_chat/chat/${u}?source=steve_match`)
        }}
        onClose={() => setMatchSheetOpen(false)}
      />
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
