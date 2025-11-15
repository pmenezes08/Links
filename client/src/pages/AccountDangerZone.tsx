import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

export default function AccountDangerZone() {
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setTitle('Danger Zone')
  }, [setTitle])

  const handleDelete = async () => {
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      setFeedback({ type: 'error', text: 'Please type DELETE to confirm.' })
      return
    }
    setFeedback(null)
    setLoading(true)
    try {
      try {
        const keys = Object.keys(localStorage)
        keys.forEach(key => {
          if (key.includes('onboarding') || key.includes('first_login')) {
            localStorage.removeItem(key)
          }
        })
        localStorage.clear()
      } catch (e) {
        console.error('Failed clearing localStorage', e)
      }

      const resp = await fetch('/delete_account', { method: 'POST', credentials: 'include' })
      if (!resp.ok) {
        setFeedback({ type: 'error', text: `Server error (${resp.status})` })
        setLoading(false)
        return
      }
      const json = await resp.json().catch(() => null)
      if (json?.success) {
        setFeedback({ type: 'success', text: 'Account deleted. Redirecting…' })
        setTimeout(() => {
          window.location.replace('/signup')
        }, 1200)
      } else {
        setFeedback({ type: 'error', text: json?.error || 'Failed to delete account' })
        setLoading(false)
      }
    } catch (err) {
      setFeedback({ type: 'error', text: 'Network error. Please try again.' })
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm text-[#9fb0b5] hover:text-white"
          onClick={() => navigate('/account_settings')}
        >
          <i className="fa-solid fa-arrow-left" />
          Back to Account Settings
        </button>

        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">Danger Zone</p>
            <h1 className="text-xl font-semibold text-white">Delete your account</h1>
            <p className="text-sm text-red-200/80 mt-2">
              This action is permanent. All posts, messages, and membership data will be deleted and cannot be recovered.
            </p>
          </div>

          {feedback && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                feedback.type === 'success'
                  ? 'border-green-500/40 bg-green-500/10 text-green-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div className="space-y-3">
            <label className="text-sm text-white/80">
              Type <span className="font-semibold">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={confirmation}
              onChange={e => setConfirmation(e.target.value)}
              className="w-full rounded-lg border border-red-500/40 bg-black px-4 py-3 text-white focus:border-red-300 focus:outline-none"
              placeholder="DELETE"
              disabled={loading}
            />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleDelete}
            className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-500 disabled:opacity-60"
          >
            {loading ? 'Deleting…' : 'Delete Account Permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
