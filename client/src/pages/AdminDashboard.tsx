import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { invalidateDashboardCache } from '../utils/dashboardCache'
import { triggerDashboardServerPull } from '../utils/serverPull'
import { clearDeviceCache } from '../utils/deviceCache'
import KnowledgeBaseGraph from '../components/KnowledgeBaseGraph'

interface Stats {
  total_users: number
  premium_users: number
  total_communities: number
  total_posts: number
  dau?: number
  mau?: number
  dau_pct?: number
  mau_pct?: number
  avg_dau_30?: number
  mau_month?: number
  mru?: number
  mru_repeat_rate_pct?: number
  wau?: number
  wru?: number
  wru_repeat_rate_pct?: number
  last_user?: { username: string; created_at?: string | null }
  last_community?: { name: string; id: number }
  cohorts?: { month: string; size: number; retention: number[] }[]
  leaderboards?: {
    top_posters: { username: string; count: number }[]
    top_reactors: { username: string; count: number }[]
    top_voters: { username: string; count: number }[]
  }
}

interface User {
  username: string
  subscription: string
  is_active: boolean
  is_admin?: boolean
  created_at?: string
}

interface Community {
  id: number
  name: string
  type: string
  creator_username: string
  join_code: string
  member_count: number
  is_active: boolean
  parent_community_id?: number | null
  children?: Community[]
}

type SimpleCommunityOption = { id: number; name: string }
type NestedCommunityOption = { id: number; name: string; depth: number }

export default function AdminDashboard() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const flatCommunities: Community[] = useMemo(() => {
    const flat: Community[] = []
    const visited = new Set<number>()

    const traverse = (community: Community) => {
      if (visited.has(community.id)) return
      visited.add(community.id)
      flat.push(community)
      if (community.children && community.children.length > 0) {
        for (const child of community.children) traverse(child)
      }
    }

    for (const entry of communities) {
      traverse(entry)
    }
    return flat
  }, [communities])
  const flatCommunityMap = useMemo(() => {
    const map = new Map<number, Community>()
    for (const community of flatCommunities) {
      map.set(community.id, community)
    }
    return map
  }, [flatCommunities])

  const communityChildrenMap = useMemo(() => {
    const map = new Map<number, Community[]>()
    for (const community of flatCommunities) {
      const parentId = community.parent_community_id
      if (parentId === null || parentId === undefined) continue
      const siblings = map.get(parentId) || []
      siblings.push(community)
      map.set(parentId, siblings)
    }
    return map
  }, [flatCommunities])

  const getParentChain = useCallback(
    (communityId: number) => {
      const chain: Community[] = []
      const visited = new Set<number>()
      let current = flatCommunityMap.get(communityId)

      while (current) {
        const parentId = current.parent_community_id
        if (parentId === null || parentId === undefined) break
        if (visited.has(parentId)) break
        visited.add(parentId)
        const parent = flatCommunityMap.get(parentId)
        if (!parent) break
        chain.push(parent)
        current = parent
      }

      return chain
    },
    [flatCommunityMap]
  )

  const getNestedOptions = useCallback(
    (communityId: number) => {
      const options: NestedCommunityOption[] = []
      const visited = new Set<number>()

      const traverse = (currentId: number, depth: number) => {
        const children = communityChildrenMap.get(currentId) || []
        for (const child of children) {
          if (visited.has(child.id)) continue
          visited.add(child.id)
          options.push({ id: child.id, name: child.name, depth })
          traverse(child.id, depth + 1)
        }
      }

      traverse(communityId, 0)
      return options
    },
    [communityChildrenMap]
  )

  const [metricsExtra, setMetricsExtra] = useState<Partial<Stats> | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsError, setMetricsError] = useState<string | null>(null)

  const metricsViewStats = useMemo(() => {
    if (!stats) return null
    return { ...stats, ...(metricsExtra ?? {}) }
  }, [stats, metricsExtra])
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'communities' | 'metrics' | 'content_review' | 'blocked_users' | 'steve_feedback' | 'steve_profiling' | 'network_profiling'>('overview')
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'premium' | 'free'>('all')
  const [userSortBy, setUserSortBy] = useState<'name' | 'date'>('name')
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteCommunityId, setInviteCommunityId] = useState<number | null>(null)
  const [inviteCommunityName, setInviteCommunityName] = useState<string>('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)
  const [qrCodeUrl, setQRCodeUrl] = useState('')
  const [inviteScope, setInviteScope] = useState<'parent-only' | 'all-nested' | 'selected-nested'>('parent-only')
  const [inviteNestedOptions, setInviteNestedOptions] = useState<NestedCommunityOption[]>([])
  const [inviteParentOptions, setInviteParentOptions] = useState<SimpleCommunityOption[]>([])
  const [inviteSelectedNestedIds, setInviteSelectedNestedIds] = useState<number[]>([])
  const [inviteSelectedParentIds, setInviteSelectedParentIds] = useState<number[]>([])
  const [inviteNestedDropdownOpen, setInviteNestedDropdownOpen] = useState(false)
  const [welcomeCards, setWelcomeCards] = useState<string[]>(['', '', ''])
  const [welcomeStatus, setWelcomeStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [onboardingVideo, setOnboardingVideo] = useState<string | null>(null)
  const [onboardingVideoStatus, setOnboardingVideoStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [onboardingVideoUploading, setOnboardingVideoUploading] = useState(false)
  const [welcomeUploadingIndex, setWelcomeUploadingIndex] = useState<number | null>(null)
  const [welcomeError, setWelcomeError] = useState<string>('')
  const [welcomeMessage, setWelcomeMessage] = useState<string>('')

  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [broadcastTitle, setBroadcastTitle] = useState('')
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastLink, setBroadcastLink] = useState('')
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [broadcastSuccess, setBroadcastSuccess] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)

  // Add-to-community modal state
  const [showAddToCommunityModal, setShowAddToCommunityModal] = useState(false)
  const [addToCommunityId, setAddToCommunityId] = useState<number | null>(null)
  const [addToCommunityUsername, setAddToCommunityUsername] = useState('')
  const [addToCommunityLoading, setAddToCommunityLoading] = useState(false)
  const [addToCommunityError, setAddToCommunityError] = useState('')
  const [addToCommunitySuccess, setAddToCommunitySuccess] = useState(false)

  // Content Review state
  type ReportedPost = {
    report_id: number
    post_id: number
    reporter_username: string
    reason: string
    details?: string
    status: string
    reviewed_by?: string
    reviewed_at?: string
    reported_at: string
    post_author: string
    post_content: string
    image_path?: string
    video_path?: string
    post_timestamp: string
    community_id?: number
    community_name?: string
    report_count: number
  }
  const [reportedPosts, setReportedPosts] = useState<ReportedPost[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportsFilter, setReportsFilter] = useState<'pending' | 'reviewed' | 'dismissed' | 'all'>('pending')

  // Blocked users state
  type BlockedUserEntry = {
    id: number
    blocker_username: string
    blocked_username: string
    reason: string | null
    blocked_at: string
    blocker_picture: string | null
    blocked_picture: string | null
  }
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserEntry[]>([])
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(false)
  const [unblockingId, setUnblockingId] = useState<number | null>(null)

  // Steve Feedback Queue state
  type SteveFeedbackItem = {
    id: number
    created_at: string
    submitted_by: string
    type: string
    severity: string
    status: string
    title: string
    summary?: string | null
    raw_user_message?: string | null
    steve_summary?: string | null
    surface?: string | null
    community_id?: number | null
    admin_notes?: string | null
  }
  const [steveFeedbackItems, setSteveFeedbackItems] = useState<SteveFeedbackItem[]>([])
  const [steveFeedbackLoading, setSteveFeedbackLoading] = useState(false)
  const [steveFeedbackFilter, setSteveFeedbackFilter] = useState<'all' | 'new' | 'triaged' | 'planned' | 'in_progress' | 'resolved' | 'closed'>('new')
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null)
  const [feedbackNote, setFeedbackNote] = useState('')

  // Steve Profiles state (Phase 0)
  interface SteveProfile {
    username: string
    display_name?: string
    analysis: {
      _schemaVersion?: number
      summary?: string
      analysisDepth?: string
      dataQuality?: string
      identity?: { roles?: string[]; drivingForces?: string; bridgeInsight?: string } | null
      professional?: {
        company?: { name?: string; description?: string; sector?: string; stage?: string } | null
        role?: { title?: string; seniority?: string; function?: string; implication?: string } | null
        careerHistory?: { company?: string; role?: string; period?: string; duration?: string; highlight?: string }[]
        education?: string | null
        location?: { city?: string; country?: string; context?: string } | null
        webFindings?: string
        publications?: { source?: string; date?: string; insight?: string; relevance?: string }[]
      } | null
      personal?: {
        verifiedLinks?: { platform: string; url: string; notes?: string; verifiedBy?: string; verifiedAt?: string }[]
        socialProfiles?: { platform?: string; url?: string; handle?: string }[]
        interests?: string[]
        lifestyle?: string
        webFindings?: string
        publicPosts?: { source?: string; date?: string; insight?: string; relevance?: string }[]
      } | null
      interests?: Record<string, { score: number; source?: string; type?: string }>
      traits?: string[]
      observations?: string
      networkingValue?: string | null
      /** Content ingestion / access issues (e.g. failed article fetch, no transcript) */
      notes?: string
      conversationStarters?: string[]
      _feedback?: Record<string, any>
      _userReview?: { status: 'pending' | 'confirmed' | 'edited' | 'disputed'; at?: string; notes?: string }
    }
    lastUpdated?: string
    /** URLs fetched for enrichment (articles, YouTube, audio) on last standard/deep run */
    profilingExternalSources?: {
      updatedAt?: string
      items?: Array<{ url: string; kind: string; postDate?: string; success: boolean; detail?: string }>
    } | null
  }
  const [steveProfiles, setSteveProfiles] = useState<SteveProfile[]>([])
  const [steveProfilesLoading, setSteveProfilesLoading] = useState(false)
  const [analyzingUser, setAnalyzingUser] = useState<string | null>(null)
  const [selectedProfileUsername, setSelectedProfileUsername] = useState<string>('')
  const [profileSearchQuery, setProfileSearchQuery] = useState('')
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentUser: '' })
  const batchAbortRef = useRef(false)

  // Steve profile editing
  const [editingSteveProfile, setEditingSteveProfile] = useState<string | null>(null)
  const [editSection, setEditSection] = useState<'professional' | 'personal' | 'links' | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editExperiences, setEditExperiences] = useState<Array<{ company: string; title: string; dates: string; description: string }>>([])
  const [editVerifiedLinks, setEditVerifiedLinks] = useState<Array<{ platform: string; url: string; notes?: string }>>([])

  // Network Profiling state
  const [networkSearchQuery, setNetworkSearchQuery] = useState('')
  const [selectedNetworkId, setSelectedNetworkId] = useState<number | null>(null)
  const [synthesizingNetworkId, setSynthesizingNetworkId] = useState<number | null>(null)


  // New user form
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    subscription: 'free'
  })

  useEffect(() => {
    if (inviteNestedOptions.length === 0 && inviteScope === 'selected-nested') {
      setInviteScope('parent-only')
    }
  }, [inviteNestedOptions, inviteScope])

  useEffect(() => {
    if (inviteScope !== 'selected-nested') {
      setInviteNestedDropdownOpen(false)
    }
  }, [inviteScope])

  const checkAdminAccess = async () => {
    try {
      const response = await fetch('/api/check_admin', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const data = await response.json()
      if (!data.is_admin) {
        navigate('/')
      }
    } catch (error) {
      console.error('Error checking admin access:', error)
      navigate('/')
    }
  }

  const loadAdminData = async () => {
    setLoading(true)
    setMetricsExtra(null)
    setMetricsError(null)
    try {
      const response = await fetch('/api/admin/dashboard', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const data = await response.json()

      if (data.success) {
        setStats(data.stats)
        setUsers(data.users)
        setCommunities(data.communities)
      }
    } catch (error) {
      console.error('Error loading admin data:', error)
    } finally {
      setLoading(false)
    }
  }


  const loadWelcomeCards = useCallback(async () => {
    setWelcomeStatus('loading')
    try {
      // Add cache-buster to prevent browser caching
      const response = await fetch(`/welcome_cards?_t=${Date.now()}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      })
      const data = await response.json()
      if (data?.success && Array.isArray(data.cards)) {
        setWelcomeCards(data.cards)
        setWelcomeStatus('success')
        setWelcomeError('')
      } else {
        setWelcomeCards(['', '', ''])
        setWelcomeStatus('error')
        setWelcomeError(data?.error || 'Failed to load welcome images')
      }
    } catch (error) {
      console.error('Error loading welcome cards:', error)
      setWelcomeCards(['', '', ''])
      setWelcomeStatus('error')
      setWelcomeError('Failed to load welcome images')
    }
  }, [])

  const loadOnboardingWelcomeVideo = useCallback(async () => {
    setOnboardingVideoStatus('loading')
    try {
      const response = await fetch('/admin/get_onboarding_welcome_video', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      })
      const data = await response.json()
      if (data?.success) {
        setOnboardingVideo(data.video_url || null)
        setOnboardingVideoStatus('success')
      } else {
        setOnboardingVideoStatus('error')
      }
    } catch (error) {
      console.error('Error loading onboarding welcome video:', error)
      setOnboardingVideoStatus('error')
    }
  }, [])

  const validateOnboardingVideoDuration = (file: File): Promise<void> => new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    const cleanup = () => URL.revokeObjectURL(objectUrl)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      cleanup()
      if (duration > 15.5) {
        reject(new Error('Keep the onboarding welcome video to 15 seconds or less.'))
        return
      }
      resolve()
    }
    video.onerror = () => {
      cleanup()
      reject(new Error('Could not read this video. Please upload a valid MP4 or WebM file.'))
    }
    video.src = objectUrl
  })

  const handleOnboardingVideoUpload = async (file: File) => {
    const hasAllowedType = ['video/mp4', 'video/webm'].includes(file.type)
    const hasAllowedExtension = /\.(mp4|webm)$/i.test(file.name)
    if (!hasAllowedType && !hasAllowedExtension) {
      alert('Use an MP4 or WebM video.')
      return
    }
    setOnboardingVideoUploading(true)
    try {
      await validateOnboardingVideoDuration(file)
      const formData = new FormData()
      formData.append('video', file)

      const response = await fetch('/admin/upload_onboarding_welcome_video', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })
      const data = await response.json()
      if (data?.success) {
        setOnboardingVideo(data.video_url || null)
        setOnboardingVideoStatus('success')
      } else {
        alert(data?.error || 'Failed to upload onboarding welcome video')
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Server error while uploading video')
    } finally {
      setOnboardingVideoUploading(false)
    }
  }

  const handleRemoveOnboardingVideo = async () => {
    if (!confirm('Remove the onboarding welcome video?')) return

    try {
      const response = await fetch('/admin/remove_onboarding_welcome_video', {
        method: 'POST',
        credentials: 'include'
      })
      const data = await response.json()
      if (data?.success) {
        setOnboardingVideo(null)
        setOnboardingVideoStatus('success')
      } else {
        alert(data?.error || 'Failed to remove onboarding welcome video')
      }
    } catch (error) {
      console.error('Error removing onboarding welcome video:', error)
      alert('Server error while removing video')
    }
  }

  const loadReportedPosts = useCallback(async (status: string = 'pending') => {
    setReportsLoading(true)
    try {
      const response = await fetch(`/api/admin/reported_posts?status=${status}`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
      const data = await response.json()
      if (data?.success) {
        setReportedPosts(data.reports || [])
      } else {
        setReportedPosts([])
      }
    } catch (error) {
      console.error('Error loading reported posts:', error)
      setReportedPosts([])
    } finally {
      setReportsLoading(false)
    }
  }, [])

  const loadBlockedUsers = useCallback(async () => {
    setBlockedUsersLoading(true)
    try {
      const response = await fetch('/api/admin/all_blocked_users', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
      const data = await response.json()
      if (data?.success) {
        setBlockedUsers(data.blocked_users || [])
      } else {
        setBlockedUsers([])
      }
    } catch (error) {
      console.error('Error loading blocked users:', error)
      setBlockedUsers([])
    } finally {
      setBlockedUsersLoading(false)
    }
  }, [])

  const loadSteveFeedback = useCallback(async () => {
    setSteveFeedbackLoading(true)
    try {
      const qs = new URLSearchParams()
      if (steveFeedbackFilter !== 'all') qs.set('status', steveFeedbackFilter)
      const response = await fetch(`/api/admin/steve_feedback?${qs.toString()}`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      })
      const data = await response.json()
      if (data?.success) {
        setSteveFeedbackItems(data.items || [])
        if (!selectedFeedbackId && data.items?.length) {
          setSelectedFeedbackId(data.items[0].id)
        }
      } else {
        setSteveFeedbackItems([])
      }
    } catch (error) {
      console.error('Error loading Steve feedback:', error)
      setSteveFeedbackItems([])
    } finally {
      setSteveFeedbackLoading(false)
    }
  }, [steveFeedbackFilter, selectedFeedbackId])

  const updateSteveFeedback = useCallback(async (feedbackId: number, body: Record<string, unknown>) => {
    const response = await fetch(`/api/admin/steve_feedback/${feedbackId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!data?.success) {
      alert(data?.error || 'Could not update feedback item')
      return
    }
    setSteveFeedbackItems(prev => prev.map(item => item.id === feedbackId ? data.item : item))
  }, [])

  const addSteveFeedbackNote = useCallback(async () => {
    if (!selectedFeedbackId || !feedbackNote.trim()) return
    const response = await fetch(`/api/admin/steve_feedback/${selectedFeedbackId}/notes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: feedbackNote.trim() }),
    })
    const data = await response.json()
    if (!data?.success) {
      alert(data?.error || 'Could not add note')
      return
    }
    setFeedbackNote('')
    setSteveFeedbackItems(prev => prev.map(item => item.id === selectedFeedbackId ? data.item : item))
  }, [selectedFeedbackId, feedbackNote])

  const sendFeedbackClosureReceipt = useCallback(async (feedbackId: number) => {
    const response = await fetch(`/api/admin/steve_feedback/${feedbackId}/closure_receipt`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await response.json()
    if (!data?.success) {
      alert(data?.error || 'Could not send closure receipt')
      return
    }
    alert('Closure receipt sent by Steve.')
  }, [])

  const loadSteveProfiles = useCallback(async () => {
    setSteveProfilesLoading(true)
    try {
      const response = await fetch('/api/admin/steve_profiles', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
      const data = await response.json()
      if (data?.success) {
        setSteveProfiles(data.profiles || [])
      } else {
        setSteveProfiles([])
        console.error('Failed to load Steve profiles:', data?.error)
      }
    } catch (error) {
      console.error('Error loading Steve profiles:', error)
      setSteveProfiles([])
    } finally {
      setSteveProfilesLoading(false)
    }
  }, [])

  const [networkSynthesisStatus, setNetworkSynthesisStatus] = useState<{ id: number; status: 'ok' | 'error'; message: string } | null>(null)

  const synthesizeNetworkKB = useCallback(async (communityId: number) => {
    setSynthesizingNetworkId(communityId)
    setNetworkSynthesisStatus(null)
    try {
      const resp = await fetch(`/api/admin/knowledge_base/network/${communityId}/synthesize`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await resp.json()
      if (data.success) {
        setNetworkSynthesisStatus({
          id: communityId,
          status: 'ok',
          message: data.message || `Network KB synthesized for community ${communityId}`
        })
        // Auto-refresh data after successful synthesis
        setTimeout(() => loadAdminData(), 800)
      } else {
        setNetworkSynthesisStatus({
          id: communityId,
          status: 'error',
          message: data.error || 'Synthesis failed'
        })
      }
    } catch (err) {
      console.error('Network synthesis error:', err)
      setNetworkSynthesisStatus({
        id: communityId,
        status: 'error',
        message: 'Request failed \u2014 check server logs'
      })
    } finally {
      setSynthesizingNetworkId(null)
    }
  }, [loadAdminData])

  const [batchDepth, setBatchDepth] = useState<'quick' | 'standard' | 'deep'>('quick')
  /** Used when depth is Deep \u2014 clamped server-side between env floor and ceiling. */
  const [adminDeepMaxOutputTokens, setAdminDeepMaxOutputTokens] = useState(4000)

  const analyzeUser = useCallback(async (targetUsername: string, depth: 'quick' | 'standard' | 'deep' = 'standard', reset = false) => {
    if (reset && !confirm(`This will discard existing data and run a fresh analysis for @${targetUsername}. Continue?`)) return
    setAnalyzingUser(targetUsername)
    try {
      const body: Record<string, unknown> = { depth, reset }
      if (depth === 'deep') {
        body.max_output_tokens = adminDeepMaxOutputTokens
      }
      const response = await fetch(`/api/admin/steve_profiles/${encodeURIComponent(targetUsername)}/analyze`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await response.json()
      if (data?.success && data.analysis) {
        setSteveProfiles(prev => prev.map(p =>
          p.username === targetUsername
            ? {
                ...p,
                analysis: data.analysis,
                lastUpdated: new Date().toISOString(),
                profilingExternalSources: data.profilingExternalSources ?? p.profilingExternalSources,
              }
            : p
        ))
      } else {
        console.error('Analyze failed:', data?.error)
      }
    } catch (error) {
      console.error('Error analyzing user:', error)
    } finally {
      setAnalyzingUser(null)
    }
  }, [adminDeepMaxOutputTokens])

  const analyzeAllProfiles = useCallback(async (onlyNew = false) => {
    const targets = onlyNew ? steveProfiles.filter(p => !p.analysis?.summary) : steveProfiles
    if (targets.length === 0) return
    batchAbortRef.current = false
    setBatchRunning(true)
    setBatchProgress({ current: 0, total: targets.length, currentUser: '' })
    for (let i = 0; i < targets.length; i++) {
      if (batchAbortRef.current) break
      const u = targets[i]
      setBatchProgress({ current: i + 1, total: targets.length, currentUser: u.username })
      try {
        const batchBody: Record<string, unknown> = { depth: batchDepth }
        if (batchDepth === 'deep') {
          batchBody.max_output_tokens = adminDeepMaxOutputTokens
        }
        const res = await fetch(`/api/admin/steve_profiles/${encodeURIComponent(u.username)}/analyze`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchBody)
        })
        const data = await res.json()
        if (data?.success && data.analysis) {
          setSteveProfiles(prev => prev.map(p =>
            p.username === u.username
              ? {
                  ...p,
                  analysis: data.analysis,
                  lastUpdated: new Date().toISOString(),
                  profilingExternalSources: data.profilingExternalSources ?? p.profilingExternalSources,
                }
              : p
          ))
        }
      } catch {}
    }
    setBatchRunning(false)
    setBatchProgress({ current: 0, total: 0, currentUser: '' })
  }, [steveProfiles, batchDepth, adminDeepMaxOutputTokens])

  const [kbBatchRunning, setKbBatchRunning] = useState(false)
  const [kbBatchProgress, setKbBatchProgress] = useState({ current: 0, total: 0, currentUser: '', skipped: 0 })
  /** new_only: skip members who already have any KB note; all: POST synthesize for everyone */
  const [kbSynthesizeMode, setKbSynthesizeMode] = useState<'new_only' | 'all'>('new_only')

  const synthesizeAllKBs = useCallback(async () => {
    const targets = steveProfiles.filter(p => p.analysis?.summary)
    if (targets.length === 0) return
    const skipExisting = kbSynthesizeMode === 'new_only'
    batchAbortRef.current = false
    setKbBatchRunning(true)
    setKbBatchProgress({ current: 0, total: targets.length, currentUser: '', skipped: 0 })
    let skipped = 0

    for (let i = 0; i < targets.length; i++) {
      if (batchAbortRef.current) break
      const u = targets[i]
      setKbBatchProgress({ current: i + 1, total: targets.length, currentUser: u.username, skipped })

      try {
        if (skipExisting) {
          const checkResp = await fetch(`/api/admin/knowledge_base/${encodeURIComponent(u.username)}`, { credentials: 'include' })
          const checkData = await checkResp.json()
          if (checkData.success && Object.keys(checkData.knowledge || {}).length > 0) {
            skipped++
            setKbBatchProgress(prev => ({ ...prev, skipped }))
            continue
          }
        }

        await fetch(`/api/admin/knowledge_base/${encodeURIComponent(u.username)}/synthesize`, {
          method: 'POST',
          credentials: 'include',
        })
      } catch (err) {
        console.error(`KB synthesis failed for ${u.username}:`, err)
      }
    }

    setKbBatchRunning(false)
    setKbBatchProgress({ current: 0, total: 0, currentUser: '', skipped: 0 })
  }, [steveProfiles, kbSynthesizeMode])

  const clearProfile = useCallback(async (targetUsername: string) => {
    if (!confirm(`Clear all AI analysis for @${targetUsername}?`)) return
    try {
      const res = await fetch(`/api/admin/steve_profiles/${encodeURIComponent(targetUsername)}/analysis`, {
        method: 'DELETE', credentials: 'include'
      })
      const data = await res.json()
      if (data?.success) {
        setSteveProfiles(prev => prev.map(p =>
          p.username === targetUsername ? { ...p, analysis: {} as any, lastUpdated: new Date().toISOString() } : p
        ))
      }
    } catch {}
  }, [])

  const flagWrongPerson = useCallback(async (targetUsername: string) => {
    if (!confirm(
      `Flag @${targetUsername}'s profile as WRONG PERSON?\n\n` +
      `This will:\n` +
      `\u2022 Record the current (incorrect) data as anti-target\n` +
      `\u2022 Clear the analysis\n` +
      `\u2022 Future analyses will avoid matching this wrong identity\n\n` +
      `Use this when Steve consistently pulls data about a different person with the same name.`
    )) return
    try {
      const res = await fetch(`/api/admin/steve_profiles/${encodeURIComponent(targetUsername)}/wrong_person`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const data = await res.json()
      if (data?.success) {
        setSteveProfiles(prev => prev.map(p =>
          p.username === targetUsername ? {
            ...p,
            analysis: {
              _feedback: { wrongPerson: data.wrongData },
              _schemaVersion: 3,
              summary: '',
              identity: {},
              professional: {},
              personal: {},
              interests: {},
              traits: [],
              observations: '',
              networkingValue: '',
              conversationStarters: [],
              dataQuality: 'sparse',
              analysisDepth: 'quick'
            } as any,
            lastUpdated: new Date().toISOString()
          } : p
        ))
      }
    } catch {}
  }, [])

  const submitFeedback = useCallback(async (targetUsername: string, section: string, status: 'approved' | 'rejected') => {
    try {
      const res = await fetch(`/api/admin/steve_profiles/${encodeURIComponent(targetUsername)}/feedback`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, status })
      })
      const data = await res.json()
      if (data?.success && data.feedback) {
        setSteveProfiles(prev => prev.map(p =>
          p.username === targetUsername
            ? { ...p, analysis: { ...p.analysis, _feedback: data.feedback } }
            : p
        ))
      }
    } catch {}
  }, [])

  const parseEndDate = (dates: string): number => {
    if (!dates || dates.toLowerCase() === 'unknown') return -Infinity
    const lower = dates.toLowerCase()
    if (lower.includes('present') || lower.includes('current') || lower.includes('now')) return Infinity

    // Try to extract the end date (after hyphen, en dash, or em dash)
    const parts = dates.split(/\s*[-\u2013\u2014]\s*/)
    const endPart = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).trim()

    // Try full date like "Dec 2024"
    const monthYear = endPart.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{4})/i)
    if (monthYear) {
      const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
      const m = endPart.slice(0, 3).toLowerCase()
      return new Date(parseInt(monthYear[1]), months[m] || 0).getTime()
    }
    // Try just a year like "2022"
    const yearMatch = endPart.match(/(\d{4})/)
    if (yearMatch) return new Date(parseInt(yearMatch[1]), 11).getTime()
    return -Infinity
  }

  const sortExperiencesByDate = (exps: typeof editExperiences) =>
    [...exps].sort((a, b) => parseEndDate(b.dates) - parseEndDate(a.dates))

  const openSteveEditModal = (username: string, section: 'professional' | 'personal' | 'links') => {
    const profile = steveProfiles.find(p => p.username === username)
    setEditingSteveProfile(username)
    setEditSection(section)

    if (section === 'professional') {
      const pro = profile?.analysis?.professional || {}
      const existingCareer = (pro.careerHistory || []).map((e: any) => ({
        company: e?.company || '',
        title: e?.role || e?.title || '',
        dates: e?.period || e?.dates || '',
        description: e?.highlight || e?.description || '',
      }))
      setEditExperiences(existingCareer.length > 0 ? sortExperiencesByDate(existingCareer) : [{ company: '', title: '', dates: '', description: '' }])
      setEditContent('')
    } else if (section === 'links') {
      const personal = (profile?.analysis?.personal || {}) as any
      setEditVerifiedLinks(personal.verifiedLinks || [])
      setEditContent('')
      setEditExperiences([])
    } else {
      const personal = (profile?.analysis?.personal || {}) as any
      setEditContent(personal.manualContext || '')
      setEditExperiences([])
      setEditVerifiedLinks([])
    }
  }

  const saveSteveEdit = async () => {
    if (!editingSteveProfile || !editSection) return

    try {
      let payloadContent: any

      if (editSection === 'professional') {
        const validExperiences = sortExperiencesByDate(editExperiences.filter(e => e.company.trim() || e.title.trim()))
        if (validExperiences.length === 0) return
        payloadContent = { experiences: validExperiences }
      } else if (editSection === 'links') {
        payloadContent = { verifiedLinks: editVerifiedLinks.filter(l => l.url.trim()) }
      } else {
        if (!editContent.trim()) return
        payloadContent = editContent.trim()
      }

      const res = await fetch(`/api/admin/steve_profiles/${encodeURIComponent(editingSteveProfile)}/edit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: editSection,
          content: payloadContent,
          type: 'manualEdits'
        })
      })
      const data = await res.json()

      if (data.success) {
        setSteveProfiles(prev => prev.map(p =>
          p.username === editingSteveProfile
            ? { ...p, analysis: data.analysis }
            : p
        ))
        setEditingSteveProfile(null)
        setEditSection(null)
        setEditContent('')
        setEditExperiences([])
        setEditVerifiedLinks([])
      } else {
        alert(`Failed to save: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Failed to save Steve edit:', err)
      alert('Failed to save edit')
    }
  }

  const handleAdminUnblock = async (blockId: number) => {
    setUnblockingId(blockId)
    try {
      const response = await fetch('/api/admin/unblock_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ block_id: blockId })
      })
      const data = await response.json()
      if (data?.success) {
        setBlockedUsers(prev => prev.filter(b => b.id !== blockId))
      } else {
        alert(data?.error || 'Failed to unblock')
      }
    } catch (error) {
      alert('Network error')
    } finally {
      setUnblockingId(null)
    }
  }

  const handleReviewReport = async (reportId: number, action: 'dismiss' | 'reviewed') => {
    try {
      const response = await fetch('/api/admin/review_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ report_id: reportId, action })
      })
      const data = await response.json()
      if (data?.success) {
        loadReportedPosts(reportsFilter)
      } else {
        alert(data?.error || 'Failed to review report')
      }
    } catch (error) {
      console.error('Error reviewing report:', error)
      alert('Error reviewing report')
    }
  }

  const handleDeleteReportedPost = async (postId: number) => {
    if (!confirm('Are you sure you want to delete this post? This cannot be undone.')) return
    try {
      const response = await fetch('/api/admin/delete_reported_post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ post_id: postId })
      })
      const data = await response.json()
      if (data?.success) {
        alert('Post deleted successfully')
        loadReportedPosts(reportsFilter)
      } else {
        alert(data?.error || 'Failed to delete post')
      }
    } catch (error) {
      console.error('Error deleting post:', error)
      alert('Error deleting post')
    }
  }

  const handleWelcomeCardUpload = async (cardIndex: number, file: File) => {
    setWelcomeUploadingIndex(cardIndex)
    setWelcomeError('')
    setWelcomeMessage('')
    const formData = new FormData()
    formData.append('index', String(cardIndex + 1))
    formData.append('image', file)
    try {
      const response = await fetch('/admin/upload_welcome_card', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })
      const data = await response.json()
      if (data?.success) {
        setWelcomeMessage(`Card ${cardIndex + 1} updated successfully`)
        loadWelcomeCards()
        window.setTimeout(() => setWelcomeMessage(''), 4000)
      } else {
        setWelcomeError(data?.error || 'Failed to upload image')
      }
    } catch (error) {
      console.error('Error uploading welcome image:', error)
      setWelcomeError('Server error while uploading image')
    } finally {
      setWelcomeUploadingIndex(null)
    }
  }

  useEffect(() => {
    setTitle('Admin Dashboard')
    checkAdminAccess()
    loadAdminData()
    loadWelcomeCards()
    loadOnboardingWelcomeVideo()
  }, [setTitle, loadWelcomeCards, loadOnboardingWelcomeVideo])

  useEffect(() => {
    if (activeTab !== 'metrics' || !stats) return
    let cancelled = false
    setMetricsLoading(true)
    setMetricsError(null)
    setMetricsExtra(null)
    fetch('/api/admin/metrics', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && data.success && data.stats) {
          setMetricsExtra(data.stats)
          setMetricsError(null)
        } else {
          setMetricsExtra(null)
          const msg =
            typeof data.error === 'string'
              ? data.error
              : !res.ok
                ? `Could not load metrics (HTTP ${res.status})`
                : 'Could not load metrics'
          setMetricsError(msg)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMetricsExtra(null)
          setMetricsError('Network error \u2014 could not reach the server')
        }
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, stats])

  // Load reported posts when content_review tab is active
  useEffect(() => {
    if (activeTab === 'content_review') {
      loadReportedPosts(reportsFilter)
    }
  }, [activeTab, reportsFilter, loadReportedPosts])

  // Load blocked users when blocked_users tab is active
  useEffect(() => {
    if (activeTab === 'blocked_users') {
      loadBlockedUsers()
    }
  }, [activeTab, loadBlockedUsers])

  useEffect(() => {
    if (activeTab === 'steve_feedback') {
      loadSteveFeedback()
    }
  }, [activeTab, loadSteveFeedback])

  // Scroll to top when switching tabs
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeTab])

  // Load Steve profiles when steve_profiling tab is active
  useEffect(() => {
    if (activeTab === 'steve_profiling') {
      loadSteveProfiles()
    }
  }, [activeTab])

  // Check URL for tab parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab === 'content_review') {
      setActiveTab('content_review')
    } else if (tab === 'blocked_users') {
      setActiveTab('blocked_users')
    } else if (tab === 'steve_feedback') {
      setActiveTab('steve_feedback')
    } else if (tab === 'steve_profiling') {
      setActiveTab('steve_profiling')
    } else if (tab === 'network_profiling') {
      setActiveTab('network_profiling')
    }
  }, [])



  const resetInviteSelections = () => {
    setInviteCommunityId(null)
    setInviteCommunityName('')
    setInviteEmail('')
    setInviteError('')
    setInviteSuccess(false)
    setInviteScope('parent-only')
    setInviteNestedOptions([])
    setInviteSelectedNestedIds([])
    setInviteParentOptions([])
    setInviteSelectedParentIds([])
    setShowQRCode(false)
    setQRCodeUrl('')
  }

  const resetBroadcastForm = () => {
    setBroadcastTitle('')
    setBroadcastMessage('')
    setBroadcastLink('')
    setBroadcastError(null)
    setBroadcastSuccess(null)
    setBroadcastSending(false)
  }

  const handleBroadcastSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (broadcastSending) return
    if (!broadcastTitle.trim() && !broadcastMessage.trim()) {
      setBroadcastError('Please enter a title or message.')
      return
    }
    setBroadcastSending(true)
    setBroadcastError(null)
    setBroadcastSuccess(null)
    try {
      const response = await fetch('/api/admin/broadcast_notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: broadcastTitle.trim(),
          message: broadcastMessage.trim(),
          link: broadcastLink.trim()
        })
      })
      const data = await response.json()
      if (response.ok && data?.success) {
        setBroadcastSuccess(`Notification sent to ${data.notified ?? 0} users.`)
        setBroadcastMessage('')
        setBroadcastTitle('')
        setBroadcastLink('')
        window.setTimeout(() => {
          setShowBroadcastModal(false)
          resetBroadcastForm()
        }, 1800)
      } else {
        setBroadcastError(data?.error || 'Failed to send notification.')
      }
    } catch (error) {
      console.error('Error sending broadcast notification:', error)
      setBroadcastError('Server error while sending notification.')
    } finally {
      setBroadcastSending(false)
    }
  }

  const handleCloseInviteModal = () => {
    resetInviteSelections()
    setShowInviteModal(false)
  }

  const buildInvitePayload = (base: Record<string, unknown> = {}) => {
    if (!inviteCommunityId) return base
    const payload: Record<string, unknown> = {
      community_id: inviteCommunityId,
      invite_scope: inviteScope,
      ...base
    }

    if (inviteNestedOptions.length > 0) {
      if (inviteScope === 'all-nested') {
        payload.include_nested_ids = inviteNestedOptions.map(option => option.id)
      } else if (inviteScope === 'selected-nested') {
        payload.include_nested_ids = inviteSelectedNestedIds
      }
    }

    if (inviteParentOptions.length > 0) {
      payload.include_parent_ids = inviteSelectedParentIds
    }

    return payload
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/admin/add_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newUser)
      })
      
      const data = await response.json()
      if (data.success) {
        setShowAddUserModal(false)
        setNewUser({ username: '', password: '', subscription: 'free' })
        loadAdminData()
      } else {
        alert(data.error || 'Failed to add user')
      }
    } catch (error) {
      console.error('Error adding user:', error)
      alert('Failed to add user')
    }
  }

  const handleUserUpdate = async (username: string, updates: Partial<User>) => {
    try {
      const response = await fetch('/api/admin/update_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, ...updates })
      })
      
      const data = await response.json()
      if (data.success) {
        loadAdminData()
      }
    } catch (error) {
      console.error('Error updating user:', error)
    }
  }

  const [deleteUserModal, setDeleteUserModal] = useState<{username: string} | null>(null)
  const [deletePreserveData, setDeletePreserveData] = useState(false)

  const handleDeleteUser = async (username: string) => {
    // Show modal instead of immediate confirm
    setDeleteUserModal({ username })
    setDeletePreserveData(false)
  }

  const confirmDeleteUser = async () => {
    if (!deleteUserModal) return
    const { username } = deleteUserModal
    
    try {
      const response = await fetch('/api/admin/delete_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          username,
          preserve_data: deletePreserveData
        })
      })
      
      const data = await response.json()
      if (data.success) {
        setDeleteUserModal(null)
        loadAdminData()
      } else {
        alert(data.error || 'Failed to delete user')
      }
    } catch (error) {
      console.error('Error deleting user:', error)
      alert('Error deleting user')
    }
  }

  const handleAddToCommunity = async () => {
    if (!addToCommunityId || !addToCommunityUsername.trim()) return
    setAddToCommunityLoading(true)
    setAddToCommunityError('')
    setAddToCommunitySuccess(false)
    try {
      const body = new URLSearchParams({
        community_id: String(addToCommunityId),
        username: addToCommunityUsername.trim(),
      })
      const res = await fetch('/add_community_member', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const data = await res.json()
      if (data.success) {
        setAddToCommunitySuccess(true)
        setAddToCommunityUsername('')
        loadAdminData()
      } else {
        setAddToCommunityError(data.error || 'Failed to add user')
      }
    } catch {
      setAddToCommunityError('Network error')
    } finally {
      setAddToCommunityLoading(false)
    }
  }

  const handleInviteUser = (communityId: number, communityName: string) => {
    setInviteCommunityId(communityId)
    setInviteCommunityName(communityName)
    setInviteEmail('')
    setInviteError('')
    setInviteSuccess(false)
    setInviteScope('parent-only')
    setShowQRCode(false)

    const nestedOptions = getNestedOptions(communityId)
    setInviteNestedOptions(nestedOptions)
    setInviteSelectedNestedIds([])
    setInviteNestedDropdownOpen(false)

    const parentChain = getParentChain(communityId)
    const parentOptions = parentChain.map<SimpleCommunityOption>((parent) => ({
      id: parent.id,
      name: parent.name
    }))
    setInviteParentOptions(parentOptions)
    setInviteSelectedParentIds(parentOptions.map((option) => option.id))

    setShowInviteModal(true)
  }

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) {
      setInviteError('Email is required')
      return
    }
    if (!inviteCommunityId) {
      setInviteError('No community selected for invitation')
      return
    }
    if (inviteScope === 'selected-nested' && inviteSelectedNestedIds.length === 0) {
      setInviteError('Select at least one nested community')
      return
    }

    setInviteLoading(true)
    setInviteError('')
    setInviteSuccess(false)

    try {
      const payload = buildInvitePayload({ email: inviteEmail.trim() })
      const response = await fetch('/api/community/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setInviteSuccess(true)
        setInviteEmail('')
        setTimeout(() => {
          handleCloseInviteModal()
        }, 2000)
      } else {
        setInviteError(data.error || 'Failed to send invitation')
      }
    } catch (error) {
      console.error('Error sending invitation:', error)
      setInviteError('Failed to send invitation')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleGenerateQR = async () => {
    if (!inviteCommunityId) {
      setInviteError('No community selected for invitation')
      return
    }
    if (inviteScope === 'selected-nested' && inviteSelectedNestedIds.length === 0) {
      setInviteError('Select at least one nested community')
      return
    }

    setInviteLoading(true)
    setInviteError('')
    
    try {
      const payload = buildInvitePayload()
      const response = await fetch('/api/community/invite_link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setQRCodeUrl(data.invite_url)
        setShowQRCode(true)
      } else {
        setInviteError(data.error || 'Failed to generate QR code')
      }
    } catch (error) {
      console.error('Error generating QR code:', error)
      setInviteError('Failed to generate QR code')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleDeleteCommunity = async (communityId: number) => {
    if (!confirm('Are you sure you want to delete this community?')) return
    
    try {
      const response = await fetch('/api/admin/delete_community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ community_id: communityId })
      })
      
      const data = await response.json()
      if (data.success) {
        // Clear all community-related caches
        clearDeviceCache(`community-feed:${communityId}`)
        invalidateDashboardCache()
        // Clear community management caches
        const storage = window.localStorage
        if (storage) {
          const keysToRemove: string[] = []
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i)
            if (key && (key.startsWith('community-management:') || key.startsWith('community-feed:'))) {
              keysToRemove.push(key)
            }
          }
          keysToRemove.forEach(key => storage.removeItem(key))
        }
        await triggerDashboardServerPull()
        alert('Community deleted successfully.')
        await loadAdminData()
      } else {
        alert(data.error || 'Failed to delete community.')
      }
    } catch (error) {
      console.error('Error deleting community:', error)
      alert('Failed to delete community. Please try again.')
    }
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.username.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filterType === 'all' || 
      (filterType === 'premium' && user.subscription === 'premium') ||
      (filterType === 'free' && user.subscription === 'free')
    return matchesSearch && matchesFilter
  }).sort((a, b) => {
    if (userSortBy === 'date') {
      const da = a.created_at ? new Date(a.created_at).getTime() : 0
      const db = b.created_at ? new Date(b.created_at).getTime() : 0
      return db - da
    }
    return a.username.localeCompare(b.username)
  })

  const filteredCommunities = communities.filter(community => {
    const q = searchQuery.toLowerCase()
    const name = (community.name || '').toLowerCase()
    const type = (community.type || '').toLowerCase()
    const creator = (community.creator_username || '').toLowerCase()
    return name.includes(q) || type.includes(q) || creator.includes(q)
  })
  const filteredFlatCommunities = flatCommunities.filter(c => {
    const q = searchQuery.toLowerCase()
    const name = (c.name || '').toLowerCase()
    const type = (c.type || '').toLowerCase()
    const creator = (c.creator_username || '').toLowerCase()
    return name.includes(q) || type.includes(q) || creator.includes(q)
  })

  const selectedFeedbackItem = steveFeedbackItems.find(item => item.id === selectedFeedbackId) || null

  if (loading) {
    return (
      <div className="min-h-screen bg-c-bg-app text-c-text-primary flex items-center justify-center">
        <div className="text-xl">Loading admin dashboard...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary lg:ml-64">
      {/* Secondary nav like Communities page */}
      <div
        className="fixed left-0 lg:left-64 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-4xl mx-auto h-full flex overflow-x-auto scrollbar-hide">
          {([
            ['overview', 'Overview'],
            ['users', 'Users'],
            ['communities', 'Communities'],
            ['metrics', 'Metrics'],
            ['content_review', 'Reports'],
            ['blocked_users', 'Blocks'],
            ['steve_feedback', 'Steve Feedback'],
            ['steve_profiling', 'Steve Profiling'],
            ['network_profiling', 'Network Profiling'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`flex-shrink-0 px-3 text-center text-sm font-medium ${
                activeTab === key ? 'text-c-text-secondary' : 'text-c-text-tertiary hover:text-c-text-secondary'
              }`}
            >
              <div className="pt-2 whitespace-nowrap">{label}</div>
              <div className={`h-0.5 ${activeTab === key ? 'bg-cpoint-turquoise' : 'bg-transparent'} rounded-full w-12 mx-auto mt-1`} />
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        className="app-subnav-offset max-w-4xl mx-auto pb-6 px-3 overflow-y-auto no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
          '--app-subnav-height': '40px',
        } as CSSProperties}
      >
        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-4">
              {/* Onboarding Welcome Video */}
              <div className="bg-c-hover-bg backdrop-blur rounded-xl p-6 border border-c-border">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-cpoint-turquoise">Onboarding Welcome Video</h3>
                    <p className="text-xs text-c-text-tertiary mt-1">
                      This appears on the first post-login onboarding welcome screen. Use MP4 or WebM, 15 seconds max.
                    </p>
                  </div>
                  <div className="text-xs text-c-text-tertiary">
                    {onboardingVideoStatus === 'loading' && <span className="text-c-text-tertiary">Loading\u2026</span>}
                    {onboardingVideoStatus === 'success' && <span className="text-cpoint-turquoise">Up to date</span>}
                    {onboardingVideoStatus === 'error' && <span className="text-red-400">Failed to load</span>}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <div className="w-full sm:w-72 aspect-video rounded-xl overflow-hidden border border-c-border bg-c-hover-bg flex items-center justify-center flex-shrink-0">
                    {onboardingVideoStatus === 'loading' ? (
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    ) : onboardingVideo ? (
                      <video
                        src={onboardingVideo}
                        className="w-full h-full object-contain"
                        controls
                        preload="metadata"
                      />
                    ) : (
                      <div className="text-xs text-c-text-tertiary text-center px-4">No onboarding video configured</div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="px-4 py-2 bg-cpoint-turquoise text-black rounded-lg text-sm font-medium cursor-pointer hover:bg-cpoint-turquoise/90 transition-colors text-center">
                      {onboardingVideoUploading ? 'Uploading...' : 'Upload Video'}
                      <input
                        type="file"
                        accept="video/mp4,video/webm"
                        hidden
                        disabled={onboardingVideoUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) {
                            handleOnboardingVideoUpload(file)
                          }
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {onboardingVideo && (
                      <button
                        onClick={handleRemoveOnboardingVideo}
                        className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
                      >
                        Remove Video
                      </button>
                    )}
                    <p className="text-xs text-c-text-tertiary max-w-sm">
                      The welcome screen still works without a video. The Start onboarding button is always visible immediately.
                    </p>
                  </div>
                </div>
              </div>

              {/* Welcome Cards Management */}
              <div className="bg-c-hover-bg backdrop-blur rounded-xl p-6 border border-c-border">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-cpoint-turquoise">Welcome Page Cards</h3>
                    <p className="text-xs text-c-text-tertiary mt-1">
                      These three images appear on the public welcome page carousel. Use square or wide images (recommended 1920{'\u00D7'}1080).
                    </p>
                  </div>
                  <div className="text-xs text-c-text-tertiary">
                    {welcomeStatus === 'loading' && <span className="text-c-text-tertiary">Loading\u2026</span>}
                    {welcomeStatus === 'success' && <span className="text-cpoint-turquoise">Up to date</span>}
                    {welcomeStatus === 'error' && <span className="text-red-400">Failed to load</span>}
                  </div>
                </div>

                {welcomeMessage && (
                  <div className="mb-3 rounded-lg border border-cpoint-turquoise/40 bg-cpoint-turquoise/10 px-3 py-2 text-xs text-[#7fe7df]">
                    {welcomeMessage}
                  </div>
                )}
                {welcomeError && (
                  <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {welcomeError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[0, 1, 2].map((index) => {
                    const cardUrl = welcomeCards[index]
                    const inputId = `welcome-card-input-${index}`
                    return (
                      <div key={index} className="bg-c-hover-bg border border-c-border rounded-xl p-3 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-c-text-secondary">Card {index + 1}</div>
                          {cardUrl ? (
                            <a
                              href={cardUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-cpoint-turquoise hover:text-[#7fe7df]"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="text-xs text-c-text-tertiary">Using default</span>
                          )}
                        </div>

                        <div className="aspect-video rounded-lg overflow-hidden border border-c-border bg-c-hover-bg flex items-center justify-center">
                          {welcomeStatus === 'loading' && !cardUrl ? (
                            <div className="flex flex-col items-center gap-2 text-c-text-tertiary text-xs">
                              <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                              Loading\u2026
                            </div>
                          ) : cardUrl ? (
                            <img
                              src={cardUrl}
                              alt={`Welcome card ${index + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="text-xs text-c-text-tertiary px-4 text-center">
                              No image uploaded yet.
                            </div>
                          )}
                        </div>

                        <input
                          id={inputId}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) {
                              handleWelcomeCardUpload(index, file)
                            }
                            event.target.value = ''
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById(inputId) as HTMLInputElement | null
                            el?.click()
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-c-active-bg border border-white/20 text-sm text-c-text-secondary hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={welcomeUploadingIndex === index}
                        >
                          {welcomeUploadingIndex === index ? 'Uploading\u2026' : cardUrl ? 'Replace image' : 'Upload image'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

            {/* Key Metrics removed from overview; available in Metrics tab */}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                <div className="text-2xl font-bold text-cpoint-turquoise">{stats.total_users}</div>
                <div className="text-xs text-c-text-tertiary mt-1">Total Users</div>
              </div>
              <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                <div className="text-2xl font-bold text-cpoint-turquoise">{stats.premium_users}</div>
                <div className="text-xs text-c-text-tertiary mt-1">Premium Users</div>
              </div>
              <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                <div className="text-2xl font-bold text-cpoint-turquoise">{stats.total_communities}</div>
                <div className="text-xs text-c-text-tertiary mt-1">Communities</div>
              </div>
              <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                <div className="text-2xl font-bold text-cpoint-turquoise">{stats.total_posts}</div>
                <div className="text-xs text-c-text-tertiary mt-1">Total Posts</div>
              </div>
            </div>

            {/* Latest Activity */}
            <div className="grid grid-cols-1 gap-3">
              {stats.last_user && (
                <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                  <div className="text-xs text-c-text-tertiary mb-1">Last User Created</div>
                  <div className="text-sm font-semibold text-cpoint-turquoise">{stats.last_user.username}</div>
                  {stats.last_user.created_at && (
                    <div className="text-[11px] text-c-text-tertiary mt-0.5">{new Date(stats.last_user.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  )}
                </div>
              )}
              {stats.last_community && (
                <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                  <div className="text-xs text-c-text-tertiary mb-1">Last Community Created</div>
                  <div className="text-sm font-semibold text-cpoint-turquoise">{stats.last_community.name}</div>
                </div>
              )}
            </div>

            {/* Parent Communities section removed per request */}

            {/* Quick Actions */}
              <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button 
                    onClick={() => { setActiveTab('users'); setShowAddUserModal(true) }}
                    className="py-2 px-3 bg-cpoint-turquoise/20 text-cpoint-turquoise rounded-lg text-sm font-medium hover:bg-cpoint-turquoise/30 transition-colors"
                  >
                    Add New User
                  </button>
                  <button
                    onClick={() => {
                      setAddToCommunityId(flatCommunities[0]?.id ?? null)
                      setAddToCommunityUsername('')
                      setAddToCommunityError('')
                      setAddToCommunitySuccess(false)
                      setShowAddToCommunityModal(true)
                    }}
                    className="py-2 px-3 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-500/30 transition-colors"
                  >
                    Add to Community
                  </button>
                  <button 
                    onClick={() => navigate('/premium_dashboard')}
                    className="py-2 px-3 bg-cpoint-turquoise/20 text-cpoint-turquoise rounded-lg text-sm font-medium hover:bg-cpoint-turquoise/30 transition-colors"
                  >
                    Create Community
                  </button>
                  <button
                    onClick={() => {
                      resetBroadcastForm()
                      setShowBroadcastModal(true)
                    }}
                    className="py-2 px-3 bg-cpoint-turquoise/20 text-cpoint-turquoise rounded-lg text-sm font-medium hover:bg-cpoint-turquoise/30 transition-colors"
                  >
                    Broadcast Notification
                  </button>
                </div>
              </div>
          </div>
        )}

        {/* Metrics Tab */}
        {activeTab === 'metrics' && metricsViewStats && (
          <div className="relative space-y-4 min-h-[24rem]">
            {metricsLoading && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-xl bg-[#0a1214]/90 backdrop-blur-sm border border-c-border px-6 py-12"
                role="status"
                aria-live="polite"
              >
                <i className="fa-solid fa-spinner fa-spin text-3xl text-cpoint-turquoise" aria-hidden />
                <div className="text-center max-w-md">
                  <p className="text-base font-semibold text-white">Calculating usage metrics</p>
                  <p className="text-sm text-white/65 mt-2 leading-relaxed">
                    DAU, MAU, cohorts, and leaderboards are computed on the server. On large databases this can take up
                    to a minute {'\u2014'} please wait.
                  </p>
                </div>
              </div>
            )}
            {metricsError && !metricsLoading && (
              <div
                className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                role="alert"
              >
                {metricsError}
              </div>
            )}
            <div
              className={`space-y-4 transition-opacity ${metricsLoading ? 'opacity-35 pointer-events-none select-none' : ''}`}
            >
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-6 border border-c-border">
              <h3 className="text-lg font-semibold mb-3 text-cpoint-turquoise">Key Metrics</h3>
              <div
                className="mb-4 rounded-lg border border-c-border bg-white/[0.03] px-4 py-3 text-sm text-c-text-secondary leading-relaxed space-y-2"
                role="region"
                aria-label="DAU and MAU definitions"
              >
                <p className="font-medium text-white/85">How DAU and MAU are counted</p>
                <p>
                  Both use <span className="text-c-text-secondary">distinct usernames</span> with at least one qualifying{' '}
                  <span className="text-c-text-secondary">in-app activity</span> in the time window {'\u2014'} not login history alone,
                  and not simply opening the app unless that visit produces an event below.
                </p>
                <ul className="list-disc pl-5 space-y-1 text-white/65">
                  <li>
                    <span className="text-c-text-secondary">DAU:</span> any qualifying activity from{' '}
                    <span className="text-c-text-secondary">midnight today</span> (server date) through now.
                  </li>
                  <li>
                    <span className="text-c-text-secondary">MAU:</span> any qualifying activity in the{' '}
                    <span className="text-c-text-secondary">rolling 30 days</span> ending at the start of today.
                  </li>
                </ul>
                <p className="text-white/65">
                  <span className="text-c-text-secondary">Activity includes</span> (union {'\u2014'} one is enough): posts, reactions,
                  poll votes, opening a community feed (visit row), and sending DMs/messages.{' '}
                  <span className="text-c-text-secondary">Login history alone does not count.</span>
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-c-hover-bg rounded-lg p-3 border border-c-border">
                  <div className="text-xs text-c-text-tertiary">DAU</div>
                  <div className="text-xl font-bold">{metricsViewStats.dau ?? '\u2014'}</div>
                  <div className="text-xs text-c-text-tertiary">{metricsViewStats.dau_pct != null ? `${metricsViewStats.dau_pct}% of users` : ''}</div>
                </div>
                <div className="bg-c-hover-bg rounded-lg p-3 border border-c-border">
                  <div className="text-xs text-c-text-tertiary">MAU</div>
                  <div className="text-xl font-bold">{metricsViewStats.mau ?? '\u2014'}</div>
                  <div className="text-xs text-c-text-tertiary">{metricsViewStats.mau_pct != null ? `${metricsViewStats.mau_pct}% of users` : ''}</div>
                </div>
                <div className="bg-c-hover-bg rounded-lg p-3 border border-c-border">
                  <div className="text-xs text-c-text-tertiary">Total Users</div>
                  <div className="text-xl font-bold">{metricsViewStats.total_users}</div>
                </div>
                <div className="bg-c-hover-bg rounded-lg p-3 border border-c-border">
                  <div className="text-xs text-c-text-tertiary">Total Communities</div>
                  <div className="text-xl font-bold">{metricsViewStats.total_communities}</div>
                </div>
                <div className="bg-c-hover-bg rounded-lg p-3 border border-c-border">
                  <div className="text-xs text-c-text-tertiary">Avg DAU (30d)</div>
                  <div className="text-xl font-bold">{metricsViewStats.avg_dau_30 ?? '\u2014'}</div>
                  <div className="text-xs text-c-text-tertiary">daily avg</div>
                </div>
              </div>
            </div>

            {/* Returning Users */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-c-hover-bg rounded-lg p-4 border border-c-border">
                <div className="text-sm font-semibold mb-1">Monthly Returning Users</div>
                <div className="text-xs text-c-text-tertiary mb-2">Previous month âˆ© current month</div>
                <div className="flex items-end gap-4">
                  <div>
                    <div className="text-[11px] text-c-text-tertiary">MRU</div>
                    <div className="text-xl font-bold">{metricsViewStats.mru ?? '\u2014'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-c-text-tertiary">MAU (month)</div>
                    <div className="text-xl font-bold">{metricsViewStats.mau_month ?? '\u2014'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-c-text-tertiary">Repeat rate</div>
                    <div className="text-xl font-bold">{metricsViewStats.mru_repeat_rate_pct != null ? `${metricsViewStats.mru_repeat_rate_pct}%` : '\u2014'}</div>
                  </div>
                </div>
              </div>
              <div className="bg-c-hover-bg rounded-lg p-4 border border-c-border">
                <div className="text-sm font-semibold mb-1">Weekly Returning Users</div>
                <div className="text-xs text-c-text-tertiary mb-2">Previous week âˆ© current week</div>
                <div className="flex items-end gap-4">
                  <div>
                    <div className="text-[11px] text-c-text-tertiary">WRU</div>
                    <div className="text-xl font-bold">{metricsViewStats.wru ?? '\u2014'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-c-text-tertiary">WAU</div>
                    <div className="text-xl font-bold">{metricsViewStats.wau ?? '\u2014'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-c-text-tertiary">Repeat rate</div>
                    <div className="text-xl font-bold">{metricsViewStats.wru_repeat_rate_pct != null ? `${metricsViewStats.wru_repeat_rate_pct}%` : '\u2014'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cohort Retention removed per request */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-c-hover-bg rounded-lg p-4 border border-c-border">
                <div className="text-sm font-semibold mb-2">Top Posters</div>
                <div className="space-y-1 text-sm">
                  {metricsViewStats.leaderboards?.top_posters?.length ? metricsViewStats.leaderboards.top_posters.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-c-text-secondary">{i+1}. {u.username}</span>
                      <span className="text-c-text-tertiary">{u.count}</span>
                    </div>
                  )) : <div className="text-c-text-tertiary">No data</div>}
                </div>
              </div>
              <div className="bg-c-hover-bg rounded-lg p-4 border border-c-border">
                <div className="text-sm font-semibold mb-2">Top Reactors</div>
                <div className="space-y-1 text-sm">
                  {metricsViewStats.leaderboards?.top_reactors?.length ? metricsViewStats.leaderboards.top_reactors.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-c-text-secondary">{i+1}. {u.username}</span>
                      <span className="text-c-text-tertiary">{u.count}</span>
                    </div>
                  )) : <div className="text-c-text-tertiary">No data</div>}
                </div>
              </div>
              <div className="bg-c-hover-bg rounded-lg p-4 border border-c-border">
                <div className="text-sm font-semibold mb-2">Top Voters</div>
                <div className="space-y-1 text-sm">
                  {metricsViewStats.leaderboards?.top_voters?.length ? metricsViewStats.leaderboards.top_voters.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-c-text-secondary">{i+1}. {u.username}</span>
                      <span className="text-c-text-tertiary">{u.count}</span>
                    </div>
                  )) : <div className="text-c-text-tertiary">No data</div>}
                </div>
              </div>
            </div>
            </div>
          </div>
        )}
        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-3">
            {/* Search and Filter Bar */}
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-3 border border-c-border flex items-center gap-2">
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-c-hover-bg border border-c-border rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
              />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="bg-c-hover-bg border border-c-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cpoint-turquoise"
              >
                <option value="all">All</option>
                <option value="premium">Premium</option>
                <option value="free">Free</option>
              </select>
              <button
                onClick={() => setUserSortBy(prev => prev === 'name' ? 'date' : 'name')}
                className="px-3 py-1.5 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white hover:bg-c-hover-bg flex items-center gap-1"
              >
                <i className={`fa-solid ${userSortBy === 'date' ? 'fa-calendar' : 'fa-arrow-down-a-z'} text-xs`} />
                {userSortBy === 'date' ? 'Date' : 'A-Z'}
              </button>
              <button
                onClick={() => setShowAddUserModal(true)}
                className="px-3 py-1.5 bg-cpoint-turquoise text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Add User
              </button>
            </div>

            {/* Users List */}
            <div className="space-y-2">
              {filteredUsers.map(user => (
                <div key={user.username} className="bg-c-hover-bg backdrop-blur rounded-xl p-3 border border-c-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-cpoint-turquoise rounded-full flex items-center justify-center text-xs font-bold text-black">
                        {user.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{user.username}</div>
                        <div className="text-xs text-c-text-tertiary flex flex-wrap items-center gap-1">
                          {user.subscription === 'premium' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-cpoint-turquoise/20 text-cpoint-turquoise font-medium">
                              PREMIUM
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-c-active-bg text-c-text-tertiary">
                              FREE
                            </span>
                          )}
                          {user.is_admin && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                              ADMIN
                            </span>
                          )}
                        </div>
                        {user.created_at && (
                          <div className="text-[10px] text-white/30 mt-0.5">
                            Joined {new Date(user.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleUserUpdate(user.username, { 
                          subscription: user.subscription === 'premium' ? 'free' : 'premium' 
                        })}
                        className="px-2 py-1 text-xs rounded-lg bg-c-hover-bg border border-c-border hover:bg-c-hover-bg"
                      >
                        {user.subscription === 'premium' ? 'Downgrade' : 'Upgrade'}
                      </button>
                      {user.username !== 'admin' && (
                        <button
                          onClick={() => handleDeleteUser(user.username)}
                          className="px-2 py-1 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Communities Tab */}
        {activeTab === 'communities' && (
          <div className="space-y-3">
            {/* Search Bar */}
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-3 border border-c-border flex items-center gap-2">
              <input
                type="text"
                placeholder="Search communities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-c-hover-bg border border-c-border rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
              />
              <button
                onClick={() => navigate('/premium_dashboard')}
                className="px-3 py-1.5 bg-cpoint-turquoise text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Create New
              </button>
            </div>

            {/* Communities List - Show parent communities with their children */}
            <div className="space-y-3">
              {filteredCommunities.filter(c => !c.parent_community_id).map(community => (
                <div key={community.id} className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold text-sm">{community.name}</h3>
                      <p className="text-xs text-c-text-tertiary">{community.type}</p>
                    </div>
                    <span className="text-xs bg-cpoint-turquoise/20 text-cpoint-turquoise px-2 py-1 rounded">
                      {community.member_count} members
                    </span>
                  </div>
                  <div className="text-xs text-c-text-tertiary mb-3">
                    <div>Creator: {community.creator_username}</div>
                    <div>Code: {community.join_code}</div>
                  </div>
                  
                  {/* Show child communities if any */}
                  {community.children && community.children.length > 0 && (
                    <div className="mb-3 p-2 bg-c-hover-bg rounded-lg">
                      <p className="text-xs text-c-text-tertiary mb-2">Sub-communities:</p>
                      <div className="space-y-2">
                        {community.children.map(child => (
                          <div key={child.id} className="flex justify-between items-center">
                            <div className="text-xs">
                              <span className="text-c-text-secondary">{'\u2022 '}{child.name}</span>
                              <span className="text-c-text-tertiary ml-2">({child.type})</span>
                            </div>
                            <div className="flex gap-1">
                              <span className="text-xs text-c-text-tertiary">{child.member_count} members</span>
                              <button
                                onClick={() => {
                                  setAddToCommunityId(child.id)
                                  setAddToCommunityUsername('')
                                  setAddToCommunityError('')
                                  setAddToCommunitySuccess(false)
                                  setShowAddToCommunityModal(true)
                                }}
                                className="px-2 py-0.5 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded hover:bg-blue-500/20"
                              >
                                Add User
                              </button>
                              <button
                                onClick={() => navigate(`/community_feed_react/${child.id}`)}
                                className="px-2 py-0.5 text-xs bg-c-hover-bg border border-c-border rounded hover:bg-c-hover-bg"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setAddToCommunityId(community.id)
                        setAddToCommunityUsername('')
                        setAddToCommunityError('')
                        setAddToCommunitySuccess(false)
                        setShowAddToCommunityModal(true)
                      }}
                      className="px-2 py-1 text-xs rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20"
                    >
                      Add User
                    </button>
                    <button
                      onClick={() => handleInviteUser(community.id, community.name)}
                      className="px-2 py-1 text-xs rounded-lg bg-cpoint-turquoise/10 border border-cpoint-turquoise/20 text-cpoint-turquoise hover:bg-cpoint-turquoise/20"
                    >
                      Invite
                    </button>
                    <button
                      onClick={() => navigate(`/community_feed_react/${community.id}`)}
                      className="flex-1 py-1 text-xs bg-c-hover-bg border border-c-border rounded-lg hover:bg-c-hover-bg"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleDeleteCommunity(community.id)}
                      className="px-2 py-1 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Flat list of all communities with delete */}
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-2 text-c-text-secondary">All Communities (flat list)</h4>
              <div className="space-y-2">
                {filteredFlatCommunities.map(c => (
                  <div key={c.id} className="flex items-center justify-between bg-c-hover-bg rounded-lg p-2 border border-c-border">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-cpoint-turquoise/30 text-cpoint-turquoise rounded flex items-center justify-center text-[10px] font-bold">
                        {c.name.substring(0,2).toUpperCase()}
                      </div>
                      <div className="text-xs">
                        <div className="text-c-text-secondary font-medium">{c.name}</div>
                        <div className="text-c-text-tertiary">{c.type}{c.parent_community_id ? ` \u2014 child of ${c.parent_community_id}` : ' \u2014 parent'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/community_feed_react/${c.id}`)}
                        className="px-2 py-1 text-xs bg-c-hover-bg border border-c-border rounded hover:bg-c-hover-bg"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDeleteCommunity(c.id)}
                        className="px-2 py-1 text-xs rounded bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Content Review Tab */}
        {activeTab === 'content_review' && (
          <div className="space-y-4">
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-cpoint-turquoise">Reported Posts</h3>
                <select
                  value={reportsFilter}
                  onChange={(e) => setReportsFilter(e.target.value as any)}
                  className="bg-c-hover-bg border border-c-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cpoint-turquoise"
                >
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="dismissed">Dismissed</option>
                  <option value="all">All</option>
                </select>
              </div>

              {reportsLoading ? (
                <div className="text-center py-8 text-c-text-tertiary">Loading reports...</div>
              ) : reportedPosts.length === 0 ? (
                <div className="text-center py-8 text-c-text-tertiary">
                  <i className="fa-solid fa-check-circle text-2xl mb-2 text-green-400" />
                  <div>No {reportsFilter === 'all' ? '' : reportsFilter} reports</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {reportedPosts.map(report => (
                    <div key={report.report_id} className="bg-c-hover-bg border border-c-border rounded-xl p-4">
                      {/* Report Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            report.status === 'pending' ? 'bg-orange-500/20 text-orange-400' :
                            report.status === 'reviewed' ? 'bg-green-500/20 text-green-400' :
                            'bg-c-active-bg text-c-text-tertiary'
                          }`}>
                            {report.status.toUpperCase()}
                          </div>
                          <span className="text-xs text-c-text-tertiary">
                            {report.report_count} report{report.report_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="text-xs text-c-text-tertiary">
                          {new Date(report.reported_at).toLocaleDateString()}
                        </div>
                      </div>

                      {/* Report Reason */}
                      <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <div className="text-sm font-medium text-red-400 mb-1">
                          <i className="fa-solid fa-flag mr-2" />
                          {report.reason}
                        </div>
                        {report.details && (
                          <div className="text-xs text-c-text-tertiary">{report.details}</div>
                        )}
                        <div className="text-[11px] text-c-text-tertiary mt-1">
                          Reported by: @{report.reporter_username}
                        </div>
                      </div>

                      {/* Post Preview */}
                      <div className="border border-c-border rounded-lg p-3 mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-6 h-6 bg-cpoint-turquoise/30 rounded-full flex items-center justify-center text-[10px] font-bold text-cpoint-turquoise">
                            {report.post_author[0]?.toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-c-text-secondary">@{report.post_author}</span>
                          {report.community_name && (
                            <span className="text-xs text-cpoint-turquoise">in {report.community_name}</span>
                          )}
                        </div>
                        <div className="text-sm text-c-text-secondary line-clamp-3">{report.post_content}</div>
                        {(report.image_path || report.video_path) && (
                          <div className="mt-2 text-xs text-c-text-tertiary">
                            <i className={`fa-solid ${report.video_path ? 'fa-video' : 'fa-image'} mr-1`} />
                            Has media attachment
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {report.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigate(`/post/${report.post_id}`)}
                            className="flex-1 py-2 text-xs rounded-lg bg-c-hover-bg border border-c-border hover:bg-c-hover-bg"
                          >
                            View Post
                          </button>
                          <button
                            onClick={() => handleReviewReport(report.report_id, 'dismiss')}
                            className="flex-1 py-2 text-xs rounded-lg bg-c-active-bg border border-white/20 hover:bg-white/15"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => handleDeleteReportedPost(report.post_id)}
                            className="flex-1 py-2 text-xs rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30"
                          >
                            Delete Post
                          </button>
                        </div>
                      )}
                      {report.status !== 'pending' && report.reviewed_by && (
                        <div className="text-xs text-c-text-tertiary">
                          {report.status === 'dismissed' ? 'Dismissed' : 'Reviewed'} by @{report.reviewed_by}
                          {report.reviewed_at && ` on ${new Date(report.reviewed_at).toLocaleDateString()}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Blocked Users Tab */}
        {activeTab === 'blocked_users' && (
          <div className="space-y-4">
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-cpoint-turquoise">
                  <i className="fa-solid fa-ban mr-2" />
                  Blocked Users
                </h3>
                <button
                  onClick={loadBlockedUsers}
                  className="text-xs text-cpoint-turquoise hover:underline"
                >
                  <i className="fa-solid fa-refresh mr-1" />
                  Refresh
                </button>
              </div>

              {blockedUsersLoading ? (
                <div className="text-center py-8 text-c-text-tertiary">Loading blocked users...</div>
              ) : blockedUsers.length === 0 ? (
                <div className="text-center py-8 text-c-text-tertiary">
                  <i className="fa-solid fa-check-circle text-2xl mb-2 text-green-400" />
                  <div>No blocked users</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {blockedUsers.map(block => (
                    <div key={block.id} className="bg-c-hover-bg border border-c-border rounded-xl p-4">
                      {/* Block Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {/* Blocker */}
                          <div className="flex items-center gap-2">
                            {block.blocker_picture ? (
                              <img 
                                src={block.blocker_picture} 
                                alt="" 
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-8 h-8 bg-cpoint-turquoise/30 rounded-full flex items-center justify-center text-xs font-bold text-cpoint-turquoise">
                                {block.blocker_username[0]?.toUpperCase()}
                              </div>
                            )}
                            <span className="text-sm font-medium text-c-text-secondary">@{block.blocker_username}</span>
                          </div>

                          <i className="fa-solid fa-arrow-right text-red-400 text-sm" />

                          {/* Blocked */}
                          <div className="flex items-center gap-2">
                            {block.blocked_picture ? (
                              <img 
                                src={block.blocked_picture} 
                                alt="" 
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-8 h-8 bg-red-500/30 rounded-full flex items-center justify-center text-xs font-bold text-red-400">
                                {block.blocked_username[0]?.toUpperCase()}
                              </div>
                            )}
                            <span className="text-sm font-medium text-c-text-secondary">@{block.blocked_username}</span>
                          </div>
                        </div>

                        <div className="text-xs text-c-text-tertiary">
                          {new Date(block.blocked_at).toLocaleDateString()}
                        </div>
                      </div>

                      {/* Block Reason */}
                      {block.reason && (
                        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                          <div className="text-sm text-c-text-secondary">
                            <i className="fa-solid fa-quote-left mr-2 text-xs text-red-400/60" />
                            {block.reason}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => navigate(`/profile/${block.blocker_username}`)}
                          className="flex-1 py-2 text-xs rounded-lg bg-c-hover-bg border border-c-border hover:bg-c-hover-bg"
                        >
                          View @{block.blocker_username}
                        </button>
                        <button
                          onClick={() => navigate(`/profile/${block.blocked_username}`)}
                          className="flex-1 py-2 text-xs rounded-lg bg-c-hover-bg border border-c-border hover:bg-c-hover-bg"
                        >
                          View @{block.blocked_username}
                        </button>
                        <button
                          onClick={() => handleAdminUnblock(block.id)}
                          disabled={unblockingId === block.id}
                          className="flex-1 py-2 text-xs rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30 disabled:opacity-50"
                        >
                          {unblockingId === block.id ? 'Unblocking...' : 'Unblock'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Steve Feedback Queue Tab */}
        {activeTab === 'steve_feedback' && (
          <div className="space-y-4">
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-4 border border-c-border">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-cpoint-turquoise">
                    <i className="fa-solid fa-inbox mr-2" />
                    Steve Feedback Queue
                  </h3>
                  <p className="text-xs text-c-text-tertiary mt-1">Bugs, feature ideas, complaints, and product feedback submitted through Steve.</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={steveFeedbackFilter}
                    onChange={(e) => setSteveFeedbackFilter(e.target.value as typeof steveFeedbackFilter)}
                    className="bg-c-hover-bg border border-c-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cpoint-turquoise"
                  >
                    {['all', 'new', 'triaged', 'planned', 'in_progress', 'resolved', 'closed'].map(status => (
                      <option key={status} value={status}>{status.replace('_', ' ')}</option>
                    ))}
                  </select>
                  <button onClick={loadSteveFeedback} className="px-3 py-1.5 rounded-lg bg-c-hover-bg border border-c-border hover:bg-c-hover-bg text-sm">
                    Refresh
                  </button>
                </div>
              </div>

              {steveFeedbackLoading ? (
                <div className="text-center py-8 text-c-text-tertiary">Loading Steve feedback...</div>
              ) : steveFeedbackItems.length === 0 ? (
                <div className="text-center py-8 text-c-text-tertiary">
                  <i className="fa-solid fa-check-circle text-2xl mb-2 text-green-400" />
                  <div>No feedback items for this filter</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {steveFeedbackItems.map(item => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedFeedbackId(item.id)}
                        className={`w-full text-left p-3 rounded-xl border transition-colors ${
                          selectedFeedbackId === item.id ? 'bg-cpoint-turquoise/10 border-cpoint-turquoise/40' : 'bg-c-hover-bg border-c-border hover:bg-c-hover-bg'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="font-medium text-c-text-secondary truncate">{item.title}</div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            item.severity === 'critical' ? 'text-red-300 border-red-400/40 bg-red-500/10' :
                            item.severity === 'high' ? 'text-orange-300 border-orange-400/40 bg-orange-500/10' :
                            'text-c-text-tertiary border-c-border bg-c-hover-bg'
                          }`}>
                            {item.severity}
                          </span>
                        </div>
                        <div className="text-xs text-c-text-tertiary flex flex-wrap gap-2">
                          <span>{item.type.replace('_', ' ')}</span>
                          <span>{'\u2022'}</span>
                          <span>{item.status.replace('_', ' ')}</span>
                          <span>{'\u2022'}</span>
                          <span>@{item.submitted_by}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="bg-c-hover-bg border border-c-border rounded-xl p-4 min-h-[320px]">
                    {selectedFeedbackItem ? (
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs text-c-text-tertiary mb-1">#{selectedFeedbackItem.id}{' \u2022 '}{new Date(selectedFeedbackItem.created_at).toLocaleString()}</div>
                          <h4 className="text-white font-semibold">{selectedFeedbackItem.title}</h4>
                          <div className="text-xs text-c-text-tertiary mt-1">@{selectedFeedbackItem.submitted_by} via {selectedFeedbackItem.surface || 'steve_dm'}</div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={selectedFeedbackItem.status}
                            onChange={(e) => updateSteveFeedback(selectedFeedbackItem.id, { status: e.target.value })}
                            className="bg-c-hover-bg border border-c-border rounded-lg px-2 py-2 text-sm text-white"
                          >
                            {['new', 'triaged', 'planned', 'in_progress', 'resolved', 'closed'].map(status => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}
                          </select>
                          <select
                            value={selectedFeedbackItem.severity}
                            onChange={(e) => updateSteveFeedback(selectedFeedbackItem.id, { status: selectedFeedbackItem.status, severity: e.target.value })}
                            className="bg-c-hover-bg border border-c-border rounded-lg px-2 py-2 text-sm text-white"
                          >
                            {['low', 'medium', 'high', 'critical'].map(sev => <option key={sev} value={sev}>{sev}</option>)}
                          </select>
                        </div>

                        <div>
                          <div className="text-xs uppercase tracking-wide text-c-text-tertiary mb-1">Steve summary</div>
                          <div className="text-sm text-c-text-secondary whitespace-pre-wrap">{selectedFeedbackItem.steve_summary || selectedFeedbackItem.summary || 'No summary'}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-c-text-tertiary mb-1">Raw message</div>
                          <div className="text-sm text-white/65 whitespace-pre-wrap">{selectedFeedbackItem.raw_user_message || 'No raw message'}</div>
                        </div>
                        {selectedFeedbackItem.admin_notes && (
                          <div>
                            <div className="text-xs uppercase tracking-wide text-c-text-tertiary mb-1">Admin notes</div>
                            <div className="text-xs text-c-text-tertiary whitespace-pre-wrap">{selectedFeedbackItem.admin_notes}</div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <textarea
                            value={feedbackNote}
                            onChange={(e) => setFeedbackNote(e.target.value)}
                            placeholder="Add admin note..."
                            className="w-full min-h-[70px] bg-c-hover-bg border border-c-border rounded-lg px-3 py-2 text-sm text-white placeholder-white/35"
                          />
                          <div className="flex gap-2">
                            <button onClick={addSteveFeedbackNote} className="flex-1 py-2 rounded-lg bg-c-hover-bg border border-c-border hover:bg-c-hover-bg text-sm">
                              Add note
                            </button>
                            <button onClick={() => sendFeedbackClosureReceipt(selectedFeedbackItem.id)} className="flex-1 py-2 rounded-lg bg-cpoint-turquoise/20 border border-cpoint-turquoise/30 text-cpoint-turquoise hover:bg-cpoint-turquoise/30 text-sm">
                              Send receipt
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-c-text-tertiary">Select a feedback item to view details.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Steve Profiling Tab */}
        {activeTab === 'steve_profiling' && (
          <div className="space-y-4">
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-6 border border-c-border">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-cpoint-turquoise">
                    Steve Profiling
                  </h3>
                  <p className="text-xs text-c-text-tertiary mt-1">Per-user AI analysis and Knowledge Base {'\u2014'} select a user to analyze</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-c-text-tertiary">
                    {steveProfiles.filter(p => p.analysis?.summary).length}/{steveProfiles.length} analyzed
                  </span>
                  {!batchRunning && steveProfiles.length > 0 && (
                    <div className="flex items-center gap-1">
                      <select
                        value={batchDepth}
                        onChange={e => setBatchDepth(e.target.value as 'quick' | 'standard' | 'deep')}
                        className="bg-c-bg-surface border border-c-border rounded-xl text-[11px] text-c-text-secondary px-2 py-1.5 outline-none"
                      >
                        <option value="quick">Quick</option>
                        <option value="standard">Standard</option>
                        <option value="deep">Deep</option>
                      </select>
                      {batchDepth === 'deep' && (
                        <div className="flex items-center gap-1 flex-wrap" title="Max output tokens for deep runs (server clamps to configured range)">
                          <span className="text-[10px] text-c-text-tertiary">Deep tokens</span>
                          {([4000, 6000, 8000] as const).map(n => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setAdminDeepMaxOutputTokens(n)}
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${adminDeepMaxOutputTokens === n ? 'bg-cpoint-turquoise/25 border-cpoint-turquoise/40 text-cpoint-turquoise' : 'bg-c-hover-bg border-c-border text-c-text-tertiary hover:bg-c-hover-bg'}`}
                            >
                              {n}
                            </button>
                          ))}
                          <input
                            type="number"
                            min={4000}
                            max={8192}
                            step={256}
                            value={adminDeepMaxOutputTokens}
                            onChange={e => setAdminDeepMaxOutputTokens(Math.max(4000, Math.min(8192, parseInt(e.target.value, 10) || 4000)))}
                            className="w-16 bg-c-bg-surface border border-c-border rounded-lg text-[10px] text-c-text-secondary px-1 py-0.5"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => analyzeAllProfiles(false)}
                        disabled={steveProfilesLoading || batchRunning}
                        className="px-2.5 py-1 bg-cpoint-turquoise/20 border border-cpoint-turquoise/30 hover:bg-cpoint-turquoise/30 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 text-cpoint-turquoise"
                      >
                        <i className="fa-solid fa-bolt text-[10px]" />
                        Enhance All ({steveProfiles.length})
                      </button>
                      {steveProfiles.filter(p => !p.analysis?.summary).length > 0 && (
                        <button
                          onClick={() => analyzeAllProfiles(true)}
                          disabled={steveProfilesLoading || batchRunning}
                          className="px-2.5 py-1 bg-c-hover-bg border border-c-border hover:bg-c-hover-bg rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 text-c-text-tertiary"
                        >
                          New only ({steveProfiles.filter(p => !p.analysis?.summary).length})
                        </button>
                      )}
                      <select
                        value={kbSynthesizeMode}
                        onChange={e => setKbSynthesizeMode(e.target.value as 'new_only' | 'all')}
                        disabled={steveProfilesLoading || batchRunning || kbBatchRunning}
                        className="px-2 py-1 bg-c-hover-bg border border-c-border rounded-lg text-[11px] text-c-text-secondary max-w-[220px] disabled:opacity-50"
                        title="Batch KB synthesis scope"
                      >
                        <option value="new_only">Only new (no KB yet)</option>
                        <option value="all">Including existing (re-synthesize)</option>
                      </select>
                      <button
                        onClick={() => void synthesizeAllKBs()}
                        disabled={steveProfilesLoading || batchRunning || kbBatchRunning}
                        className="px-2.5 py-1 bg-purple-500/20 border border-purple-500/30 hover:bg-purple-500/30 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 text-purple-300"
                      >
                        <i className="fa-solid fa-layer-group text-[10px]" />
                        Synthesize KBs
                      </button>
                    </div>
                  )}
                  {(batchRunning || kbBatchRunning) && (
                    <button
                      onClick={() => { batchAbortRef.current = true }}
                      className="px-2.5 py-1 bg-red-500/20 border border-red-500/30 hover:bg-red-500/30 rounded-xl text-xs flex items-center gap-1.5 text-red-400"
                    >
                      <i className="fa-solid fa-stop text-[10px]" />
                      Stop
                    </button>
                  )}
                  <button
                    onClick={loadSteveProfiles}
                    disabled={steveProfilesLoading || batchRunning}
                    className="px-2.5 py-1 bg-c-hover-bg border border-c-border hover:bg-c-hover-bg rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <i className="fa-solid fa-refresh text-[10px]" />
                    {steveProfilesLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {/* Infrastructure operations */}
              <div className="mb-4 p-4 bg-white/[0.03] border border-c-border rounded-xl space-y-3">
                <div className="text-xs font-semibold text-c-text-tertiary uppercase tracking-wide">Infrastructure</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch('/api/admin/embeddings/backfill', { method: 'POST', credentials: 'include' })
                        const d = await r.json()
                        alert(d.message || JSON.stringify(d))
                      } catch { alert('Request failed') }
                    }}
                    className="px-3 py-1.5 bg-purple-500/20 border border-purple-500/30 hover:bg-purple-500/30 rounded-lg text-xs flex items-center gap-1.5 text-purple-300"
                  >
                    <i className="fa-solid fa-vector-square" />
                    Backfill Embeddings
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('Re-embed ALL profiles from KB + legacy data? This will recompute every vector.')) return
                      try {
                        const r = await fetch('/api/admin/embeddings/backfill', {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ force: true })
                        })
                        const d = await r.json()
                        alert(d.message || JSON.stringify(d))
                      } catch { alert('Request failed') }
                    }}
                    className="px-3 py-1.5 bg-orange-500/20 border border-orange-500/30 hover:bg-orange-500/30 rounded-lg text-xs flex items-center gap-1.5 text-orange-300"
                  >
                    <i className="fa-solid fa-arrows-rotate" />
                    Re-embed All (KB)
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch('/api/admin/embeddings/status', { credentials: 'include' })
                        const d = await r.json()
                        alert(`Profiles: ${d.total_profiles}\nChunked embeddings: ${d.with_chunked_embeddings}\nLegacy (single-vector): ${d.with_legacy_embedding}\nMissing any: ${d.missing_any_embedding}\nChunks: prof=${d.chunk_coverage?.professional ?? '?'} pers=${d.chunk_coverage?.personality ?? '?'} exp=${d.chunk_coverage?.experiences ?? '?'} soc=${d.chunk_coverage?.social ?? '?'}\nFAISS: ${d.faiss_index_vectors} vectors / ${d.faiss_index_users} users (ready: ${d.faiss_ready})`)
                      } catch { alert('Request failed') }
                    }}
                    className="px-3 py-1.5 bg-c-hover-bg border border-c-border hover:bg-c-hover-bg rounded-lg text-xs flex items-center gap-1.5 text-c-text-tertiary"
                  >
                    <i className="fa-solid fa-chart-bar" />
                    Embedding Status
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch('/api/admin/steve_profiles/refresh_stale', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ max_age_days: 30, batch_size: 5 }) })
                        const d = await r.json()
                        alert(d.message || JSON.stringify(d))
                      } catch { alert('Request failed') }
                    }}
                    className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 rounded-lg text-xs flex items-center gap-1.5 text-amber-300"
                  >
                    <i className="fa-solid fa-clock-rotate-left" />
                    Refresh Stale (&gt;30d)
                  </button>
                </div>
              </div>

              {batchRunning && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs text-c-text-tertiary mb-1">
                    <span>Analyzing {batchProgress.currentUser}...</span>
                    <span>{batchProgress.current}/{batchProgress.total}</span>
                  </div>
                  <div className="w-full bg-c-active-bg rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-cpoint-turquoise rounded-full transition-all duration-300"
                      style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {kbBatchRunning && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs text-purple-300/80 mb-1">
                    <span>Synthesizing KB for {kbBatchProgress.currentUser}...</span>
                    <span>{kbBatchProgress.current}/{kbBatchProgress.total} ({kbBatchProgress.skipped} skipped)</span>
                  </div>
                  <div className="w-full bg-c-active-bg rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all duration-300"
                      style={{ width: `${kbBatchProgress.total > 0 ? (kbBatchProgress.current / kbBatchProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {steveProfilesLoading ? (
                <div className="text-center py-12 text-c-text-tertiary">
                  <i className="fa-solid fa-spinner fa-spin text-2xl mb-3" />
                  <div>Analyzing user profiles...</div>
                </div>
              ) : steveProfiles.length === 0 ? (
                <div className="text-center py-8 text-c-text-tertiary">
                  <i className="fa-solid fa-user text-2xl mb-2 text-white/30" />
                  <div className="text-sm mb-1">No profiles yet</div>
                  <div className="text-xs">Click refresh to generate interest vectors</div>
                </div>
              ) : (
                <div className="flex flex-col lg:flex-row gap-4">
                  {/* Left: search + list */}
                  <div className="lg:w-64 flex-shrink-0">
                    <input
                      type="text"
                      list="user-profiles-list"
                      value={selectedProfileUsername}
                      onChange={(e) => setSelectedProfileUsername(e.target.value)}
                      placeholder="Search user..."
                      className="w-full bg-c-hover-bg border border-c-border rounded-md px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
                    />
                    <datalist id="user-profiles-list">
                      {steveProfiles.map((profile) => (
                        <option key={profile.username} value={profile.username} />
                      ))}
                    </datalist>
                    <input
                      type="text"
                      value={profileSearchQuery}
                      onChange={(e) => setProfileSearchQuery(e.target.value)}
                      placeholder="Filter..."
                      className="mt-1.5 w-full bg-c-hover-bg border border-c-border rounded-md px-3 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
                    />
                    <div className="text-[10px] text-white/30 mt-1 mb-2">{steveProfiles.length} users</div>

                    <div className="max-h-[480px] overflow-y-auto space-y-0.5">
                      {steveProfiles
                        .filter(p => !profileSearchQuery || p.username.toLowerCase().includes(profileSearchQuery.toLowerCase())
                          || (p.display_name || '').toLowerCase().includes(profileSearchQuery.toLowerCase()))
                        .map((profile) => {
                          const a = profile.analysis || {}
                          const hasAnalysis = !!a.summary
                          const topInterest = Object.entries(a.interests || {}).sort(([, x]: any, [, y]: any) => (y?.score ?? 0) - (x?.score ?? 0))[0]
                          return (
                            <button
                              key={profile.username}
                              onClick={() => setSelectedProfileUsername(profile.username)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                                selectedProfileUsername === profile.username
                                  ? 'bg-cpoint-turquoise/20 text-cpoint-turquoise border-l-2 border-cpoint-turquoise'
                                  : 'text-c-text-secondary hover:bg-c-hover-bg'
                              }`}
                            >
                              <span className="font-medium">@{profile.username}</span>
                              {hasAnalysis && topInterest ? (
                                <span className="ml-1.5 text-white/30">{topInterest[0]} {Math.round(((topInterest[1] as any)?.score ?? 0) * 100)}%</span>
                              ) : null}
                              <span className={`ml-1 text-[9px] ${hasAnalysis ? 'text-green-400/50' : 'text-white/20'}`}>
                                {hasAnalysis ? 'â—' : 'â—‹'}
                              </span>
                              {(() => {
                                const rs = a._userReview?.status;
                                if (rs === 'confirmed' || rs === 'edited') return <span className="ml-0.5 text-[8px] text-green-400" title={rs === 'edited' ? 'User edited' : 'User confirmed'}><i className="fa-solid fa-check" /></span>;
                                if (rs === 'disputed') return <span className="ml-0.5 text-[8px] text-orange-400" title="User disputed"><i className="fa-solid fa-exclamation" /></span>;
                                return null;
                              })()}
                            </button>
                          )
                        })}
                    </div>
                  </div>

                  {/* Right: detail */}
                  <div className="flex-1 min-w-0">
                    {selectedProfileUsername ? (
                      (() => {
                        const profile = steveProfiles.find(p => p.username === selectedProfileUsername);
                        if (!profile) return <div className="text-c-text-tertiary text-sm">Profile not found</div>;
                        const a = profile.analysis || {};
                        const hasAnalysis = !!a.summary;
                        const interests = a.interests || {};
                        const traits: string[] = a.traits || [];
                        const summary = a.summary || '';
                        const observations = a.observations || '';
                        const quality = a.dataQuality || 'sparse';
                        const depthLabel = a.analysisDepth || '';
                        const identity = a.identity || null;
                        const pro = a.professional || null;
                        const personal = a.personal || null;
                        const conversationStarters: string[] = a.conversationStarters || [];
                        const isAnalyzing = analyzingUser === profile.username;
                        const fb = a._feedback || {};
                        const FbBtns = ({ s }: { s: string }) => {
                          const st = fb[s]?.status;
                          return (
                            <span className="inline-flex items-center gap-0.5 ml-auto">
                              <button onClick={() => submitFeedback(profile.username, s, 'approved')}
                                className={`p-0.5 rounded transition-colors ${st === 'approved' ? 'text-green-400' : 'text-white/15 hover:text-green-400/60'}`}
                                title="Approve"><i className="fa-solid fa-thumbs-up text-[9px]" /></button>
                              <button onClick={() => submitFeedback(profile.username, s, 'rejected')}
                                className={`p-0.5 rounded transition-colors ${st === 'rejected' ? 'text-red-400' : 'text-white/15 hover:text-red-400/60'}`}
                                title="Reject"><i className="fa-solid fa-thumbs-down text-[9px]" /></button>
                            </span>
                          );
                        };

                        return (
                          <div className="space-y-4">
                            {/* Header */}
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-gradient-to-br from-cpoint-turquoise to-blue-500 rounded-lg flex items-center justify-center text-sm font-bold text-c-text-primary flex-shrink-0">
                                {profile.username[0]?.toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-lg font-semibold text-white truncate">@{profile.username}</div>
                                {profile.display_name && profile.display_name !== profile.username && (
                                  <div className="text-xs text-c-text-tertiary truncate">{profile.display_name}</div>
                                )}
                                <div className="text-[10px] text-c-text-tertiary flex items-center gap-2 mt-0.5">
                                  {hasAnalysis && (
                                    <>
                                      <span className={`${quality === 'rich' ? 'text-green-400' : quality === 'moderate' ? 'text-yellow-400' : 'text-white/30'}`}>{quality} data</span>
                                      <span>{'\u00B7'}</span>
                                      <span>{profile.lastUpdated ? new Date(profile.lastUpdated).toLocaleDateString() : '\u2014'}</span>
                                      <span>{'\u00B7'}</span>
                                      {(() => {
                                        const rs = a._userReview?.status;
                                        if (rs === 'confirmed') return <span className="text-green-400">User confirmed</span>;
                                        if (rs === 'edited') return <span className="text-green-400">User edited</span>;
                                        if (rs === 'disputed') return <span className="text-orange-400">User disputed</span>;
                                        return <span className="text-white/30">Pending review</span>;
                                      })()}
                                      <span>{'\u00B7'}</span>
                                    </>
                                  )}
                                  {!hasAnalysis && (() => {
                                    const rs = a._userReview?.status;
                                    if (rs === 'confirmed') return <><span className="text-green-400 text-[10px]">User confirmed</span><span>{'\u00B7'}</span></>;
                                    if (rs === 'edited') return <><span className="text-green-400 text-[10px]">User edited</span><span>{'\u00B7'}</span></>;
                                    if (rs === 'disputed') return <><span className="text-orange-400 text-[10px]">User disputed</span><span>{'\u00B7'}</span></>;
                                    return null;
                                  })()}
                                  <button onClick={() => navigate(`/profile/${encodeURIComponent(profile.username)}`)} className="text-blue-400 hover:text-blue-300 transition-colors">
                                    <i className="fa-solid fa-user mr-0.5" /> Profile
                                  </button>
                                  <span>{'\u00B7'}</span>
                                  <button onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(profile.username)}`)} className="text-blue-400 hover:text-blue-300 transition-colors">
                                    <i className="fa-solid fa-message mr-0.5" /> Message
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <div className="relative group">
                                  <button
                                    onClick={() => analyzeUser(profile.username, 'standard')}
                                    disabled={isAnalyzing}
                                    className="px-3 py-1.5 bg-cpoint-turquoise/10 hover:bg-cpoint-turquoise/20 border border-cpoint-turquoise/30 rounded-l-lg text-xs text-cpoint-turquoise flex items-center gap-1.5 disabled:opacity-50"
                                  >
                                    {isAnalyzing ? (
                                      <><i className="fa-solid fa-spinner fa-spin" /> Analyzing...</>
                                    ) : (
                                      <>{hasAnalysis ? 'Enhance' : 'Analyze'}</>
                                    )}
                                  </button>
                                </div>
                                <div className="relative">
                                  <button
                                    disabled={isAnalyzing}
                                    className="px-1.5 py-1.5 bg-cpoint-turquoise/10 hover:bg-cpoint-turquoise/20 border border-cpoint-turquoise/30 border-l-0 rounded-r-lg text-xs text-cpoint-turquoise disabled:opacity-50 peer"
                                  >
                                    <i className="fa-solid fa-chevron-down text-[9px]" />
                                  </button>
                                  <div className="absolute right-0 top-full mt-1 bg-c-bg-surface border border-c-border rounded-lg shadow-xl z-50 w-44 hidden peer-focus:block hover:block">
                                    {([['quick', 'Quick', 'fa-bolt'], ['standard', 'Standard', 'fa-magnifying-glass'], ['deep', 'Deep', 'fa-microscope']] as const).map(([d, label, icon]) => (
                                      <button
                                        key={d}
                                        onClick={() => analyzeUser(profile.username, d)}
                                        className="w-full px-3 py-2 text-left text-xs text-c-text-secondary hover:bg-c-hover-bg flex items-center gap-2"
                                      >
                                        <i className={`fa-solid ${icon} w-3 text-center text-cpoint-turquoise`} />
                                        {label}
                                      </button>
                                    ))}
                                    {hasAnalysis && (
                                      <>
                                        <div className="border-t border-c-border my-0.5" />
                                        <button
                                          onClick={() => analyzeUser(profile.username, 'deep', true)}
                                          className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2 rounded-b-lg"
                                        >
                                          <i className="fa-solid fa-rotate w-3 text-center" />
                                          Reset & Re-analyze
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {hasAnalysis && (
                                  <>
                                    <button
                                      onClick={() => flagWrongPerson(profile.username)}
                                      className="px-2 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-lg text-xs text-orange-400 flex items-center gap-1 ml-0.5"
                                      title="Wrong person \u2014 flag identity mismatch"
                                    >
                                      <i className="fa-solid fa-user-xmark" />
                                    </button>
                                    <button
                                      onClick={() => clearProfile(profile.username)}
                                      className="px-2 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-1 ml-0.5"
                                      title="Clear all analysis"
                                    >
                                      <i className="fa-solid fa-trash-can" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {isAnalyzing && (
                              <div className="text-center py-8 text-c-text-tertiary">
                                <i className="fa-solid fa-spinner fa-spin text-xl mb-2" />
                                <div className="text-xs">Steve is analyzing this profile...</div>
                              </div>
                            )}

                            {!isAnalyzing && !hasAnalysis && (
                              <div className="text-center py-8 text-white/30">
                                {a._feedback?.wrongPerson ? (
                                  <>
                                    <i className="fa-solid fa-user-xmark text-2xl mb-2 text-orange-400" />
                                    <div className="text-sm text-orange-300">Wrong person flagged</div>
                                    <div className="text-xs mt-1 text-c-text-tertiary">Previous identity was incorrect. Re-analyze to find the right person.</div>
                                  </>
                                ) : (
                                  <>
                                    <i className="fa-solid fa-user-magnifying-glass text-2xl mb-2" />
                                    <div className="text-sm">Not yet analyzed</div>
                                    <div className="text-xs mt-1">Click "Analyze" to run Steve's profile analysis</div>
                                  </>
                                )}
                              </div>
                            )}

                            {!isAnalyzing && hasAnalysis && (
                              <>
                                {/* Meta badges */}
                                <div className="flex items-center gap-2 flex-wrap">
                                  {depthLabel && (
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                      depthLabel === 'deep' ? 'bg-purple-500/10 text-purple-300 border-purple-500/20' :
                                      depthLabel === 'standard' ? 'bg-cpoint-turquoise/10 text-cpoint-turquoise border-cpoint-turquoise/20' :
                                      'bg-c-hover-bg text-c-text-tertiary border-c-border'
                                    }`}>
                                      <i className={`fa-solid ${depthLabel === 'deep' ? 'fa-microscope' : depthLabel === 'standard' ? 'fa-magnifying-glass' : 'fa-bolt'} mr-1`} />
                                      {depthLabel}
                                    </span>
                                  )}
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                    quality === 'rich' ? 'bg-green-500/10 text-green-300 border-green-500/20' :
                                    quality === 'moderate' ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' :
                                    'bg-c-hover-bg text-c-text-tertiary border-c-border'
                                  }`}>{quality}</span>
                                  {a._feedback?.wrongPerson && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-orange-500/10 text-orange-300 border-orange-500/20">
                                      <i className="fa-solid fa-user-xmark mr-1" />
                                      Wrong person flagged
                                    </span>
                                  )}
                                </div>

                                {/* Summary */}
                                {summary && (
                                  <div className="text-sm text-c-text-secondary leading-relaxed bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-c-border">
                                    {summary}
                                  </div>
                                )}

                                {/* Content ingestion notes (e.g. failed article/video fetch) */}
                                {a.notes && String(a.notes).trim() && (
                                  <div>
                                    <div className="text-[10px] text-amber-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                      <i className="fa-solid fa-triangle-exclamation" />
                                      Notes (content access)
                                    </div>
                                    <div className="text-xs text-amber-200/70 leading-relaxed bg-amber-500/5 rounded-lg px-3.5 py-2.5 border border-amber-500/15 whitespace-pre-wrap">
                                      {a.notes}
                                    </div>
                                  </div>
                                )}

                                {profile.profilingExternalSources?.items && profile.profilingExternalSources.items.length > 0 && (
                                  <div>
                                    <div className="text-[10px] text-cyan-400/90 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                      <i className="fa-solid fa-link" />
                                      External sources
                                    </div>
                                    <div className="text-[11px] text-white/65 space-y-1.5 bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-c-border">
                                      {profile.profilingExternalSources.updatedAt && (
                                        <div className="text-[10px] text-c-text-tertiary mb-1">
                                          Last enriched: {new Date(profile.profilingExternalSources.updatedAt).toLocaleString()}
                                        </div>
                                      )}
                                      <ul className="space-y-2">
                                        {profile.profilingExternalSources.items.map((item, idx) => (
                                          <li key={`${item.url}-${idx}`} className="border-b border-c-border last:border-0 pb-2 last:pb-0">
                                            <a
                                              href={item.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-cpoint-turquoise hover:underline break-all"
                                            >
                                              {item.url}
                                            </a>
                                            <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-c-hover-bg text-c-text-tertiary">{item.kind}</span>
                                              {item.postDate ? (
                                                <span className="text-[9px] text-white/30">Post {item.postDate}</span>
                                              ) : null}
                                              <span
                                                className={`text-[9px] px-1.5 py-0.5 rounded ${
                                                  item.success ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                                                }`}
                                              >
                                                {item.success ? 'Included' : 'Not included'}
                                              </span>
                                            </div>
                                            {item.detail ? (
                                              <div className="text-[10px] text-c-text-tertiary mt-0.5">{item.detail}</div>
                                            ) : null}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                )}

                                {/* Identity \u2014 the bridge */}
                                {identity && (identity.bridgeInsight || identity.drivingForces || (identity.roles && identity.roles.length > 0)) && (
                                  <div>
                                    <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider mb-2 flex items-center justify-between">
                                      <span><i className="fa-solid fa-fingerprint mr-1" /> Identity</span>
                                      <FbBtns s="identity" />
                                    </div>
                                    <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-c-border space-y-2">
                                      {identity.roles && identity.roles.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                          {identity.roles.map((r: string, i: number) => (
                                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-cpoint-turquoise/10 text-cpoint-turquoise border border-cpoint-turquoise/20">{r}</span>
                                          ))}
                                        </div>
                                      )}
                                      {identity.drivingForces && <div className="text-xs text-c-text-tertiary leading-relaxed">{identity.drivingForces}</div>}
                                      {identity.bridgeInsight && <div className="text-xs text-cpoint-turquoise/80 leading-relaxed italic">{identity.bridgeInsight}</div>}
                                    </div>
                                  </div>
                                )}

                                {/* Professional + Personal side-by-side */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                  {/* Professional */}
                                  <div className="space-y-3">
                                    <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider flex items-center justify-between">
                                      <span><i className="fa-solid fa-briefcase mr-1" /> Professional</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => openSteveEditModal(profile.username, 'professional')}
                                          className="text-[10px] px-2 py-0.5 bg-c-hover-bg hover:bg-c-hover-bg border border-c-border rounded text-c-text-secondary hover:text-white transition-colors"
                                        >
                                          âœï¸ Edit
                                        </button>
                                        <FbBtns s="professional" />
                                      </div>
                                    </div>
                                    {pro ? (
                                      <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-c-border space-y-2">
                                        {pro.company?.description && (
                                          <div>
                                            <div className="text-sm text-white font-medium">{pro.company.name}</div>
                                            <div className="text-xs text-c-text-tertiary leading-relaxed">{pro.company.description}</div>
                                            <div className="flex gap-2 mt-1">
                                              {pro.company.sector && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300/80 border border-purple-500/20">{pro.company.sector}</span>}
                                              {pro.company.stage && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300/80 border border-amber-500/20">{pro.company.stage}</span>}
                                            </div>
                                          </div>
                                        )}
                                        {pro.role?.title && (
                                          <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-sm text-white">{pro.role.title}</span>
                                              {pro.role.seniority && <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300/80 border border-teal-500/20">{pro.role.seniority}</span>}
                                              {pro.role.function && <span className="text-[10px] px-2 py-0.5 rounded-full bg-c-hover-bg text-c-text-tertiary border border-c-border">{pro.role.function}</span>}
                                            </div>
                                            {pro.role.implication && <div className="text-xs text-c-text-tertiary leading-relaxed mt-0.5">{pro.role.implication}</div>}
                                          </div>
                                        )}
                                        {pro.careerHistory && pro.careerHistory.length > 0 && (
                                          <div className="mt-2 space-y-1.5">
                                            <div className="text-[10px] font-medium text-c-text-tertiary uppercase tracking-wider">Career Timeline</div>
                                            {pro.careerHistory.map((ch, i) => (
                                              <div key={i} className="flex items-start gap-2 text-xs">
                                                <div className="w-1 h-1 rounded-full bg-teal-400/50 mt-1.5 shrink-0" />
                                                <div>
                                                  <span className="text-c-text-secondary font-medium">{ch.role}</span>
                                                  {ch.company && <span className="text-c-text-tertiary"> at {ch.company}</span>}
                                                  {(ch.duration || ch.period) && <span className="text-white/30 ml-1">({ch.duration || ch.period})</span>}
                                                  {ch.highlight && <div className="text-[10px] text-c-text-tertiary leading-relaxed">{ch.highlight}</div>}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {pro.education && <div className="text-xs text-c-text-tertiary mt-1"><i className="fa-solid fa-graduation-cap mr-1" />{pro.education}</div>}
                                        {pro.location?.context && <div className="text-xs text-c-text-tertiary"><i className="fa-solid fa-location-dot mr-1" />{pro.location.context}</div>}
                                        {pro.webFindings && <div className="text-xs text-c-text-tertiary leading-relaxed italic mt-1">{pro.webFindings}</div>}
                                        {pro.publications && pro.publications.length > 0 && (
                                          <div className="space-y-1 mt-1">
                                            {pro.publications.map((pub, i) => (
                                              <div key={i} className="text-[10px] text-c-text-tertiary">
                                                <span>{pub.source}</span>
                                                {pub.date && <span>{' \u00B7 '}{pub.date}</span>}
                                                {pub.insight && <span className="text-c-text-tertiary">{' \u2014 '}{pub.insight}</span>}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-white/20 text-center py-4 bg-white/[0.02] rounded-lg border border-dashed border-c-border">
                                        No professional data found
                                      </div>
                                    )}
                                  </div>

                                  {/* Personal */}
                                  <div className="space-y-3">
                                    <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider flex items-center justify-between">
                                      <span><i className="fa-solid fa-user mr-1" /> Personal</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => openSteveEditModal(profile.username, 'personal')}
                                          className="text-[10px] px-2 py-0.5 bg-c-hover-bg hover:bg-c-hover-bg border border-c-border rounded text-c-text-secondary hover:text-white transition-colors"
                                        >
                                          âœï¸ Edit
                                        </button>
                                        <button
                                          onClick={() => openSteveEditModal(profile.username, 'links')}
                                          className="text-[10px] px-2 py-0.5 bg-c-hover-bg hover:bg-c-hover-bg border border-c-border rounded text-c-text-secondary hover:text-white transition-colors"
                                        >
                                          ðŸ”— Verified Links
                                        </button>
                                        <FbBtns s="personal" />
                                      </div>
                                    </div>
                                    {personal ? (
                                      <div className="bg-white/[0.03] rounded-lg px-3.5 py-2.5 border border-c-border space-y-2">
                                        {personal.lifestyle && <div className="text-xs text-c-text-tertiary leading-relaxed">{personal.lifestyle}</div>}
                                        {personal.interests && personal.interests.length > 0 && (
                                          <div className="flex flex-wrap gap-1.5">
                                            {personal.interests.map((item, i) => (
                                              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-300/80 border border-pink-500/20">{item}</span>
                                            ))}
                                          </div>
                                        )}
                                        {personal.socialProfiles && personal.socialProfiles.length > 0 && (
                                          <div className="flex flex-wrap gap-2">
                                            {personal.socialProfiles.map((sp, i) => (
                                              <a key={i} href={sp.url || '#'} target="_blank" rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                                                <i className={`fa-brands fa-${(sp.platform || '').toLowerCase() === 'x' ? 'x-twitter' : (sp.platform || '').toLowerCase()}`} />
                                                {sp.platform}{sp.handle ? ` ${sp.handle}` : ''}
                                              </a>
                                            ))}
                                          </div>
                                        )}
                                        {personal.webFindings && <div className="text-xs text-c-text-tertiary leading-relaxed italic">{personal.webFindings}</div>}
                                        {personal.publicPosts && personal.publicPosts.length > 0 && (
                                          <div className="space-y-1">
                                            {personal.publicPosts.map((pp, i) => (
                                              <div key={i} className="text-[10px] text-c-text-tertiary">
                                                <span>{pp.source}</span>
                                                {pp.date && <span>{' \u00B7 '}{pp.date}</span>}
                                                {pp.insight && <span className="text-c-text-tertiary">{' \u2014 '}{pp.insight}</span>}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-white/20 text-center py-4 bg-white/[0.02] rounded-lg border border-dashed border-c-border">
                                        {depthLabel === 'deep' ? 'No personal data found' : 'Run a Deep analysis to discover personal data'}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Networking + Conversation Starters */}
                                {(a.networkingValue || conversationStarters.length > 0) && (
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    {a.networkingValue && (
                                      <div>
                                        <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider mb-2 flex items-center justify-between">
                                          <span>Networking Value</span>
                                          <FbBtns s="networkingValue" />
                                        </div>
                                        <div className="text-xs text-c-text-tertiary leading-relaxed bg-cpoint-turquoise/5 rounded-lg px-3.5 py-2.5 border border-cpoint-turquoise/15">
                                          <i className="fa-solid fa-handshake text-cpoint-turquoise/50 mr-1.5" />{a.networkingValue}
                                        </div>
                                      </div>
                                    )}
                                    {conversationStarters.length > 0 && (
                                      <div>
                                        <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider mb-2">
                                          <i className="fa-solid fa-comments mr-1" /> Starters
                                        </div>
                                        <div className="space-y-1">
                                          {conversationStarters.map((s, i) => (
                                            <div key={i} className="text-xs text-c-text-tertiary leading-relaxed bg-cpoint-turquoise/5 rounded-lg px-3 py-2 border border-cpoint-turquoise/10">
                                              <i className="fa-solid fa-lightbulb text-cpoint-turquoise/40 mr-1.5" />{s}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Interests */}
                                {Object.keys(interests).length > 0 && (
                                  <div>
                                    <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider mb-2 flex items-center justify-between">
                                      <span>Interests</span>
                                      <FbBtns s="interests" />
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {Object.entries(interests)
                                        .sort(([, a], [, b]) => (b?.score ?? 0) - (a?.score ?? 0))
                                        .map(([topic, meta]) => {
                                          const typeColor = meta?.type === 'professional' ? 'bg-blue-500/10 border-blue-500/15 text-blue-300/60' :
                                            meta?.type === 'personal' ? 'bg-pink-500/10 border-pink-500/15 text-pink-300/60' :
                                            'bg-c-hover-bg border-c-border text-c-text-tertiary';
                                          return (
                                            <span key={topic} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border ${typeColor}`}>
                                              <span className="text-white">{topic}</span>
                                              <span className="text-cpoint-turquoise font-mono text-[10px]">{Math.round((meta?.score ?? 0) * 100)}%</span>
                                            </span>
                                          );
                                        })}
                                    </div>
                                  </div>
                                )}

                                {/* Traits + Observations */}
                                {(traits.length > 0 || observations) && (
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    {traits.length > 0 && (
                                      <div>
                                        <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider mb-2 flex items-center justify-between">
                                          <span>Traits</span>
                                          <FbBtns s="traits" />
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                          {traits.map((trait, i) => (
                                            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300/80 border border-blue-500/20">{trait}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {observations && (
                                      <div>
                                        <div className="text-[10px] text-c-text-tertiary uppercase tracking-wider mb-2 flex items-center justify-between">
                                          <span>Steve's Observations</span>
                                          <FbBtns s="observations" />
                                        </div>
                                        <div className="text-xs text-c-text-tertiary leading-relaxed">{observations}</div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}

                            {/* Knowledge Base */}
                            <button
                              onClick={() => {
                                setSelectedProfileUsername(profile.username)
                                setShowKnowledgeBase(true)
                              }}
                              className="mt-4 w-full py-2 px-3 bg-[#6366f1]/15 text-[#a5b4fc] border border-[#6366f1]/20 rounded-lg text-xs font-medium hover:bg-[#6366f1]/25 transition-colors flex items-center justify-center gap-2"
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="5.5" r="1.5" fill="currentColor"/><circle cx="5" cy="10" r="1.5" fill="currentColor"/><circle cx="11" cy="10" r="1.5" fill="currentColor"/><line x1="8" y1="7" x2="5.5" y2="9" stroke="currentColor" strokeWidth="0.8"/><line x1="8" y1="7" x2="10.5" y2="9" stroke="currentColor" strokeWidth="0.8"/></svg>
                              View Knowledge Base
                            </button>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="h-48 flex items-center justify-center text-white/30 text-sm">
                        Select a user
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Network Profiling Tab \u2014 matches Steve Profiling layout exactly */}
        {activeTab === 'network_profiling' && (
          <div className="space-y-4">
            <div className="bg-c-hover-bg backdrop-blur rounded-xl p-6 border border-c-border">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-cpoint-turquoise flex items-center gap-2">
                    <i className="fa-solid fa-globe" />
                    Network Profiling
                  </h3>
                  <p className="text-xs text-c-text-tertiary mt-1">Network intelligence {'\u2014'} company intel, professional/personal analytics, geographic & trait distributions</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-c-text-tertiary">
                    {flatCommunities.length} communities
                  </span>
                  <button
                    onClick={() => loadAdminData()}
                    className="px-2.5 py-1 bg-c-hover-bg border border-c-border hover:bg-c-hover-bg rounded-xl text-xs flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-refresh text-[10px]" />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Status banner */}
              {networkSynthesisStatus && (
                <div className={`mb-6 px-4 py-3 rounded-xl text-sm flex items-center justify-between border ${
                  networkSynthesisStatus.status === 'ok'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  <div className="flex items-center gap-2">
                    <i className={`fa-solid ${networkSynthesisStatus.status === 'ok' ? 'fa-check-circle' : 'fa-exclamation-triangle'}`} />
                    <span>{networkSynthesisStatus.message}</span>
                  </div>
                  <button
                    onClick={() => setNetworkSynthesisStatus(null)}
                    className="text-c-text-tertiary hover:text-white text-xs px-2 py-1 rounded hover:bg-c-hover-bg"
                  >
                    dismiss
                  </button>
                </div>
              )}

              <div className="flex flex-col lg:flex-row gap-4">
                {/* Left: search + community list */}
                <div className="lg:w-64 flex-shrink-0">
                  <input
                    type="text"
                    value={networkSearchQuery}
                    onChange={(e) => setNetworkSearchQuery(e.target.value)}
                    placeholder="Search communities..."
                    className="w-full bg-c-hover-bg border border-c-border rounded-md px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
                  />
                  <div className="text-[10px] text-white/30 mt-1 mb-2">{flatCommunities.length} communities</div>

                  <div className="max-h-[520px] overflow-y-auto space-y-0.5 pr-1">
                    {flatCommunities
                      .filter(c => !networkSearchQuery ||
                        c.name.toLowerCase().includes(networkSearchQuery.toLowerCase()) ||
                        (c.creator_username || '').toLowerCase().includes(networkSearchQuery.toLowerCase()))
                      .map((community) => (
                        <button
                          key={community.id}
                          onClick={() => setSelectedNetworkId(community.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-3 group ${
                            selectedNetworkId === community.id
                              ? 'bg-cpoint-turquoise/10 border border-cpoint-turquoise/30'
                              : 'hover:bg-c-hover-bg border border-transparent'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0 transition-colors ${
                            selectedNetworkId === community.id
                              ? 'bg-cpoint-turquoise/20 text-cpoint-turquoise'
                              : 'bg-c-hover-bg text-c-text-tertiary group-hover:text-c-text-secondary'
                          }`}>
                            <i className="fa-solid fa-users" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white truncate">{community.name}</div>
                            <div className="text-[11px] text-c-text-tertiary flex items-center gap-2">
                              <span>{community.member_count || 0} members</span>
                              {community.parent_community_id != null && (
                                <span className="px-1.5 py-px bg-purple-500/10 text-purple-400 text-[9px] rounded">sub</span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    {flatCommunities.length === 0 && (
                      <div className="text-center py-8 text-c-text-tertiary text-xs">No communities found</div>
                    )}
                  </div>
                </div>

                {/* Right: selected community detail */}
                <div className="flex-1 min-w-0">
                  {selectedNetworkId ? (() => {
                    const community = flatCommunities.find(c => c.id === selectedNetworkId);
                    if (!community) return <div className="text-c-text-tertiary text-sm p-8">Community not found</div>;

                    return (
                      <div className="space-y-6">
                        <div className="bg-white/[0.03] rounded-2xl border border-c-border p-6">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-cpoint-turquoise to-blue-500 rounded-2xl flex items-center justify-center text-2xl">
                                  ðŸŒ
                                </div>
                                <div>
                                  <h4 className="text-xl font-semibold text-white">{community.name}</h4>
                                  <div className="flex items-center gap-4 text-sm text-c-text-tertiary mt-1">
                                    <span>{community.member_count || 0} members</span>
                                    <span className="text-white/30">{'\u2022'}</span>
                                    <span>ID: {community.id}</span>
                                    {community.parent_community_id && (
                                      <span className="text-purple-400">Sub-community of #{community.parent_community_id}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => synthesizeNetworkKB(community.id)}
                                disabled={synthesizingNetworkId === community.id}
                                className="px-3 py-1.5 bg-cpoint-turquoise hover:bg-[#3d9b8f] disabled:bg-white/20 text-black text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all active:scale-[0.985]"
                              >
                                {synthesizingNetworkId === community.id ? (
                                  <><i className="fa-solid fa-spinner fa-spin text-[10px]" /> Synthesizing...</>
                                ) : (
                                  <><i className="fa-solid fa-sync text-[10px]" /> Synthesize KB</>
                                )}
                              </button>

                              <button
                                onClick={() => setShowKnowledgeBase(true)}
                                className="px-3 py-1.5 bg-c-active-bg hover:bg-white/20 text-white text-xs font-medium rounded-xl flex items-center gap-1.5 border border-c-border transition-all"
                              >
                                <i className="fa-solid fa-diagram-project text-[10px]" /> View Knowledge Base
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="bg-white/[0.03] border border-c-border rounded-2xl p-8 text-center">
                          <div className="mx-auto w-16 h-16 bg-c-hover-bg rounded-2xl flex items-center justify-center mb-6">
                            <i className="fa-solid fa-chart-pie text-4xl text-white/30" />
                          </div>
                          <div className="text-c-text-secondary text-lg font-medium mb-2">Network Analytics</div>
                          <p className="text-c-text-tertiary max-w-md mx-auto text-sm">
                            Click "Synthesize KB" to aggregate member knowledge into network-level intelligence:
                            company intel (size, valuation, global presence), expertise & industry distributions,
                            geographic spread, personality traits, and core values.
                          </p>
                          <p className="text-[11px] text-c-text-tertiary mt-4">
                            Then click "View Knowledge Base" to explore interactive charts, KPIs, and synthesized narratives.
                          </p>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="h-[420px] flex items-center justify-center border border-dashed border-c-border rounded-3xl">
                      <div className="text-center">
                        <div className="text-white/30 text-6xl mb-4">ðŸŒ</div>
                        <div className="text-c-text-tertiary">Select a community from the list</div>
                        <div className="text-white/30 text-xs mt-2">to view analytics or synthesize its Network Knowledge Base</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Add User to Community Modal */}
      {showAddToCommunityModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-c-bg-surface rounded-xl p-6 w-full max-w-md border border-c-border">
            <h2 className="text-lg font-semibold mb-1">Add User to Community</h2>
            <p className="text-xs text-c-text-tertiary mb-4">
              {(() => {
                const c = flatCommunities.find(x => x.id === addToCommunityId)
                return c ? c.name : `Community #${addToCommunityId}`
              })()}
            </p>

            {addToCommunitySuccess && (
              <div className="mb-3 p-2 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                User added successfully!
              </div>
            )}
            {addToCommunityError && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {addToCommunityError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-c-text-tertiary mb-1">Community</label>
                <select
                  value={addToCommunityId ?? ''}
                  onChange={(e) => {
                    setAddToCommunityId(Number(e.target.value))
                    setAddToCommunityError('')
                    setAddToCommunitySuccess(false)
                  }}
                  className="w-full bg-c-hover-bg border border-c-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cpoint-turquoise"
                >
                  {flatCommunities.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.parent_community_id ? '  â””â”€ ' : ''}{c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-c-text-tertiary mb-1">Username</label>
                <input
                  type="text"
                  value={addToCommunityUsername}
                  onChange={(e) => { setAddToCommunityUsername(e.target.value); setAddToCommunityError(''); setAddToCommunitySuccess(false) }}
                  placeholder="Enter username"
                  className="w-full bg-c-hover-bg border border-c-border rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddToCommunity() } }}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAddToCommunity}
                  disabled={addToCommunityLoading || !addToCommunityUsername.trim()}
                  className="flex-1 py-2 bg-cpoint-turquoise text-black rounded-lg font-medium hover:bg-[#45a099] disabled:opacity-50"
                >
                  {addToCommunityLoading ? 'Adding...' : 'Add User'}
                </button>
                <button
                  onClick={() => setShowAddToCommunityModal(false)}
                  className="px-4 py-2 bg-c-active-bg text-c-text-primary rounded-lg hover:bg-white/15"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-c-bg-surface rounded-xl p-6 w-full max-w-md border border-c-border">
            <h2 className="text-lg font-semibold mb-4">Add New User</h2>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs text-c-text-tertiary mb-1">Username</label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm focus:outline-none focus:border-cpoint-turquoise"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-c-text-tertiary mb-1">Password</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm focus:outline-none focus:border-cpoint-turquoise"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-c-text-tertiary mb-1">Subscription</label>
                <select
                  value={newUser.subscription}
                  onChange={(e) => setNewUser({ ...newUser, subscription: e.target.value })}
                  className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm focus:outline-none focus:border-cpoint-turquoise"
                >
                  <option value="free">Free</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-cpoint-turquoise text-black rounded-lg font-medium hover:bg-[#45a099]"
                >
                  Add User
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddUserModal(false)
                    setNewUser({ username: '', password: '', subscription: 'free' })
                  }}
                  className="flex-1 py-2 bg-c-hover-bg border border-c-border rounded-lg hover:bg-c-hover-bg"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        {showBroadcastModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-c-bg-surface rounded-xl p-6 w-full max-w-lg border border-c-border">
              <h2 className="text-lg font-semibold mb-3 text-cpoint-turquoise">Broadcast Notification</h2>
              <p className="text-xs text-c-text-tertiary mb-4">
                Send a message to every active member on the platform. Use this for important announcements.
              </p>

              {broadcastSuccess && (
                <div className="mb-3 rounded-lg border border-cpoint-turquoise/40 bg-cpoint-turquoise/10 px-3 py-2 text-xs text-[#7fe7df]">
                  {broadcastSuccess}
                </div>
              )}
              {broadcastError && (
                <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {broadcastError}
                </div>
              )}

              <form onSubmit={handleBroadcastSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-c-text-tertiary mb-1">
                    Title <span className="text-c-text-tertiary">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    maxLength={140}
                    placeholder="System Maintenance Tonight"
                    className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
                    disabled={broadcastSending}
                  />
                </div>

                <div>
                  <label className="block text-xs text-c-text-tertiary mb-1">Message</label>
                  <textarea
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="We're performing scheduled maintenance at 10 PM UTC..."
                    rows={5}
                    maxLength={2000}
                    className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
                    disabled={broadcastSending}
                    required={!broadcastTitle.trim()}
                  />
                  <div className="text-[11px] text-c-text-tertiary mt-1">
                    {broadcastMessage.length}/2000 characters
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-c-text-tertiary mb-1">
                    Link <span className="text-c-text-tertiary">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={broadcastLink}
                    onChange={(e) => setBroadcastLink(e.target.value)}
                    placeholder="https://status.yourapp.com/maintenance"
                    className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise"
                    disabled={broadcastSending}
                  />
                  <p className="text-[11px] text-c-text-tertiary mt-1">Recipients will be taken to this URL when they open the notification.</p>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={broadcastSending}
                    className="flex-1 py-2 bg-cpoint-turquoise text-black rounded-lg font-medium hover:bg-[#45a099] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {broadcastSending ? 'Sending\u2026' : 'Send Notification'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetBroadcastForm()
                      setShowBroadcastModal(false)
                    }}
                    className="flex-1 py-2 bg-c-hover-bg border border-c-border rounded-lg hover:bg-c-hover-bg"
                    disabled={broadcastSending}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Invite User Modal */}
        {showInviteModal && !showQRCode && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-xl border border-c-border bg-c-bg-surface shadow-xl shadow-black/40">
              <div className="max-h-[85vh] overflow-y-auto px-6 py-6">
              <h2 className="text-lg font-semibold mb-2">Invite to {inviteCommunityName}</h2>
              <p className="text-sm text-c-text-tertiary mb-4">Choose how you want to invite members</p>

              {inviteSuccess && (
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                  Invitation sent successfully!
                </div>
              )}

              {inviteError && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {inviteError}
                </div>
              )}

                {inviteNestedOptions.length > 0 && (
                  <div className="mb-4 space-y-3 rounded-xl border border-c-border bg-c-hover-bg p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-c-text-tertiary">Nested communities</div>
                    <div className="space-y-2 text-sm text-c-text-secondary">
                      {[
                        { value: 'parent-only', label: `Invite only to ${inviteCommunityName}` },
                        { value: 'all-nested', label: `Invite to ${inviteCommunityName} and all nested communities` },
                        { value: 'selected-nested', label: `Invite to ${inviteCommunityName} and selected nested communities` }
                      ].map(option => {
                        const selected = inviteScope === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                              selected
                                ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/15 text-c-text-primary shadow-lg shadow-cpoint-turquoise/10'
                                : 'border-c-border bg-c-hover-bg text-c-text-secondary hover:border-white/20 hover:bg-c-bg-app/50'
                            }`}
                            onClick={() => setInviteScope(option.value as typeof inviteScope)}
                          >
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 bg-black/60 text-[10px] text-c-text-secondary">
                              {selected ? (
                                <span className="h-2 w-2 rounded-full bg-cpoint-turquoise" />
                              ) : (
                                <span className="h-1 w-1 rounded-full bg-white/25" />
                              )}
                            </span>
                            <span className="ml-2">{option.label}</span>
                          </button>
                        )
                      })}
                    </div>

                    {inviteScope === 'selected-nested' && (
                      <div className="space-y-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setInviteNestedDropdownOpen(prev => !prev)}
                          className="flex w-full items-center justify-between rounded-lg border border-c-border bg-c-hover-bg px-3 py-2 text-sm text-c-text-secondary hover:border-white/20 hover:bg-c-hover-bg"
                        >
                          <span>
                            {inviteSelectedNestedIds.length === 0
                              ? 'No nested communities selected'
                              : `${inviteSelectedNestedIds.length} nested ${inviteSelectedNestedIds.length === 1 ? 'community' : 'communities'} selected`}
                          </span>
                          <i className={`fa-solid fa-chevron-${inviteNestedDropdownOpen ? 'up' : 'down'} text-xs text-c-text-tertiary`} />
                        </button>
                        {inviteNestedDropdownOpen && (
                          <div className="max-h-56 overflow-y-auto rounded-lg border border-c-border bg-c-hover-bg p-2 space-y-1">
                            {inviteNestedOptions.map(option => {
                              const selected = inviteSelectedNestedIds.includes(option.id)
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() =>
                                    setInviteSelectedNestedIds(prev =>
                                      prev.includes(option.id)
                                        ? prev.filter(id => id !== option.id)
                                        : [...prev, option.id]
                                    )
                                  }
                                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                                    selected
                                      ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/15 text-c-text-primary shadow-lg shadow-cpoint-turquoise/10'
                                      : 'border-c-border bg-c-hover-bg text-c-text-secondary hover:border-white/20 hover:bg-c-hover-bg'
                                  }`}
                                  style={{ paddingLeft: `${(option.depth + 1) * 16}px` }}
                                >
                                  <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-white/20 bg-c-hover-bg text-[10px] text-c-text-secondary">
                                    {selected ? (
                                      <i className="fa-solid fa-check text-cpoint-turquoise" />
                                    ) : (
                                      <span className="h-1 w-1 rounded-full bg-white/30" />
                                    )}
                                  </span>
                                  <span className="ml-2">{option.name}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {inviteSelectedNestedIds.length === 0 && (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                            Select at least one nested community or change the invite scope.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {inviteParentOptions.length > 0 && (
                  <div className="mb-4 space-y-2 rounded-xl border border-c-border bg-c-hover-bg p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-c-text-tertiary">Parent communities</div>
                    <p className="text-xs text-c-text-tertiary">Decide if the invitee should also join parent communities.</p>
                    <div className="space-y-2">
                    {inviteParentOptions.map((option) => {
                      const selected = inviteSelectedParentIds.includes(option.id)
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setInviteSelectedParentIds((prev) =>
                              prev.includes(option.id)
                                ? prev.filter((id) => id !== option.id)
                                : [...prev, option.id]
                            )
                          }
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                            selected
                              ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/15 text-c-text-primary shadow-lg shadow-cpoint-turquoise/10'
                              : 'border-c-border bg-c-hover-bg text-c-text-secondary hover:border-white/20 hover:bg-c-hover-bg'
                          }`}
                        >
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-white/20 bg-c-hover-bg text-[10px] text-c-text-secondary">
                            {selected ? (
                              <i className="fa-solid fa-check text-cpoint-turquoise" />
                            ) : (
                              <span className="h-1 w-1 rounded-full bg-white/30" />
                            )}
                          </span>
                          <span className="ml-2">{option.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-c-text-tertiary mb-2">Send invitation via email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full px-3 py-2 bg-c-hover-bg border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-cpoint-turquoise focus:outline-none"
                    disabled={inviteLoading || inviteSuccess}
                  />
                  <button
                    onClick={handleSendInvite}
                    className="w-full mt-2 px-4 py-2 bg-cpoint-turquoise text-black rounded-lg text-sm font-medium hover:bg-[#45a099] disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={
                      inviteLoading ||
                      inviteSuccess ||
                      !inviteEmail.trim() ||
                      (inviteScope === 'selected-nested' && inviteSelectedNestedIds.length === 0)
                    }
                  >
                    {inviteLoading ? 'Sending...' : 'Send Email Invite'}
                  </button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-c-border" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-c-bg-surface text-c-text-tertiary">OR</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-c-text-tertiary mb-2">Share via QR code</label>
                  <button
                    onClick={handleGenerateQR}
                    className="w-full px-4 py-2 bg-c-hover-bg border border-white/20 rounded-lg text-sm font-medium hover:bg-c-hover-bg disabled:opacity-50"
                    disabled={inviteLoading || (inviteScope === 'selected-nested' && inviteSelectedNestedIds.length === 0)}
                  >
                    <i className="fa-solid fa-qrcode mr-2" />
                    Generate QR Code
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <button
                  onClick={handleCloseInviteModal}
                  className="w-full px-4 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm font-medium hover:bg-c-hover-bg"
                  disabled={inviteLoading}
                >
                  Close
                </button>
              </div>
            </div>
            </div>
          </div>
        )}

      {/* QR Code Modal */}
      {showQRCode && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-c-bg-surface rounded-xl p-6 w-full max-w-md border border-c-border">
            <h2 className="text-lg font-semibold mb-2">QR Code Invitation</h2>
            <p className="text-sm text-c-text-tertiary mb-4">Scan this QR code to join {inviteCommunityName}</p>

            <div className="bg-white p-6 rounded-xl mb-4 flex justify-center">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl)}`}
                alt="Invitation QR Code"
                className="w-64 h-64"
              />
            </div>

            <div className="text-xs text-c-text-tertiary mb-4 text-center break-all">
              {qrCodeUrl}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowQRCode(false)
                  setShowInviteModal(true)
                }}
                className="flex-1 px-4 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm font-medium hover:bg-c-hover-bg"
              >
                Back
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(qrCodeUrl)
                  alert('Link copied to clipboard!')
                }}
                className="flex-1 px-4 py-2 bg-cpoint-turquoise text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteUserModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-c-bg-elevated rounded-2xl border border-c-border p-6">
            <h2 className="text-lg font-semibold mb-2 text-white">Delete User: {deleteUserModal.username}</h2>
            <p className="text-sm text-c-text-tertiary mb-6">
              Choose how to handle this user's data:
            </p>

            {/* Option 1: Preserve Data */}
            <button
              onClick={() => setDeletePreserveData(true)}
              className={`w-full mb-3 p-4 rounded-xl border text-left transition ${
                deletePreserveData
                  ? 'border-cpoint-turquoise bg-cpoint-turquoise/10'
                  : 'border-c-border bg-c-hover-bg hover:border-white/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    deletePreserveData ? 'border-cpoint-turquoise bg-cpoint-turquoise' : 'border-white/30'
                  }`}>
                    {deletePreserveData && <i className="fa-solid fa-check text-xs text-black" />}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-white mb-1">Preserve User Content</div>
                  <div className="text-xs text-c-text-tertiary">
                    Keep all posts, messages, reactions, and uploads. Only removes the user account.
                  </div>
                </div>
              </div>
            </button>

            {/* Option 2: Delete Everything */}
            <button
              onClick={() => setDeletePreserveData(false)}
              className={`w-full mb-6 p-4 rounded-xl border text-left transition ${
                !deletePreserveData
                  ? 'border-red-500/60 bg-red-500/10'
                  : 'border-c-border bg-c-hover-bg hover:border-white/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    !deletePreserveData ? 'border-red-500 bg-red-500' : 'border-white/30'
                  }`}>
                    {!deletePreserveData && <i className="fa-solid fa-check text-xs text-white" />}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-white mb-1">Delete All Data</div>
                  <div className="text-xs text-c-text-tertiary">
                    Permanently remove user and ALL their content: posts, messages, reactions, uploads. Cannot be undone.
                  </div>
                </div>
              </div>
            </button>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteUserModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-white hover:bg-c-hover-bg"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteUser}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold ${
                  deletePreserveData
                    ? 'bg-cpoint-turquoise text-black hover:brightness-110'
                    : 'bg-red-500 text-white hover:bg-red-600'
                }`}
              >
                {deletePreserveData ? 'Delete Account Only' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Steve Profile Edit Modal */}
      {editingSteveProfile && editSection && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-c-bg-surface rounded-2xl w-full max-w-3xl border border-c-border flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-c-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-cpoint-turquoise to-blue-500 rounded-xl flex items-center justify-center text-base font-bold text-white">
                  {editingSteveProfile[0]?.toUpperCase()}
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-white">
                    {editSection === 'professional' ? 'Professional Experience' : editSection === 'links' ? 'Verified Links' : 'Personal Context'}
                  </h3>
                  <p className="text-sm text-c-text-tertiary">@{editingSteveProfile}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setEditingSteveProfile(null)
                  setEditSection(null)
                  setEditContent('')
                  setEditExperiences([])
                  setEditVerifiedLinks([])
                }}
                className="text-c-text-tertiary hover:text-white p-2 text-xl leading-none"
              >
                âœ•
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {editSection === 'professional' ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-c-text-tertiary">Edit positions below. Grok will enrich company details automatically.</p>
                    <button
                      onClick={() => setEditExperiences(prev => [{ company: '', title: '', dates: '', description: '' }, ...prev])}
                      className="px-4 py-2 bg-cpoint-turquoise/20 hover:bg-cpoint-turquoise/30 text-cpoint-turquoise text-sm rounded-xl border border-cpoint-turquoise/30 transition-colors"
                    >
                      + Add Position
                    </button>
                  </div>

                  {editExperiences.map((exp, idx) => (
                    <div key={idx} className="bg-white/[0.03] border border-c-border rounded-xl p-4 space-y-3 relative group">
                      <button
                        onClick={() => setEditExperiences(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-3 right-3 text-white/20 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove position"
                      >
                        âœ•
                      </button>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] uppercase tracking-wider text-c-text-tertiary mb-1">Company</label>
                          <input
                            type="text"
                            value={exp.company}
                            onChange={(e) => setEditExperiences(prev => prev.map((x, i) => i === idx ? { ...x, company: e.target.value } : x))}
                            placeholder="e.g. Deloitte"
                            className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cpoint-turquoise"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] uppercase tracking-wider text-c-text-tertiary mb-1">Title / Role</label>
                          <input
                            type="text"
                            value={exp.title}
                            onChange={(e) => setEditExperiences(prev => prev.map((x, i) => i === idx ? { ...x, title: e.target.value } : x))}
                            placeholder="e.g. Manager"
                            className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cpoint-turquoise"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-c-text-tertiary mb-1">Dates</label>
                        <input
                          type="text"
                          value={exp.dates}
                          onChange={(e) => setEditExperiences(prev => prev.map((x, i) => i === idx ? { ...x, dates: e.target.value } : x))}
                          placeholder="e.g. 2015 - 2022  or  Dec 2024 - Present"
                          className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cpoint-turquoise"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-c-text-tertiary mb-1">Description</label>
                        <textarea
                          value={exp.description}
                          onChange={(e) => setEditExperiences(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                          placeholder="Brief description of role, achievements, focus areas..."
                          rows={2}
                          className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cpoint-turquoise resize-none"
                        />
                      </div>
                    </div>
                  ))}

                  {editExperiences.length === 0 && (
                    <div className="text-center py-10 text-white/30 text-sm">
                      No positions yet. Click "+ Add Position" to start.
                    </div>
                  )}
                </div>
              ) : editSection === 'links' ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-c-text-tertiary">Add verified links that Steve should use as the primary source before any web search.</p>
                      <p className="text-xs text-cpoint-turquoise mt-1">Particularly useful for LinkedIn to avoid access restrictions (status 999).</p>
                    </div>
                    <button
                      onClick={() => setEditVerifiedLinks(prev => [{ platform: 'LinkedIn', url: '', notes: '' }, ...prev])}
                      className="px-4 py-2 bg-cpoint-turquoise/20 hover:bg-cpoint-turquoise/30 text-cpoint-turquoise text-sm rounded-xl border border-cpoint-turquoise/30 transition-colors"
                    >
                      + Add Verified Link
                    </button>
                  </div>

                  {editVerifiedLinks.map((link, idx) => (
                    <div key={idx} className="bg-white/[0.03] border border-c-border rounded-xl p-4 space-y-3 relative group">
                      <button
                        onClick={() => setEditVerifiedLinks(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-3 right-3 text-white/20 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove link"
                      >
                        âœ•
                      </button>
                      <div className="flex gap-3">
                        <div className="w-40">
                          <label className="block text-[10px] uppercase tracking-wider text-c-text-tertiary mb-1">Platform</label>
                          <select
                            value={link.platform}
                            onChange={(e) => setEditVerifiedLinks(prev => prev.map((x, i) => i === idx ? { ...x, platform: e.target.value } : x))}
                            className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white focus:outline-none focus:border-cpoint-turquoise"
                          >
                            <option value="LinkedIn">LinkedIn</option>
                            <option value="X">X / Twitter</option>
                            <option value="Instagram">Instagram</option>
                            <option value="Medium">Medium</option>
                            <option value="Blog">Blog / Personal Site</option>
                            <option value="YouTube">YouTube</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] uppercase tracking-wider text-c-text-tertiary mb-1">URL</label>
                          <input
                            type="url"
                            value={link.url}
                            onChange={(e) => setEditVerifiedLinks(prev => prev.map((x, i) => i === idx ? { ...x, url: e.target.value } : x))}
                            placeholder="https://www.linkedin.com/in/..."
                            className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cpoint-turquoise"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-c-text-tertiary mb-1">Notes (optional)</label>
                        <textarea
                          value={link.notes || ''}
                          onChange={(e) => setEditVerifiedLinks(prev => prev.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))}
                          placeholder="Primary professional profile, key article, personal blog, etc."
                          rows={2}
                          className="w-full px-3 py-2 bg-c-hover-bg border border-c-border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cpoint-turquoise resize-none"
                        />
                      </div>
                    </div>
                  ))}

                  {editVerifiedLinks.length === 0 && (
                    <div className="text-center py-10 text-white/30 text-sm border border-dashed border-white/20 rounded-2xl">
                      No verified links yet. Add your LinkedIn, personal site, key articles, or social profiles.
                      <br />
                      <span className="text-cpoint-turquoise">Steve will use these as the primary source before any web search.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">Personal Context & Life Notes</label>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder="Share any personal background, life experiences, values, interests, or context that would help Steve understand you better..."
                      className="w-full h-80 px-5 py-4 bg-c-hover-bg border border-c-border rounded-2xl text-sm leading-relaxed text-white placeholder-white/40 focus:outline-none focus:border-cpoint-turquoise resize-y"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-c-border bg-[#161618] flex gap-3">
              <button
                onClick={() => {
                  setEditingSteveProfile(null)
                  setEditSection(null)
                  setEditContent('')
                  setEditExperiences([])
                  setEditVerifiedLinks([])
                }}
                className="flex-1 py-3.5 bg-c-hover-bg hover:bg-c-hover-bg border border-c-border rounded-2xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSteveEdit}
                className="flex-1 py-3.5 bg-cpoint-turquoise hover:bg-[#45a099] text-black rounded-2xl text-sm font-semibold transition-colors"
              >
                Save to Steve's Knowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Base Modal (supports both users and networks) */}
      {showKnowledgeBase && (
        <KnowledgeBaseGraph
          username={selectedProfileUsername || undefined}
          networkId={selectedNetworkId}
          open={showKnowledgeBase}
          onClose={() => {
            setShowKnowledgeBase(false)
            setSelectedProfileUsername('')
            setSelectedNetworkId(null)
          }}
        />
      )}
    </div>
  )
}
