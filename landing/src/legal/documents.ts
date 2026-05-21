import type { LegalLocale } from './locale';
import type { LegalPageId } from './labels';

import privacyEn from '../content/legal/en/privacy.md?raw';
import termsEn from '../content/legal/en/terms.md?raw';
import safetyEn from '../content/legal/en/safety.md?raw';

import privacyPt from '../content/legal/pt-PT/privacy.md?raw';
import termsPt from '../content/legal/pt-PT/terms.md?raw';
import safetyPt from '../content/legal/pt-PT/safety.md?raw';

const BY_LOCALE: Record<LegalLocale, Record<LegalPageId, string>> = {
  en: {
    privacy: privacyEn,
    terms: termsEn,
    safety: safetyEn,
  },
  'pt-PT': {
    privacy: privacyPt,
    terms: termsPt,
    safety: safetyPt,
  },
};

export function getLegalMarkdown(pageId: LegalPageId, locale: LegalLocale): string {
  return BY_LOCALE[locale][pageId];
}
