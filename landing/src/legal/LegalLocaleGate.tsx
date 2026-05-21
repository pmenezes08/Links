import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { parseLegalLocale, legalPath, type LegalLocale } from './locale';
import type { LegalPageId } from './labels';
import { LegalDocumentPage } from './LegalDocumentPage';

type Props = {
  pageId: LegalPageId;
  locale: LegalLocale;
  showAgeBanner?: boolean;
};

/** Redirects `?lang=pt-PT` to `/pt/...` for stable App Store privacy URLs. */
export function LegalLocaleGate({ pageId, locale, showAgeBanner }: Props) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const langParam = searchParams.get('lang');

  if (locale === 'en' && parseLegalLocale(langParam) === 'pt-PT') {
    const next = `${legalPath(location.pathname, 'pt-PT')}${location.hash}`;
    return <Navigate to={next} replace />;
  }

  return <LegalDocumentPage pageId={pageId} locale={locale} showAgeBanner={showAgeBanner} />;
}
