/**
 * Plans (/plans) — design_handoff_landing_redesign, "C-Point Plans" prototypes.
 *
 * Pricing comes from src/generated/pricing.json, which is generated from the
 * in-app Knowledge Base seeds (`scripts/generate_landing_pricing.py`) — the KB
 * stays the source of truth; never hard-code prices here. Per the handoff:
 * 4 tiers (Free / L1 / L2 highlighted / L3) + the Steve add-on band. No
 * Enterprise card, no personal/Premium pricing. Upgrade CTAs deep-link to the
 * in-app plans screen.
 */
import { Link } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";
import { usePageTitle, useReveal, useScrollToTop } from "@/redesign/hooks";
import { SiteNav } from "@/redesign/SiteNav";
import { SiteFooter } from "@/redesign/SiteFooter";
import { APP_URL, SUPPORT_EMAIL } from "@/redesign/links";
import { trackLandingEvent } from "@/lib/track";
import pricing from "@/generated/pricing.json";
import steveLogo from "@/assets/steve-logo.png";

const TEAL = "#4db6ac";

type TierCode = "free" | "paid_l1" | "paid_l2" | "paid_l3";

function kbTier(code: TierCode): { price: number; maxMembers: number } {
  const row = pricing.community_tiers.find((t) => t.code === code);
  if (!row || row.price_eur_monthly === null || row.max_members === null) {
    throw new Error(`pricing.json missing community tier ${code}`);
  }
  return { price: row.price_eur_monthly, maxMembers: row.max_members };
}

const eur = (v: number) => `€${Number.isInteger(v) ? v : v.toFixed(2)}`;

const COPY = {
  en: {
    title: "C-Point | Plans",
    eyebrow: "Plans",
    h1: "Sized to the room.",
    lead: "Every community starts free. Paid tiers raise the member cap; Steve joins as an add-on or comes included with Enterprise.",
    free: "Free",
    perMonth: "/mo",
    upTo: (n: number) => `Up to ${n} members`,
    startFree: "Start free",
    upgrade: "Upgrade in app",
    enterprise: "Enterprise",
    customPrice: "Custom",
    unlimited: "Unlimited members",
    contactUs: "Contact us",
    features: {
      free: ["Feed, chat, events, and polls", "Invitation-only with approval", "Sub-communities and groups"],
      l1: ["Everything in Free", "Higher media storage", "Steve package available as add-on"],
      l2: ["Everything in L1", "Grows with active chapters", "Steve package available as add-on"],
      l3: ["Everything in L2", "Full-organisation scale", "Steve package available as add-on"],
      enterprise: ["Everything in L3", "Unlimited members", "Steve Community Package included"],
    },
    addOn: "Add-on",
    steveTitle: (price: string) => `Steve Community Package — ${price}/mo`,
    steveBody:
      "One shared intelligent presence for the whole community — in the feed, groups, and chats, with a pooled monthly allowance. Available on any paid tier.",
    disclaimer:
      "Prices shown are read from the same source of truth as the app — current caps, billing, and renewal terms are always confirmed in-app before you pay.",
    ctaTitle: ["Start free.", "Grow when the room does."],
    openApp: "Open the app",
    seePlatform: "See the platform",
  },
  pt: {
    title: "C-Point | Planos",
    eyebrow: "Planos",
    h1: "À medida da sala.",
    lead: "Todas as comunidades começam grátis. Os planos pagos aumentam o limite de membros; o Steve entra como add-on ou vem incluído no Enterprise.",
    free: "Grátis",
    perMonth: "/mês",
    upTo: (n: number) => `Até ${n} membros`,
    startFree: "Começar grátis",
    upgrade: "Atualizar na app",
    enterprise: "Enterprise",
    customPrice: "À medida",
    unlimited: "Membros ilimitados",
    contactUs: "Fala connosco",
    features: {
      free: ["Feed, chat, eventos e sondagens", "Apenas por convite, com aprovação", "Subcomunidades e grupos"],
      l1: ["Tudo do plano Grátis", "Mais armazenamento de media", "Pacote Steve disponível como add-on"],
      l2: ["Tudo do L1", "Cresce com capítulos ativos", "Pacote Steve disponível como add-on"],
      l3: ["Tudo do L2", "Escala de organização inteira", "Pacote Steve disponível como add-on"],
      enterprise: ["Tudo do L3", "Membros ilimitados", "Steve Community Package incluído"],
    },
    addOn: "Add-on",
    steveTitle: (price: string) => `Steve Community Package — ${price}/mês`,
    steveBody:
      "Uma presença inteligente partilhada para toda a comunidade — no feed, nos grupos e nos chats, com um plafond mensal partilhado. Disponível em qualquer plano pago.",
    disclaimer:
      "Os preços apresentados são lidos da mesma fonte de verdade da app — limites, faturação e condições de renovação são sempre confirmados na app antes de pagares.",
    ctaTitle: ["Começa grátis.", "Cresce quando a sala crescer."],
    openApp: "Abrir a app",
    seePlatform: "Ver a plataforma",
  },
} as const;

export default function Plans() {
  const { lang } = useLang();
  const pt = lang === "pt";
  const c = COPY[pt ? "pt" : "en"];
  useReveal(lang);
  useScrollToTop();
  usePageTitle(c.title);

  const l1 = kbTier("paid_l1");
  const l2 = kbTier("paid_l2");
  const l3 = kbTier("paid_l3");
  const free = kbTier("free");
  const stevePrice = eur(pricing.steve_package.price_eur_monthly);

  const darkStyle = {
    border: `1px solid rgba(242,245,244,${pt ? ".18" : ".12"})`,
    bg: "transparent",
    accent: `rgba(242,245,244,${pt ? ".6" : ".5"})`,
    btnBg: "transparent",
    btnColor: "#f2f5f4",
    btnBorder: "1px solid rgba(242,245,244,.4)",
  };
  const hiStyle = {
    border: "1px solid rgba(77,182,172,.5)",
    bg: "rgba(77,182,172,.06)",
    accent: TEAL,
    btnBg: TEAL,
    btnColor: "#0a0d0d",
    btnBorder: "1px solid transparent",
  };

  // Upgrades happen in-app after login; the deep link to /subscription_plans
  // errors for logged-out visitors, so all tiers land on the app itself.
  const tiers = [
    { ...darkStyle, name: c.free, price: "€0", per: "", range: c.upTo(free.maxMembers), cta: c.startFree, href: APP_URL, features: c.features.free },
    { ...darkStyle, name: "Paid L1", price: eur(l1.price), per: c.perMonth, range: c.upTo(l1.maxMembers), cta: c.upgrade, href: APP_URL, features: c.features.l1 },
    { ...hiStyle, name: "Paid L2", price: eur(l2.price), per: c.perMonth, range: c.upTo(l2.maxMembers), cta: c.upgrade, href: APP_URL, features: c.features.l2 },
    { ...darkStyle, name: "Paid L3", price: eur(l3.price), per: c.perMonth, range: c.upTo(l3.maxMembers), cta: c.upgrade, href: APP_URL, features: c.features.l3 },
    {
      ...darkStyle,
      name: c.enterprise,
      price: c.customPrice,
      per: "",
      range: c.unlimited,
      cta: c.contactUs,
      href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("C-Point Enterprise")}`,
      features: c.features.enterprise,
    },
  ];

  const hairline = `1px solid rgba(242,245,244,${pt ? ".13" : ".06"})`;

  return (
    <div className={pt ? "rl rl--pt" : "rl"} key={lang}>
      <SiteNav active="plans" variant="solid" />

      <div style={{ padding: "200px var(--rl-gutter) 72px", textAlign: "center" }}>
        <div className="rl-eyebrow" style={{ color: TEAL, marginBottom: 28 }}>{c.eyebrow}</div>
        <h1 style={{ margin: "0 0 24px", fontWeight: 600, fontSize: "clamp(40px, 6vw, 80px)", lineHeight: 1.02, letterSpacing: "-.025em" }}>{c.h1}</h1>
        <p style={{ margin: "0 auto", fontSize: 18, lineHeight: 1.65, color: pt ? "rgba(242,245,244,.68)" : "rgba(242,245,244,.55)", maxWidth: 560 }}>{c.lead}</p>
      </div>

      <div style={{ padding: "48px var(--rl-gutter) 96px", display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", alignItems: "stretch" }}>
        {tiers.map((tier) => (
          <div key={tier.name} style={{ width: 300, display: "flex", flexDirection: "column", padding: "36px 32px", border: tier.border, background: tier.bg, boxSizing: "border-box" }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".25em", textTransform: "uppercase", color: tier.accent, marginBottom: 18 }}>{tier.name}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-.02em" }}>{tier.price}</span>
              <span style={{ fontSize: 14, color: pt ? "rgba(242,245,244,.6)" : "rgba(242,245,244,.45)" }}>{tier.per}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEAL, marginBottom: 26 }}>{tier.range}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: `1px solid rgba(242,245,244,${pt ? ".18" : ".1"})`, paddingTop: 22, flex: 1 }}>
              {tier.features.map((feat) => (
                <div key={feat} style={{ display: "flex", gap: 12, fontSize: 14, lineHeight: 1.55, color: pt ? "rgba(242,245,244,.82)" : "rgba(242,245,244,.7)" }}>
                  <span style={{ color: TEAL }}>—</span>
                  <span>{feat}</span>
                </div>
              ))}
            </div>
            <a
              href={tier.href}
              target="_blank"
              rel="noopener"
              onClick={() => trackLandingEvent("cta_click", { page: "plans", cta: tier.name })}
              style={{
                marginTop: 28, display: "block", textAlign: "center",
                fontSize: 11.5, fontWeight: 600, letterSpacing: ".22em", textTransform: "uppercase",
                padding: "15px 0", background: tier.btnBg, color: tier.btnColor, border: tier.btnBorder,
                transition: "opacity .3s",
              }}
            >
              {tier.cta}
            </a>
          </div>
        ))}
      </div>

      <div style={{ margin: "0 var(--rl-gutter)", borderTop: hairline, padding: "96px 0", display: "flex", flexWrap: "wrap", gap: "48px 96px", alignItems: "center", justifyContent: "center" }}>
        <img src={steveLogo} alt="Steve" style={{ width: 88, height: 88, borderRadius: "50%", boxShadow: "0 0 60px rgba(77,182,172,.35)" }} />
        <div style={{ maxWidth: 520, flex: "1 1 380px", minWidth: "min(320px, 100%)" }}>
          <div className="rl-eyebrow" style={{ color: TEAL, marginBottom: 16 }}>{c.addOn}</div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.01em", marginBottom: 12 }}>{c.steveTitle(stevePrice)}</div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.68)" : "rgba(242,245,244,.55)" }}>{c.steveBody}</p>
        </div>
      </div>

      <div style={{ margin: "0 var(--rl-gutter)", borderTop: hairline, padding: "72px 0 96px", textAlign: "center" }}>
        <p style={{ margin: "0 auto", fontSize: 13, color: pt ? "rgba(242,245,244,.5)" : "rgba(242,245,244,.35)", maxWidth: 640 }}>{c.disclaimer}</p>
      </div>

      <div style={{ padding: "110px var(--rl-gutter) 44px", textAlign: "center", borderTop: hairline, background: "radial-gradient(ellipse 60% 70% at 50% 110%, rgba(77,182,172,.14), transparent)" }}>
        <h2 style={{ margin: "0 0 44px", fontWeight: 600, fontSize: "clamp(34px, 5vw, 64px)", lineHeight: 1.02, letterSpacing: "-.025em" }}>
          {c.ctaTitle[0]}
          <br />
          <span style={{ color: TEAL }}>{c.ctaTitle[1]}</span>
        </h2>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 120, flexWrap: "wrap" }}>
          <a href={APP_URL} target="_blank" rel="noopener" className="rl-btn rl-btn--primary" onClick={() => trackLandingEvent("cta_click", { page: "plans", cta: "open_app" })}>
            {c.openApp}
          </a>
          <Link to="/platform" className="rl-btn rl-btn--ghost">{c.seePlatform}</Link>
        </div>
        <SiteFooter />
      </div>
    </div>
  );
}
