import { useState, useEffect, useRef } from 'react'
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
  const [keyboardLift, setKeyboardLift] = useState(0)
  const isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  // Keyboard detection via visualViewport (same pattern as GroupChatThread)
  useEffect(() => {
    if (!isMobile) return
    const vv = window.visualViewport
    if (!vv) return
    let baseHeight: number | null = null
    const onResize = () => {
      const h = vv.height
      if (baseHeight === null || h > (baseHeight ?? 0)) baseHeight = h
      const offset = Math.max(0, (baseHeight ?? h) - h)
      setKeyboardLift(offset < 50 ? 0 : offset)
    }
    vv.addEventListener('resize', onResize)
    onResize()
    return () => vv.removeEventListener('resize', onResize)
  }, [isMobile])

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

  useEffect(() => { steveEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [steveMessages])

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
        {/* ── Steve Recommendations ── */}
        {activeSection === 'steve' && (
          <div className="space-y-3">
            <section className="rounded-xl border border-white/10 bg-black p-3 space-y-2.5">
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca0a8]">AI Networking</p>
                <h1 className="text-xl font-semibold tracking-tight text-white">Who would you like to meet?</h1>
                <p className="text-[13px] leading-relaxed text-[#a7b8be]">
                  Ask Steve to find the right people for you, or let AI suggest matches based on your profile.
                </p>
              </div>

              {/* Community selector */}
              <select
                value={steveCommunity || ''}
                onChange={e => { setSteveCommunity(Number(e.target.value)); setSteveMessages([]) }}
                className="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-xs text-white focus:outline-none focus:border-[#4db6ac]"
              >
                {communities.map(c => <option key={c.id} value={c.id} className="bg-black">{c.name}</option>)}
              </select>

              {/* Chat area */}
              <div className="rounded-xl border border-white/10 bg-black/50 p-3 min-h-[280px] max-h-[50vh] overflow-y-auto space-y-3">
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

            </section>
            {/* Spacer for fixed input bar */}
            <div className="h-16" />
          </div>
        )}

        {/* Steve input bar — fixed at viewport bottom, lifted above keyboard */}
        {activeSection === 'steve' && (
          <div className="fixed left-0 right-0 z-50 bg-black border-t border-white/10 px-3 py-2" style={{ bottom: keyboardLift > 0 ? `${keyboardLift}px` : 0, paddingBottom: keyboardLift > 0 ? '4px' : 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
            <div className="max-w-3xl mx-auto flex items-center gap-2">
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
        )}

        {/* ── Personal ── */}
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

              {/* Results */}
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
