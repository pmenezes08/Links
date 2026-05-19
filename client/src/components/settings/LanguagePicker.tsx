import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LOCALE_OPTIONS } from '../../i18n/localeOptions'
import { useLocale } from '../../i18n/useLocale'
import type { SupportedLocale } from '../../i18n'

/**
 * Language picker for Account Settings.
 *
 * Mounts under the Notifications block (and above Danger Zone) per the
 * locked product decision in docs/I18N_ROADMAP.md. Visual style mirrors
 * the surrounding `rounded-xl border border-white/10` sections so the
 * page rhythm stays intact.
 */
export default function LanguagePicker() {
  const { t } = useTranslation()
  const { locale, supported, saving, error, setLocale } = useLocale()
  const [draftLocale, setDraftLocale] = useState<SupportedLocale>(locale)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraftLocale(locale)
  }, [locale])

  const hasChanges = draftLocale !== locale

  async function handleSave() {
    if (!hasChanges || saving) return
    setSaved(false)
    const result = await setLocale(draftLocale)
    if (result.locale === draftLocale && result.persisted) {
      setSaved(true)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('account.language.section_title')}</h2>
        <p className="mt-1 text-sm text-white/60">{t('account.language.helper')}</p>
      </div>

      <div className="space-y-2">
        {LOCALE_OPTIONS.filter((opt) => supported.includes(opt.value)).map((opt) => {
          const checked = draftLocale === opt.value
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                checked
                  ? 'border-emerald-400/60 bg-emerald-400/5 text-white'
                  : 'border-white/10 bg-white/5 text-white/80 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="cpoint-language"
                value={opt.value}
                checked={checked}
                disabled={saving}
                onChange={() => {
                  setSaved(false)
                  setDraftLocale(opt.value)
                }}
                className="h-4 w-4 accent-emerald-400"
              />
              <span>{t(opt.labelKey)}</span>
            </label>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={!hasChanges || saving}
        className="inline-flex items-center justify-center rounded-lg bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#45a99c] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? t('account.language.saving') : t('common.save')}
      </button>

      <div className="min-h-[1.25rem] text-xs">
        {saving && <span className="text-white/50">{t('account.language.saving')}</span>}
        {!saving && saved && !error && (
          <span className="text-emerald-300">{t('account.language.saved')}</span>
        )}
        {!saving && error && (
          <span className="text-red-300">{t('account.language.save_failed')}</span>
        )}
      </div>
    </div>
  )
}
