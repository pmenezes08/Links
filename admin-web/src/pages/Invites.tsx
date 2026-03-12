import { useEffect, useState, useRef } from 'react'
import { apiJson, apiPost } from '../utils/api'

export default function Invites() {
  const [communities, setCommunities] = useState<{ id: number; name: string }[]>([])
  const [commLoading, setCommLoading] = useState(true)
  const [selectedCommunity, setSelectedCommunity] = useState('')
  const [email, setEmail] = useState('')
  const [generatedUrl, setGeneratedUrl] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [linkMsg, setLinkMsg] = useState('')
  const [bulkEmails, setBulkEmails] = useState('')
  const [bulkMsg, setBulkMsg] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiJson<{ communities?: { id: number; name: string }[] }>('/api/admin/communities')
      .then(d => setCommunities(d.communities ?? []))
      .catch(() => {})
      .finally(() => setCommLoading(false))
  }, [])

  const handleEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCommunity) return
    setEmailMsg('')
    try {
      await apiPost('/api/community/invite', {
        email,
        community_id: selectedCommunity,
      })
      setEmailMsg('Invite sent successfully')
      setEmail('')
    } catch {
      setEmailMsg('Failed to send invite')
    }
    setTimeout(() => setEmailMsg(''), 5000)
  }

  const handleGenerateLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCommunity) return
    setLinkMsg('')
    setGeneratedUrl('')
    try {
      const res = await apiPost('/api/community/invite_link', {
        community_id: selectedCommunity,
      }) as { invite_url?: string; url?: string; link?: string }
      const url = res.invite_url || res.url || res.link || ''
      if (url) {
        setGeneratedUrl(url)
        setLinkMsg('Link generated')
      } else {
        setLinkMsg('No URL returned')
      }
    } catch {
      setLinkMsg('Failed to generate link')
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedUrl)
    setLinkMsg('Copied to clipboard!')
    setTimeout(() => setLinkMsg(''), 2000)
  }

  const handleBulkInvite = async (emails: string) => {
    if (!selectedCommunity || !emails.trim()) return
    setBulkLoading(true); setBulkMsg('')
    try {
      const emailList = emails.split(/[,\n]+/).map(e => e.trim()).filter(Boolean)
      if (emailList.length === 0) { setBulkMsg('No valid emails provided'); setBulkLoading(false); return }
      await apiPost('/api/community/invite_bulk', { emails: emailList, community_id: selectedCommunity })
      setBulkMsg(`Bulk invite sent to ${emailList.length} email(s)`)
      setBulkEmails('')
    } catch {
      setBulkMsg('Failed to send bulk invites')
    } finally { setBulkLoading(false) }
    setTimeout(() => setBulkMsg(''), 5000)
  }

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (text) handleBulkInvite(text)
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Invites</h1>

      {commLoading ? (
        <div className="text-muted text-center py-12">Loading communities...</div>
      ) : (
        <>
          <div className="max-w-md">
            <label className="text-sm text-muted block mb-1.5">Community</label>
            <select
              value={selectedCommunity}
              onChange={e => setSelectedCommunity(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">Select a community...</option>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name} (ID: {c.id})</option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
              <h2 className="font-semibold mb-1">Email Invite</h2>
              <p className="text-muted text-xs mb-4">Send an invite email to join a community</p>

              {emailMsg && (
                <div className="mb-3 p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{emailMsg}</div>
              )}

              <form onSubmit={handleEmailInvite} className="space-y-3">
                <input
                  type="email"
                  placeholder="Email address"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!selectedCommunity}
                  className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
                >
                  <i className="fa-solid fa-paper-plane mr-2" />Send Invite
                </button>
              </form>
            </div>

            <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
              <h2 className="font-semibold mb-1">QR / Link Invite</h2>
              <p className="text-muted text-xs mb-4">Generate a shareable invite link</p>

              {linkMsg && (
                <div className="mb-3 p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{linkMsg}</div>
              )}

              <form onSubmit={handleGenerateLink} className="space-y-3">
                <button
                  type="submit"
                  disabled={!selectedCommunity}
                  className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
                >
                  <i className="fa-solid fa-link mr-2" />Generate Link
                </button>
              </form>

              {generatedUrl && (
                <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-lg">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-accent text-xs break-all flex-1">{generatedUrl}</code>
                    <button onClick={copyToClipboard} className="shrink-0 p-2 rounded-lg hover:bg-white/10 transition text-muted hover:text-white" title="Copy">
                      <i className="fa-solid fa-copy" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
            <h2 className="font-semibold mb-1">Bulk Invite</h2>
            <p className="text-muted text-xs mb-4">Invite multiple users at once via comma-separated emails or CSV upload</p>

            {bulkMsg && (
              <div className="mb-3 p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{bulkMsg}</div>
            )}

            <div className="space-y-3">
              <textarea
                placeholder="Enter emails separated by commas or newlines"
                rows={4}
                value={bulkEmails}
                onChange={e => setBulkEmails(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleBulkInvite(bulkEmails)}
                  disabled={!selectedCommunity || !bulkEmails.trim() || bulkLoading}
                  className="flex-1 bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
                >
                  <i className="fa-solid fa-paper-plane mr-2" />{bulkLoading ? 'Sending...' : 'Send Bulk Invite'}
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!selectedCommunity || bulkLoading}
                  className="px-4 bg-white/5 border border-white/10 font-semibold py-2.5 rounded-lg hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
                >
                  <i className="fa-solid fa-file-csv mr-2" />Upload CSV
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
