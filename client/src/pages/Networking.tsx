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
type FilterOptions = {
  cities: string[]
  countries: string[]
  industries: string[]
  interests: string[]
}

export default function Networking() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  useEffect(() => { setTitle('Networking') }, [setTitle])

  const [activeTab, setActiveTab] = useState<'steve' | 'personal'>('steve')
  const [communities, setCommunities] = useState<Community[]>([])
  const [selectedCommunity, setSelectedCommunity] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Steve tab state
  const [steveMessages, setSteveMessages] = useState<Array<{ role: 'user' | 'steve'; text: string }>>([])
  const [steveInput, setSteveInput] = useState('')
  const [steveSending, setSteveSending] = useState(false)
  const [autoMatching, setAutoMatching] = useState(false)
  const steveEndRef = useRef<HTMLDivElement>(null)

  // Personal tab state
  const [personalCommunity, setPersonalCommunity] = useState<number | null>(null)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ cities: [], countries: [], industries: [], interests: [] })
  const [selectedLocation, setSelectedLocation] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState('')
  const [selectedInterest, setSelectedInterest] = useState('')
  const [personalMembers, setPersonalMembers] = useState<MemberProfile[]>([])
  const [personalLoading, setPersonalLoading] = useState(false)

  useEffect(() => {
    fetch('/get_user_communities', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setCommunities(data.communities || [])
          if (data.communities?.length > 0) {
            setSelectedCommunity(data.communities[0].id)
            setPersonalCommunity(data.communities[0].id)
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    steveEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steveMessages])

  // Load filter options when personal community changes
  useEffect(() => {
    if (!personalCommunity) return
    setPersonalLoading(true)
    fetch(`/api/networking/community_members/${personalCommunity}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setFilterOptions({
            cities: data.filters?.cities || [],
            countries: data.filters?.countries || [],
            industries: data.filters?.industries || [],
            interests: data.filters?.interests || [],
          })
          setPersonalMembers(data.members || [])
        }
      })
      .catch(() => {})
      .finally(() => setPersonalLoading(false))
    setSelectedLocation('')
    setSelectedIndustry('')
    setSelectedInterest('')
  }, [personalCommunity])

  // Filter members when criteria change
  useEffect(() => {
    if (!personalCommunity) return
    if (!selectedLocation && !selectedIndustry && !selectedInterest) {
      // No filters - reload all
      fetch(`/api/networking/community_members/${personalCommunity}`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => { if (data.success) setPersonalMembers(data.members || []) })
        .catch(() => {})
      return
    }
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
    if (!steveInput.trim() || !selectedCommunity || steveSending) return
    const msg = steveInput.trim()
    setSteveInput('')
    setSteveMessages(prev => [...prev, { role: 'user', text: msg }])
    setSteveSending(true)
    try {
      const res = await fetch('/api/networking/steve_match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ community_id: selectedCommunity, message: msg }),
      })
      const data = await res.json()
      if (data.success) {
        setSteveMessages(prev => [...prev, { role: 'steve', text: data.response }])
      } else {
        setSteveMessages(prev => [...prev, { role: 'steve', text: data.error || 'Something went wrong.' }])
      }
    } catch {
      setSteveMessages(prev => [...prev, { role: 'steve', text: 'Network error. Please try again.' }])
    }
    setSteveSending(false)
  }

  const triggerAutoMatch = async () => {
    if (!selectedCommunity || autoMatching) return
    setAutoMatching(true)
    setSteveMessages(prev => [...prev, { role: 'user', text: '✨ Find me the best matches based on my profile' }])
    try {
      const res = await fetch('/api/networking/steve_auto_match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ community_id: selectedCommunity }),
      })
      const data = await res.json()
      if (data.success) {
        setSteveMessages(prev => [...prev, { role: 'steve', text: data.response }])
      } else {
        setSteveMessages(prev => [...prev, { role: 'steve', text: data.error || 'Something went wrong.' }])
      }
    } catch {
      setSteveMessages(prev => [...prev, { role: 'steve', text: 'Network error. Please try again.' }])
    }
    setAutoMatching(false)
  }

  const MemberCard = ({ member }: { member: MemberProfile }) => (
    <div
      className="flex items-center gap-3 bg-white/5 rounded-xl p-3 border border-white/10 cursor-pointer hover:bg-white/10 transition"
      onClick={() => navigate(`/profile/${member.username}`)}
    >
      <Avatar username={member.username} url={member.profile_picture || undefined} size={44} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{member.display_name || member.username}</div>
        <div className="text-[11px] text-white/50">@{member.username}</div>
        {(member.city || member.country) && (
          <div className="text-[11px] text-white/40 flex items-center gap-1 mt-0.5">
            <i className="fa-solid fa-location-dot text-[9px]" />
            {[member.city, member.country].filter(Boolean).join(', ')}
          </div>
        )}
        {member.role && (
          <div className="text-[11px] text-white/40 mt-0.5">{member.role}{member.company ? ` at ${member.company}` : ''}</div>
        )}
      </div>
      <i className="fa-solid fa-chevron-right text-white/20 text-xs" />
    </div>
  )

  if (loading) return <div className="glass-page min-h-screen text-white flex items-center justify-center"><i className="fa-solid fa-spinner fa-spin mr-2" />Loading...</div>

  return (
    <div className="glass-page min-h-screen text-white" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}>
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">

        {/* Tabs */}
        <div className="flex gap-2">
          {(['steve', 'personal'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition ${
                activeTab === tab
                  ? 'bg-[#4db6ac] text-black'
                  : 'bg-white/5 text-white/60 border border-white/10'
              }`}
            >
              {tab === 'steve' ? (
                <><i className="fa-solid fa-wand-magic-sparkles mr-1.5 text-xs" />Steve Recommendations</>
              ) : (
                <><i className="fa-solid fa-user-group mr-1.5 text-xs" />Personal</>
              )}
            </button>
          ))}
        </div>

        {/* Steve Tab */}
        {activeTab === 'steve' && (
          <div className="space-y-4">
            {/* Community picker */}
            <div>
              <label className="text-xs text-white/50 mb-1 block">Who would you like to meet?</label>
              <select
                value={selectedCommunity || ''}
                onChange={e => { setSelectedCommunity(Number(e.target.value)); setSteveMessages([]) }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
              >
                {communities.map(c => (
                  <option key={c.id} value={c.id} className="bg-[#1a1a2e]">{c.name}</option>
                ))}
              </select>
            </div>

            {/* Chat area */}
            <div className="bg-white/5 border border-white/10 rounded-xl min-h-[300px] max-h-[50vh] overflow-y-auto p-3 space-y-3">
              {steveMessages.length === 0 && (
                <div className="text-center text-white/30 py-12 space-y-3">
                  <i className="fa-solid fa-wand-magic-sparkles text-3xl text-[#4db6ac]/40" />
                  <p className="text-sm">Ask Steve to find people for you, or tap the wand for automatic matching</p>
                  <p className="text-xs text-white/20">e.g., "I want to meet people who work in tech" or "Find members from Lisbon"</p>
                </div>
              )}
              {steveMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-[#4db6ac]/20 text-white rounded-br-lg'
                      : 'bg-white/10 text-white/90 rounded-bl-lg'
                  }`}>
                    {msg.role === 'steve' ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] text-[#4db6ac] font-medium mb-1">
                          <i className="fa-solid fa-wand-magic-sparkles text-[8px]" /> Steve
                        </div>
                        <div className="whitespace-pre-wrap leading-relaxed">{renderTextWithSourceLinks(msg.text)}</div>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.text}</span>
                    )}
                  </div>
                </div>
              ))}
              {(steveSending || autoMatching) && (
                <div className="flex justify-start">
                  <div className="bg-white/10 rounded-2xl rounded-bl-lg px-4 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-white/70 text-sm">Steve is thinking</span>
                      <span className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={steveEndRef} />
            </div>

            {/* Input bar */}
            <div className="flex gap-2">
              <button
                onClick={triggerAutoMatch}
                disabled={autoMatching || steveSending || !selectedCommunity}
                className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0 hover:bg-[#4db6ac]/30 disabled:opacity-40 transition"
                title="Auto-match based on my profile"
              >
                <i className="fa-solid fa-wand-magic-sparkles text-[#4db6ac]" />
              </button>
              <input
                value={steveInput}
                onChange={e => setSteveInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSteveMessage() } }}
                placeholder="I want to meet people who..."
                className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#4db6ac]"
                disabled={steveSending || autoMatching}
              />
              <button
                onClick={sendSteveMessage}
                disabled={!steveInput.trim() || steveSending || autoMatching}
                className="w-10 h-10 rounded-full bg-[#4db6ac] flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition"
              >
                <i className="fa-solid fa-paper-plane text-black text-sm" />
              </button>
            </div>
          </div>
        )}

        {/* Personal Tab */}
        {activeTab === 'personal' && (
          <div className="space-y-4">
            {/* Community picker */}
            <div>
              <label className="text-xs text-white/50 mb-1 block">Select community</label>
              <select
                value={personalCommunity || ''}
                onChange={e => setPersonalCommunity(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
              >
                {communities.map(c => (
                  <option key={c.id} value={c.id} className="bg-[#1a1a2e]">{c.name}</option>
                ))}
              </select>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs text-white/50 mb-1 block">Location</label>
                <select
                  value={selectedLocation}
                  onChange={e => setSelectedLocation(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-[#1a1a2e]">All locations</option>
                  {[...new Set([...filterOptions.cities, ...filterOptions.countries])].filter(Boolean).sort().map(loc => (
                    <option key={loc} value={loc} className="bg-[#1a1a2e]">{loc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Industry</label>
                <select
                  value={selectedIndustry}
                  onChange={e => setSelectedIndustry(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-[#1a1a2e]">All industries</option>
                  {filterOptions.industries.filter(Boolean).sort().map(ind => (
                    <option key={ind} value={ind} className="bg-[#1a1a2e]">{ind}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Interests</label>
                <select
                  value={selectedInterest}
                  onChange={e => setSelectedInterest(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#4db6ac]"
                >
                  <option value="" className="bg-[#1a1a2e]">All interests</option>
                  {filterOptions.interests.filter(Boolean).sort().map(int => (
                    <option key={int} value={int} className="bg-[#1a1a2e]">{int}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Results */}
            {personalLoading ? (
              <div className="text-center text-white/40 py-8"><i className="fa-solid fa-spinner fa-spin mr-2" />Loading members...</div>
            ) : personalMembers.length === 0 ? (
              <div className="text-center text-white/30 py-8">
                <i className="fa-solid fa-users text-2xl mb-2 block text-white/15" />
                <p className="text-sm">No members match your criteria</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-white/40">{personalMembers.length} member{personalMembers.length !== 1 ? 's' : ''} found</div>
                {personalMembers.map(m => <MemberCard key={m.username} member={m} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
