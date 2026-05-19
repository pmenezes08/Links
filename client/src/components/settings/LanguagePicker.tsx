import { useTranslation } from 'react-i18next'

import { useLocale } from '../../i18n/useLocale'
import type { SupportedLocale } from '../../i18n'

type Option = { value: SupportedLocale; labelKey: string }

const OPTIONS: Option[] = [
  { value: 'en', labelKey: 'account.language.option_en' },
  { value: 'pt-PT', labelKey: 'account.language.option_pt_pt' },
]

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

  return (
    <div className="rounded-xl border border-white/10 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('account.language.section_title')}</h2>
        <p className="mt-1 text-sm text-white/60">{t('account.language.helper')}</p>
      </div>

      <div className="space-y-2">
        {OPTIONS.filter((opt) => supported.includes(opt.value)).map((opt) => {
          const checked = locale === opt.value
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
                  void setLocale(opt.value)
                }}
                className="h-4 w-4 accent-emerald-400"
              />
              <span>{t(opt.labelKey)}</span>
            </label>
          )
        })}
      </div>

      <div className="min-h-[1.25rem] text-xs">
        {saving && <span className="text-white/50">{t('account.language.saving')}</span>}
        {!saving && error && (
          <span className="text-red-300">{t('account.language.save_failed')}</span>
        )}
      </div>
    </div>
  )
}
