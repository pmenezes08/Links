/**
 * Manifesto (/manifesto) — design_handoff_landing_redesign,
 * "C-Point Manifesto" prototypes. Same structure in both languages.
 */
import { useLang } from "@/i18n/LanguageContext";
import { usePageTitle, useReveal, useScrollToTop } from "@/redesign/hooks";
import { SiteNav } from "@/redesign/SiteNav";
import { SiteFooter } from "@/redesign/SiteFooter";
import { ANDROID_URL, APP_URL, IOS_URL } from "@/redesign/links";
import { trackLandingEvent } from "@/lib/track";

const TEAL = "#4db6ac";

const COPY = {
  en: {
    title: "C-Point | Manifesto",
    eyebrow: "The C-Point manifesto",
    h1: "The world is meant to be lived.",
    lead: "Come here to reconnect with your people, stay present in your world, and actually get back to living.",
    platform: "C-Point is a global platform of private, independent communities.",
    nos: ["No public feeds.", "No self-promotion.", "No algorithm-driven noise.", "No fast-consuming content."],
    anything:
      "A community can be anything — a close group of friends planning trips, a circle debating the future, a place for banter with people who truly get you, or the private network that keeps you connected to the organisations that matter: your alumni group, your school, an investor network, your sports club, or your company.",
    steveBefore: "Inside every community lives ",
    steveAfter:
      " — our intelligent presence who deeply understands each member's journey, values and expertise, and quietly works to create meaningful connections and keep the space alive.",
    invitation:
      "Access is by invitation only. Privacy and exclusivity are built in from day one. Everything shared inside stays inside. No strangers. No algorithms deciding what deserves your attention.",
    closing: ["This is your world.", "Come connect with it."],
    ios: "Download for iOS",
    android: "Download for Android",
    web: "Open web app",
  },
  pt: {
    title: "C-Point | Manifesto",
    eyebrow: "O manifesto C-Point",
    h1: "O mundo é para ser vivido.",
    lead: "Vem para aqui reencontrar as tuas pessoas, estar presente no teu mundo, e voltar de facto a viver.",
    platform: "O C-Point é uma plataforma global de comunidades privadas e independentes.",
    nos: ["Sem feeds públicos.", "Sem autopromoção.", "Sem ruído de algoritmos.", "Sem conteúdo de consumo rápido."],
    anything:
      "Uma comunidade pode ser qualquer coisa — um grupo próximo de amigos a planear viagens, um círculo a debater o futuro, um sítio para conversa com pessoas que te percebem mesmo, ou a rede privada que te mantém ligado às organizações que importam: o teu grupo de alumni, a tua escola, uma rede de investidores, o teu clube desportivo, ou a tua empresa.",
    steveBefore: "Dentro de cada comunidade vive o ",
    steveAfter:
      " — a nossa presença inteligente, que compreende profundamente o percurso, os valores e a experiência de cada membro, e trabalha discretamente para criar ligações com significado e manter o espaço vivo.",
    invitation:
      "O acesso é apenas por convite. A privacidade e a exclusividade fazem parte desde o primeiro dia. Tudo o que é partilhado lá dentro fica lá dentro. Sem estranhos. Sem algoritmos a decidir o que merece a tua atenção.",
    closing: ["Este é o teu mundo.", "Vem ligar-te a ele."],
    ios: "Descarregar para iOS",
    android: "Descarregar para Android",
    web: "Abrir app web",
  },
} as const;

const track = (cta: string) => () => trackLandingEvent("cta_click", { page: "manifesto", cta });

export default function Manifesto() {
  const { lang } = useLang();
  const pt = lang === "pt";
  const c = COPY[pt ? "pt" : "en"];
  useReveal(lang);
  useScrollToTop();
  usePageTitle(c.title);

  const nosColors = pt
    ? ["#f2f5f4", "rgba(242,245,244,.82)", "rgba(242,245,244,.6)", TEAL]
    : ["#f2f5f4", "rgba(242,245,244,.7)", "rgba(242,245,244,.45)", TEAL];
  const bodyColor = pt ? "rgba(242,245,244,.74)" : "rgba(242,245,244,.6)";

  return (
    <div className={pt ? "rl rl--pt" : "rl"} key={lang}>
      <SiteNav active="manifesto" />

      <div
        style={{
          minHeight: "92vh", display: "flex", flexDirection: "column", justifyContent: "flex-end",
          padding: "140px var(--rl-gutter) 96px", boxSizing: "border-box",
          background: pt ? "radial-gradient(ellipse 60% 50% at 80% 10%, rgba(47,145,135,.1), transparent)" : undefined,
        }}
      >
        <div data-reveal="" className="rl-eyebrow" style={{ color: TEAL, marginBottom: 32 }}>{c.eyebrow}</div>
        <h1 data-reveal="" style={{ transitionDelay: ".12s", margin: 0, fontWeight: 600, fontSize: "clamp(46px, 7.4vw, 100px)", lineHeight: 1, letterSpacing: "-.03em", maxWidth: 1100 }}>
          {c.h1}
        </h1>
      </div>

      <div className="rl-border-t" style={{ padding: "120px var(--rl-gutter) 160px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 72 }}>
          <p data-reveal="" style={{ margin: 0, fontSize: 30, fontWeight: 400, lineHeight: 1.5, color: "rgba(242,245,244,.85)" }}>{c.lead}</p>
          <div data-reveal="">
            <p style={{ margin: "0 0 28px", fontSize: 22, fontWeight: 400, lineHeight: 1.6, color: bodyColor }}>{c.platform}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 600, fontSize: "clamp(24px, 3.6vw, 44px)", lineHeight: 1.15, letterSpacing: "-.01em" }}>
              {c.nos.map((line, i) => (
                <span key={i} style={{ color: nosColors[i] }}>{line}</span>
              ))}
            </div>
          </div>
          <p data-reveal="" style={{ margin: 0, fontSize: 22, fontWeight: 400, lineHeight: 1.7, color: bodyColor }}>{c.anything}</p>
          <div data-reveal="" style={{ borderLeft: `2px solid ${TEAL}`, paddingLeft: 36 }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 400, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.85)" : "rgba(242,245,244,.75)" }}>
              {c.steveBefore}
              <span style={{ color: TEAL, fontWeight: 600 }}>Steve</span>
              {c.steveAfter}
            </p>
          </div>
          <p data-reveal="" style={{ margin: 0, fontSize: 22, fontWeight: 400, lineHeight: 1.7, color: bodyColor }}>{c.invitation}</p>
          <div data-reveal="">
            <p style={{ margin: "0 0 48px", fontWeight: 600, fontSize: "clamp(29px, 4.4vw, 54px)", lineHeight: 1.1, letterSpacing: "-.01em" }}>
              {c.closing[0]}
              <br />
              <span style={{ color: TEAL }}>{c.closing[1]}</span>
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <a href={IOS_URL} target="_blank" rel="noopener" className={pt ? "rl-btn rl-btn--md rl-btn--primary" : "rl-btn rl-btn--md rl-btn--light"} onClick={track("ios")}>
                {c.ios}
              </a>
              <a href={ANDROID_URL} target="_blank" rel="noopener" className="rl-btn rl-btn--md rl-btn--ghost" style={{ padding: "16px 38px" }} onClick={track("android")}>
                {c.android}
              </a>
              <a href={APP_URL} target="_blank" rel="noopener" className="rl-btn rl-btn--md rl-btn--ghost" style={{ padding: "16px 38px" }} onClick={track("web_app")}>
                {c.web}
              </a>
            </div>
          </div>
        </div>
      </div>

      <SiteFooter standalone />
    </div>
  );
}
