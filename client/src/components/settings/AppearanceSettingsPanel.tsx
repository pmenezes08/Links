import { useTranslation } from 'react-i18next'

import { useTheme, type ThemePreference } from '../../contexts/ThemeContext'
import { triggerHaptic } from '../../utils/haptics'

type AppearanceSettingsPanelProps = {
  onDone?: () => void
}

export default function AppearanceSettingsPanel({ onDone }: AppearanceSettingsPanelProps) {
  const { t } = useTranslation()
  const { theme, preference, setPreference } = useTheme()

  const options: { value: ThemePreference; labelKey: string; helperKey?: string }[] = [
    { value: 'system', labelKey: 'account.appearance_system', helperKey: 'account.appearance_system_helper' },
    { value: 'dark', labelKey: 'account.appearance_dark' },
    { value: 'light', labelKey: 'account.appearance_light' },
  ]

  function selectTheme(next: ThemePreference) {
    if (next !== preference) {
      setPreference(next)
      void triggerHaptic('selection')
    }
    onDone?.()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('account.appearance')}
      className="overflow-hidden rounded-3xl border border-c-border bg-c-bg-surface"
    >
      {options.map((opt, index) => {
        const checked = preference === opt.value
        const resolvedHint = opt.value === 'system'
          ? ` (${t('account.appearance_system_resolved', { mode: t(theme === 'dark' ? 'account.appearance_dark' : 'account.appearance_light') })})`
          : ''
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${t(opt.labelKey)}${resolvedHint}`}
            onClick={() => selectTheme(opt.value)}
            className={`flex w-full items-center justify-between px-4 py-4 text-left transition-colors active:bg-c-active-bg ${
              index < options.length - 1 ? 'border-b border-c-border-subtle' : ''
            }`}
          >
            <div className="flex flex-col">
              <span className="text-base font-semibold text-c-text-primary">
                {t(opt.labelKey)}
                {opt.value === 'system' && (
                  <span className="ml-1.5 text-sm font-normal text-c-text-tertiary" aria-hidden="true">
                    {resolvedHint}
                  </span>
                )}
              </span>
              {opt.helperKey && (
                <span className="mt-0.5 text-xs text-c-text-tertiary">{t(opt.helperKey)}</span>
              )}
            </div>
            {checked ? <i className="fa-solid fa-check text-cpoint-turquoise" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
