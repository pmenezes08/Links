/**
 * Legal shell (Privacy / Terms / Safety) — dark redesign
 * (design_handoff_landing_redesign legal prototypes). Renders the repo
 * markdown from src/content/legal/ (single source of truth) and keeps the
 * /pt/... path-based locale system, disclaimer, and age banner.
 */
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LegalLocale } from './locale';
import { legalPath, oppositeLegalLocale } from './locale';
import { legalLabels, type LegalPageId } from './labels';
import { getLegalMarkdown } from './documents';
import { SiteNav } from '@/redesign/SiteNav';
import { SiteFooter } from '@/redesign/SiteFooter';
import { usePageTitle, useScrollToTop } from '@/redesign/hooks';

const TEAL = '#4db6ac';

type Props = {
  pageId: LegalPageId;
  locale: LegalLocale;
  showAgeBanner?: boolean;
};

export function LegalDocumentPage({ pageId, locale, showAgeBanner = false }: Props) {
  const labels = legalLabels(locale);
  const page = labels.pages[pageId];
  const otherLocale = oppositeLegalLocale(locale);
  const markdown = getLegalMarkdown(pageId, locale);
  const lang = locale === 'pt-PT' ? 'pt' : 'en';
  useScrollToTop();
  usePageTitle(`C-Point | ${page.title}`);

  const resolveHref = (href: string | undefined) => {
    if (!href) return href;
    if (href.startsWith('/') && !href.startsWith('//')) {
      return legalPath(href, locale);
    }
    return href;
  };

  return (
    <div className={lang === 'pt' ? 'rl rl--pt' : 'rl'}>
      <SiteNav variant="solid" langOverride={lang} langSwitchTo={legalPath(`/${pageId}`, otherLocale)} />

      <main style={{ padding: '180px var(--rl-gutter) 120px', maxWidth: 760, margin: '0 auto' }}>
        <div className="rl-eyebrow" style={{ color: TEAL, marginBottom: 28 }}>
          Legal
        </div>
        <h1 style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 'clamp(34px, 5.5vw, 64px)', lineHeight: 1.04, letterSpacing: '-.02em' }}>
          {page.title}
        </h1>
        <p style={{ margin: '0 0 24px', color: 'rgba(242,245,244,.45)', fontSize: 14 }}>{page.lastUpdated}</p>

        {locale === 'en' && (
          <p style={{ fontSize: 14, color: 'rgba(242,245,244,.55)', margin: '0 0 24px' }}>
            {page.alsoAvailableIn}{' '}
            <Link to={legalPath(`/${pageId}`, 'pt-PT')} style={{ color: TEAL, textDecoration: 'underline' }}>
              Português (Portugal)
            </Link>
            .
          </p>
        )}

        {locale === 'pt-PT' && (
          <div
            role="note"
            style={{
              background: 'rgba(77,182,172,.06)',
              border: '1px solid rgba(77,182,172,.3)',
              padding: '14px 18px',
              margin: '0 0 32px',
              fontSize: 14,
              lineHeight: 1.6,
              color: 'rgba(242,245,244,.8)',
            }}
          >
            {page.disclaimer}{' '}
            <Link to={legalPath(`/${pageId}`, 'en')} style={{ color: TEAL, textDecoration: 'underline', fontWeight: 600 }}>
              Versão em inglês
            </Link>
            .
          </div>
        )}

        {showAgeBanner && labels.ageBannerTitle && (
          <div style={{ background: 'rgba(77,182,172,.06)', border: '1px solid rgba(77,182,172,.3)', padding: '14px 18px', margin: '0 0 32px' }}>
            <p style={{ margin: 0, color: TEAL, fontWeight: 600, fontSize: 15 }}>{labels.ageBannerTitle}</p>
            <p style={{ margin: '4px 0 0', color: 'rgba(242,245,244,.7)', fontSize: 14 }}>{labels.ageBannerBody}</p>
          </div>
        )}

        <article className="rl-legal-doc" style={{ marginTop: 40 }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => {
                const resolved = resolveHref(href);
                if (resolved?.startsWith('/')) {
                  return <Link to={resolved}>{children}</Link>;
                }
                return (
                  <a href={resolved} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </main>

      <SiteFooter standalone langOverride={lang} langSwitchTo={legalPath(`/${pageId}`, otherLocale)} />
    </div>
  );
}
