import type { SupportedLocale } from './index'

export type LocaleOption = { value: SupportedLocale; labelKey: string }

/** Shared EN / PT-PT choices for Account Settings and first-run welcome. */
export const LOCALE_OPTIONS: LocaleOption[] = [
  { value: 'en', labelKey: 'account.language.option_en' },
  { value: 'pt-PT', labelKey: 'account.language.option_pt_pt' },
  { value: 'de-DE', labelKey: 'account.language.option_de' },
]
