import { useState } from 'react'
import { apiPost } from '../utils/api'

export default function Invites() {
  const [emailForm, setEmailForm] = useState({ email: '', community_id: '' })
  const [linkForm, setLinkForm] = useState({ community_id: '' })
  const [generatedUrl, setGeneratedUrl] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [linkMsg, setLinkMsg] = useState('')

  const handleEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailMsg('')
    try {
      await apiPost('/api/community/invite', {
        email: emailForm.email,
        community_id: emailForm.community_id,
      })
      setEmailMsg('Invite sent successfully')
      setEmailForm({ email: '', community_id: emailForm.community_id })
    } catch {
      setEmailMsg('Failed to send invite')
    }
    setTimeout(() => setEmailMsg(''), 5000)
  }

  const handleGenerateLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLinkMsg('')
    setGeneratedUrl('')
    try {
      const res = await apiPost('/api/community/invite_link', {
        community_id: linkForm.community_id,
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Invites</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
          <h2 className="font-semibold mb-1">Email Invite</h2>
          <p className="text-muted text-xs mb-4">Send an invite email to join a community</p>

          {emailMsg && (
            <div className="mb-3 p-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm">{emailMsg}</div>
          )}

          <form onSubmit={handleEmailInvite} className="space-y-3">
            <input
              type="text"
              placeholder="Community ID"
              required
              value={emailForm.community_id}
              onChange={e => setEmailForm(p => ({ ...p, community_id: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
            />
            <input
              type="email"
              placeholder="Email address"
              required
              value={emailForm.email}
              onChange={e => setEmailForm(p => ({ ...p, email: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
            />
            <button type="submit" className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 transition text-sm">
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
            <input
              type="text"
              placeholder="Community ID"
              required
              value={linkForm.community_id}
              onChange={e => setLinkForm({ community_id: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
            />
            <button type="submit" className="w-full bg-accent text-black font-semibold py-2.5 rounded-lg hover:bg-accent/90 transition text-sm">
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
    </div>
  )
}
