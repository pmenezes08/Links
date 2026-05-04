import { useEffect, useState } from 'react'

type OnboardingIntroGateProps = {
  onStart: () => void
}

const MANIFESTO_SUMMARY =
  'C-Point is built on a simple belief: the world is meant to be lived, and private communities should help you reconnect with your people without public noise or algorithms in the way.'

// Keep this aligned with backend/services/steve_platform_manual.py, card platform.what_is_cpoint.
const MANIFESTO_PARAGRAPHS = [
  'C-Point was built on a simple principle: The world is meant to be lived. Come here to reconnect with your people, stay present in your world, and actually get back to living.',
  'C-Point is a global platform of private, independent communities.',
  'No public feeds. No self-promotion. No algorithm-driven noise. No fast-consuming content.',
  'A community can be anything - a close group of friends planning trips, a circle debating the future, a place for banter with people who truly get you, or the private network that keeps you connected to the organisations that matter: your alumni group, your school, an investor network, your sports club, or your company.',
  "Inside every community lives Steve - our intelligent presence who deeply understands each member's journey, values and expertise, and quietly works to create meaningful connections and keep the space alive.",
  'Access is by invitation only. Privacy and exclusivity are built in from day one. Everything shared inside stays inside. No strangers. No algorithms deciding what deserves your attention.',
  'This is your world. Come connect with it.',
]

export default function OnboardingIntroGate({ onStart }: OnboardingIntroGateProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [manifestoOpen, setManifestoOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/public/onboarding_welcome_video', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        const data = await response.json().catch(() => null)
        if (!cancelled && data?.success && data.video_url) {
          setVideoUrl(String(data.video_url))
        }
      } catch {
        if (!cancelled) setVideoFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const showVideo = Boolean(videoUrl && !videoFailed)

  return (
    <div className="fixed inset-0 z-[1101] overflow-y-auto bg-black text-white">
      <div className="min-h-full px-5 py-8 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="rounded-[28px] border border-[#4db6ac]/45 bg-black shadow-[0_24px_80px_rgba(77,182,172,0.16)] overflow-hidden">
            <div className="p-6 sm:p-7">
              <img
                src="/api/public/logo"
                alt="C-Point"
                className="w-16 h-16 rounded-2xl object-contain mx-auto mb-5"
              />

              {showVideo && (
                <div className="mb-5 rounded-2xl overflow-hidden border border-[#4db6ac]/35 bg-black">
                  <video
                    src={videoUrl || undefined}
                    className="w-full aspect-video object-cover"
                    muted
                    autoPlay
                    playsInline
                    controls
                    preload="metadata"
                    onError={() => setVideoFailed(true)}
                  />
                </div>
              )}

              <div className="text-center">
                <h1 className="text-2xl font-semibold tracking-tight mb-3">Welcome to C-Point</h1>
                <p className="text-sm leading-relaxed text-[#d5e4e7] mb-4">{MANIFESTO_SUMMARY}</p>
                <p className="text-sm leading-relaxed text-[#9fb0b5] mb-6">
                  Steve will help personalize your profile so your communities, conversations, and
                  connections start from the right place.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={onStart}
                  className="w-full rounded-xl bg-[#4db6ac] text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition"
                >
                  Start onboarding
                </button>
                <button
                  type="button"
                  onClick={() => setManifestoOpen(true)}
                  className="w-full rounded-xl bg-[#4db6ac]/10 text-[#d5fffb] border border-[#4db6ac]/30 font-medium py-3 text-sm hover:bg-[#4db6ac]/15 transition"
                >
                  Read the manifesto
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {manifestoOpen && (
        <div
          className="fixed inset-0 z-[1110] flex items-center justify-center px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
          }}
        >
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setManifestoOpen(false)} />
          <div
            className="relative w-full max-w-lg overflow-y-auto rounded-2xl border border-[#4db6ac]/45 bg-black p-6 shadow-[0_24px_80px_rgba(77,182,172,0.18)]"
            style={{
              maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
            }}
          >
            <img
              src="/api/public/logo"
              alt="C-Point"
              className="w-12 h-12 rounded-xl object-contain mx-auto mb-4"
            />
            <h2 className="text-xl font-semibold text-center mb-5">The C-Point Manifesto</h2>
            <div className="space-y-4 text-sm leading-relaxed text-[#c8d6d9]">
              {MANIFESTO_PARAGRAPHS.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setManifestoOpen(false)}
                className="rounded-xl bg-[#4db6ac]/10 text-[#d5fffb] border border-[#4db6ac]/30 font-medium py-3 text-sm hover:bg-[#4db6ac]/15 transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onStart}
                className="rounded-xl bg-[#4db6ac] text-black font-semibold py-3 text-sm hover:brightness-110 transition"
              >
                Start onboarding
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
