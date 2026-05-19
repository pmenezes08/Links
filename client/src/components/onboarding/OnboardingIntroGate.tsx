import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type OnboardingIntroGateProps = {
  onStart: () => void
}

export default function OnboardingIntroGate({ onStart }: OnboardingIntroGateProps) {
  const { t } = useTranslation()
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [manifestoOpen, setManifestoOpen] = useState(false)
  const [page, setPage] = useState<0 | 1>(0)

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
  const manifestoParagraphs = t('onboarding_intro.manifesto', { returnObjects: true }) as string[]

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

              {page === 0 ? (
                <div className="text-center">
                  <h1 className="text-2xl font-semibold tracking-tight mb-3">{t('onboarding_intro.welcome_title')}</h1>
                  <p className="text-sm leading-relaxed text-[#d5e4e7] mb-6">{t('onboarding_intro.summary')}</p>
                </div>
              ) : (
                <div className="text-center">
                  <h1 className="text-2xl font-semibold tracking-tight mb-3">{t('onboarding_intro.steve_title')}</h1>
                  <p className="text-sm leading-relaxed text-[#9fb0b5] mb-6">
                    {t('onboarding_intro.steve_body')}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {page === 0 ? (
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    className="w-full rounded-xl bg-[#4db6ac] text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition"
                  >
                    {t('onboarding_intro.continue')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onStart}
                    className="w-full rounded-xl bg-[#4db6ac] text-black font-semibold py-3 text-sm hover:brightness-110 active:scale-[0.99] transition"
                  >
                    {t('onboarding_intro.start')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={page === 0 ? () => setManifestoOpen(true) : () => setPage(0)}
                  className="w-full rounded-xl bg-[#4db6ac]/10 text-[#d5fffb] border border-[#4db6ac]/30 font-medium py-3 text-sm hover:bg-[#4db6ac]/15 transition"
                >
                  {page === 0 ? t('onboarding_intro.read_manifesto') : t('common.back')}
                </button>
              </div>
              <div className="mt-5 flex justify-center gap-2" aria-label={t('onboarding_intro.progress_label')}>
                {[0, 1].map((item) => (
                  <span
                    key={item}
                    className={`h-1.5 w-6 rounded-full ${page === item ? 'bg-[#4db6ac]' : 'bg-[#4db6ac]/25'}`}
                  />
                ))}
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
            <h2 className="text-xl font-semibold text-center mb-5">{t('onboarding_intro.manifesto_title')}</h2>
            <div className="space-y-4 text-sm leading-relaxed text-[#c8d6d9]">
              {manifestoParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setManifestoOpen(false)}
                className="rounded-xl bg-[#4db6ac]/10 text-[#d5fffb] border border-[#4db6ac]/30 font-medium py-3 text-sm hover:bg-[#4db6ac]/15 transition"
              >
                {t('common.close')}
              </button>
              <button
                type="button"
                onClick={onStart}
                className="rounded-xl bg-[#4db6ac] text-black font-semibold py-3 text-sm hover:brightness-110 transition"
              >
                {t('onboarding_intro.start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
