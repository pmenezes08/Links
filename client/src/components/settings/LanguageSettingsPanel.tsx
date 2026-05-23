import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LOCALE_OPTIONS } from '../../i18n/localeOptions'
import { useLocale } from '../../i18n/useLocale'
import type { SupportedLocale } from '../../i18n'
import { triggerHaptic } from '../../utils/haptics'

type LanguageSettingsPanelProps = {
  onDone: () => void
  onToast: (message: string, type?: 'success' | 'error') => void
}

export default function LanguageSettingsPanel({ onDone, onToast }: LanguageSettingsPanelProps) {
  const { t } = useTranslation()
  const { locale, supported, saving, error, setLocale } = useLocale()
  const [draftLocale, setDraftLocale] = useState<SupportedLocale>(locale)

  useEffect(() => {
    setDraftLocale(locale)
  }, [locale])

  async function selectLocale(nextLocale: SupportedLocale) {
    if (saving) return
    setDraftLocale(nextLocale)
    void triggerHaptic('selection')

    if (nextLocale === locale) {
      onDone()
      return
    }

    const result = await setLocale(nextLocale)
    if (result.locale === nextLocale && result.persisted) {
      void triggerHaptic('success')
      onToast(t('account.language.saved'), 'success')
      window.setTimeout(onDone, 180)
    } else {
      void triggerHaptic('error')
      onToast(t('account.language.save_failed'), 'error')
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.055]">
      {LOCALE_OPTIONS.filter(opt => supported.includes(opt.value)).map((opt, index, options) => {
        const checked = draftLocale === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={saving}
            onClick={() => void selectLocale(opt.value)}
            className={`flex w-full items-center justify-between px-4 py-4 text-left transition-colors active:bg-white/[0.08] ${
              index < options.length - 1 ? 'border-b border-white/[0.055]' : ''
            }`}
          >
            <span className="text-base font-semibold text-white">{t(opt.labelKey)}</span>
            <span className="flex items-center gap-3 text-sm text-white/38">
              {checked ? <i className="fa-solid fa-check text-[#4db6ac]" /> : null}
              {saving && checked ? <i className="fa-solid fa-spinner fa-spin text-white/35" /> : null}
            </span>
          </button>
        )
      })}
      {error ? <div className="border-t border-red-400/20 px-4 py-3 text-sm text-red-200">{t('account.language.save_failed')}</div> : null}
    </div>
  )
}
