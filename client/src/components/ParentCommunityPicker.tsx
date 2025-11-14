import { useEffect, useMemo, useState } from 'react'
import Avatar from './Avatar'

type Community = { id: number; name: string }
type Member = { username: string; profile_picture?: string | null }

type ParentCommunityPickerProps = {
  title?: string
  description?: string
  variant?: 'regular' | 'compact'
}

function normalizeCommunities(rawCommunities: unknown): Community[] {
  if (!Array.isArray(rawCommunities)) return []
  const seen = new Set<number>()
  const normalized: Community[] = []

  for (const raw of rawCommunities) {
    if (!raw || typeof raw !== 'object') continue
    const anyRaw = raw as Record<string, unknown>

    const idCandidates = [
      anyRaw.id,
      anyRaw.community_id,
      anyRaw.communityId,
      anyRaw.parent_community_id,
      anyRaw.parentId,
    ]
    const id = idCandidates
      .map(candidate => {
        const num = Number(candidate)
        return Number.isFinite(num) ? num : NaN
      })
      .find(candidate => !Number.isNaN(candidate))

    if (!id || seen.has(id)) continue

    const name =
      (typeof anyRaw.name === 'string' && anyRaw.name.trim()) ||
      (typeof anyRaw.community_name === 'string' && anyRaw.community_name.trim()) ||
      (typeof anyRaw.title === 'string' && anyRaw.title.trim()) ||
      `Community ${id}`

    const parentIndicators = [
      anyRaw.parent_community_id,
      anyRaw.parentCommunityId,
      anyRaw.parent_id,
      anyRaw.parentId,
      anyRaw.parent,
    ]
    const isParent = parentIndicators.every(value => value === null || value === undefined || value === 0)
    if (!isParent) continue

    seen.add(id)
    normalized.push({ id, name })
  }

  normalized.sort((a, b) => a.name.localeCompare(b.name))
  return normalized
}

export default function ParentCommunityPicker({
  title = 'Select a Community',
  description,
  variant = 'regular',
}: ParentCommunityPickerProps) {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [membersByCommunity, setMembersByCommunity] = useState<Record<number, Member[]>>({})
  const [loadingMembers, setLoadingMembers] = useState<Record<number, boolean>>({})
  const [memberErrors, setMemberErrors] = useState<Record<number, string>>({})
  const [searchTerms, setSearchTerms] = useState<Record<number, string>>({})

  useEffect(() => {
    let cancelled = false
    async function loadCommunities() {
      setLoading(true)
      setError(null)
      try {
        let list: Community[] = []
        try {
          const r = await fetch('/api/user_parent_community', { credentials: 'include' })
          const j = await r.json().catch(() => null)
          if (j?.success) list = normalizeCommunities(j.communities)
        } catch {
          // Ignore and fallback
        }

        if (!list.length) {
          try {
            const r2 = await fetch('/get_user_communities', { credentials: 'include' })
            const j2 = await r2.json().catch(() => null)
            list = normalizeCommunities(j2?.communities)
          } catch {
            // Ignore
          }
        }

        if (!cancelled) {
          setCommunities(list)
        }
      } catch (err) {
        if (!cancelled) {
          setError('Unable to load communities right now.')
          console.error('ParentCommunityPicker load error:', err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadCommunities()
    return () => {
      cancelled = true
    }
  }, [])

  function handleToggle(commId: number) {
    const willOpen = !expanded[commId]
    setExpanded(prev => {
      const next = { ...prev, [commId]: !prev[commId] }
      if (!next[commId]) {
        setSearchTerms(prevTerms => {
          if (!(commId in prevTerms)) return prevTerms
          const clone = { ...prevTerms }
          delete clone[commId]
          return clone
        })
      }
      return next
    })

    if (willOpen && !membersByCommunity[commId] && !loadingMembers[commId]) {
      setLoadingMembers(prev => ({ ...prev, [commId]: true }))
      setMemberErrors(prev => {
        if (!prev[commId]) return prev
        const clone = { ...prev }
        delete clone[commId]
        return clone
      })
      const fd = new URLSearchParams({ community_id: String(commId) })
      fetch('/get_community_members', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd,
      })
        .then(r => r.json())
        .then(j => {
          if (j?.success && Array.isArray(j.members)) {
            const list = j.members.map((m: any) => ({
              username: m.username,
              profile_picture: m.profile_picture ?? null,
            })) as Member[]
            setMembersByCommunity(prev => ({ ...prev, [commId]: list }))
          } else {
            setMemberErrors(prev => ({ ...prev, [commId]: 'No members found for this community yet.' }))
            setMembersByCommunity(prev => ({ ...prev, [commId]: [] }))
          }
        })
        .catch(err => {
          console.error('ParentCommunityPicker member load error:', err)
          setMemberErrors(prev => ({ ...prev, [commId]: 'Unable to load members.' }))
        })
        .finally(() => {
          setLoadingMembers(prev => ({ ...prev, [commId]: false }))
        })
    }
  }

  const cardClasses =
    variant === 'compact'
      ? 'rounded-xl border border-white/10 bg-black'
      : 'rounded-xl border border-white/10 bg-black'

  const headerClasses =
    variant === 'compact'
      ? 'p-3 border-b border-white/10 font-semibold text-[15px]'
      : 'p-4 border-b border-white/10 font-semibold text-[16px]'

  const communityButtonClasses =
    variant === 'compact'
      ? 'w-full px-3 py-2 text-left hover:bg-white/5 flex items-center justify-between text-[14px]'
      : 'w-full px-4 py-3 text-left hover:bg-white/5 flex items-center justify-between'

  const memberLinkClasses =
    variant === 'compact'
      ? 'block px-3 py-2 rounded-md hover:bg-white/5 flex items-center gap-2 text-[14px]'
      : 'block px-4 py-2 rounded-md hover:bg-white/5 flex items-center gap-2'

  const sectionPadding = variant === 'compact' ? 'px-3 pb-3' : 'px-4 pb-4'

  const searchInputClasses =
    'w-full rounded-lg border border-white/12 bg-[#0f1318] pl-9 pr-3 py-2 text-sm text-white/90 outline-none focus:border-[#4db6ac]/70 focus:ring-0 transition'

  const filteredCommunities = useMemo(() => communities, [communities])

  function renderMembers(commId: number) {
    const members = membersByCommunity[commId] || []
    const term = (searchTerms[commId] || '').trim().toLowerCase()
    const filteredMembers = term
      ? members.filter(member => member.username.toLowerCase().includes(term))
      : members

    if (loadingMembers[commId]) {
      return <div className="px-3 py-3 text-sm text-[#9fb0b5]">Loading members...</div>
    }

    if (memberErrors[commId]) {
      return <div className="px-3 py-3 text-sm text-red-400">{memberErrors[commId]}</div>
    }

    if (!members.length) {
      return <div className="px-3 py-3 text-sm text-[#9fb0b5]">No members available yet.</div>
    }

    if (!filteredMembers.length) {
      return (
        <div className="px-3 py-3 text-sm text-[#9fb0b5]">
          No members match "{searchTerms[commId]?.trim()}".
        </div>
      )
    }

    return (
      <div className="mt-2 max-h-64 overflow-y-auto space-y-1 pr-1">
        {filteredMembers.map(member => (
          <a
            key={member.username}
            className={memberLinkClasses}
            href={`/user_chat/chat/${encodeURIComponent(member.username)}`}
          >
            <Avatar username={member.username} url={member.profile_picture || undefined} size={32} linkToProfile />
            <span className="truncate">{member.username}</span>
          </a>
        ))}
      </div>
    )
  }

  return (
    <div className={cardClasses}>
      <div className={headerClasses}>
        <div>{title}</div>
        {description ? <div className="mt-1 text-xs text-[#9fb0b5]">{description}</div> : null}
      </div>
      {loading ? (
        <div className="p-4 text-sm text-[#9fb0b5]">Loading your parent communities...</div>
      ) : error ? (
        <div className="p-4 text-sm text-red-400">{error}</div>
      ) : !filteredCommunities.length ? (
        <div className="p-4 text-sm text-[#9fb0b5]">You haven't created or joined any parent communities yet.</div>
      ) : (
        <div className="divide-y divide-white/10">
          {filteredCommunities.map(comm => {
            const isOpen = !!expanded[comm.id]
            return (
              <div key={comm.id}>
                <button className={communityButtonClasses} onClick={() => handleToggle(comm.id)}>
                  <span className="font-medium">{comm.name}</span>
                  <i
                    className={`fa-solid ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-[#9fb0b5] transition-transform duration-150`}
                  />
                </button>
                {isOpen && (
                  <div className={sectionPadding}>
                    <div className="relative">
                      <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-xs" />
                      <input
                        value={searchTerms[comm.id] || ''}
                        onChange={event =>
                          setSearchTerms(prev => ({ ...prev, [comm.id]: event.target.value }))
                        }
                        placeholder="Search members"
                        className={searchInputClasses}
                        type="text"
                        spellCheck={false}
                      />
                    </div>
                    {renderMembers(comm.id)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
