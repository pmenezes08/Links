import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { invalidateDashboardCache } from '../utils/dashboardCache'
import { triggerDashboardServerPull } from '../utils/serverPull'
import { clearDeviceCache } from '../utils/deviceCache'

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

  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'communities' | 'metrics' | 'content_review' | 'blocked_users'>('overview')
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'premium' | 'free'>('all')
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [showLogoModal, setShowLogoModal] = useState(false)
  const [currentLogo, setCurrentLogo] = useState<string | null>(null)
  const [logoStatus, setLogoStatus] = useState<'loading' | 'success' | 'error'>('loading')
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
      const response = await fetch('/api/check_admin', { credentials: 'include' })
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
    try {
      const response = await fetch('/api/admin/dashboard', { credentials: 'include' })
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

  const loadCurrentLogo = async () => {
    try {
      setLogoStatus('loading')
      const response = await fetch('/get_logo', { credentials: 'include' })
      const data = await response.json()

      if (data.success && data.logo_path) {
        setCurrentLogo(`/static/${data.logo_path}`)
        setLogoStatus('success')
      } else {
        setCurrentLogo(null)
        setLogoStatus('success')
      }
    } catch (error) {
      console.error('Error loading logo:', error)
      setLogoStatus('error')
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

  const loadReportedPosts = useCallback(async (status: string = 'pending') => {
    setReportsLoading(true)
    try {
      const response = await fetch(`/api/admin/reported_posts?status=${status}`, {
        credentials: 'include'
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
        credentials: 'include'
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
    loadCurrentLogo()
    loadWelcomeCards()
  }, [setTitle, loadWelcomeCards])

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

  // Check URL for tab parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab === 'content_review') {
      setActiveTab('content_review')
    } else if (tab === 'blocked_users') {
      setActiveTab('blocked_users')
    }
  }, [])

  const handleLogoUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('logo', file)

    try {
      const response = await fetch('/upload_logo', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })

      const data = await response.json()
      if (data.success) {
        alert('Logo uploaded successfully!')
        loadCurrentLogo()
        setShowLogoModal(false)
      } else {
        alert('Error uploading logo: ' + data.error)
      }
    } catch (error) {
      console.error('Error uploading logo:', error)
      alert('Error uploading logo')
    }
  }

  const handleRemoveLogo = async () => {
    if (!confirm('Are you sure you want to remove the logo?')) return

    try {
      const response = await fetch('/remove_logo', {
        method: 'POST',
        credentials: 'include'
      })

      const data = await response.json()
      if (data.success) {
        alert('Logo removed successfully!')
        loadCurrentLogo()
        setShowLogoModal(false)
      } else {
        alert('Error removing logo: ' + data.error)
      }
    } catch (error) {
      console.error('Error removing logo:', error)
      alert('Error removing logo')
    }
  }

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

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-xl">Loading admin dashboard...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Secondary nav like Communities page */}
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-4xl mx-auto h-full flex">
          <button 
            onClick={() => setActiveTab('overview')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'overview' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Overview</div>
            <div className={`h-0.5 ${activeTab === 'overview' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('users')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'users' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Users</div>
            <div className={`h-0.5 ${activeTab === 'users' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('communities')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'communities' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Communities</div>
            <div className={`h-0.5 ${activeTab === 'communities' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('metrics')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'metrics' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Key Metrics</div>
            <div className={`h-0.5 ${activeTab === 'metrics' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('content_review')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'content_review' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Reports</div>
            <div className={`h-0.5 ${activeTab === 'content_review' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
          <button 
            onClick={() => setActiveTab('blocked_users')}
            className={`flex-1 text-center text-sm font-medium ${
              activeTab === 'blocked_users' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'
            }`}
          >
            <div className="pt-2">Blocks</div>
            <div className={`h-0.5 ${activeTab === 'blocked_users' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
          </button>
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
            {/* Logo Management Section */}
            <div className="bg-white/5 backdrop-blur rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-4 text-[#4db6ac]">App Logo Management</h3>

              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center">
                  <div className="text-sm text-white/60 mb-2">Current Logo</div>
                  <div className="w-24 h-16 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center mb-3">
                    {logoStatus === 'loading' ? (
                      <div className="text-xs text-white/60">Loading...</div>
                    ) : currentLogo ? (
                      <img src={currentLogo} alt="Current Logo" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <div className="text-xs text-white/60">No Logo</div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowLogoModal(true)}
                      className="px-3 py-1 text-xs bg-[#4db6ac] text-black rounded-lg hover:bg-[#45a099]"
                    >
                      Change
                    </button>
                    {currentLogo && (
                      <button
                        onClick={handleRemoveLogo}
                        className="px-3 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                      <div className="text-sm font-medium mb-1">Logo Status</div>
                      <div className="text-xs">
                        {logoStatus === 'loading' && <span className="text-white/60">Loading...</span>}
                        {logoStatus === 'success' && currentLogo && <span className="text-[#4db6ac]">Uploaded</span>}
                        {logoStatus === 'success' && !currentLogo && <span className="text-yellow-400">Not Set</span>}
                        {logoStatus === 'error' && <span className="text-red-400">Error</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={async () => {
                        try{
                          const r = await fetch('/admin/regenerate_app_icons', { method:'POST', credentials:'include' })
                          const j = await r.json()
                          if (j?.success) {
                            alert('App icons regenerated. Remove and re-add the PWA to update the home screen icon.')
                          } else {
                            alert('Failed to regenerate icons: ' + (j?.error || 'Unknown error'))
                          }
                        }catch{ alert('Server error') }
                      }}
                      className="px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-sm hover:bg-white/15"
                    >
                      Regenerate App Icons
                    </button>
                  </div>
                </div>
              </div>
            </div>

              {/* Welcome Cards Management */}
              <div className="bg-white/5 backdrop-blur rounded-xl p-6 border border-white/10">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[#4db6ac]">Welcome Page Cards</h3>
                    <p className="text-xs text-white/60 mt-1">
                      These three images appear on the public welcome page carousel. Use square or wide images (recommended 1920×1080).
                    </p>
                  </div>
                  <div className="text-xs text-white/50">
                    {welcomeStatus === 'loading' && <span className="text-white/60">Loading…</span>}
                    {welcomeStatus === 'success' && <span className="text-[#4db6ac]">Up to date</span>}
                    {welcomeStatus === 'error' && <span className="text-red-400">Failed to load</span>}
                  </div>
                </div>

                {welcomeMessage && (
                  <div className="mb-3 rounded-lg border border-[#4db6ac]/40 bg-[#4db6ac]/10 px-3 py-2 text-xs text-[#7fe7df]">
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
                      <div key={index} className="bg-black/30 border border-white/10 rounded-xl p-3 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-white/80">Card {index + 1}</div>
                          {cardUrl ? (
                            <a
                              href={cardUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-[#4db6ac] hover:text-[#7fe7df]"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="text-xs text-white/40">Using default</span>
                          )}
                        </div>

                        <div className="aspect-video rounded-lg overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center">
                          {welcomeStatus === 'loading' && !cardUrl ? (
                            <div className="flex flex-col items-center gap-2 text-white/50 text-xs">
                              <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                              Loading…
                            </div>
                          ) : cardUrl ? (
                            <img
                              src={cardUrl}
                              alt={`Welcome card ${index + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="text-xs text-white/50 px-4 text-center">
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
                          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm text-white/80 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={welcomeUploadingIndex === index}
                        >
                          {welcomeUploadingIndex === index ? 'Uploading…' : cardUrl ? 'Replace image' : 'Upload image'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

            {/* Key Metrics removed from overview; available in Metrics tab */}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.total_users}</div>
                <div className="text-xs text-white/60 mt-1">Total Users</div>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.premium_users}</div>
                <div className="text-xs text-white/60 mt-1">Premium Users</div>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.total_communities}</div>
                <div className="text-xs text-white/60 mt-1">Communities</div>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <div className="text-2xl font-bold text-[#4db6ac]">{stats.total_posts}</div>
                <div className="text-xs text-white/60 mt-1">Total Posts</div>
              </div>
            </div>

            {/* Leaderboards removed from overview; available in Metrics tab */}

            {/* Parent Communities section removed per request */}

            {/* Quick Actions */}
              <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button 
                    onClick={() => { setActiveTab('users'); setShowAddUserModal(true) }}
                    className="py-2 px-3 bg-[#4db6ac]/20 text-[#4db6ac] rounded-lg text-sm font-medium hover:bg-[#4db6ac]/30 transition-colors"
                  >
                    Add New User
                  </button>
                  <button 
                    onClick={() => navigate('/communities')}
                    className="py-2 px-3 bg-[#4db6ac]/20 text-[#4db6ac] rounded-lg text-sm font-medium hover:bg-[#4db6ac]/30 transition-colors"
                  >
                    Create Community
                  </button>
                  <button
                    onClick={() => {
                      resetBroadcastForm()
                      setShowBroadcastModal(true)
                    }}
                    className="py-2 px-3 bg-[#4db6ac]/20 text-[#4db6ac] rounded-lg text-sm font-medium hover:bg-[#4db6ac]/30 transition-colors"
                  >
                    Broadcast Notification
                  </button>
                </div>
              </div>
          </div>
        )}

        {/* Metrics Tab */}
        {activeTab === 'metrics' && stats && (
          <div className="space-y-4">
            <div className="bg-white/5 backdrop-blur rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3 text-[#4db6ac]">Key Metrics</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">DAU</div>
                  <div className="text-xl font-bold">{stats.dau ?? '—'}</div>
                  <div className="text-xs text-white/60">{stats.dau_pct != null ? `${stats.dau_pct}% of users` : ''}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">MAU</div>
                  <div className="text-xl font-bold">{stats.mau ?? '—'}</div>
                  <div className="text-xs text-white/60">{stats.mau_pct != null ? `${stats.mau_pct}% of users` : ''}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">Total Users</div>
                  <div className="text-xl font-bold">{stats.total_users}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">Total Communities</div>
                  <div className="text-xl font-bold">{stats.total_communities}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-white/60">Avg DAU (30d)</div>
                  <div className="text-xl font-bold">{stats.avg_dau_30 ?? '—'}</div>
                  <div className="text-xs text-white/60">daily avg</div>
                </div>
              </div>
            </div>

            {/* Returning Users */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-1">Monthly Returning Users</div>
                <div className="text-xs text-white/60 mb-2">Previous month ∩ current month</div>
                <div className="flex items-end gap-4">
                  <div>
                    <div className="text-[11px] text-white/60">MRU</div>
                    <div className="text-xl font-bold">{stats.mru ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/60">MAU (month)</div>
                    <div className="text-xl font-bold">{stats.mau_month ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/60">Repeat rate</div>
                    <div className="text-xl font-bold">{stats.mru_repeat_rate_pct != null ? `${stats.mru_repeat_rate_pct}%` : '—'}</div>
                  </div>
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-1">Weekly Returning Users</div>
                <div className="text-xs text-white/60 mb-2">Previous week ∩ current week</div>
                <div className="flex items-end gap-4">
                  <div>
                    <div className="text-[11px] text-white/60">WRU</div>
                    <div className="text-xl font-bold">{stats.wru ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/60">WAU</div>
                    <div className="text-xl font-bold">{stats.wau ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/60">Repeat rate</div>
                    <div className="text-xl font-bold">{stats.wru_repeat_rate_pct != null ? `${stats.wru_repeat_rate_pct}%` : '—'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cohort Retention removed per request */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-2">Top Posters</div>
                <div className="space-y-1 text-sm">
                  {stats.leaderboards?.top_posters?.length ? stats.leaderboards.top_posters.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-white/80">{i+1}. {u.username}</span>
                      <span className="text-white/60">{u.count}</span>
                    </div>
                  )) : <div className="text-white/60">No data</div>}
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-2">Top Reactors</div>
                <div className="space-y-1 text-sm">
                  {stats.leaderboards?.top_reactors?.length ? stats.leaderboards.top_reactors.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-white/80">{i+1}. {u.username}</span>
                      <span className="text-white/60">{u.count}</span>
                    </div>
                  )) : <div className="text-white/60">No data</div>}
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-sm font-semibold mb-2">Top Voters</div>
                <div className="space-y-1 text-sm">
                  {stats.leaderboards?.top_voters?.length ? stats.leaderboards.top_voters.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <span className="text-white/80">{i+1}. {u.username}</span>
                      <span className="text-white/60">{u.count}</span>
                    </div>
                  )) : <div className="text-white/60">No data</div>}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-3">
            {/* Search and Filter Bar */}
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10 flex items-center gap-2">
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]"
              />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
              >
                <option value="all">All</option>
                <option value="premium">Premium</option>
                <option value="free">Free</option>
              </select>
              <button
                onClick={() => setShowAddUserModal(true)}
                className="px-3 py-1.5 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Add User
              </button>
            </div>

            {/* Users List */}
            <div className="space-y-2">
              {filteredUsers.map(user => (
                <div key={user.username} className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-[#4db6ac] rounded-full flex items-center justify-center text-xs font-bold text-black">
                        {user.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{user.username}</div>
                        <div className="text-xs text-white/60">
                          {user.subscription === 'premium' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#4db6ac]/20 text-[#4db6ac] font-medium">
                              PREMIUM
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                              FREE
                            </span>
                          )}
                          {user.is_admin && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                              ADMIN
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleUserUpdate(user.username, { 
                          subscription: user.subscription === 'premium' ? 'free' : 'premium' 
                        })}
                        className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
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
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10 flex items-center gap-2">
              <input
                type="text"
                placeholder="Search communities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]"
              />
              <button
                onClick={() => navigate('/communities')}
                className="px-3 py-1.5 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Create New
              </button>
            </div>

            {/* Communities List - Show parent communities with their children */}
            <div className="space-y-3">
              {filteredCommunities.filter(c => !c.parent_community_id).map(community => (
                <div key={community.id} className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold text-sm">{community.name}</h3>
                      <p className="text-xs text-white/60">{community.type}</p>
                    </div>
                    <span className="text-xs bg-[#4db6ac]/20 text-[#4db6ac] px-2 py-1 rounded">
                      {community.member_count} members
                    </span>
                  </div>
                  <div className="text-xs text-white/60 mb-3">
                    <div>Creator: {community.creator_username}</div>
                    <div>Code: {community.join_code}</div>
                  </div>
                  
                  {/* Show child communities if any */}
                  {community.children && community.children.length > 0 && (
                    <div className="mb-3 p-2 bg-black/20 rounded-lg">
                      <p className="text-xs text-white/60 mb-2">Sub-communities:</p>
                      <div className="space-y-2">
                        {community.children.map(child => (
                          <div key={child.id} className="flex justify-between items-center">
                            <div className="text-xs">
                              <span className="text-white/80">• {child.name}</span>
                              <span className="text-white/50 ml-2">({child.type})</span>
                            </div>
                            <div className="flex gap-1">
                              <span className="text-xs text-white/50">{child.member_count} members</span>
                              <button
                                onClick={() => navigate(`/community_feed_react/${child.id}`)}
                                className="px-2 py-0.5 text-xs bg-white/5 border border-white/10 rounded hover:bg-white/10"
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
                      onClick={() => handleInviteUser(community.id, community.name)}
                      className="px-2 py-1 text-xs rounded-lg bg-[#4db6ac]/10 border border-[#4db6ac]/20 text-[#4db6ac] hover:bg-[#4db6ac]/20"
                    >
                      Invite
                    </button>
                    <button
                      onClick={() => navigate(`/community_feed_react/${community.id}`)}
                      className="flex-1 py-1 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
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
              <h4 className="text-sm font-semibold mb-2 text-white/80">All Communities (flat list)</h4>
              <div className="space-y-2">
                {filteredFlatCommunities.map(c => (
                  <div key={c.id} className="flex items-center justify-between bg-white/5 rounded-lg p-2 border border-white/10">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-[#4db6ac]/30 text-[#4db6ac] rounded flex items-center justify-center text-[10px] font-bold">
                        {c.name.substring(0,2).toUpperCase()}
                      </div>
                      <div className="text-xs">
                        <div className="text-white/90 font-medium">{c.name}</div>
                        <div className="text-white/50">{c.type}{c.parent_community_id ? ` — child of ${c.parent_community_id}` : ' — parent'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/community_feed_react/${c.id}`)}
                        className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded hover:bg-white/10"
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
            <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[#4db6ac]">Reported Posts</h3>
                <select
                  value={reportsFilter}
                  onChange={(e) => setReportsFilter(e.target.value as any)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="dismissed">Dismissed</option>
                  <option value="all">All</option>
                </select>
              </div>

              {reportsLoading ? (
                <div className="text-center py-8 text-white/60">Loading reports...</div>
              ) : reportedPosts.length === 0 ? (
                <div className="text-center py-8 text-white/60">
                  <i className="fa-solid fa-check-circle text-2xl mb-2 text-green-400" />
                  <div>No {reportsFilter === 'all' ? '' : reportsFilter} reports</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {reportedPosts.map(report => (
                    <div key={report.report_id} className="bg-black/30 border border-white/10 rounded-xl p-4">
                      {/* Report Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            report.status === 'pending' ? 'bg-orange-500/20 text-orange-400' :
                            report.status === 'reviewed' ? 'bg-green-500/20 text-green-400' :
                            'bg-white/10 text-white/60'
                          }`}>
                            {report.status.toUpperCase()}
                          </div>
                          <span className="text-xs text-white/60">
                            {report.report_count} report{report.report_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="text-xs text-white/50">
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
                          <div className="text-xs text-white/60">{report.details}</div>
                        )}
                        <div className="text-[11px] text-white/40 mt-1">
                          Reported by: @{report.reporter_username}
                        </div>
                      </div>

                      {/* Post Preview */}
                      <div className="border border-white/10 rounded-lg p-3 mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-6 h-6 bg-[#4db6ac]/30 rounded-full flex items-center justify-center text-[10px] font-bold text-[#4db6ac]">
                            {report.post_author[0]?.toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-white/80">@{report.post_author}</span>
                          {report.community_name && (
                            <span className="text-xs text-[#4db6ac]">in {report.community_name}</span>
                          )}
                        </div>
                        <div className="text-sm text-white/70 line-clamp-3">{report.post_content}</div>
                        {(report.image_path || report.video_path) && (
                          <div className="mt-2 text-xs text-white/50">
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
                            className="flex-1 py-2 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                          >
                            View Post
                          </button>
                          <button
                            onClick={() => handleReviewReport(report.report_id, 'dismiss')}
                            className="flex-1 py-2 text-xs rounded-lg bg-white/10 border border-white/20 hover:bg-white/15"
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
                        <div className="text-xs text-white/40">
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
            <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[#4db6ac]">
                  <i className="fa-solid fa-ban mr-2" />
                  Blocked Users
                </h3>
                <button
                  onClick={loadBlockedUsers}
                  className="text-xs text-[#4db6ac] hover:underline"
                >
                  <i className="fa-solid fa-refresh mr-1" />
                  Refresh
                </button>
              </div>

              {blockedUsersLoading ? (
                <div className="text-center py-8 text-white/60">Loading blocked users...</div>
              ) : blockedUsers.length === 0 ? (
                <div className="text-center py-8 text-white/60">
                  <i className="fa-solid fa-check-circle text-2xl mb-2 text-green-400" />
                  <div>No blocked users</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {blockedUsers.map(block => (
                    <div key={block.id} className="bg-black/30 border border-white/10 rounded-xl p-4">
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
                              <div className="w-8 h-8 bg-[#4db6ac]/30 rounded-full flex items-center justify-center text-xs font-bold text-[#4db6ac]">
                                {block.blocker_username[0]?.toUpperCase()}
                              </div>
                            )}
                            <span className="text-sm font-medium text-white/90">@{block.blocker_username}</span>
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
                            <span className="text-sm font-medium text-white/90">@{block.blocked_username}</span>
                          </div>
                        </div>

                        <div className="text-xs text-white/50">
                          {new Date(block.blocked_at).toLocaleDateString()}
                        </div>
                      </div>

                      {/* Block Reason */}
                      {block.reason && (
                        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                          <div className="text-sm text-white/70">
                            <i className="fa-solid fa-quote-left mr-2 text-xs text-red-400/60" />
                            {block.reason}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => navigate(`/profile/${block.blocker_username}`)}
                          className="flex-1 py-2 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                        >
                          View @{block.blocker_username}
                        </button>
                        <button
                          onClick={() => navigate(`/profile/${block.blocked_username}`)}
                          className="flex-1 py-2 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
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
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Add New User</h2>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs text-white/60 mb-1">Username</label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#4db6ac]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Password</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#4db6ac]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Subscription</label>
                <select
                  value={newUser.subscription}
                  onChange={(e) => setNewUser({ ...newUser, subscription: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="free">Free</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#4db6ac] text-black rounded-lg font-medium hover:bg-[#45a099]"
                >
                  Add User
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddUserModal(false)
                    setNewUser({ username: '', password: '', subscription: 'free' })
                  }}
                  className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
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
            <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-lg border border-white/10">
              <h2 className="text-lg font-semibold mb-3 text-[#4db6ac]">Broadcast Notification</h2>
              <p className="text-xs text-white/60 mb-4">
                Send a message to every active member on the platform. Use this for important announcements.
              </p>

              {broadcastSuccess && (
                <div className="mb-3 rounded-lg border border-[#4db6ac]/40 bg-[#4db6ac]/10 px-3 py-2 text-xs text-[#7fe7df]">
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
                  <label className="block text-xs text-white/60 mb-1">
                    Title <span className="text-white/40">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    maxLength={140}
                    placeholder="System Maintenance Tonight"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]"
                    disabled={broadcastSending}
                  />
                </div>

                <div>
                  <label className="block text-xs text-white/60 mb-1">Message</label>
                  <textarea
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                    placeholder="We're performing scheduled maintenance at 10 PM UTC..."
                    rows={5}
                    maxLength={2000}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]"
                    disabled={broadcastSending}
                    required={!broadcastTitle.trim()}
                  />
                  <div className="text-[11px] text-white/40 mt-1">
                    {broadcastMessage.length}/2000 characters
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-white/60 mb-1">
                    Link <span className="text-white/40">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={broadcastLink}
                    onChange={(e) => setBroadcastLink(e.target.value)}
                    placeholder="https://status.yourapp.com/maintenance"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-[#4db6ac]"
                    disabled={broadcastSending}
                  />
                  <p className="text-[11px] text-white/40 mt-1">Recipients will be taken to this URL when they open the notification.</p>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={broadcastSending}
                    className="flex-1 py-2 bg-[#4db6ac] text-black rounded-lg font-medium hover:bg-[#45a099] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {broadcastSending ? 'Sending…' : 'Send Notification'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetBroadcastForm()
                      setShowBroadcastModal(false)
                    }}
                    className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
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
            <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] shadow-xl shadow-black/40">
              <div className="max-h-[85vh] overflow-y-auto px-6 py-6">
              <h2 className="text-lg font-semibold mb-2">Invite to {inviteCommunityName}</h2>
              <p className="text-sm text-white/60 mb-4">Choose how you want to invite members</p>

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
                  <div className="mb-4 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Nested communities</div>
                    <div className="space-y-2 text-sm text-white/80">
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
                                ? 'border-[#4db6ac]/60 bg-[#4db6ac]/15 text-white shadow-lg shadow-[#4db6ac]/10'
                                : 'border-white/10 bg-black/40 text-white/70 hover:border-white/20 hover:bg-black/50'
                            }`}
                            onClick={() => setInviteScope(option.value as typeof inviteScope)}
                          >
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 bg-black/60 text-[10px] text-white/70">
                              {selected ? (
                                <span className="h-2 w-2 rounded-full bg-[#4db6ac]" />
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
                          className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80 hover:border-white/20 hover:bg-black/40"
                        >
                          <span>
                            {inviteSelectedNestedIds.length === 0
                              ? 'No nested communities selected'
                              : `${inviteSelectedNestedIds.length} nested ${inviteSelectedNestedIds.length === 1 ? 'community' : 'communities'} selected`}
                          </span>
                          <i className={`fa-solid fa-chevron-${inviteNestedDropdownOpen ? 'up' : 'down'} text-xs text-white/60`} />
                        </button>
                        {inviteNestedDropdownOpen && (
                          <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2 space-y-1">
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
                                      ? 'border-[#4db6ac]/60 bg-[#4db6ac]/15 text-white shadow-lg shadow-[#4db6ac]/10'
                                      : 'border-white/10 bg-black/30 text-white/70 hover:border-white/20 hover:bg-black/40'
                                  }`}
                                  style={{ paddingLeft: `${(option.depth + 1) * 16}px` }}
                                >
                                  <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-white/20 bg-black/40 text-[10px] text-white/70">
                                    {selected ? (
                                      <i className="fa-solid fa-check text-[#4db6ac]" />
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
                  <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Parent communities</div>
                    <p className="text-xs text-white/40">Decide if the invitee should also join parent communities.</p>
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
                              ? 'border-[#4db6ac]/60 bg-[#4db6ac]/15 text-white shadow-lg shadow-[#4db6ac]/10'
                              : 'border-white/10 bg-black/30 text-white/70 hover:border-white/20 hover:bg-black/40'
                          }`}
                        >
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-white/20 bg-black/40 text-[10px] text-white/70">
                            {selected ? (
                              <i className="fa-solid fa-check text-[#4db6ac]" />
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
                  <label className="block text-xs text-white/60 mb-2">Send invitation via email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-sm text-white placeholder-white/50 focus:border-[#4db6ac] focus:outline-none"
                    disabled={inviteLoading || inviteSuccess}
                  />
                  <button
                    onClick={handleSendInvite}
                    className="w-full mt-2 px-4 py-2 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099] disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-[#1a1a1a] text-white/40">OR</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-white/60 mb-2">Share via QR code</label>
                  <button
                    onClick={handleGenerateQR}
                    className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-sm font-medium hover:bg-white/10 disabled:opacity-50"
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
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:bg-white/10"
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
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h2 className="text-lg font-semibold mb-2">QR Code Invitation</h2>
            <p className="text-sm text-white/60 mb-4">Scan this QR code to join {inviteCommunityName}</p>

            <div className="bg-white p-6 rounded-xl mb-4 flex justify-center">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl)}`}
                alt="Invitation QR Code"
                className="w-64 h-64"
              />
            </div>

            <div className="text-xs text-white/40 mb-4 text-center break-all">
              {qrCodeUrl}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowQRCode(false)
                  setShowInviteModal(true)
                }}
                className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:bg-white/10"
              >
                Back
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(qrCodeUrl)
                  alert('Link copied to clipboard!')
                }}
                className="flex-1 px-4 py-2 bg-[#4db6ac] text-black rounded-lg text-sm font-medium hover:bg-[#45a099]"
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logo Upload Modal */}
      {showLogoModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 w-full max-w-md border border-white/10">
            <h2 className="text-lg font-semibold mb-4">Change App Logo</h2>

            {/* Current Logo Preview */}
            <div className="mb-4">
              <div className="text-sm text-white/60 mb-2">Current Logo</div>
              <div className="w-full h-20 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center mb-3">
                {currentLogo ? (
                  <img src={currentLogo} alt="Current Logo" className="max-w-full max-h-full object-contain" />
                ) : (
                  <div className="text-sm text-white/60">No logo uploaded</div>
                )}
              </div>
            </div>

            {/* Upload Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const fileInput = document.getElementById('logoFile') as HTMLInputElement
                if (fileInput?.files?.[0]) {
                  handleLogoUpload(fileInput.files[0])
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm text-white/60 mb-1">Select New Logo</label>
                <input
                  id="logoFile"
                  type="file"
                  accept="image/*"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-[#4db6ac]"
                  required
                />
                <div className="text-xs text-white/40 mt-1">Supported formats: PNG, JPG, SVG, WEBP (Max 200×100px)</div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#4db6ac] text-black rounded-lg font-medium hover:bg-[#45a099]"
                >
                  Upload Logo
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogoModal(false)}
                  className="flex-1 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteUserModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0b0f10] rounded-2xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold mb-2 text-white">Delete User: {deleteUserModal.username}</h2>
            <p className="text-sm text-white/60 mb-6">
              Choose how to handle this user's data:
            </p>

            {/* Option 1: Preserve Data */}
            <button
              onClick={() => setDeletePreserveData(true)}
              className={`w-full mb-3 p-4 rounded-xl border text-left transition ${
                deletePreserveData
                  ? 'border-[#4db6ac] bg-[#4db6ac]/10'
                  : 'border-white/10 bg-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    deletePreserveData ? 'border-[#4db6ac] bg-[#4db6ac]' : 'border-white/30'
                  }`}>
                    {deletePreserveData && <i className="fa-solid fa-check text-xs text-black" />}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-white mb-1">Preserve User Content</div>
                  <div className="text-xs text-white/60">
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
                  : 'border-white/10 bg-white/5 hover:border-white/20'
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
                  <div className="text-xs text-white/60">
                    Permanently remove user and ALL their content: posts, messages, reactions, uploads. Cannot be undone.
                  </div>
                </div>
              </div>
            </button>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteUserModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-white hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteUser}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold ${
                  deletePreserveData
                    ? 'bg-[#4db6ac] text-black hover:brightness-110'
                    : 'bg-red-500 text-white hover:bg-red-600'
                }`}
              >
                {deletePreserveData ? 'Delete Account Only' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}