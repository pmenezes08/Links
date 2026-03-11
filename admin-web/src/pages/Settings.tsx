import { useEffect, useState, useRef } from 'react'
import { api, apiJson } from '../utils/api'

interface WelcomeCard {
  index: number
  url: string
}

export default function Settings() {
  const [cards, setCards] = useState<WelcomeCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(true)
  const [cardsError, setCardsError] = useState('')
  const [cardsMsg, setCardsMsg] = useState('')

  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoLoading, setLogoLoading] = useState(true)
  const [logoError, setLogoError] = useState('')
  const [logoMsg, setLogoMsg] = useState('')

  const cardFileRef = useRef<HTMLInputElement>(null)
  const [cardIndex, setCardIndex] = useState('0')
  const [uploadingCard, setUploadingCard] = useState(false)

  const logoFileRef = useRef<HTMLInputElement>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const fetchCards = () => {
    setCardsLoading(true)
    apiJson<WelcomeCard[] | { cards?: WelcomeCard[] }>('/welcome_cards')
      .then(d => setCards(Array.isArray(d) ? d : d.cards ?? []))
      .catch(() => setCardsError('Failed to load welcome cards'))
      .finally(() => setCardsLoading(false))
  }

  const fetchLogo = () => {
    setLogoLoading(true)
    apiJson<{ url?: string; logo_url?: string }>('/admin/get_invite_logo')
      .then(d => setLogoUrl(d.url || d.logo_url || null))
      .catch(() => setLogoError('Failed to load invite logo'))
      .finally(() => setLogoLoading(false))
  }

  useEffect(() => { fetchCards(); fetchLogo() }, [])

  const handleUploadCard = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = cardFileRef.current?.files?.[0]
    if (!file) return
    setUploadingCard(true)
    setCardsMsg('')
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('card_index', cardIndex)
      await api('/admin/upload_welcome_card', { method: 'POST', body: fd })
      setCardsMsg('Card uploaded')
      if (cardFileRef.current) cardFileRef.current.value = ''
      fetchCards()
    } catch {
      setCardsMsg('Failed to upload card')
    } finally {
      setUploadingCard(false)
    }
    setTimeout(() => setCardsMsg(''), 4000)
  }

  const handleUploadLogo = async () => {
    const file = logoFileRef.current?.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    setLogoMsg('')
    try {
      const fd = new FormData()
      fd.append('logo', file)
      await api('/admin/upload_invite_logo', { method: 'POST', body: fd })
      setLogoMsg('Logo uploaded')
      if (logoFileRef.current) logoFileRef.current.value = ''
      fetchLogo()
    } catch {
      setLogoMsg('Failed to upload logo')
    } finally {
      setUploadingLogo(false)
    }
    setTimeout(() => setLogoMsg(''), 4000)
  }

  const handleRemoveLogo = async () => {
    if (!confirm('Remove invite logo?')) return
    setLogoMsg('')
    try {
      await api('/admin/remove_invite_logo', { method: 'POST' })
      setLogoMsg('Logo removed')
      setLogoUrl(null)
    } catch {
      setLogoMsg('Failed to remove logo')
    }
    setTimeout(() => setLogoMsg(''), 4000)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Welcome Cards */}
      <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
        <h2 className="font-semibold mb-1">Welcome Cards</h2>
        <p className="text-muted text-xs mb-4">Manage onboarding welcome cards</p>

        {cardsMsg && (
          <div className="mb-3 p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{cardsMsg}</div>
        )}

        {cardsLoading ? (
          <div className="text-muted text-sm py-4">Loading cards...</div>
        ) : cardsError ? (
          <div className="text-red-400 text-sm py-4">{cardsError}</div>
        ) : (
          <>
            {cards.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
                {cards.map(c => (
                  <div key={c.index} className="relative group">
                    <img src={c.url} alt={`Card ${c.index}`} className="w-full aspect-[3/4] object-cover rounded-lg border border-white/10" />
                    <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 rounded text-xs text-accent">#{c.index}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted text-sm mb-4">No welcome cards uploaded</div>
            )}

            <form onSubmit={handleUploadCard} className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 w-full">
                <label className="text-sm text-muted block mb-1.5">Card Image</label>
                <input
                  ref={cardFileRef}
                  type="file"
                  accept="image/*"
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-accent/20 file:text-accent file:text-xs file:font-medium"
                />
              </div>
              <div className="w-full sm:w-24">
                <label className="text-sm text-muted block mb-1.5">Index</label>
                <input
                  type="number"
                  min="0"
                  value={cardIndex}
                  onChange={e => setCardIndex(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </div>
              <button type="submit" disabled={uploadingCard} className="shrink-0 bg-accent text-black font-semibold px-4 py-2 rounded-lg text-sm hover:bg-accent/90 disabled:opacity-50 transition">
                {uploadingCard ? 'Uploading...' : 'Upload Card'}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Invite Logo */}
      <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
        <h2 className="font-semibold mb-1">Invite Logo</h2>
        <p className="text-muted text-xs mb-4">Custom logo shown on invite pages</p>

        {logoMsg && (
          <div className="mb-3 p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{logoMsg}</div>
        )}

        {logoLoading ? (
          <div className="text-muted text-sm py-4">Loading logo...</div>
        ) : logoError ? (
          <div className="text-red-400 text-sm py-4">{logoError}</div>
        ) : (
          <>
            {logoUrl ? (
              <div className="mb-4 flex items-start gap-4">
                <img src={logoUrl} alt="Invite logo" className="h-20 w-20 object-contain rounded-lg border border-white/10 bg-white/5 p-2" />
                <button onClick={handleRemoveLogo} className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition">
                  Remove Logo
                </button>
              </div>
            ) : (
              <div className="text-muted text-sm mb-4">No logo uploaded</div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 w-full">
                <label className="text-sm text-muted block mb-1.5">Logo Image</label>
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/*"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-accent/20 file:text-accent file:text-xs file:font-medium"
                />
              </div>
              <button type="button" onClick={handleUploadLogo} disabled={uploadingLogo} className="shrink-0 bg-accent text-black font-semibold px-4 py-2 rounded-lg text-sm hover:bg-accent/90 disabled:opacity-50 transition">
                {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
