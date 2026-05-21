import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LegalLocale } from './locale';
import { legalPath, oppositeLegalLocale } from './locale';
import { legalLabels, type LegalPageId } from './labels';
import { getLegalMarkdown } from './documents';

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

  const resolveHref = (href: string | undefined) => {
    if (!href) return href;
    if (href.startsWith('/') && !href.startsWith('//')) {
      return legalPath(href, locale);
    }
    return href;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10">
        <div className="container mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="text-2xl font-bold text-[#4db6ac]">
            C-Point
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-white/50">{page.languageLabel}:</span>
            <span className="font-medium text-white">
              {locale === 'pt-PT' ? 'Português (Portugal)' : 'English'}
            </span>
            <span className="text-white/30">|</span>
            <Link
              to={legalPath(`/${pageId}`, otherLocale)}
              className="text-[#4db6ac] hover:underline"
            >
              {page.switchToOther}
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-4xl font-bold mb-4">{page.title}</h1>
        <p className="text-white/60 mb-6">{page.lastUpdated}</p>

        {locale === 'en' && (
          <p className="text-sm text-white/55 mb-6">
            {page.alsoAvailableIn}{' '}
            <Link to={legalPath(`/${pageId}`, 'pt-PT')} className="text-[#4db6ac] hover:underline">
              Português (Portugal)
            </Link>
            .
          </p>
        )}

        {locale === 'pt-PT' && (
          <div
            role="note"
            className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-8 text-sm text-white/85 leading-relaxed"
          >
            {page.disclaimer}{' '}
            <Link to={legalPath(`/${pageId}`, 'en')} className="text-[#4db6ac] hover:underline font-medium">
              Versão em inglês
            </Link>
            .
          </div>
        )}

        {showAgeBanner && labels.ageBannerTitle && (
          <div className="bg-[#4db6ac]/10 border border-[#4db6ac]/30 rounded-lg p-4 mb-8">
            <p className="text-[#4db6ac] font-semibold">{labels.ageBannerTitle}</p>
            <p className="text-white/70 text-sm">{labels.ageBannerBody}</p>
          </div>
        )}

        <article className="prose prose-invert prose-lg max-w-none legal-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => (
                <h2 className="text-2xl font-semibold mb-4 mt-10 text-[#4db6ac] first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => <h3 className="text-xl font-medium mb-3 mt-6 text-white">{children}</h3>,
              p: ({ children }) => <p className="text-white/80 leading-relaxed mb-4">{children}</p>,
              ul: ({ children }) => (
                <ul className="list-disc list-inside text-white/80 space-y-2 ml-4 mb-4">{children}</ul>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              a: ({ href, children }) => {
                const resolved = resolveHref(href);
                if (resolved?.startsWith('/')) {
                  return (
                    <Link to={resolved} className="text-[#4db6ac] hover:underline">
                      {children}
                    </Link>
                  );
                }
                return (
                  <a
                    href={resolved}
                    className="text-[#4db6ac] hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                );
              },
              strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </main>

      <footer className="border-t border-white/10 py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-white/60">
          <p>
            © {new Date().getFullYear()} C-Point. {page.footerRights}
          </p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="hover:text-[#4db6ac]">
              {page.footerHome}
            </Link>
            <Link to={legalPath('/privacy', locale)} className="hover:text-[#4db6ac]">
              {page.footerPrivacy}
            </Link>
            <Link to={legalPath('/terms', locale)} className="hover:text-[#4db6ac]">
              {page.footerTerms}
            </Link>
            <Link to={legalPath('/safety', locale)} className="hover:text-[#4db6ac]">
              {page.footerSafety}
            </Link>
            <Link to="/support" className="hover:text-[#4db6ac]">
              {page.footerSupport}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
