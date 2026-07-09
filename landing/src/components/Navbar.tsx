import { useState, useEffect } from "react";
import { Menu, X, Laptop, Apple, Smartphone, Globe } from "lucide-react";
import { APP_STORE_URL, APP_WEB_URL, PLAY_STORE_URL } from "@/content/siteCopy";
import { useLang } from "@/i18n/LanguageContext";
import type { Lang } from "@/i18n/copy";

export const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { lang, setLang, copy } = useLang();
  const nav = copy.nav;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const linkClass = scrolled
    ? "text-muted-foreground hover:text-foreground"
    : "text-white/75 hover:text-white";

  const pillWeb = scrolled
    ? "bg-primary/15 text-primary hover:bg-primary/20 border border-primary/20"
    : "bg-white/20 text-white backdrop-blur-sm border border-white/25 hover:bg-white/30";

  const pillIos = scrolled
    ? "bg-foreground text-background hover:opacity-90"
    : "bg-white text-[#2a7a72] hover:bg-white/95";

  const pillAndroid = scrolled
    ? "bg-primary/15 text-primary hover:bg-primary/20 border border-primary/20"
    : "bg-white/20 text-white backdrop-blur-sm border border-white/25 hover:bg-white/30";

  const langSwitch = (compact: boolean) => (
    <div
      className={`inline-flex items-center gap-1 rounded-full border ${
        scrolled ? "border-black/10 text-muted-foreground" : "border-white/25 text-white/80"
      } ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`}
      role="group"
      aria-label={nav.languageAria}
    >
      <Globe size={compact ? 12 : 14} className="shrink-0" aria-hidden />
      {(["en", "pt"] as Lang[]).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`text-xs font-medium px-1.5 py-0.5 rounded-full transition-colors ${
            lang === code
              ? scrolled
                ? "bg-primary/15 text-primary"
                : "bg-white/25 text-white"
              : "hover:opacity-80"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-white/90 backdrop-blur-xl border-b border-black/[0.04] shadow-sm" : "bg-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-2">
        <a
          href="/"
          className={`text-xl font-bold tracking-tight transition-colors shrink-0 ${
            scrolled ? "text-foreground" : "text-white"
          }`}
        >
          C<span className={scrolled ? "text-primary" : "text-white/80"}>-</span>Point
        </a>

        <div className="hidden lg:flex items-center gap-5 xl:gap-6 flex-wrap justify-end">
          {nav.links.map((link) => (
            <a key={link.href} href={link.href} className={`text-sm transition-colors ${linkClass}`}>
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex lg:hidden items-center gap-2">
          {langSwitch(true)}
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all ${pillIos}`}
          >
            <Apple size={14} />
            iOS
          </a>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all ${pillAndroid}`}
          >
            <Smartphone size={14} />
            Android
          </a>
          <a
            href={APP_WEB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-all ${pillWeb}`}
          >
            <Laptop size={14} />
            {nav.webShort}
          </a>
        </div>

        <div className="hidden lg:flex items-center gap-2 shrink-0">
          {langSwitch(false)}
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-all ${pillIos}`}
          >
            <Apple size={16} />
            iOS
          </a>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-all ${pillAndroid}`}
          >
            <Smartphone size={16} />
            Android
          </a>
          <a
            href={APP_WEB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-all ${pillWeb}`}
          >
            <Laptop size={16} />
            {nav.webApp}
          </a>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          {langSwitch(true)}
          <button type="button" className="p-2" aria-label={nav.menuAria} onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? (
              <X size={20} className={scrolled ? "" : "text-white"} />
            ) : (
              <Menu size={20} className={scrolled ? "" : "text-white"} />
            )}
          </button>
        </div>
        <button
          type="button"
          className="hidden md:block lg:hidden p-2"
          aria-label={nav.menuAria}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? (
            <X size={20} className={scrolled ? "" : "text-white"} />
          ) : (
            <Menu size={20} className={scrolled ? "" : "text-white"} />
          )}
        </button>
      </div>

      {mobileOpen ? (
        <div className="lg:hidden bg-white border-t border-black/[0.04] px-6 py-4 space-y-1 max-h-[min(70vh,calc(100dvh-4rem))] overflow-y-auto">
          {nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block text-sm text-muted-foreground hover:text-foreground py-2.5"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="flex flex-col gap-2 pt-3 border-t border-black/[0.06] mt-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center px-4 py-2.5 rounded-full bg-foreground text-background text-sm font-medium"
            >
              {nav.downloadIos}
            </a>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center px-4 py-2.5 rounded-full bg-primary/10 text-primary text-sm font-medium border border-primary/20"
            >
              {nav.getAndroid}
            </a>
            <a
              href={APP_WEB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center px-4 py-2.5 rounded-full bg-primary/10 text-primary text-sm font-medium border border-primary/20"
            >
              {nav.openWebApp}
            </a>
          </div>
        </div>
      ) : null}
    </nav>
  );
};
