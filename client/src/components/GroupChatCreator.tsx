import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'

type Community = { id: number; name: string }
type Member = { username: string; profile_picture?: string | null; display_name?: string }

const MAX_GROUP_MEMBERS = 5

function normalizeCommunities(rawCommunities: unknown, communityFallback: (id: number) => string): Community[] {
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
      communityFallback(id)

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

export default function GroupChatCreator() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [membersByCommunity, setMembersByCommunity] = useState<Record<number, Member[]>>({})
  const [loadingMembers, setLoadingMembers] = useState<Record<number, boolean>>({})
  const [memberErrors, setMemberErrors] = useState<Record<number, string>>({})
  const [searchTerms, setSearchTerms] = useState<Record<number, string>>({})
  
  // Group chat state
  const [selectedMembers, setSelectedMembers] = useState<Member[]>([])
  const [groupName, setGroupName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadCommunities() {
      setLoading(true)
      setError(null)
      try {
        let list: Community[] = []
        try {
          const r = await fetch('/api/user_parent_community', { credentials: 'include', headers: { 'Accept': 'application/json' } })
          const j = await r.json().catch(() => null)
          if (j?.success) list = normalizeCommunities(j.communities, (id) => t('chat.community_name_fallback', { id }))
        } catch {
          // Ignore and fallback
        }

        if (!list.length) {
          try {
            const r2 = await fetch('/get_user_communities', { credentials: 'include' })
            const j2 = await r2.json().catch(() => null)
            list = normalizeCommunities(j2?.communities, (id) => t('chat.community_name_fallback', { id }))
          } catch {
            // Ignore
          }
        }

        if (!cancelled) {
          setCommunities(list)
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('chat.unable_load_communities'))
          console.error('GroupChatCreator load error:', err)
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
              display_name: m.display_name || m.username,
            })) as Member[]
            setMembersByCommunity(prev => ({ ...prev, [commId]: list }))
          } else {
            setMemberErrors(prev => ({ ...prev, [commId]: t('chat.no_members_in_community') }))
            setMembersByCommunity(prev => ({ ...prev, [commId]: [] }))
          }
        })
        .catch(err => {
          console.error('GroupChatCreator member load error:', err)
          setMemberErrors(prev => ({ ...prev, [commId]: t('chat.unable_load_members') }))
        })
        .finally(() => {
          setLoadingMembers(prev => ({ ...prev, [commId]: false }))
        })
    }
  }

  function toggleMember(member: Member) {
    setSelectedMembers(prev => {
      const exists = prev.some(m => m.username === member.username)
      if (exists) {
        return prev.filter(m => m.username !== member.username)
      }
      if (prev.length >= MAX_GROUP_MEMBERS) {
        return prev // Don't add more than max
      }
      return [...prev, member]
    })
  }

  function removeMember(username: string) {
    setSelectedMembers(prev => prev.filter(m => m.username !== username))
  }

  async function handleCreateGroup() {
    if (selectedMembers.length < 2) {
      setCreateError(t('chat.select_min_members'))
      return
    }
    if (!groupName.trim()) {
      setCreateError(t('chat.group_name_required'))
      return
    }

    setCreating(true)
    setCreateError(null)

    try {
      const response = await fetch('/api/group_chat/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: groupName.trim(),
          members: selectedMembers.map(m => m.username),
        }),
      })
      const data = await response.json()

      if (data.success && data.group_id) {
        navigate(`/group_chat/${data.group_id}`)
      } else {
        setCreateError(data.error || t('chat.failed_create_group'))
      }
    } catch (err) {
      console.error('Error creating group chat:', err)
      setCreateError(t('chat.network_error'))
    } finally {
      setCreating(false)
    }
  }

  const filteredCommunities = useMemo(() => communities, [communities])

  const searchInputClasses =
    'w-full rounded-lg border border-c-border bg-[#0f1318] pl-9 pr-3 py-2 text-sm text-c-text-secondary outline-none focus:border-cpoint-turquoise/70 focus:ring-0 transition'

  function renderMembers(commId: number) {
    const members = membersByCommunity[commId] || []
    const term = (searchTerms[commId] || '').trim().toLowerCase()
    const filteredMembers = term
      ? members.filter(member => member.username.toLowerCase().includes(term))
      : members

    if (loadingMembers[commId]) {
      return <div className="px-3 py-3 text-sm text-c-text-tertiary">{t('chat.loading_members')}</div>
    }

    if (memberErrors[commId]) {
      return <div className="px-3 py-3 text-sm text-red-400">{memberErrors[commId]}</div>
    }

    if (!members.length) {
      return <div className="px-3 py-3 text-sm text-c-text-tertiary">{t('chat.no_members_available')}</div>
    }

    if (!filteredMembers.length) {
      return (
        <div className="px-3 py-3 text-sm text-c-text-tertiary">
          {t('chat.no_members_match', { query: searchTerms[commId]?.trim() ?? '' })}
        </div>
      )
    }

    return (
      <div className="mt-2 max-h-64 overflow-y-auto space-y-1 pr-1">
        {filteredMembers.map(member => {
          const isSelected = selectedMembers.some(m => m.username === member.username)
          const isDisabled = !isSelected && selectedMembers.length >= MAX_GROUP_MEMBERS
          
          return (
            <button
              key={member.username}
              type="button"
              onClick={() => !isDisabled && toggleMember(member)}
              disabled={isDisabled}
              className={`w-full px-3 py-2 rounded-lg flex items-center gap-3 transition ${
                isSelected
                  ? 'bg-cpoint-turquoise/20 border border-cpoint-turquoise/50'
                  : isDisabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-c-hover-bg border border-transparent'
              }`}
            >
              <Avatar username={member.username} url={member.profile_picture || undefined} size={32} />
              <span className="truncate flex-1 text-left text-[14px]">{member.display_name || member.username}</span>
              {isSelected && (
                <i className="fa-solid fa-check text-cpoint-turquoise text-sm" />
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Selected Members */}
      {selectedMembers.length > 0 && (
        <div className="rounded-xl border border-c-border bg-c-bg-app p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-c-text-secondary">
              {t('chat.selected_count', { current: selectedMembers.length, max: MAX_GROUP_MEMBERS })}
            </div>
            {selectedMembers.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedMembers([])}
                className="text-xs text-c-text-tertiary hover:text-white"
              >
                {t('chat.clear_all')}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedMembers.map(member => (
              <div
                key={member.username}
                className="flex items-center gap-2 px-2 py-1 rounded-full bg-cpoint-turquoise/20 border border-cpoint-turquoise/40"
              >
                <Avatar username={member.username} url={member.profile_picture || undefined} size={20} />
                <span className="text-xs text-c-text-secondary">{member.display_name || member.username}</span>
                <button
                  type="button"
                  onClick={() => removeMember(member.username)}
                  className="text-c-text-tertiary hover:text-white ml-1"
                >
                  <i className="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Group Name Input */}
      {selectedMembers.length >= 2 && (
        <div className="rounded-xl border border-c-border bg-c-bg-app p-3">
          <label className="block text-sm font-semibold text-white/80 mb-2">{t('chat.group_name_label')}</label>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder={t('chat.group_name_placeholder')}
            className={searchInputClasses}
            maxLength={50}
          />
        </div>
      )}

      {/* Create Button */}
      {selectedMembers.length >= 2 && (
        <div className="rounded-xl border border-c-border bg-c-bg-app p-3">
          {createError && (
            <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {createError}
            </div>
          )}
          <button
            type="button"
            onClick={handleCreateGroup}
            disabled={creating || !groupName.trim()}
            className="w-full px-4 py-3 bg-cpoint-turquoise text-black font-semibold rounded-lg hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {creating ? (
              <>
                <i className="fa-solid fa-spinner fa-spin mr-2" />
                {t('chat.creating')}
              </>
            ) : (
              <>
                <i className="fa-solid fa-users mr-2" />
                {t('chat.create_group_chat')}
              </>
            )}
          </button>
        </div>
      )}

      {/* Community Picker */}
      <div className="rounded-xl border border-c-border bg-c-bg-app">
        <div className="p-3 border-b border-c-border">
          <div className="font-semibold text-[15px]">{t('chat.select_members_title')}</div>
          <div className="mt-1 text-xs text-c-text-tertiary">
            {t('chat.select_members_hint', { max: MAX_GROUP_MEMBERS })}
          </div>
        </div>
        
        {loading ? (
          <div className="p-4 text-sm text-c-text-tertiary">{t('chat.loading_communities')}</div>
        ) : error ? (
          <div className="p-4 text-sm text-red-400">{error}</div>
        ) : !filteredCommunities.length ? (
          <div className="p-4 text-sm text-c-text-tertiary">{t('chat.no_communities_joined')}</div>
        ) : (
          <div className="divide-y divide-c-border">
            {filteredCommunities.map(comm => {
              const isOpen = !!expanded[comm.id]
              return (
                <div key={comm.id}>
                  <button
                    className="w-full px-3 py-2 text-left hover:bg-c-hover-bg flex items-center justify-between text-[14px]"
                    onClick={() => handleToggle(comm.id)}
                  >
                    <span className="font-medium">{comm.name}</span>
                    <i
                      className={`fa-solid ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-c-text-tertiary transition-transform duration-150`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3">
                      <div className="relative">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-c-text-tertiary text-xs" />
                        <input
                          value={searchTerms[comm.id] || ''}
                          onChange={event =>
                            setSearchTerms(prev => ({ ...prev, [comm.id]: event.target.value }))
                          }
                          placeholder={t('chat.search_members')}
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
    </div>
  )
}
