/** Landing legal pages — EN default, pt-PT for App Store / EU users. */

export type LegalLocale = 'en' | 'pt-PT';

export const LEGAL_LOCALE_STORAGE_KEY = 'cpoint-landing-legal-locale';

export const DEFAULT_LEGAL_LOCALE: LegalLocale = 'en';

export function parseLegalLocale(raw: string | null | undefined): LegalLocale {
  if (!raw) return DEFAULT_LEGAL_LOCALE;
  const n = raw.trim().toLowerCase();
  if (n === 'pt-pt' || n === 'pt_pt' || n === 'pt') return 'pt-PT';
  return 'en';
}

export function legalPath(basePath: string, locale: LegalLocale): string {
  const normalized = basePath.startsWith('/') ? basePath : `/${basePath}`;
  if (locale === 'pt-PT') {
    return `/pt${normalized}`;
  }
  return normalized;
}

export function oppositeLegalLocale(locale: LegalLocale): LegalLocale {
  return locale === 'pt-PT' ? 'en' : 'pt-PT';
}
