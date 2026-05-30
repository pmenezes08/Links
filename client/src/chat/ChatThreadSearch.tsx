import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SearchResult {
  id: number | string
  text: string
  sent: boolean
  time: string
  created_at?: string
  sender?: string
  sender_username?: string
  image_path?: string
  video_path?: string
  audio_path?: string
  voice?: string
}

interface ChatThreadSearchProps {
  open: boolean
  onClose: () => void
  onJumpToMessage: (messageId: number | string) => Promise<boolean>
  threadType: 'dm' | 'group'
  threadId: string | number
  currentUser?: string
}

export default function ChatThreadSearch({
  open,
  onClose,
  onJumpToMessage,
  threadType,
  threadId,
  currentUser,
}: ChatThreadSearchProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [jumpingToId, setJumpingToId] = useState<number | string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTotal(0)
      setHasMore(false)
      setSearched(false)
      setJumpingToId(null)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [open])

  const doSearch = useCallback(
    async (searchQuery: string, offset = 0) => {
      if (!searchQuery.trim()) {
        setResults([])
        setTotal(0)
        setHasMore(false)
        setSearched(false)
        return
      }
      setLoading(true)
      try {
        const params = new URLSearchParams({
          q: searchQuery.trim(),
          limit: '20',
          offset: String(offset),
        })
        let url: string
        if (threadType === 'dm') {
          params.set('other_user', String(threadId))
          url = `/api/dm/search?${params}`
        } else {
          url = `/api/group_chat/${threadId}/search?${params}`
        }
        const res = await fetch(url, { credentials: 'include' })
        const data = await res.json()
        if (data.success) {
          if (offset > 0) {
            setResults(prev => [...prev, ...data.messages])
          } else {
            setResults(data.messages)
          }
          setTotal(data.total)
          setHasMore(data.has_more)
        }
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setLoading(false)
        setSearched(true)
      }
    },
    [threadType, threadId],
  )

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => doSearch(value, 0), 350)
    },
    [doSearch],
  )

  const handleLoadMore = useCallback(() => {
    doSearch(query, results.length)
  }, [doSearch, query, results.length])

  const handleResultClick = useCallback(
    async (messageId: number | string) => {
      inputRef.current?.blur()
      if (jumpingToId !== null) return
      setJumpingToId(messageId)
      try {
        const ok = await onJumpToMessage(messageId)
        if (ok) {
          onClose()
        } else {
          setJumpingToId(null)
        }
      } catch {
        setJumpingToId(null)
      }
    },
    [onJumpToMessage, onClose, jumpingToId],
  )

  const handleResultsTouch = useCallback(() => {
    inputRef.current?.blur()
  }, [])

  const formatTime = (time: string) => {
    try {
      const d = new Date(time)
      return (
        d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }) +
        ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      )
    } catch {
      return time
    }
  }

  const getMessagePreview = (result: SearchResult) => {
    if (result.text) return result.text
    if (result.image_path) return '\u{1F4F7} Photo'
    if (result.video_path) return '\u{1F3AC} Video'
    if (result.audio_path || result.voice) return '\u{1F3A4} Voice'
    return 'Message'
  }

  const getSenderLabel = (result: SearchResult) => {
    const sender = result.sender || result.sender_username || ''
    if (!sender) {
      return result.sent ? t('chat.you', 'You') : ''
    }
    if (currentUser && sender.toLowerCase() === currentUser.toLowerCase()) {
      return t('chat.you', 'You')
    }
    if (sender.toLowerCase() === 'steve') {
      return 'Steve'
    }
    return sender
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[10050] flex flex-col bg-black/80"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex flex-col w-full max-w-lg mx-auto mt-[env(safe-area-inset-top,0px)] h-full max-h-[80vh] my-auto rounded-xl overflow-hidden bg-[#111] border border-white/10">
        {/* Search header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <i className="fa-solid fa-magnifying-glass text-white/50 text-sm" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            placeholder={t('chat.search_messages', 'Search messages...')}
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/40"
            aria-label={t('chat.search_messages', 'Search messages')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="p-1 text-white/50 hover:text-white/80"
              onClick={() => {
                setQuery('')
                setResults([])
                setTotal(0)
                setSearched(false)
              }}
              aria-label={t('chat.clear_search', 'Clear')}
            >
              <i className="fa-solid fa-xmark text-sm" />
            </button>
          )}
          <button
            type="button"
            className="p-1 text-white/50 hover:text-white/80"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
          >
            <i className="fa-solid fa-xmark text-base" />
          </button>
        </div>

        {/* Count badge */}
        {searched && total > 0 && (
          <div className="px-3 py-1.5 text-xs text-[#00cec8] border-b border-white/5">
            {total}{' '}
            {total === 1
              ? t('chat.match', 'match')
              : t('chat.matches', 'matches')}
          </div>
        )}

        {/* Results */}
        <div
          className="flex-1 overflow-y-auto"
          role="listbox"
          aria-label={t('chat.search_results', 'Search results')}
          onTouchStart={handleResultsTouch}
        >
          {loading && results.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <i className="fa-solid fa-spinner fa-spin text-white/40" />
            </div>
          )}

          {searched && !loading && results.length === 0 && query.trim() && (
            <div className="text-center py-8 text-white/40 text-sm">
              {t('chat.no_search_results', 'No messages found')}
            </div>
          )}

          {!searched && !loading && (
            <div className="text-center py-8 text-white/40 text-sm">
              {t('chat.search_hint', 'Type to search this conversation')}
            </div>
          )}

          {results.map(result => {
            const isJumping = jumpingToId === result.id
            const isDisabled = jumpingToId !== null && !isJumping
            return (
              <button
                key={result.id}
                type="button"
                role="option"
                aria-selected={false}
                className={`w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 ${
                  isDisabled ? 'opacity-40 pointer-events-none' : ''
                } ${isJumping ? 'opacity-70' : ''}`}
                onClick={() => handleResultClick(result.id)}
                disabled={isDisabled}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {getSenderLabel(result) && (
                      <div className="text-xs text-[#00cec8] font-medium mb-0.5 truncate">
                        {getSenderLabel(result)}
                      </div>
                    )}
                    <div className="text-sm text-white/90 line-clamp-2">
                      {getMessagePreview(result)}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">
                      {formatTime(result.time || result.created_at || '')}
                    </div>
                  </div>
                  {isJumping ? (
                    <i className="fa-solid fa-spinner fa-spin text-[#00cec8] text-xs mt-1.5 flex-shrink-0" aria-label={t('chat.loading_message', 'Loading message')} />
                  ) : (
                    <i className="fa-solid fa-chevron-right text-white/20 text-xs mt-1.5 flex-shrink-0" />
                  )}
                </div>
              </button>
            )
          })}

          {hasMore && (
            <button
              type="button"
              className="w-full py-3 text-sm text-[#00cec8] hover:bg-white/5 transition-colors"
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? (
                <i className="fa-solid fa-spinner fa-spin" />
              ) : (
                t('chat.load_more_results', 'Load more results')
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
