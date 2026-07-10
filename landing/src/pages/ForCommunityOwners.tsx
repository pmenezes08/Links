import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  CircleUserRound,
  FileText,
  Globe,
  Layers3,
  LockKeyhole,
  MessageCircle,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { ContactForm } from "@/components/ContactForm";
import heroBg from "@/assets/hero-community.jpg";
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  PLATFORM_AVAILABILITY_LINE,
} from "@/content/siteCopy";
import {
  COMMUNITY_PLANS,
  STEVE_COMMUNITY_PACKAGE,
} from "@/content/pricing";
import { useLang } from "@/i18n/LanguageContext";
import type { Lang } from "@/i18n/copy";
import { signupUrlWithAttribution, trackLandingEvent } from "@/lib/track";

const problemIcons = [MessagesSquare, LockKeyhole, Layers3];
const featureIcons = [CircleUserRound, MessageCircle, CalendarDays, UsersRound];
const analyticsIcons = [Activity, UserPlus, Trophy, Layers3];

export default function ForCommunityOwners() {
  const { copy, lang, setLang } = useLang();
  const c = copy.ownerLanding;
  const [contactOpen, setContactOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const signupUrl = useMemo(signupUrlWithAttribution, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;

    document.title = c.metaTitle;
    if (description) description.content = c.metaDescription;
    trackLandingEvent("lp_view", {
      page_path: window.location.pathname,
      lang,
    });

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, [c.metaDescription, c.metaTitle, lang]);

  const trackCta = (ctaId: string, section: string) => {
    trackLandingEvent("cta_click", {
      cta_id: ctaId,
      section,
      lang,
    });
  };

  const showContact = (section: string) => {
    trackCta("contact", section);
    setContactOpen(true);
  };

  const formatPrice = (value: number) =>
    new Intl.NumberFormat(lang === "pt" ? "pt-PT" : "en-IE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: value === 0 ? 0 : 2,
    }).format(value);

  return (
    <div className="min-h-screen bg-white text-foreground">
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "border-b border-black/[0.04] bg-white/90 shadow-sm backdrop-blur-xl"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="C-Point home">
            <img
              src="/cpoint-logo.png"
              alt=""
              className="h-10 w-10 rounded-xl bg-white object-contain shadow-sm"
              draggable={false}
            />
            <span className={`text-xl font-bold tracking-tight ${scrolled ? "text-foreground" : "text-white"}`}>
              C-Point
            </span>
          </Link>

          <nav className="hidden items-center gap-6 lg:flex" aria-label="Owner landing">
            <a href="#why" className={`text-sm transition-colors ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}>
              {c.nav.problem}
            </a>
            <a href="#features" className={`text-sm transition-colors ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}>
              {c.nav.features}
            </a>
            <a href="#analytics" className={`text-sm transition-colors ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}>
              {c.nav.analytics}
            </a>
            <a href="#steve-package" className={`text-sm transition-colors ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}>
              {c.nav.steve}
            </a>
            <a href="#pricing" className={`text-sm transition-colors ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}>
              {c.nav.pricing}
            </a>
            <a href="#faq" className={`text-sm transition-colors ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}>
              {c.nav.faq}
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <div
              className={`hidden items-center gap-1 rounded-full border px-2 py-1 sm:inline-flex ${
                scrolled ? "border-black/10 text-muted-foreground" : "border-white/25 text-white/80"
              }`}
              role="group"
              aria-label={copy.nav.languageAria}
            >
              <Globe size={13} aria-hidden />
              {(["en", "pt"] as Lang[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={`rounded-full px-1.5 py-0.5 text-xs font-medium transition-colors ${
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
            <a
              href={signupUrl}
              onClick={() => trackCta("nav_start_free", "nav")}
              className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                scrolled
                  ? "bg-foreground text-background hover:opacity-90"
                  : "bg-white text-[#2a7a72] hover:bg-white/95"
              }`}
            >
              {c.nav.start}
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative flex min-h-screen items-center justify-center overflow-hidden pb-24 pt-32 text-white md:pb-28 md:pt-36">
          <div className="absolute inset-0">
            <img src={heroBg} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-[#4db6ac]/85" />
          </div>
          <div className="relative mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
                <ShieldCheck size={16} />
                {c.hero.badge}
              </div>
              <h1 className="text-4xl font-bold leading-[1.06] tracking-tight sm:text-5xl md:text-7xl">
                {c.hero.title}
              </h1>
              <p className="mx-auto mt-7 max-w-3xl text-lg leading-relaxed text-white/85 md:text-xl">
                {c.hero.body}
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href={signupUrl}
                  onClick={() => trackCta("hero_start_free", "hero")}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-semibold text-[#2a7a72] shadow-lg transition-colors hover:bg-white/95 sm:w-auto"
                >
                  {c.hero.primary}
                  <ArrowRight size={17} />
                </a>
                <a
                  href="#pricing"
                  onClick={() => trackCta("hero_see_plans", "hero")}
                  className="inline-flex w-full items-center justify-center rounded-full border-2 border-white bg-white/10 px-7 py-4 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/20 sm:w-auto"
                >
                  {c.hero.secondary}
                </a>
              </div>
              <p className="mt-6 text-sm text-white/70">{c.hero.proof}</p>
            </div>
          </div>
        </section>

        <section id="why" className="section-padding scroll-mt-16 bg-white">
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeading kicker={c.problem.kicker} title={c.problem.title} intro={c.problem.intro} />
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {c.problem.cards.map((card, index) => {
                const Icon = problemIcons[index] ?? FileText;
                return (
                  <article key={card.title} className="glass-card rounded-2xl p-7">
                    <Icon className="mb-5 h-7 w-7 text-primary" aria-hidden />
                    <h3 className="text-xl font-semibold">{card.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="features" className="section-padding scroll-mt-16 bg-[#4db6ac]/10">
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeading
              kicker={c.features.kicker}
              title={c.features.title}
              intro={c.features.intro}
            />
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {c.features.cards.map((card, index) => {
                const Icon = featureIcons[index] ?? UsersRound;
                return (
                  <article key={card.title} className="glass-card rounded-2xl p-8 md:p-10">
                    <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/[0.08] text-primary">
                      <Icon size={22} aria-hidden />
                    </div>
                    <h3 className="text-xl font-semibold">{card.title}</h3>
                    <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{card.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="analytics" className="section-padding scroll-mt-16 bg-white">
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-6 lg:grid-cols-[0.82fr_1.18fr]">
            <div className="lg:sticky lg:top-28">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/[0.08] text-primary">
                <BarChart3 size={24} aria-hidden />
              </div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                {c.analytics.kicker}
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                {c.analytics.title}
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{c.analytics.intro}</p>
              <a
                href={signupUrl}
                onClick={() => trackCta("analytics_start_free", "analytics")}
                className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background shadow-lg transition-opacity hover:opacity-90"
              >
                {c.analytics.cta}
                <ArrowRight size={17} />
              </a>
            </div>

            <div>
              <div className="grid gap-5 sm:grid-cols-2">
                {c.analytics.metrics.map((metric, index) => {
                  const Icon = analyticsIcons[index] ?? Activity;
                  return (
                    <article key={metric.title} className="glass-card rounded-2xl p-6">
                      <Icon className="h-6 w-6 text-primary" aria-hidden />
                      <h3 className="mt-5 text-lg font-semibold">{metric.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{metric.body}</p>
                    </article>
                  );
                })}
              </div>
              <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/[0.06] p-6">
                <p className="font-semibold text-foreground">{c.analytics.action}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.analytics.paidNote}</p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{c.analytics.privacy}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="steve-package" className="section-padding scroll-mt-16 overflow-hidden bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">{c.steve.kicker}</p>
              <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                {c.steve.title}
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">{c.steve.intro}</p>
              <ul className="mt-8 space-y-4">
                {c.steve.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3 text-sm font-medium">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-card relative mx-auto w-full max-w-md rounded-3xl p-8 shadow-elegant">
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/15 blur-3xl" />
              <Bot className="h-10 w-10 text-primary" aria-hidden />
              <p className="mt-8 text-sm font-medium uppercase tracking-widest text-muted-foreground">
                {c.pricing.steveTitle}
              </p>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-4xl font-bold">
                  {formatPrice(STEVE_COMMUNITY_PACKAGE.priceEurMonthly)}
                </span>
                <span className="pb-1 text-sm text-muted-foreground">{c.pricing.perMonth}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {STEVE_COMMUNITY_PACKAGE.monthlyCredits} {lang === "pt" ? "créditos partilhados" : "shared credits"}
              </p>
              <div className="mt-8 rounded-2xl bg-primary/10 p-4 text-sm font-medium text-primary">
                <Sparkles className="mr-2 inline h-4 w-4" aria-hidden />
                {c.steve.trial}
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="section-padding scroll-mt-16 bg-white">
          <div className="mx-auto max-w-7xl px-6">
            <SectionHeading kicker={c.pricing.kicker} title={c.pricing.title} intro={c.pricing.intro} />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {COMMUNITY_PLANS.map((plan) => {
                const recommended = plan.id === "paid_l1";
                const isEnterprise = plan.id === "enterprise";
                const name = c.pricing.planNames[plan.id];
                return (
                  <article
                    key={plan.id}
                    className={`relative flex min-h-[310px] flex-col rounded-2xl border p-6 ${
                      recommended
                        ? "border-primary bg-primary/[0.06] shadow-lg"
                        : "border-black/10 bg-white"
                    }`}
                  >
                    {recommended ? (
                      <span className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                        {c.pricing.recommended}
                      </span>
                    ) : null}
                    <h3 className="pr-16 text-lg font-semibold">{name}</h3>
                    <div className="mt-5">
                      {isEnterprise ? (
                        <p className="text-2xl font-bold">{c.pricing.contact}</p>
                      ) : plan.priceEurMonthly === 0 ? (
                        <p className="text-3xl font-bold">{c.pricing.free}</p>
                      ) : (
                        <p className="text-3xl font-bold">
                          {formatPrice(plan.priceEurMonthly!)}
                          <span className="text-sm font-normal text-muted-foreground">
                            {c.pricing.perMonth}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                      <UsersRound size={17} className="text-primary" aria-hidden />
                      {isEnterprise
                        ? c.pricing.contact
                        : `${c.pricing.upTo} ${plan.maxMembers} ${c.pricing.members}`}
                    </div>
                    <div className="mt-auto pt-8">
                      {isEnterprise ? (
                        <button
                          type="button"
                          onClick={() => showContact("pricing")}
                          className="w-full rounded-full border border-black/15 px-4 py-3 text-sm font-semibold transition-colors hover:bg-black hover:text-white"
                        >
                          {c.pricing.contact}
                        </button>
                      ) : (
                        <a
                          href={signupUrl}
                          onClick={() => trackCta(`pricing_${plan.id}`, "pricing")}
                          className={`block w-full rounded-full px-4 py-3 text-center text-sm font-semibold transition-colors ${
                            recommended
                              ? "bg-foreground text-background hover:opacity-90"
                              : "bg-primary text-white hover:opacity-90"
                          }`}
                        >
                          {plan.id === "free" ? c.pricing.start : c.pricing.choose}
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-black/10 bg-muted/40 p-5 text-center">
              <p className="font-semibold">{c.pricing.steveTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">{c.pricing.steveBody}</p>
            </div>
            <p className="mt-5 text-center text-xs text-muted-foreground">
              {c.pricing.footnote} {c.pricing.trialFootnote}
            </p>
          </div>
        </section>

        <section id="faq" className="section-padding scroll-mt-16 bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">{c.faq.kicker}</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{c.faq.title}</h2>
            </div>
            <div className="space-y-3">
              {c.faq.items.map((item) => (
                <details key={item.question} className="group rounded-2xl border border-black/10 bg-white p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                    {item.question}
                    <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-4 pr-8 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-[#4db6ac] py-24 text-white">
          <div className="relative mx-auto max-w-5xl px-6 text-center">
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 blur-[100px]" />
            <div className="relative">
              <p className="text-sm font-semibold uppercase tracking-widest text-white/75">
                {c.finalCta.kicker}
              </p>
              <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
                {c.finalCta.title}
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-white/60">{c.finalCta.body}</p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <a
                  href={signupUrl}
                  onClick={() => trackCta("final_start_free", "final_cta")}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-semibold text-[#2a7a72] shadow-lg hover:bg-white/95"
                >
                  {c.finalCta.primary}
                  <ArrowRight size={17} />
                </a>
                <button
                  type="button"
                  onClick={() => showContact("final_cta")}
                  className="rounded-full border border-white/20 px-7 py-4 text-sm font-semibold text-white hover:bg-white/10"
                >
                  {c.finalCta.secondary}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/15 bg-[#4db6ac] py-10 text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-6 text-center md:flex-row md:text-left">
          <div className="flex items-center gap-3">
            <Link to="/" aria-label="C-Point home">
              <img
                src="/cpoint-logo.png"
                alt=""
                className="h-11 w-11 rounded-xl bg-white object-contain"
                draggable={false}
              />
            </Link>
            <div>
              <p className="text-lg font-bold">C-Point</p>
              <p className="mt-1 text-xs text-white/60">{PLATFORM_AVAILABILITY_LINE}</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-5 text-sm text-white/70">
            <Link to={copy.footer.legalPaths.privacy} className="hover:text-white">
              {copy.footer.privacy}
            </Link>
            <Link to={copy.footer.legalPaths.terms} className="hover:text-white">
              {copy.footer.terms}
            </Link>
            <Link to="/support" className="hover:text-white">
              {copy.footer.support}
            </Link>
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white">
              iOS
            </a>
            <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white">
              Android
            </a>
          </div>
        </div>
      </footer>

      <ContactForm open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  );
}

function SectionHeading({
  kicker,
  title,
  intro,
}: {
  kicker: string;
  title: string;
  intro: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">{kicker}</p>
      <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">{title}</h2>
      <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{intro}</p>
    </div>
  );
}
