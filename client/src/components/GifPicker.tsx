import { useCallback, useEffect, useMemo, useState } from 'react'

export type GifSelection = {
  id: string
  url: string
  previewUrl: string
}

type GifPickerProps = {
  isOpen: boolean
  onClose: () => void
  onSelect: (gif: GifSelection) => void
}

type GiphyItem = {
  id: string
  images?: {
    original?: { url?: string }
    downsized_medium?: { url?: string }
    fixed_width?: { url?: string }
    fixed_width_downsampled?: { url?: string }
    fixed_width_small?: { url?: string }
    preview_gif?: { url?: string }
    original_still?: { url?: string }
  }
}

export default function GifPicker({ isOpen, onClose, onSelect }: GifPickerProps){
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GifSelection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [keyLoading, setKeyLoading] = useState(false)

  const envKey = useMemo(() => {
    const raw = (import.meta as any)?.env?.VITE_GIPHY_API_KEY
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  }, [])

  const [apiKey, setApiKey] = useState<string | null>(envKey)

  useEffect(() => {
    if (!isOpen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape'){
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setDebouncedQuery('')
    setResults([])
    setError(null)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [query, isOpen])

  const loadGifs = useCallback(async (searchTerm: string, signal: AbortSignal) => {
    if (!apiKey){
      setError('GIF search requires a valid GIPHY API key. Ask an admin to configure it in the server environment.')
      return
    }
    setLoading(true)
    setError(null)
    const endpoint = searchTerm ? 'search' : 'trending'
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: '24',
      rating: 'pg-13',
    })
    if (searchTerm) params.set('q', searchTerm)

    try{
      const res = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`, { signal })
      if (!res.ok){
        if (res.status === 403){
          throw new Error('GIPHY API key rejected (HTTP 403)')
        }
        throw new Error(`GIPHY request failed: ${res.status}`)
      }
      const data = await res.json() as { data?: GiphyItem[] }
      const mapped = (data?.data || []).map((item) => {
        const imgs = item.images || {}
        const original = imgs.original?.url || imgs.downsized_medium?.url || imgs.fixed_width?.url
        const thumb = imgs.fixed_width_small?.url || imgs.preview_gif?.url || imgs.original_still?.url || original
        if (!original) return null
        return {
          id: item.id,
          url: original,
          previewUrl: thumb || original,
        }
      }).filter((item): item is GifSelection => Boolean(item && item.url))
      setResults(mapped)
    }catch (err){
      if ((err as Error).name === 'AbortError') return
      console.error('GIF search error', err)
      const message = (err as Error).message.includes('GIPHY API key rejected')
        ? 'GIF search requires a valid GIPHY API key. Ask an admin to configure VITE_GIPHY_API_KEY.'
        : 'Failed to load GIFs. Please try again.'
      setError(message)
    }finally{
      setLoading(false)
    }
  }, [apiKey])

  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    loadGifs(debouncedQuery, controller.signal)
    return () => controller.abort()
  }, [debouncedQuery, isOpen, loadGifs])

  useEffect(() => {
    if (!isOpen) return
    if (apiKey) return
    let cancelled = false
    setKeyLoading(true)
    setError(null)
    fetch('/api/config/giphy_key', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json().catch(() => null)
      })
      .then((json) => {
        if (!json || cancelled) return
        if (json?.success && json.key){
          setApiKey(String(json.key))
        }else{
          setError('GIF search requires a valid GIPHY API key. Ask an admin to configure it in the server environment.')
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load GIPHY API key', err)
        setError('Unable to load GIF configuration from server. Please try again later.')
      })
      .finally(() => {
        if (!cancelled) setKeyLoading(false)
      })
    return () => { cancelled = true }
  }, [apiKey, isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 backdrop-blur-sm px-3" onClick={onClose}>
      <div className="w-full max-w-[400px] max-h-[78vh] rounded-2xl border border-white/10 bg-[#0b0f10] py-3 px-3 shadow-[0_20px_36px_rgba(0,0,0,0.55)]" onClick={(e)=> e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 rounded-lg border border-white/15 bg-white/[0.02] px-2 py-1.25">
            <i className="fa-solid fa-magnifying-glass text-white/45 text-[11px]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-[12px] text-white placeholder-white/35 outline-none"
              placeholder="Search GIFs"
            />
            {query && (
              <button className="text-white/35 hover:text-white transition px-1" onClick={() => setQuery('')} aria-label="Clear search">
                <i className="fa-solid fa-xmark text-xs" />
              </button>
            )}
          </div>
          <button className="shrink-0 w-7 h-7 rounded-full text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition" onClick={onClose} aria-label="Close GIF picker">
            <i className="fa-solid fa-times text-sm" />
          </button>
        </div>

        <div className="mt-2.5 max-h-[54vh] overflow-y-auto pr-1">
          {keyLoading ? (
            <div className="flex items-center justify-center py-16 text-white/70 text-sm gap-2">
              <i className="fa-solid fa-spinner fa-spin" />
              Connecting to GIF library…
            </div>
          ) : !apiKey ? (
            <div className="py-12 text-center text-sm text-red-400 px-4 leading-relaxed">GIF search requires a valid GIPHY API key. Ask an admin to configure it in the server environment.</div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16 text-white/70 text-sm gap-2">
              <i className="fa-solid fa-spinner fa-spin" />
              Loading GIFs…
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-red-400 px-4 leading-relaxed">{error}</div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-sm text-white/60">No GIFs found. Try a different search.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {results.map((gif) => (
                <button
                  key={gif.id}
                  className="relative group rounded-lg overflow-hidden border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
                  onClick={() => onSelect(gif)}
                >
                  <img src={gif.previewUrl} alt="GIF preview" className="h-28 w-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-xs font-medium text-white uppercase tracking-wide">Use GIF</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 text-right text-[10px] tracking-wide text-white/30 uppercase">Powered by GIPHY</div>
      </div>
    </div>
  )
}
