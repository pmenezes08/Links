import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ABOUT_CPOINT_MODAL_COMMUNITY_FEED_FEATURES,
  ABOUT_CPOINT_MODAL_COMMUNITY_FEEDS_INTRO,
  ABOUT_CPOINT_MODAL_DMS_PARAS,
  ABOUT_CPOINT_MODAL_STEVE_PARAS,
  MANIFESTO_FULL,
  MANIFESTO_SUMMARY_PARAS,
} from '../../content/aboutCPoint'

const STEP_TITLES = ['Manifesto', 'Community feeds', 'DMs & group chats', 'Steve'] as const

function stevePrefillUrl(message: string): string {
  return `/user_chat/chat/Steve?prefill=${encodeURIComponent(message.trim())}`
}

function ModalBackdrop({
  children,
  onClose,
  wide,
  zClass = 'z-[200]',
}: {
  children: ReactNode
  onClose: () => void
  wide?: boolean
  zClass?: string
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
      className={`fixed inset-0 ${zClass} flex items-end sm:items-center justify-center sm:p-4 bg-black/70 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:pb-4`}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-cpoint-modal-title"
        className={`grid w-full min-h-0 shrink grid-rows-[minmax(0,1fr)] overflow-hidden ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[85vh] rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </div>
    </div>
  )
}

export default function AboutCPointModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [manifestoFullOpen, setManifestoFullOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setStep(0)
      setManifestoFullOpen(false)
    }
  }, [open])

  if (!open) return null

  const lastStep = STEP_TITLES.length - 1

  return (
    <>
      <ModalBackdrop onClose={onClose} zClass="z-[200]">
        <div className="flex justify-between items-start gap-2 mb-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#9fb0b5]/70 mb-0.5">
              About C-Point · {step + 1} / {STEP_TITLES.length}
            </div>
            <h2 id="about-cpoint-modal-title" className="text-base font-semibold text-white">
              {STEP_TITLES[step]}
            </h2>
          </div>
          <button type="button" className="text-xs text-[#9fb0b5] hover:text-white shrink-0" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex gap-1.5 mb-4" aria-hidden>
          {STEP_TITLES.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${i === step ? 'bg-[#4db6ac]' : 'bg-white/15'}`}
            />
          ))}
        </div>

        {step === 0 ? (
          <div className="space-y-3 mb-4">
            {MANIFESTO_SUMMARY_PARAS.map((p, i) => (
              <p key={i} className="text-sm text-[#9fb0b5] leading-relaxed">
                {p}
              </p>
            ))}
            <button
              type="button"
              className="text-sm font-medium text-[#4db6ac] hover:underline"
              onClick={() => setManifestoFullOpen(true)}
            >
              Read the full manifesto
            </button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3 mb-4">
            <p className="text-sm text-[#9fb0b5] leading-relaxed">{ABOUT_CPOINT_MODAL_COMMUNITY_FEEDS_INTRO}</p>
            <div className="grid grid-cols-2 gap-2">
              {ABOUT_CPOINT_MODAL_COMMUNITY_FEED_FEATURES.map((feature) => (
                <div key={feature.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#4db6ac]/10 text-[#4db6ac]">
                    <i className={`${feature.icon} text-sm`} />
                  </div>
                  <div className="text-sm font-semibold text-white">{feature.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-[#9fb0b5]">{feature.text}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3 mb-4">
            {ABOUT_CPOINT_MODAL_DMS_PARAS.map((p, i) => (
              <p key={i} className="text-sm text-[#9fb0b5] leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3 mb-4">
            {ABOUT_CPOINT_MODAL_STEVE_PARAS.map((p, i) => (
              <p key={i} className="text-sm text-[#9fb0b5] leading-relaxed">
                {p}
              </p>
            ))}
            <button
              type="button"
              className="w-full py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110"
              onClick={() => {
                onClose()
                navigate(stevePrefillUrl('I just read About C-Point — what should I try first?'))
              }}
            >
              Talk to Steve
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10">
          {step > 0 ? (
            <button
              type="button"
              className="px-4 py-2 rounded-xl border border-white/15 text-sm text-white hover:bg-white/5"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </button>
          ) : null}
          {step < lastStep ? (
            <button
              type="button"
              className="ml-auto px-4 py-2 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110"
              onClick={() => setStep((s) => Math.min(lastStep, s + 1))}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="ml-auto px-4 py-2 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110"
              onClick={onClose}
            >
              Done
            </button>
          )}
        </div>

        <button
          type="button"
          className="w-full mt-3 py-2 rounded-lg border border-white/12 text-xs text-[#9fb0b5] hover:text-white hover:border-white/20"
          onClick={() => {
            onClose()
            navigate('/about_cpoint')
          }}
        >
          Open full About page
        </button>
      </ModalBackdrop>

      {manifestoFullOpen ? (
        <ModalBackdrop onClose={() => setManifestoFullOpen(false)} wide zClass="z-[210]">
          <div className="flex justify-between items-start gap-2 mb-2">
            <h2 className="text-base font-semibold text-white">Full manifesto</h2>
            <button type="button" className="text-xs text-[#9fb0b5] shrink-0" onClick={() => setManifestoFullOpen(false)}>
              Close
            </button>
          </div>
          <div className="whitespace-pre-wrap break-words text-sm text-[#9fb0b5] font-sans">{MANIFESTO_FULL}</div>
        </ModalBackdrop>
      ) : null}
    </>
  )
}
