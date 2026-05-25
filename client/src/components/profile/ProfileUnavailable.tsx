import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

type ProfileUnavailableProps = {
  hintKey?: string
  titleKey?: string
}

/**
 * Generic empty-state for any profile page that cannot be rendered for the
 * current viewer — used both for genuinely missing usernames and for profiles
 * the viewer is not allowed to see. The copy is intentionally privacy-neutral
 * so the page does not leak whether the username actually exists.
 */
export default function ProfileUnavailable({
  hintKey = 'profile.error.unavailable_hint',
  titleKey = 'profile.error.unavailable_title',
}: ProfileUnavailableProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div className="glass-page min-h-screen text-white px-4 flex items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md px-6 py-8 text-center shadow-xl">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
          <i className="fa-regular fa-user text-2xl text-white/60" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-white">{t(titleKey)}</h1>
        <p className="mt-2 text-sm text-white/60 leading-relaxed">{t(hintKey)}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[#4db6ac] hover:bg-[#3da59a] text-black font-medium px-5 py-2 text-sm transition-colors"
        >
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          {t('profile.error.back')}
        </button>
      </div>
    </div>
  )
}
