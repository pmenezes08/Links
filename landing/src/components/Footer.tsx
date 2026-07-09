import { Link } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";

export const Footer = () => {
  const { copy } = useLang();
  const f = copy.footer;
  const nav = copy.nav;

  return (
    <footer className="bg-[#4db6ac] py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="text-center lg:text-left">
            <a href="/" className="text-lg font-bold tracking-tight text-white">
              C<span className="text-white/80">-</span>Point
            </a>
            <p className="text-sm text-white/60 mt-1">{f.tagline}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <a href="#manifesto" className="text-sm text-white/70 hover:text-white transition-colors">
              {f.manifesto}
            </a>
            {nav.links.map((link) => (
              <a key={link.href} href={link.href} className="text-sm text-white/70 hover:text-white transition-colors">
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link to={f.legalPaths.privacy} className="text-sm text-white/70 hover:text-white transition-colors">
              {f.privacy}
            </Link>
            <Link to={f.legalPaths.terms} className="text-sm text-white/70 hover:text-white transition-colors">
              {f.terms}
            </Link>
            <Link to="/support" className="text-sm text-white/70 hover:text-white transition-colors">
              {f.support}
            </Link>
            <Link to={f.legalPaths.safety} className="text-sm text-white/70 hover:text-white transition-colors">
              {f.safety}
            </Link>
            <span className="text-white/30 hidden sm:inline" aria-hidden>
              |
            </span>
            {f.crossLang.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-sm text-white/70 hover:text-white transition-colors"
                lang={item.lang}
              >
                {item.label}
              </Link>
            ))}
            <Link to="/admin" className="text-sm text-white/70 hover:text-white transition-colors">
              {f.operator}
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/15 text-center">
          <p className="text-xs text-white/50">
            &copy; {new Date().getFullYear()} C-Point. {f.rights}
          </p>
        </div>
      </div>
    </footer>
  );
};
