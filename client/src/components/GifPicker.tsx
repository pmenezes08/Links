import { useCallback, useEffect, useMemo, useState } from 'react'

export type GifSelection = {
  id: string
  url: string
  previewUrl: string
}

const FALLBACK_GIPHY_KEY = 'dc6zaTOxFJmzC'

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

  const apiKey = useMemo(() => (
    (import.meta as any)?.env?.VITE_GIPHY_API_KEY || FALLBACK_GIPHY_KEY
  ), [])

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
      setError('Failed to load GIFs. Please try again.')
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[min(620px,92%)] max-h-[85vh] rounded-2xl border border-white/10 bg-[#0b0f10] p-4 shadow-[0_30px_60px_rgba(0,0,0,0.55)]" onClick={(e)=> e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <i className="fa-solid fa-magnifying-glass text-white/50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
              placeholder="Search GIFs"
            />
            {query && (
              <button className="text-white/40 hover:text-white transition" onClick={() => setQuery('')} aria-label="Clear search">
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>
          <button className="ml-2 text-white/60 hover:text-white" onClick={onClose} aria-label="Close GIF picker">
            <i className="fa-solid fa-times" />
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-white/70 text-sm gap-2">
              <i className="fa-solid fa-spinner fa-spin" />
              Loading GIFs…
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-red-400">{error}</div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-sm text-white/60">No GIFs found. Try a different search.</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {results.map((gif) => (
                <button
                  key={gif.id}
                  className="relative group rounded-lg overflow-hidden border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
                  onClick={() => onSelect(gif)}
                >
                  <img src={gif.previewUrl} alt="GIF preview" className="h-28 w-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-xs font-medium text-white">Use GIF</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 text-right text-[10px] tracking-wide text-white/30 uppercase">Powered by GIPHY</div>
      </div>
    </div>
  )
}
