import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { BrowserRouter, Routes, Route, useLocation, useNavigate, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { extractInviteToken, isInternalLink } from './utils/internalLinkHandler'
import {
  isClipboardInviteConsumed,
  markClipboardInviteConsumed,
  parseInviteTokenFromClipboard,
} from './utils/clipboardInvite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import MobileLogin from './pages/MobileLogin'
import PremiumDashboard from './pages/PremiumDashboard'
import HeaderBar from './components/HeaderBar'
import { HeaderContext } from './contexts/HeaderContext'
import { UserProfileContext, type UserProfile } from './contexts/UserProfileContext'
import PushInit from './components/PushInit'
import NotificationPrompt from './components/NotificationPrompt'
import { EntitlementsProvider } from './contexts/EntitlementsContext'
import { LogoutPromptProvider } from './contexts/LogoutPromptContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { NetworkProvider } from './contexts/NetworkContext'
import { BadgeProvider } from './contexts/BadgeContext'
import OfflineBanner from './components/OfflineBanner'
import OutboxDrainer from './components/OutboxDrainer'
import BrandAssetsInit from './components/BrandAssetsInit'
import BasicProfileGateProvider from './components/basic-profile/BasicProfileGateProvider'
import AgeGateController from './components/onboarding/AgeGate'
import LocaleBootstrap from './components/LocaleBootstrap'
import CrossfitExact from './pages/CrossfitExact'
import CommunityFeed from './pages/CommunityFeed'
import CommunityCalendar from './pages/CommunityCalendar'
import CommunityTasks from './pages/CommunityTasks'
import CommunityPolls from './pages/CommunityPolls'
import CommunityResources from './pages/CommunityResources'
import UsefulLinks from './pages/UsefulLinks'
import CommunityPhotos from './pages/CommunityPhotos'
import PostDetail from './pages/PostDetail'
import CreatePost from './pages/CreatePost'
import Members from './pages/Members'
import EditCommunity from './pages/EditCommunity'
import Communities from './pages/Communities'
import Followers from './pages/Followers'
import Networking from './pages/Networking'
import HomeTimeline from './pages/HomeTimeline'
import WorkoutTracking from './pages/WorkoutTracking'
import Gym from './pages/Gym'
import YourSports from './pages/YourSports'
import Messages from './pages/Messages'
import NewMessage from './pages/NewMessage'
import ChatThread from './pages/ChatThread'
import GroupChatThread from './pages/GroupChatThread'
import GroupChatMedia from './pages/GroupChatMedia'
import ChatMedia from './pages/ChatMedia'
import GroupChatDocuments from './pages/GroupChatDocuments'
import ChatDocuments from './pages/ChatDocuments'
import Profile from './pages/Profile'
import PublicProfile from './pages/PublicProfile'
import AccountSettings from './pages/AccountSettings'
import AccountSecurity from './pages/AccountSecurity'
import AccountDangerZone from './pages/AccountDangerZone'
import SubscriptionPlans from './pages/SubscriptionPlans'
import Success from './pages/Success'
import Signup from './pages/Signup'
import InvitePreview from './pages/InvitePreview'
import Notifications from './pages/Notifications'
import AdminDashboard from './pages/AdminDashboard'
import AdminProfile from './pages/AdminProfile'
import KeyPosts from './pages/KeyPosts'
import AboutCPoint from './pages/AboutCPoint'
import OnboardingWelcome from './pages/OnboardingWelcome'
import ScopedProfileBuilder from './pages/ScopedProfileBuilder'
import VerifyOverlay from './components/VerifyOverlay'
import { isPremiumDashboardPath } from './components/DashboardBottomNav'
import { isDashboardTabPath } from './components/pageTransitionUtils'
import DashboardLayout from './components/DashboardLayout'
import PageTransitionStack from './components/PageTransitionStack'
import { saveScrollPosition, getScrollPosition } from './utils/scrollRestoration'

const TRANSITIONS_ENABLED = import.meta.env.VITE_PAGE_TRANSITIONS === 'true'
import { useSafeAreaSync } from './hooks/useSafeAreaSync'
import { useThemedNativeChrome } from './hooks/useThemedNativeChrome'
import { useMediaUploadResume } from './hooks/useMediaUploadResume'
import EventDetail from './pages/EventDetail'
import GroupFeed from './pages/GroupFeed'
import EditGroup from './pages/EditGroup'
import CommentReply from './pages/CommentReply'
import ShareIncomingRouteRedirect from './pages/ShareIncomingRouteRedirect'
import { isOnboardingFullscreenOverlayActive } from './utils/fullscreenOverlay'
import { ensureAccountIsolationForUsername } from './utils/accountStateReset'
import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from './constants/googleOAuth'

const queryClient = new QueryClient()

function ChatThreadRoute() {
  const { username } = useParams()
  return <ChatThread key={username} />
}

function GroupChatThreadRoute() {
  const { group_id } = useParams()
  return <GroupChatThread key={group_id} />
}

function AppRoutes(){
  const { t } = useTranslation()
  useSafeAreaSync()
  // Native chrome (status bar + iOS keyboard) tracks the active theme;
  // mounted once at the route shell so every page inherits the right
  // polarity instead of each themed page re-applying it.
  useThemedNativeChrome()
  const [title, setTitle] = useState('')
  const [titleAccessory, setTitleAccessory] = useState<ReactNode>(null)
  const [headerHiddenOverride, setHeaderHiddenOverride] = useState(false)
  const [userMeta, setUserMeta] = useState<{ username?:string; displayName?:string|null; avatarUrl?:string|null }>({})
  const location = useLocation()
  const isFirstPage = location.pathname === '/'
  const navigate = useNavigate()
  // Native-style scroll restoration: track the current route's scroll key (path +
  // search) so a scroll listener can stamp offsets against it, and remember a
  // pending restore to apply once a back-transition settles. Keyed by PATH (not
  // history key) because the in-app "smart back" PUSHes the feed path rather than
  // popping history, so a per-entry key would never match on return.
  const currentScrollKeyRef = useRef(location.pathname + location.search)
  currentScrollKeyRef.current = location.pathname + location.search
  const pendingScrollRestoreRef = useRef<number | null>(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const [isVerified, setIsVerified] = useState<boolean | null>(null)
  const [requireVerification] = useState(() => (import.meta as any).env?.VITE_REQUIRE_VERIFICATION_CLIENT === 'true')
  const [profileData, setProfileData] = useState<UserProfile>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [uploadStatusToast, setUploadStatusToast] = useState<string | null>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [fullscreenOverlayTick, setFullscreenOverlayTick] = useState(0)
  const isChatRoute = location.pathname.startsWith('/user_chat/chat/') || location.pathname.startsWith('/group_chat/')
  useMediaUploadResume(authLoaded && !!userMeta.username)

  const scrollRegionRef = useRef<HTMLDivElement | null>(null)
  const publicPaths = useMemo(
    () =>
      new Set([
        '/',
        '/welcome',
        '/onboarding',
        '/login',
        '/signup',
        '/signup_react',
        '/invite-preview',
        '/verify_required',
        '/share/incoming',
      ]),
    [],
  )

  const applyProfileFromServer = useCallback(async (profile: Record<string, unknown>) => {
    setProfileData(profile)
    setIsVerified(!!(profile as any)?.email_verified)
    setProfileError(null)

    const username = (profile as any)?.username as string | undefined
    if (username) {
      try {
        await ensureAccountIsolationForUsername(username)
      } catch (e) {
        console.warn('Error clearing account-scoped state for user change:', e)
      }
    }

    try {
      localStorage.setItem('cached_profile', JSON.stringify(profile))
    } catch { /* ignore */ }

    if (username) {
      try {
        localStorage.setItem('current_username', username)
      } catch { /* ignore */ }
    }


    if (!sessionStorage.getItem('geo_countries')) {
      fetch('/api/geo/countries', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (d?.success && Array.isArray(d.countries)) {
            const names = d.countries
              .map((item: any) => (typeof item?.name === 'string' ? item.name : null))
              .filter(Boolean)
            try {
              sessionStorage.setItem('geo_countries', JSON.stringify(names))
            } catch { /* ignore */ }
          }
        })
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    const bump = () => setFullscreenOverlayTick(t => t + 1)
    window.addEventListener('cpoint-fullscreen-overlay', bump)
    return () => window.removeEventListener('cpoint-fullscreen-overlay', bump)
  }, [])

  const applyKeyboardOffset = useCallback((nextOffset: number) => {
    setKeyboardOffset(prev => (Math.abs(prev - nextOffset) < 1 ? prev : nextOffset))
    document.documentElement.style.setProperty('--keyboard-offset', `${nextOffset}px`)
    if (document.body) {
      document.body.dataset.keyboard = nextOffset > 0 ? 'open' : 'closed'
    }
  }, [])

  useLayoutEffect(() => {
    if (isChatRoute || isOnboardingFullscreenOverlayActive()) {
      applyKeyboardOffset(0)
      return
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null

    const updateOffset = () => {
      if (isChatRoute || isOnboardingFullscreenOverlayActive()) {
        applyKeyboardOffset(0)
        return
      }
      const nextOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      applyKeyboardOffset(nextOffset)
    }

    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }

    viewport.addEventListener('resize', handleChange)
    viewport.addEventListener('scroll', handleChange)
    updateOffset()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
      viewport.removeEventListener('scroll', handleChange)
      document.documentElement.style.removeProperty('--keyboard-offset')
      if (document.body) {
        delete document.body.dataset.keyboard
      }
    }
  }, [applyKeyboardOffset, isChatRoute, fullscreenOverlayTick])

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return

    Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {})
    Keyboard.setScroll({ isDisabled: true }).catch(() => {})

    // Chat + onboarding manage keyboard lift locally; Android uses visualViewport only (see useFixedComposerKeyboard).
    if (isChatRoute || isOnboardingFullscreenOverlayActive()) return
    if (Capacitor.getPlatform() !== 'ios') return

    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const handleShow = (info: KeyboardInfo) => {
      if (isOnboardingFullscreenOverlayActive()) {
        applyKeyboardOffset(0)
        return
      }
      const height = info?.keyboardHeight ?? 0
      applyKeyboardOffset(height)
    }

    const handleHide = () => {
      applyKeyboardOffset(0)
    }

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => {
      showSub = handle
    })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => {
      hideSub = handle
    })

    return () => {
      showSub?.remove()
      hideSub?.remove()
      applyKeyboardOffset(0)
    }
  }, [applyKeyboardOffset, isChatRoute, fullscreenOverlayTick])

  const processedUrlsRef = useRef<Set<string>>(new Set())
  const clipboardInviteAttemptedRef = useRef(false)
  const pendingShareUrlRef = useRef<string | null>(null)
  
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('cpoint_processed_deep_links')
      if (stored) {
        const urls = JSON.parse(stored) as string[]
        urls.forEach(url => processedUrlsRef.current.add(url))
      }
    } catch {
      // Ignore
    }
  }, [])
  
  const markUrlProcessed = useCallback((url: string) => {
    processedUrlsRef.current.add(url)
    try {
      sessionStorage.setItem('cpoint_processed_deep_links', JSON.stringify([...processedUrlsRef.current]))
    } catch (e) {
      console.warn('🔗 Failed to persist processed URLs:', e)
    }
  }, [])
  
  const isUrlProcessed = useCallback((url: string): boolean => {
    if (processedUrlsRef.current.has(url)) return true
    try {
      const stored = sessionStorage.getItem('cpoint_processed_deep_links')
      if (stored) {
        const urls = JSON.parse(stored) as string[]
        if (urls.includes(url)) {
          processedUrlsRef.current.add(url)
          return true
        }
      }
    } catch {
      // Ignore
    }
    return false
  }, [])

  const applyInviteTokenFromDeepLink = useCallback(
    async (inviteToken: string, sourceUrl: string) => {
      const clipboardDedupeKey = `clipboard:${inviteToken}`
      if (isUrlProcessed(sourceUrl) || isUrlProcessed(clipboardDedupeKey)) {
        console.log('🔗 URL already processed (persisted), skipping:', sourceUrl)
        return
      }

      console.log('🔗 Invite token found:', inviteToken.slice(0, 12) + '…')

      const currentUrl = window.location.href
      const currentPath = window.location.pathname

      if (currentUrl.includes(`invite=${inviteToken}`)) {
        console.log('🔗 Already on login page with this invite token, skipping redirect')
        markUrlProcessed(sourceUrl)
        markUrlProcessed(clipboardDedupeKey)
        return
      }

      if (currentPath.startsWith('/community_feed_react/')) {
        console.log('🔗 Already on community feed, marking URL as processed')
        markUrlProcessed(sourceUrl)
        markUrlProcessed(clipboardDedupeKey)
        return
      }

      markUrlProcessed(sourceUrl)
      markUrlProcessed(clipboardDedupeKey)

      try {
        sessionStorage.setItem('cpoint_pending_invite', JSON.stringify({ inviteToken }))
        console.log('🔗 Stored invite token in sessionStorage')
      } catch (e) {
        console.error('🔗 Failed to store invite token:', e)
      }

      if (profileData) {
        console.log('🔗 User is authenticated, opening invite preview')
        navigate(`/invite-preview/${encodeURIComponent(inviteToken)}`)
      } else {
        console.log('🔗 User not authenticated, redirecting to login with invite token')
        navigate(`/login?invite=${encodeURIComponent(inviteToken)}`)
      }
    },
    [navigate, profileData, isUrlProcessed, markUrlProcessed],
  )

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return

    const isShareIncomingUrl = (url: string): boolean => {
      if (url.startsWith('cpoint://share')) return true
      try {
        if (isInternalLink(url)) {
          const parsed = new URL(url)
          if (parsed.pathname === '/share/incoming' || parsed.pathname.startsWith('/share/incoming/')) {
            return true
          }
        }
      } catch {
        /* ignore */
      }
      return false
    }

    const applyShareIncoming = (url: string, source: string) => {
      console.log(`🔗 Opening share inbox (${source}):`, url)
      navigate('/share/incoming')
      markUrlProcessed(url)
    }

    let listenerHandle: PluginListenerHandle | undefined

    const handleDeepLink = async (url: string, source: string) => {
      console.log(`🔗 Deep link received (${source}):`, url)

      if (isShareIncomingUrl(url)) {
        if (isUrlProcessed(url)) {
          console.log('🔗 Share deep link already handled, skipping duplicate:', url)
          return
        }
        if (!authLoaded) {
          pendingShareUrlRef.current = url
          console.log('🔗 Share deep link queued until auth is ready')
          return
        }
        applyShareIncoming(url, source)
        return
      }

      if (!authLoaded) {
        console.log('🔗 Waiting for auth to load before processing deep links...')
        return
      }

      const inviteToken = extractInviteToken(url)
      if (inviteToken) {
        await applyInviteTokenFromDeepLink(inviteToken, url)
      }
    }

    if (authLoaded) {
      const pending = pendingShareUrlRef.current
      if (pending && isShareIncomingUrl(pending)) {
        pendingShareUrlRef.current = null
        applyShareIncoming(pending, 'queued-after-auth')
      }
    }

    CapacitorApp.addListener('appUrlOpen', (event: { url: string }) => {
      console.log('🔗 appUrlOpen event:', event.url)
      handleDeepLink(event.url, 'appUrlOpen')
    }).then((handle: PluginListenerHandle) => {
      listenerHandle = handle
    })

    if (authLoaded) {
      CapacitorApp.getLaunchUrl()
        .then((result) => {
          if (result?.url) {
            console.log('🔗 App launched with URL:', result.url)
            handleDeepLink(result.url, 'getLaunchUrl')
          }
        })
        .catch(() => {})
    }

    return () => {
      listenerHandle?.remove()
    }
  }, [authLoaded, applyInviteTokenFromDeepLink, navigate, markUrlProcessed])

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    if (!authLoaded) return
    if (clipboardInviteAttemptedRef.current) return
    clipboardInviteAttemptedRef.current = true

    const search = typeof window !== 'undefined' ? window.location.search : ''
    if (search.includes('invite=')) {
      return
    }

    ;(async () => {
      try {
        const text = await navigator.clipboard.readText()
        const token = parseInviteTokenFromClipboard(text)
        if (!token || isClipboardInviteConsumed(token)) return
        await applyInviteTokenFromDeepLink(token, `clipboard:${token}`)
        markClipboardInviteConsumed(token)
      } catch {
        // iOS may block silent clipboard read; MobileLogin offers "Paste invite"
      }
    })()
  }, [authLoaded, applyInviteTokenFromDeepLink])

  const resetScrollPosition = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const scrollToTop = (target: any) => {
      if (!target) return
      if (typeof target.scrollTo === 'function') {
        try {
          target.scrollTo({ top: 0, left: 0, behavior: 'auto' })
          return
        } catch {
          try {
            target.scrollTo(0, 0)
            return
          } catch {
            // ignore
          }
        }
      }
      if (typeof target.scrollTop === 'number') {
        target.scrollTop = 0
      }
    }

    const candidates: any[] = [
      scrollRegionRef.current,
      document.scrollingElement,
      document.documentElement,
      document.body,
    ]

    candidates.forEach(scrollToTop)

    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }

    const scrollableSelectors = [
      '.overflow-y-auto',
      '.overflow-auto',
      '.overflow-scroll',
      '.no-scrollbar',
      '[data-scroll-region-child]',
      '[data-scrollable]',
    ]

    if (scrollRegionRef.current && scrollableSelectors.length) {
      try {
        const nodes = scrollRegionRef.current.querySelectorAll<HTMLElement>(scrollableSelectors.join(','))
        nodes.forEach(node => {
          if (node.dataset && node.dataset.preserveScroll === 'true') return
          const style = window.getComputedStyle(node)
          const overflowY = style.overflowY || style.overflow
          const isScrollable = /auto|scroll/i.test(overflowY)
          if (!isScrollable) return
          if (node.scrollHeight - node.clientHeight <= 1) return
          if (typeof node.scrollTo === 'function') {
            node.scrollTo({ top: 0, behavior: 'auto' })
          } else {
            node.scrollTop = 0
          }
        })
      } catch (err) {
        console.warn('scroll reset failed', err)
      }
    }
  }, [])

  const applyScrollTop = useCallback((top: number) => {
    if (typeof window === 'undefined') return
    const main = scrollRegionRef.current
    const setOn = (node: HTMLElement | null) => {
      if (!node) return
      if (typeof node.scrollTo === 'function') {
        try { node.scrollTo({ top, left: 0, behavior: 'auto' }) } catch { node.scrollTop = top }
      } else {
        node.scrollTop = top
      }
    }
    const apply = () => {
      // Apply to <main> AND the page's inner scroll container (e.g. the feed
      // scrolls an inner [data-preserve-scroll] div, not <main>). Whichever isn't
      // actually scrollable simply clamps the assignment back to 0 and ignores it.
      // Prefer the INCOMING route's container during a transition so we position
      // the page sliding in, never the outgoing snapshot.
      setOn(main)
      const inner =
        main?.querySelector<HTMLElement>('.page-transition-incoming [data-preserve-scroll="true"]') ??
        main?.querySelector<HTMLElement>('[data-preserve-scroll="true"]') ??
        null
      setOn(inner)
    }
    apply()
    // Cached pages paint synchronously but layout can settle a frame late;
    // re-apply next frame so a slightly-taller list doesn't clamp us short.
    window.requestAnimationFrame(apply)
  }, [])

  // Stamp the live scroll offset against the current route (by path) so a later
  // return to it restores exactly. Capture phase (scroll doesn't bubble) so we
  // also see the page's INNER scroll container — pages like CommunityFeed scroll
  // an inner [data-preserve-scroll] div, not <main>. rAF-throttled; key + offset
  // are captured at event time so a navigation mid-frame can't misattribute it.
  useEffect(() => {
    const main = scrollRegionRef.current
    if (!main) return
    let rafId = 0
    let pendingTop = 0
    let pendingKey = ''
    const isTrackedScroller = (node: EventTarget | null): node is HTMLElement =>
      node === main ||
      (node instanceof HTMLElement && node.matches('[data-preserve-scroll="true"]'))
    const onScroll = (ev: Event) => {
      const target = ev.target
      if (!isTrackedScroller(target)) return
      pendingTop = target.scrollTop
      pendingKey = currentScrollKeyRef.current
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        saveScrollPosition(pendingKey, pendingTop)
      })
    }
    main.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll, { capture: true } as any)
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [])

  const loadProfile = useCallback(async (path?: string): Promise<UserProfile> => {
    const currentPath = path ?? location.pathname
    setProfileLoading(true)
    setProfileError(null)

    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('cached_profile') || '')
        if (cached) {
          setProfileData(cached)
          setIsVerified(!!(cached as any)?.email_verified)
          setProfileError(null)
          setProfileLoading(false)
          setAuthLoaded(true)
          return cached
        }
      } catch { /* no cached profile */ }
      setProfileData(null)
      setProfileError('Offline')
      setProfileLoading(false)
      setAuthLoaded(true)
      return null
    }

    try {
      const response = await fetch(`/api/profile_me?_t=${Date.now()}`, { 
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }
      })
      if (response.status === 401) {
        setProfileData(null)
        setIsVerified(null)
        try { localStorage.removeItem('cached_profile') } catch {}
        if (!publicPaths.has(currentPath) && !currentPath.startsWith('/invite-preview/')) {
          window.location.href = '/'
        } else {
          setAuthLoaded(true)
        }
        return null
      }
      if (response.status === 403) {
        setProfileData(null)
        setIsVerified(false)
        setProfileError('Email verification required')
        return null
      }
      if (!response.ok) {
        throw new Error(`Profile fetch failed: ${response.status}`)
      }
      const json = await response.json().catch(() => null)
      if (json?.success && json.profile) {
        const profile = json.profile as Record<string, unknown>
        await applyProfileFromServer(profile)
        // Session confirmed — register any cached push token with the server.
        await (window as any).__reregisterPushToken?.()
        return profile as UserProfile
      }

      throw new Error(json?.error || 'Profile response invalid')
    } catch (err) {
      try {
        const cached = JSON.parse(localStorage.getItem('cached_profile') || '')
        if (cached) {
          setProfileData(cached)
          setIsVerified(!!(cached as any)?.email_verified)
          setProfileError(null)
          return cached
        }
      } catch { /* no cached profile */ }
      setProfileData(null)
      setProfileError('Failed to load profile')
      return null
    } finally {
      setProfileLoading(false)
      setAuthLoaded(true)
    }
  }, [publicPaths, applyProfileFromServer])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  // Optimistic boot: paint the shell immediately from the cached profile so cold
  // start isn't gated on the /api/profile_me round-trip. The cached profile is the
  // user's OWN last-known profile (self-access only); all viewer-scoped CONTENT is
  // still fetched with the live session, so no other user's data can render here.
  // loadProfile (below) then revalidates against the server and
  // applyProfileFromServer reconciles — running ensureAccountIsolationForUsername
  // if the server identity differs, and a 401 still clears + redirects. Runs once.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !navigator.onLine) return
    try {
      const cached = JSON.parse(localStorage.getItem('cached_profile') || 'null')
      if (cached && cached.username) {
        setProfileData(cached)
        setIsVerified(!!cached.email_verified)
        setAuthLoaded(true)
      }
    } catch { /* no cached profile — fall through to the blocking load */ }
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const prevPathnameRef = useRef(location.pathname)
  const pendingScrollResetRef = useRef(false)

  const flushDeferredScrollReset = useCallback(() => {
    // Restore takes priority over reset: a back-navigation lands where the user
    // left, everything else snaps to top.
    if (pendingScrollRestoreRef.current != null) {
      const top = pendingScrollRestoreRef.current
      pendingScrollRestoreRef.current = null
      pendingScrollResetRef.current = false
      applyScrollTop(top)
      return
    }
    if (!pendingScrollResetRef.current) return
    pendingScrollResetRef.current = false
    resetScrollPosition()
  }, [resetScrollPosition, applyScrollTop])

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const prev = prevPathnameRef.current
    prevPathnameRef.current = location.pathname
    if (isDashboardTabPath(prev) && isDashboardTabPath(location.pathname)) return
    // If we have a remembered offset for the destination route (keyed by path),
    // restore it — this covers browser POP AND the in-app "smart back" that
    // PUSHes the feed path instead of popping history. New routes have none and
    // fall through to a reset-to-top.
    const restoreTo = getScrollPosition(location.pathname + location.search)
    if (restoreTo != null && restoreTo > 0) {
      pendingScrollRestoreRef.current = restoreTo
      pendingScrollResetRef.current = false
      // Restore NOW — this is a layout effect, so it runs before paint and the
      // page slides in already at the right offset instead of snapping down
      // after the transition settles (which read as a flash). The deferred flush
      // at transition-end re-applies as a backstop for content that grows late.
      applyScrollTop(restoreTo)
    } else {
      pendingScrollRestoreRef.current = null
      pendingScrollResetRef.current = true
    }
    if (!TRANSITIONS_ENABLED) {
      const raf = window.requestAnimationFrame(() => {
        flushDeferredScrollReset()
      })
      return () => window.cancelAnimationFrame(raf)
    }
  }, [location.pathname, location.search, applyScrollTop, flushDeferredScrollReset])

  useEffect(() => {
    if (profileData) {
      const username = (profileData as any)?.username
      const displayName = (profileData as any)?.display_name || username
      // No cache-buster: upload filenames are timestamped, so the URL itself
      // changes when the picture changes and the old one can stay cached.
      const avatarUrl = (profileData as any)?.profile_picture || null
      setUserMeta({ username, displayName, avatarUrl })
    } else {
      setUserMeta({})
    }
  }, [profileData])

  const userProfileValue = useMemo(
    () => ({
      profile: profileData,
      setProfile: setProfileData,
      applyProfileFromServer,
      loading: profileLoading,
      error: profileError,
      refresh: () => loadProfile(),
    }),
    [profileData, profileLoading, profileError, loadProfile, applyProfileFromServer],
  )

  useEffect(() => {
    if (authLoaded) {
      document.getElementById('initial-loader')?.remove()
    }
  }, [authLoaded])

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      if (detail?.message) setUploadStatusToast(t(detail.message, detail.message))
    }
    window.addEventListener('chat-media-upload-status', onStatus)
    return () => window.removeEventListener('chat-media-upload-status', onStatus)
  }, [t])

  useEffect(() => {
    if (!uploadStatusToast) return
    const id = window.setTimeout(() => setUploadStatusToast(null), 3500)
    return () => window.clearTimeout(id)
  }, [uploadStatusToast])

  const rootRouteElement = (() => {
    if (!authLoaded) return null
    if (profileData) {
      return <Navigate to="/premium_dashboard" replace />
    }
    return <OnboardingWelcome />
  })()

  const currentPathName = location.pathname
  const hideHeader =
    isFirstPage ||
    currentPathName === '/welcome' ||
    currentPathName === '/onboarding' ||
    currentPathName === '/login' ||
    currentPathName === '/signup' ||
    currentPathName === '/signup_react' ||
    currentPathName.startsWith('/invite-preview/') ||
    currentPathName.startsWith('/user_chat/chat/') ||
    currentPathName.startsWith('/group_chat/') ||
    currentPathName.startsWith('/post/') ||
    currentPathName.startsWith('/reply/') ||
    currentPathName.startsWith('/group_reply/') ||
    currentPathName.startsWith('/community_feed_react/') ||
    currentPathName.startsWith('/group_feed_react/') ||
    currentPathName.startsWith('/community/') && currentPathName.includes('/feed')
  const showHeader = authLoaded && !hideHeader && !headerHiddenOverride
  const headerHeightValue = showHeader
    ? 'calc(56px + var(--sat-px, 0px))'
    : 'var(--sat-px, 0px)'
  const contentOffsetValue = headerHiddenOverride || !showHeader ? '0px' : headerHeightValue
  const hasBottomChrome =
    isPremiumDashboardPath(currentPathName) ||
    currentPathName === '/about_cpoint' ||
    currentPathName === '/feed' ||
    currentPathName.startsWith('/community_feed_react/') ||
    currentPathName.startsWith('/group_feed_react/') ||
    (currentPathName.startsWith('/community/') && currentPathName.includes('/feed'))
  const suppressGlobalKeyboardPad = isChatRoute || isOnboardingFullscreenOverlayActive()
  const mainPaddingBottom = suppressGlobalKeyboardPad
    ? '0px'
    : hasBottomChrome
      ? `${keyboardOffset}px`
      : `calc(var(--sab-px, 0px) + ${keyboardOffset}px)`
  const mainStyle = {
    paddingTop: contentOffsetValue,
    minHeight: '100%',
    paddingBottom: mainPaddingBottom,
    '--app-header-offset': contentOffsetValue,
    '--app-header-height': headerHeightValue,
    '--app-subnav-height': '40px',
    '--app-subnav-gap': '12px',
    '--app-content-gap': '8px',
  } as CSSProperties

  return (
    <UserProfileContext.Provider value={userProfileValue}>
      <BadgeProvider>
      <HeaderContext.Provider value={{ setTitle, setHeaderHidden: setHeaderHiddenOverride, setTitleAccessory }}>
        {showHeader && (
          <HeaderBar title={title} username={userMeta.username} displayName={userMeta.displayName || undefined} avatarUrl={userMeta.avatarUrl} titleAccessory={titleAccessory} />
        )}
        {uploadStatusToast ? (
          <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-[1500] -translate-x-1/2 rounded-full border border-c-border bg-c-bg-elevated/95 px-4 py-2 text-sm font-semibold text-c-text-primary shadow-2xl backdrop-blur">
            {uploadStatusToast}
          </div>
        ) : null}
        <main
          ref={scrollRegionRef}
          data-scroll-region="true"
          className="app-scroll-region ios-scroll-region"
          style={mainStyle}
        >
            <ErrorBoundary>
              <PageTransitionStack onTransitionEnd={flushDeferredScrollReset}>
              <Routes>
                <Route path="/" element={rootRouteElement} />
                <Route path="/welcome" element={<OnboardingWelcome />} />
                <Route path="/login" element={<MobileLogin />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/signup_react" element={<Signup />} />
                <Route path="/invite-preview/:token" element={<InvitePreview />} />
                <Route path="/onboarding" element={<OnboardingWelcome />} />
                <Route element={<DashboardLayout />}>
                  <Route path="/premium" element={<PremiumDashboard />} />
                  <Route path="/premium_dashboard" element={<PremiumDashboard />} />
                  <Route path="/premium_dashboard_react" element={<PremiumDashboard />} />
                  <Route path="/feed" element={<HomeTimeline mode="dashboard_feed" />} />
                  <Route path="/about_cpoint" element={<AboutCPoint />} />
                </Route>
                <Route path="/crossfit" element={<CrossfitExact />} />
                <Route path="/crossfit_react" element={<CrossfitExact />} />
                <Route path="/communities" element={<Communities />} />
                <Route path="/followers" element={<Followers />} />
                <Route path="/networking" element={<Networking />} />
                <Route path="/your_sports" element={<YourSports />} />
                <Route path="/gym" element={<Gym />} />
                <Route path="/user_chat" element={<Messages />} />
                  <Route path="/user_chat/new" element={<NewMessage />} />
                  <Route path="/user_chat/chat/:username" element={<ChatThreadRoute />} />
                  <Route path="/chat/:username/media" element={<ChatMedia />} />
                  <Route path="/chat/:username/documents" element={<ChatDocuments />} />
                  <Route path="/group_chat/:group_id" element={<GroupChatThreadRoute />} />
                  <Route path="/group_chat/:group_id/media" element={<GroupChatMedia />} />
                  <Route path="/group_chat/:group_id/documents" element={<GroupChatDocuments />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile_react" element={<Profile />} />
                  <Route path="/profile/:username" element={<PublicProfile />} />
                <Route path="/account_settings" element={<AccountSettings />} />
                <Route path="/account_settings_react" element={<AccountSettings />} />
                <Route path="/account_settings/security" element={<AccountSecurity />} />
                <Route path="/account_settings/danger" element={<AccountDangerZone />} />
                  <Route path="/subscription_plans" element={<SubscriptionPlans />} />
                <Route path="/success" element={<Success />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin_dashboard" element={<AdminDashboard />} />
                <Route path="/admin_dashboard_react" element={<AdminDashboard />} />
                <Route path="/admin_profile_react" element={<AdminProfile />} />
                <Route path="/home" element={<HomeTimeline />} />
                <Route path="/workout_tracking" element={<WorkoutTracking />} />
                <Route path="/steve/profile-builder/:section" element={<ScopedProfileBuilder />} />
                <Route path="/community_feed_react/:community_id" element={<CommunityFeed />} />
                <Route path="/community/:community_id/calendar_react" element={<CommunityCalendar />} />
                <Route path="/community/:community_id/tasks_react" element={<CommunityTasks />} />
                <Route path="/community/:community_id/polls_react" element={<CommunityPolls />} />
                <Route path="/community/:community_id/resources_react" element={<CommunityResources />} />
                <Route path="/community/:community_id/useful_links_react" element={<UsefulLinks />} />
                <Route path="/community/:community_id/photos_react" element={<CommunityPhotos />} />
                <Route path="/community/:community_id/key_posts" element={<KeyPosts />} />
                <Route path="/community/:community_id/members" element={<Members />} />
                <Route path="/community/:community_id/edit" element={<EditCommunity />} />
                <Route path="/event/:event_id" element={<EventDetail />} />
                <Route path="/post/:post_id" element={<PostDetail />} />
                <Route path="/reply/:reply_id" element={<CommentReply />} />
                <Route path="/group_reply/:reply_id" element={<CommentReply />} />
                <Route path="/share/incoming" element={<ShareIncomingRouteRedirect />} />
                <Route path="/compose" element={<CreatePost />} />
                <Route path="/group_feed_react/:group_id" element={<GroupFeed />} />
                <Route path="/group/:group_id/edit" element={<EditGroup />} />
                <Route path="*" element={<PremiumDashboard />} />
              </Routes>
              </PageTransitionStack>
            </ErrorBoundary>
        </main>
        {requireVerification && authLoaded && isVerified === false && (
          <VerifyOverlay onRecheck={async ()=>{
            try{
              const r = await fetch('/api/profile_me', { credentials:'include', headers: { 'Accept': 'application/json' } })
              const j = await r.json().catch(()=>null)
              const v = !!(j?.profile?.email_verified)
              setIsVerified(v)
            }catch{}
          }} />
        )}
        <BasicProfileGateProvider />
        {/* 18+ compliance gate (Option A): fires once per account when the
            server-side status is unanswered — see docs/COMPLIANCE_AGE_GATE.md. */}
        {authLoaded ? <AgeGateController username={userMeta.username || null} /> : null}
      </HeaderContext.Provider>
      </BadgeProvider>
    </UserProfileContext.Provider>
  )
}

export default function App() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      window.__googleAuthReady = true
      return
    }

    const platform = Capacitor.getPlatform()
    console.log(`[GoogleAuth] Initializing on platform: ${platform}`)

    import('@codetrix-studio/capacitor-google-auth')
      .then(({ GoogleAuth }) => {
        const opts: Record<string, unknown> = {
          scopes: ['profile', 'email'],
          grantOfflineAccess: false,
        }

        // IMPORTANT: On Android, it MUST use the Android OAuth Client ID (linked to SHA-1)
        // as the clientId to identify the specific app to Google Play Services.
        // It MUST use the Web OAuth Client ID as the serverClientId to return an ID Token.
        if (platform === 'android') {
          console.log('[GoogleAuth] Using Android + Web Client IDs for Android initialization')
          opts.clientId = GOOGLE_ANDROID_CLIENT_ID
          opts.serverClientId = GOOGLE_WEB_CLIENT_ID
        } else {
          console.log('[GoogleAuth] Using iOS Client ID for iOS initialization')
          opts.clientId = GOOGLE_IOS_CLIENT_ID
          opts.iosClientId = GOOGLE_IOS_CLIENT_ID
        }

        return GoogleAuth.initialize(opts as any)
      })
      .then(() => {
        console.log('[GoogleAuth] Initialization complete')
        window.__googleAuthReady = true
      })
      .catch((err) => {
        console.error('[GoogleAuth] Initialization failed:', err)
        window.__googleAuthReady = true
      })
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <NetworkProvider>
        <BrowserRouter>
          <ThemeProvider>
            <EntitlementsProvider>
              <LogoutPromptProvider>
                <OfflineBanner />
                <OutboxDrainer />
                <BrandAssetsInit />
                <LocaleBootstrap />
                <PushInit />
                <NotificationPrompt />
                <AppRoutes />
              </LogoutPromptProvider>
            </EntitlementsProvider>
          </ThemeProvider>
        </BrowserRouter>
      </NetworkProvider>
    </QueryClientProvider>
  )
}
