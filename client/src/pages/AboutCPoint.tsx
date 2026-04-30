import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { useNavigate } from 'react-router-dom'

import DashboardBottomNav from '../components/DashboardBottomNav'
import { useHeader } from '../contexts/HeaderContext'
import {
  ABOUT_CPOINT_VERSION_LABEL,
  ABOUT_HOW_IT_WORKS,
  MANIFESTO_FULL,
  MANIFESTO_SUMMARY_PARAS,
  type AboutHowCard,
  type AboutPillar,
} from '../content/aboutCPoint'

function stevePrefillUrl(message: string): string {
  return `/user_chat/chat/Steve?prefill=${encodeURIComponent(message.trim())}`
}

function ModalBackdrop({
  children,
  onClose,
  wide,
}: {
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center sm:p-4 bg-black/70 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:pb-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#0a0a0a] p-4 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function TutorialSlotBody({
  card,
  videoUrl,
  isAppAdmin,
  onClose,
  onVideoSaved,
}: {
  card: AboutHowCard
  videoUrl: string | null
  isAppAdmin: boolean
  onClose: () => void
  onVideoSaved: (slotId: string, url: string) => void
}) {
  const [pasteUrl, setPasteUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [busyFile, setBusyFile] = useState(false)

  const saveUrl = useCallback(
    async (url: string) => {
      const u = url.trim()
      if (!u.startsWith('https://')) {
        setUploadErr('URL must start with https://')
        return
      }
      setSaving(true)
      setUploadErr(null)
      try {
        const r = await fetch('/api/admin/about/tutorial_video', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ slot_id: card.id, public_url: u }),
        })
        const d = await r.json().catch(() => null)
        if (!r.ok || !d?.success) {
          setUploadErr(d?.error || 'Save failed')
          return
        }
        onVideoSaved(card.id, u)
        onClose()
      } catch {
        setUploadErr('Network error')
      } finally {
        setSaving(false)
      }
    },
    [card.id, onClose, onVideoSaved],
  )

  const onPickFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      setBusyFile(true)
      setUploadErr(null)
      try {
        const r = await fetch('/api/admin/about/tutorial_upload_url', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ filename: file.name || 'tutorial.mp4', content_type: file.type || 'video/mp4' }),
        })
        const d = await r.json().catch(() => null)
        if (!r.ok || !d?.success || !d.upload_url || !d.public_url) {
          setUploadErr(d?.error || 'Could not start upload')
          return
        }
        const put = await fetch(d.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'video/mp4' } })
        if (!put.ok) {
          setUploadErr('Upload to storage failed')
          return
        }
        await saveUrl(d.public_url as string)
      } catch {
        setUploadErr('Upload failed')
      } finally {
        setBusyFile(false)
      }
    },
    [saveUrl],
  )

  if (videoUrl) {
    return (
      <>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-semibold text-white pr-2">{card.title}</h3>
          <button type="button" className="text-xs text-[#9fb0b5] hover:text-white shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="text-sm text-[#9fb0b5] mb-3">{card.description}</p>
        <video src={videoUrl} controls className="w-full rounded-lg bg-black max-h-[50vh]" playsInline />
        {isAppAdmin ? (
          <p className="text-xs text-[#9fb0b5]/80 mt-3">Admin: replace by uploading again from this card on About.</p>
        ) : null}
      </>
    )
  }

  if (isAppAdmin) {
    return (
      <>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-semibold text-white pr-2">{card.title}</h3>
          <button type="button" className="text-xs text-[#9fb0b5] hover:text-white shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="text-sm text-[#9fb0b5] mb-3">{card.description}</p>
        <p className="text-sm text-white/90 mb-2">Upload a tutorial video (admin)</p>
        <label className="block mb-3">
          <span className="sr-only">Video file</span>
          <input
            type="file"
            accept="video/*"
            disabled={busyFile || saving}
            className="block w-full text-sm text-[#9fb0b5] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#4db6ac] file:text-black"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ''
              void onPickFile(f)
            }}
          />
        </label>
        <div className="text-xs text-[#9fb0b5] mb-2">Or paste a public https URL</div>
        <input
          type="url"
          value={pasteUrl}
          onChange={(e) => setPasteUrl(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white mb-2"
        />
        <button
          type="button"
          disabled={saving || busyFile}
          className="w-full py-2 rounded-lg bg-[#4db6ac] text-black text-sm font-semibold disabled:opacity-50"
          onClick={() => void saveUrl(pasteUrl)}
        >
          {saving ? 'Saving…' : 'Save URL'}
        </button>
        {uploadErr ? <p className="text-xs text-red-400 mt-2">{uploadErr}</p> : null}
      </>
    )
  }

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-base font-semibold text-white pr-2">{card.title}</h3>
        <button type="button" className="text-xs text-[#9fb0b5] hover:text-white shrink-0" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="text-sm text-[#9fb0b5] mb-4">{card.description}</p>
      <div className="text-center text-sm text-[#9fb0b5] py-6 border border-white/10 rounded-xl">
        Video walkthrough coming soon.
      </div>
    </>
  )
}

export default function AboutCPoint() {
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const isWeb = Capacitor.getPlatform() === 'web'

  const [videos, setVideos] = useState<Record<string, string | null>>({})
  const [isAppAdmin, setIsAppAdmin] = useState(false)
  const [manifestoOpen, setManifestoOpen] = useState(false)
  const [pillarOpen, setPillarOpen] = useState<AboutPillar | null>(null)
  const [slotOpen, setSlotOpen] = useState<AboutHowCard | null>(null)

  useEffect(() => {
    setTitle('About C-Point')
    return () => setTitle('')
  }, [setTitle])

  useEffect(() => {
    let cancel = false
    void (async () => {
      try {
        const [vRes, aRes] = await Promise.all([
          fetch('/api/about/tutorial_videos', { credentials: 'include', headers: { Accept: 'application/json' } }),
          fetch('/api/check_admin', { credentials: 'include', headers: { Accept: 'application/json' } }),
        ])
        const vJson = await vRes.json().catch(() => null)
        const aJson = await aRes.json().catch(() => null)
        if (!cancel && vJson?.success && vJson.videos && typeof vJson.videos === 'object') {
          setVideos(vJson.videos as Record<string, string | null>)
        }
        if (!cancel) setIsAppAdmin(!!aJson?.is_admin)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancel = true
    }
  }, [])

  const onVideoSaved = useCallback((slotId: string, url: string) => {
    setVideos((prev) => ({ ...prev, [slotId]: url }))
  }, [])

  const bottomPad = 'pb-[calc(3.5rem+env(safe-area-inset-bottom,0px)+12px)]'

  return (
    <div className={`min-h-screen bg-black text-white ${bottomPad} ${isWeb ? 'lg:ml-64' : ''}`}>
      <div className="max-w-xl mx-auto px-3 py-4 space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <img src="/api/public/logo" alt="" className="w-12 h-12 rounded-xl object-contain shrink-0" />
            <div className="min-w-0">
              <div className="text-base font-semibold text-white">C-Point</div>
              <div className="text-sm text-[#4db6ac]">Where communities come alive</div>
            </div>
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#4db6ac]/40 px-2 py-0.5 text-xs text-[#9fb0b5]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4db6ac]" />
            Version {ABOUT_CPOINT_VERSION_LABEL}
          </div>
        </div>

        <section>
          <div className="text-[10px] uppercase tracking-wider text-[#9fb0b5]/70 mb-1.5">C-Point manifesto</div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
            {MANIFESTO_SUMMARY_PARAS.map((p, i) => (
              <p key={i} className="text-sm text-[#9fb0b5] leading-relaxed">
                {p}
              </p>
            ))}
            <button
              type="button"
              className="text-sm font-medium text-[#4db6ac] hover:underline"
              onClick={() => setManifestoOpen(true)}
            >
              Read the full manifesto
            </button>
            <button
              type="button"
              className="block text-sm text-[#9fb0b5] hover:text-[#4db6ac] mt-1"
              onClick={() => navigate(stevePrefillUrl('I read the About C-Point manifesto — can you walk me through what this means for me?'))}
            >
              Ask Steve about this →
            </button>
          </div>
        </section>

        <section>
          <div className="text-base font-semibold text-white mb-2">How it works</div>
          <div className="space-y-2">
            {ABOUT_HOW_IT_WORKS.map((pillar) => (
              <button
                key={pillar.id}
                type="button"
                className="w-full text-left rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 hover:border-white/20 transition-colors"
                onClick={() => setPillarOpen(pillar)}
              >
                <div className="text-sm font-medium text-white">{pillar.label}</div>
                <div className="text-xs text-[#9fb0b5]">{pillar.subtitle}</div>
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          className="w-full py-2 rounded-lg border border-white/15 text-sm text-white hover:bg-white/5"
          onClick={() => navigate('/premium_dashboard')}
        >
          Back to dashboard
        </button>
      </div>

      <DashboardBottomNav show />

      {manifestoOpen ? (
        <ModalBackdrop onClose={() => setManifestoOpen(false)} wide>
          <div className="flex justify-between items-start gap-2 mb-2">
            <h2 className="text-base font-semibold text-white">Full manifesto</h2>
            <button type="button" className="text-xs text-[#9fb0b5] shrink-0" onClick={() => setManifestoOpen(false)}>
              Close
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-[#9fb0b5] font-sans">{MANIFESTO_FULL}</pre>
        </ModalBackdrop>
      ) : null}

      {pillarOpen ? (
        <ModalBackdrop onClose={() => setPillarOpen(null)}>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-base font-semibold text-white">{pillarOpen.label}</h2>
            <button type="button" className="text-xs text-[#9fb0b5]" onClick={() => setPillarOpen(null)}>
              Close
            </button>
          </div>
          <div className="space-y-2">
            {pillarOpen.cards.map((c) => (
              <div key={c.id} className="rounded-lg border border-white/10 p-3">
                <div className="text-sm font-medium text-white">{c.title}</div>
                <div className="text-xs text-[#9fb0b5] mt-0.5">{c.description}</div>
                <button
                  type="button"
                  className="mt-2 text-sm text-[#4db6ac] font-medium hover:underline"
                  onClick={() => {
                    setPillarOpen(null)
                    setSlotOpen(c)
                  }}
                >
                  See it in action
                </button>
              </div>
            ))}
          </div>
        </ModalBackdrop>
      ) : null}

      {slotOpen ? (
        <ModalBackdrop
          onClose={() => setSlotOpen(null)}
          wide={!!videos[slotOpen.id] || isAppAdmin}
        >
          <TutorialSlotBody
            card={slotOpen}
            videoUrl={videos[slotOpen.id] ?? null}
            isAppAdmin={isAppAdmin}
            onClose={() => setSlotOpen(null)}
            onVideoSaved={onVideoSaved}
          />
        </ModalBackdrop>
      ) : null}
    </div>
  )
}
