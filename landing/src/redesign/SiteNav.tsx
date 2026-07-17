import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";
import { useScrolled } from "./hooks";
import { APP_URL } from "./links";

const logo = "/cpoint-logo.png"; // served from landing/public

export type NavActive = "manifesto" | "platform" | "organizations" | "plans" | null;

type Props = {
  active?: NavActive;
  /** "scroll": transparent until 60px (marketing pages). "solid": always dark (legal/support). */
  variant?: "scroll" | "solid";
  /** Home hero starts with a soft dark gradient instead of fully transparent. */
  heroGradient?: boolean;
  /** Route to the same page in the other locale (legal pages use path-based locales). */
  langSwitchTo?: string;
  /** Force the label language (legal pages are localised by route, not context). */
  langOverride?: "en" | "pt";
};

function GlobeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

/** Globe button + dropdown listing the available site languages. */
export function LangMenu({ langSwitchTo, langOverride, up = false }: { langSwitchTo?: string; langOverride?: "en" | "pt"; up?: boolean }) {
  const { lang, setLang } = useLang();
  const navigate = useNavigate();
  const current = langOverride ?? lang;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: "en" | "pt") => {
    setOpen(false);
    if (next === current) return;
    if (langSwitchTo) {
      // legal pages: the other locale lives at its own path
      navigate(langSwitchTo);
    } else {
      setLang(next);
    }
  };

  const languages: { code: "en" | "pt"; label: string }[] = [
    { code: "en", label: "English" },
    { code: "pt", label: "Português" },
  ];

  return (
    <div ref={ref} className="rl-lang">
      <button
        type="button"
        className="rl-nav-lang"
        aria-label={current === "pt" ? "Idioma" : "Language"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <GlobeIcon />
      </button>
      {open && (
        <div className={up ? "rl-lang-menu rl-lang-menu--up" : "rl-lang-menu"} role="listbox">
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={l.code === current}
              className={l.code === current ? "rl-lang-item rl-lang-item--active" : "rl-lang-item"}
              onClick={() => choose(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteNav({ active = null, variant = "scroll", heroGradient = false, langSwitchTo, langOverride }: Props) {
  const { lang } = useLang();
  const scrolled = useScrolled();
  const pt = (langOverride ?? lang) === "pt";

  const cls = [
    "rl-nav",
    variant === "solid" ? "rl-nav--solid" : scrolled ? "rl-nav--scrolled" : heroGradient ? "rl-nav--hero-gradient" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <Link to="/" style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <img src={logo} alt="C-Point" style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 7 }} />
        <span className="rl-nav-wordmark">C-Point</span>
      </Link>
      <div className="rl-nav-links">
        {/* Mobile trades Manifesto (kept in the footer) for the revenue page. */}
        <Link to="/manifesto" className={`rl-nav-desktop-only${active === "manifesto" ? " rl-nav-active" : ""}`}>
          Manifesto
        </Link>
        <Link to="/platform" className={active === "platform" ? "rl-nav-active" : undefined}>
          {pt ? (
            <>
              <span className="rl-nav-longlabel">A Plataforma</span>
              <span className="rl-nav-shortlabel">Plataforma</span>
            </>
          ) : (
            "Platform"
          )}
        </Link>
        <Link to="/organizations" className={active === "organizations" ? "rl-nav-active" : undefined}>
          {pt ? (
            <>
              <span className="rl-nav-longlabel">Para Organizações</span>
              <span className="rl-nav-shortlabel">Organizações</span>
            </>
          ) : (
            <>
              <span className="rl-nav-longlabel">For Organisations</span>
              <span className="rl-nav-shortlabel">Organisations</span>
            </>
          )}
        </Link>
        <Link to="/plans" className={active === "plans" ? "rl-nav-active" : undefined}>
          {pt ? "Planos" : "Plans"}
        </Link>
        <LangMenu langSwitchTo={langSwitchTo} langOverride={langOverride} />
        <a href={APP_URL} target="_blank" rel="noopener" className="rl-nav-open-app">
          {pt ? "Abrir App" : "Open App"}
        </a>
      </div>
    </div>
  );
}
