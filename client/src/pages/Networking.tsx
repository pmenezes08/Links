import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import { useNavigate } from 'react-router-dom'
import { renderTextWithSourceLinks } from '../utils/linkUtils'

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

const SECTION_DEFINITIONS = [
  { key: 'steve', label: 'Steve Recommendations' },
  { key: 'personal', label: 'Personal' },
] as const
type SectionKey = (typeof SECTION_DEFINITIONS)[number]['key']

export default function Networking() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  useEffect(() => { setTitle('Networking') }, [setTitle])

  const [activeSection, setActiveSection] = useState<SectionKey>('steve')
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)

  // Steve state
  const [steveCommunity, setSteveCommunity] = useState<number | null>(null)
  const [steveMessages, setSteveMessages] = useState<Array<{ role: 'user' | 'steve'; text: string }>>([])
  const [steveInput, setSteveInput] = useState('')
  const [steveSending, setSteveSending] = useState(false)
  const [autoMatching, setAutoMatching] = useState(false)
  const steveEndRef = useRef<HTMLDivElement>(null)
  const steveListRef = useRef<HTMLDivElement>(null)

  // Layout helpers — matching GroupChatThread exactly
  const safeBottom = 'env(safe-area-inset-bottom, 0px)'
  const defaultComposerPadding = 64
  const VISUAL_VIEWPORT_KEYBOARD_THRESHOLD = 48
  const NATIVE_KEYBOARD_MIN_HEIGHT = 60
  const KEYBOARD_OFFSET_EPSILON = 6
  const [composerHeight, setComposerHeight] = useState(defaultComposerPadding)
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  const [viewportLift, setViewportLift] = useState(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)

  const composerRef = useRef<HTMLDivElement | null>(null)
  const composerCardRef = useRef<HTMLDivElement | null>(null)
  const keyboardOffsetRef = useRef(0)
  const viewportBaseRef = useRef<number | null>(null)
  const isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  const scrollToBottom = useCallback(() => {
    const el = steveListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Composer height observer (same as GroupChatThread)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return
    const node = composerCardRef.current
    if (!node) return
    const updateHeight = () => {
      const height = node.getBoundingClientRect().height
      if (!height) return
      setComposerHeight(prev => (Math.abs(prev - height) < 1 ? prev : height))
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [])

  // Safe bottom probe (same as GroupChatThread)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.bottom = '0'
    probe.style.left = '0'
    probe.style.width = '0'
    probe.style.height = 'env(safe-area-inset-bottom, 0px)'
    probe.style.pointerEvents = 'none'
    probe.style.opacity = '0'
    probe.style.zIndex = '-1'
    document.body.appendChild(probe)
    const updateSafeBottom = () => {
      const rect = probe.getBoundingClientRect()
      const next = rect.height || 0
      setSafeBottomPx(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }
    updateSafeBottom()
    window.addEventListener('resize', updateSafeBottom)
    return () => {
      window.removeEventListener('resize', updateSafeBottom)
      probe.remove()
    }
  }, [])

  const effectiveComposerHeight = Math.max(composerHeight, defaultComposerPadding)
  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = Math.max(0, liftSource - safeBottomPx)
  const showKeyboard = liftSource > 50
  const composerGapPx = 4

  const listPaddingBottom = showKeyboard
    ? `${effectiveComposerHeight + composerGapPx + keyboardLift}px`
    : `calc(${safeBottom} + ${effectiveComposerHeight + composerGapPx}px)`

  // Web visual viewport tracking (web only)
  useEffect(() => {
    if (!isMobile) return
    if (Capacitor.getPlatform() !== 'web') return
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return
    let rafId: number | null = null
    const updateOffset = () => {
      const currentHeight = viewport.height
      if (
        viewportBaseRef.current === null ||
        currentHeight > (viewportBaseRef.current ?? currentHeight) - 4
      ) {
        viewportBaseRef.current = currentHeight
      }
      const baseHeight = viewportBaseRef.current ?? currentHeight
      const nextOffset = Math.max(0, baseHeight - currentHeight)
      const normalizedOffset = nextOffset < VISUAL_VIEWPORT_KEYBOARD_THRESHOLD ? 0 : nextOffset
      if (Math.abs(keyboardOffsetRef.current - normalizedOffset) < 5) return
      setViewportLift(prev => (Math.abs(prev - normalizedOffset) < 5 ? prev : normalizedOffset))
      keyboardOffsetRef.current = normalizedOffset
      setKeyboardOffset(normalizedOffset)
      if (normalizedOffset > 0) requestAnimationFrame(scrollToBottom)
    }
    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }
    viewport.addEventListener('resize', handleChange)
    handleChange()
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
    }
  }, [isMobile, scrollToBottom])

  // Native Capacitor keyboard events (iOS/Android)
  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined
    const normalizeHeight = (raw: number) => (raw < NATIVE_KEYBOARD_MIN_HEIGHT ? 0 : raw)
    const handleShow = (info: KeyboardInfo) => {
      const height = normalizeHeight(info?.keyboardHeight ?? 0)
      if (Math.abs(keyboardOffsetRef.current - height) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
      requestAnimationFrame(scrollToBottom)
    }
    const handleHide = () => {
      if (Math.abs(keyboardOffsetRef.current) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
    }
    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => { showSub = handle })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => { hideSub = handle })
    return () => { showSub?.remove(); hideSub?.remove() }
  }, [scrollToBottom])

  // Scroll on keyboard change (same as GroupChatThread)
  useEffect(() => {
    if (liftSource < 0) return
    scrollToBottom()
    const t1 = setTimeout(scrollToBottom, 120)
    const t2 = setTimeout(scrollToBottom, 260)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [liftSource, scrollToBottom])

  // Personal state
  const [personalCommunity, setPersonalCommunity] = useState<number | null>(null)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ locations: [], industries: [], interests: [] })
  const [selectedLocation, setSelectedLocation] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState('')
  const [selectedInterest, setSelectedInterest] = useState('')
  const [personalMembers, setPersonalMembers] = useState<MemberProfile[]>([])
  const [personalLoading, setPersonalLoading] = useState(false)

  useEffect(() => {
    fetch('/api/networking/communities', { credentials: 'include' })
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
  }, [])

  useEffect(() => { scrollToBottom() }, [steveMessages, scrollToBottom])

  // Personal: load filters + members
  useEffect(() => {
    if (!personalCommunity) return
    setPersonalLoading(true)
    fetch(`/api/networking/community_members/${personalCommunity}`, { credentials: 'include' })
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
    fetch(`/api/networking/community_members/${personalCommunity}?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data.success) setPersonalMembers(data.members || []) })
      .catch(() => {})
  }, [selectedLocation, selectedIndustry, selectedInterest, personalCommunity])

  const sendSteveMessage = async () => {
    if (!steveInput.trim() || !steveCommunity || steveSending) return
    const msg = steveInput.trim()
    setSteveInput('')
    setSteveMessages(prev => [...prev, { role: 'user', text: msg }])
    setSteveSending(true)
    try {
      const res = await fetch('/api/networking/steve_match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ community_id: steveCommunity, message: msg }) })
      const data = await res.json()
      setSteveMessages(prev => [...prev, { role: 'steve', text: data.success ? data.response : (data.error || 'Something went wrong.') }])
    } catch { setSteveMessages(prev => [...prev, { role: 'steve', text: 'Network error. Please try again.' }]) }
    setSteveSending(false)
  }

  const triggerAutoMatch = async () => {
    if (!steveCommunity || autoMatching) return
    setAutoMatching(true)
    setSteveMessages(prev => [...prev, { role: 'user', text: '✨ Find me the best matches based on my profile' }])
    try {
      const res = await fetch('/api/networking/steve_auto_match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ community_id: steveCommunity }) })
      const data = await res.json()
      setSteveMessages(prev => [...prev, { role: 'steve', text: data.success ? data.response : (data.error || 'Something went wrong.') }])
    } catch { setSteveMessages(prev => [...prev, { role: 'steve', text: 'Network error. Please try again.' }]) }
    setAutoMatching(false)
  }

  if (loading) return <div className="glass-page min-h-screen text-white flex items-center justify-center"><span className="text-[#9fb0b5]">Loading…</span></div>

  /* ── Steve tab: fixed viewport layout (matching GroupChatThread) ── */
  if (activeSection === 'steve') {
    return (
      <div
        className="text-white"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#000',
        }}
      >
        {/* App header spacer — matches the global header height */}
        <div style={{ flexShrink: 0, height: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }} />

        {/* Sub-nav tabs */}
        <div className="flex-shrink-0 h-10 bg-black/70 backdrop-blur border-b border-white/5">
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
                    <div className="pt-2">{section.label}</div>
                    <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${isActive ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Info card — non-scrollable */}
        <div className="flex-shrink-0 max-w-3xl w-full mx-auto px-1 sm:px-3 pt-2">
          <section className="rounded-xl border border-white/10 bg-black p-3 space-y-2.5">
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">AI Networking</p>
              <h1 className="text-xl font-semibold tracking-tight text-white">Who would you like to meet?</h1>
              <p className="text-[13px] leading-relaxed text-[#a7b8be]">
                Ask Steve to find the right people for you, or let AI suggest matches based on your profile.
              </p>
            </div>
            <select
              value={steveCommunity || ''}
              onChange={e => { setSteveCommunity(Number(e.target.value)); setSteveMessages([]) }}
              className="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white focus:outline-none focus:border-[#4db6ac]"
            >
              {communities.map(c => <option key={c.id} value={c.id} className="bg-black">{c.name}</option>)}
            </select>
          </section>
        </div>

        {/* Chat messages — scrollable, fills remaining space */}
        <div
          ref={steveListRef}
          className="flex-1 overflow-y-auto overflow-x-hidden max-w-3xl w-full mx-auto px-1 sm:px-3"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'auto',
            paddingBottom: listPaddingBottom,
            minHeight: 0,
          } as CSSProperties}
        >
          <div className="rounded-xl border border-white/10 bg-black/50 p-3 space-y-3 mt-2">
            {steveMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
                <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center">
                  <i className="fa-solid fa-wand-magic-sparkles text-xl text-[#4db6ac]/50" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-[#9fb0b5]">What's on your mind?</p>
                  <p className="text-[11px] text-[#6f7c81]">e.g. "I want to meet people who work in tech" or "Find members from Lisbon"</p>
                </div>
              </div>
            ) : (
              steveMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-white/10 text-white rounded-br-md'
                      : 'bg-transparent text-[#c8d6db] rounded-bl-md'
                  }`}>
                    {msg.role === 'steve' ? (
                      <div className="whitespace-pre-wrap">{renderTextWithSourceLinks(msg.text)}</div>
                    ) : msg.text}
                  </div>
                </div>
              ))
            )}
            {(steveSending || autoMatching) && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-[#9fb0b5]">
                  <span>Steve is thinking</span>
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
        </div>

        {/* ====== COMPOSER — fixed at bottom, lifted above keyboard (same as GroupChatThread) ====== */}
        <div
          ref={composerRef}
          className="fixed left-0 right-0"
          style={{
            bottom: showKeyboard ? `${keyboardLift}px` : 0,
            zIndex: 1000,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            ref={composerCardRef}
            className="max-w-3xl w-[calc(100%-24px)] mx-auto bg-black border-t border-white/10 px-3 py-2 rounded-t-xl"
          >
            <div className="flex items-center gap-2">
              <button
                onClick={triggerAutoMatch}
                disabled={autoMatching || steveSending || !steveCommunity}
                className="w-9 h-9 rounded-lg border border-white/15 flex items-center justify-center flex-shrink-0 hover:border-white/35 disabled:opacity-40 transition"
                title="Auto-match based on my profile"
              >
                <i className="fa-solid fa-wand-magic-sparkles text-xs text-[#4db6ac]" />
              </button>
              <input
                value={steveInput}
                onChange={e => setSteveInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSteveMessage() } }}
                placeholder="What's on your mind?"
                className="flex-1 rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white placeholder-[#6f7c81] focus:outline-none focus:border-[#4db6ac]"
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
          {/* Safe area spacer (same as GroupChatThread) */}
          <div
            style={{
              height: showKeyboard ? '4px' : 'env(safe-area-inset-bottom, 0px)',
              background: '#000',
              flexShrink: 0,
            }}
          />
        </div>
      </div>
    )
  }

  /* ── Personal tab + default: normal page layout ── */
  return (
    <div className="glass-page min-h-screen text-white">
      {/* Fixed sub-nav tabs */}
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
                  <div className="pt-2">{section.label}</div>
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
        {activeSection === 'personal' && (
          <div className="space-y-3">
            <section className="rounded-xl border border-white/10 bg-black p-3 space-y-2.5">
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">Browse Members</p>
                <h1 className="text-xl font-semibold tracking-tight text-white">Find people in your communities</h1>
                <p className="text-[13px] leading-relaxed text-[#a7b8be]">
                  Filter by location, industry, or interests to discover members you share something with.
                </p>
              </div>

              <select
                value={personalCommunity || ''}
                onChange={e => setPersonalCommunity(Number(e.target.value))}
                className="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white focus:outline-none focus:border-[#4db6ac]"
              >
                {communities.map(c => <option key={c.id} value={c.id} className="bg-black">{c.name}</option>)}
              </select>

              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={selectedLocation}
                  onChange={e => setSelectedLocation(e.target.value)}
                  className="rounded-lg border border-white/15 bg-transparent px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-black">Location</option>
                  {filterOptions.locations.filter(Boolean).sort().map(loc => (
                    <option key={loc} value={loc} className="bg-black">{loc}</option>
                  ))}
                </select>
                <select
                  value={selectedIndustry}
                  onChange={e => setSelectedIndustry(e.target.value)}
                  className="rounded-lg border border-white/15 bg-transparent px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-black">Industry</option>
                  {filterOptions.industries.filter(Boolean).sort().map(ind => (
                    <option key={ind} value={ind} className="bg-black">{ind}</option>
                  ))}
                </select>
                <select
                  value={selectedInterest}
                  onChange={e => setSelectedInterest(e.target.value)}
                  className="rounded-lg border border-white/15 bg-transparent px-2.5 py-1.5 text-[10px] text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-black">Interests</option>
                  {filterOptions.interests.filter(Boolean).sort().map(int => (
                    <option key={int} value={int} className="bg-black">{int}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/50 p-3">
                {personalLoading ? (
                  <div className="text-[#9fb0b5]">Loading…</div>
                ) : personalMembers.length === 0 ? (
                  <div className="text-[#9fb0b5]">No members match your criteria.</div>
                ) : (
                  <div>
                    <div className="text-[11px] text-[#6f7c81] mb-2">{personalMembers.length} member{personalMembers.length !== 1 ? 's' : ''}</div>
                    <div className="divide-y divide-white/5">
                      {personalMembers.map(m => (
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
                              View
                            </button>
                            <button
                              className="rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white hover:border-white/40"
                              onClick={(e) => { e.stopPropagation(); navigate(`/user_chat/chat/${m.username}`) }}
                            >
                              Message
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
