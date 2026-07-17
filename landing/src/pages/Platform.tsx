/**
 * Platform (/platform) — product deep-dive (design_handoff_landing_redesign,
 * "C-Point Organisations" prototypes). EN and PT layouts intentionally differ.
 */
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";
import { usePageTitle, useReveal, useScrollToTop } from "@/redesign/hooks";
import { SiteNav } from "@/redesign/SiteNav";
import { SiteFooter } from "@/redesign/SiteFooter";
import { Phone } from "@/redesign/Phone";
import { SUPPORT_EMAIL } from "@/redesign/links";
import steveLogo from "@/assets/steve-logo.png";
import subcommunities from "@/assets/screens/subcommunities.jpg";
import ownerTools from "@/assets/screens/owner-tools.png";
import hiringThread from "@/assets/screens/hiring-thread.jpg";
import communityTools from "@/assets/screens/community-tools.jpg";
import profilePersonal from "@/assets/screens/profile-personal.jpg";
import profileProfessional from "@/assets/screens/profile-professional.jpg";
import askSteveNetworking from "@/assets/screens/ask-steve-networking.jpg";
import directoryFilters from "@/assets/screens/directory-filters.jpg";
import eventDetails from "@/assets/screens/event-details.jpg";
import calendarLight from "@/assets/screens/calendar-light.jpg";
import calendarDark from "@/assets/screens/calendar-dark.jpg";
import feedNetwork from "@/assets/screens/feed-network.jpg";
import directoryLightPt from "@/assets/screens/directory-light-pt.jpg";
import directoryDarkPt from "@/assets/screens/directory-dark-pt.jpg";
import askStevePt from "@/assets/screens/ask-steve-pt.jpg";

const TEAL = "#4db6ac";
const TALK_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("C-Point for our organisation")}`;
const PT_PHONE_SHADOW = "0 40px 100px -30px rgba(47,145,135,.45), 0 10px 40px -10px rgba(242,245,244,.18)";

function Eyebrow({ children, color, mb = 24 }: { children: ReactNode; color: string; mb?: number }) {
  return (
    <div data-reveal="" className="rl-eyebrow" style={{ color, marginBottom: mb }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.2vw, 56px)", lineHeight: 1.02, letterSpacing: "-.02em" }}>
      {children}
    </h2>
  );
}

function AbcList({ items, pt }: { items: string[]; pt: boolean }) {
  const border = pt ? "1px solid rgba(242,245,244,.18)" : "1px solid rgba(242,245,244,.1)";
  return (
    <div data-reveal="" style={{ transitionDelay: ".3s", display: "flex", flexDirection: "column", borderTop: border }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 20, padding: "20px 0", borderBottom: i < items.length - 1 ? border : undefined, fontSize: 15, color: pt ? "rgba(242,245,244,.85)" : "rgba(242,245,244,.75)" }}>
          <span style={{ color: TEAL, fontWeight: 600, letterSpacing: ".1em" }}>{String.fromCharCode(65 + i)}</span>
          {item}
        </div>
      ))}
    </div>
  );
}

function Hero({ pt }: { pt: boolean }) {
  return (
    <div
      style={{
        minHeight: "88vh", display: "flex", flexDirection: "column", justifyContent: "flex-end",
        padding: "140px var(--rl-gutter) 88px", boxSizing: "border-box",
        background: pt
          ? "radial-gradient(ellipse 60% 50% at 80% 10%, rgba(47,145,135,.14), transparent)"
          : "radial-gradient(ellipse 60% 50% at 80% 10%, rgba(77,182,172,.08), transparent)",
      }}
    >
      <Eyebrow color={TEAL} mb={30}>{pt ? "A plataforma" : "The platform"}</Eyebrow>
      <h1 data-reveal="" style={{ transitionDelay: ".12s", margin: "0 0 36px", fontWeight: 600, fontSize: pt ? "clamp(44px, 6.8vw, 92px)" : "clamp(42px, 6.6vw, 88px)", lineHeight: 1.02, letterSpacing: "-.025em", maxWidth: 1060 }}>
        {pt ? <>Tudo o que uma rede<br />privada precisa.</> : <>Everything a private<br />network needs.</>}
      </h1>
      <p data-reveal="" style={{ transitionDelay: ".22s", margin: "0 0 44px", fontSize: 19, lineHeight: 1.6, color: pt ? "rgba(242,245,244,.68)" : "rgba(242,245,244,.55)", maxWidth: 580 }}>
        {pt
          ? "Comunidades estruturadas, um feed a sério, eventos, e o Steve dentro de cada sala — para grupos de alumni, clubes, associações e empresas."
          : "Structured communities, a real feed, member identity, networking, events — and Steve inside every room. Built for alumni groups, clubs, associations, and companies."}
      </p>
      <div data-reveal="" style={{ transitionDelay: ".3s", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <a href={TALK_HREF} className="rl-btn rl-btn--md rl-btn--primary">{pt ? "Fala connosco" : "Talk to us"}</a>
        <Link to="/plans" className="rl-btn rl-btn--md rl-btn--ghost" style={{ padding: "16px 38px" }}>
          {pt ? "Ver planos" : "View plans"}
        </Link>
      </div>
    </div>
  );
}

function StevePanel({ pt, index }: { pt: boolean; index: string }) {
  const band: CSSProperties = pt
    ? { background: "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(77,182,172,.14), transparent), #0e1c19", color: "#eef4f2" }
    : {};
  const capabilities = pt
    ? [
        { k: "Networking", v: "Pergunta quem deves conhecer — o Steve conhece o percurso, as competências e os interesses de cada membro, e faz a apresentação." },
        { k: "Analytics", v: "As análises para owners são narradas por ele — crescimento, atividade e quem dinamiza a conversa." },
        { k: "No feed", v: "Menciona @Steve em qualquer publicação — resumos, respostas e decisões tiradas do próprio thread." },
        { k: "Documentos", v: "Lê os ficheiros que a comunidade partilha — pergunta sobre os estatutos, o deck, as atas." },
        { k: "Fotos e voz", v: "Compreende imagens e transcreve notas de voz — em português, inglês e espanhol." },
      ]
    : [
        { k: "Networking", v: "Ask who to meet — Steve knows every member's journey, skills, and interests, and makes the introduction." },
        { k: "Analytics", v: "The owner analytics are narrated by him — growth, activity, and who's driving the conversation." },
        { k: "In the feed", v: "Mention @Steve under any post — summaries, answers, and decisions pulled from the thread itself." },
        { k: "Documents", v: "Reads the files your community shares — ask about the bylaws, the deck, the meeting notes." },
        { k: "Photos & voice", v: "Understands pictures and transcribes voice notes — in English, Portuguese, and Spanish." },
      ];
  const tileBorder = pt ? "1px solid rgba(238,244,242,.15)" : "1px solid rgba(242,245,244,.1)";
  const inkSoft = pt ? "rgba(238,244,242,.68)" : "rgba(242,245,244,.55)";
  return (
    <div className="rl-border-t" style={{ padding: "140px var(--rl-gutter)", textAlign: "center", ...band }}>
      <img
        data-reveal=""
        src={steveLogo}
        alt="Steve"
        style={{ display: "block", width: 88, height: 88, borderRadius: "50%", margin: "0 auto 32px", boxShadow: "0 0 60px rgba(77,182,172,.35)" }}
      />
      <div data-reveal="" className="rl-eyebrow" style={{ transitionDelay: ".05s", color: pt ? "rgba(238,244,242,.6)" : "rgba(242,245,244,.45)", marginBottom: 26 }}>
        {index} — {pt ? "Inteligência" : "Intelligence"}
      </div>
      <SectionTitle>
        {pt
          ? <>Por trás de tudo isto,<br /><span style={{ color: TEAL }}>uma inteligência: o Steve.</span></>
          : <>Behind all of it,<br /><span style={{ color: TEAL }}>one intelligence: Steve.</span></>}
      </SectionTitle>
      <p data-reveal="" style={{ transitionDelay: ".2s", margin: "0 auto 72px", fontSize: 17, lineHeight: 1.7, color: inkSoft, maxWidth: 620 }}>
        {pt
          ? "O Steve não é uma funcionalidade — é a camada por baixo de todas. A mesma inteligência que alimenta as análises, encontra as pessoas certas, responde no feed e lê o que a comunidade partilha."
          : "Steve isn't a feature — he's the layer underneath them all. The same intelligence that powers the analytics, finds the right people, answers in the feed, and reads what your community shares."}
      </p>
      <div
        data-reveal=""
        style={{
          transitionDelay: ".25s", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 0, borderTop: tileBorder, maxWidth: 1100, margin: "0 auto", textAlign: "left",
        }}
      >
        {capabilities.map((c) => (
          <div key={c.k} style={{ padding: "28px 24px 28px 0", borderBottom: tileBorder, marginRight: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: TEAL, marginBottom: 12 }}>{c.k}</div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: inkSoft }}>{c.v}</p>
          </div>
        ))}
      </div>
      <p data-reveal="" style={{ margin: "56px auto 0", fontSize: 15, lineHeight: 1.7, color: pt ? "rgba(238,244,242,.55)" : "rgba(242,245,244,.45)", maxWidth: 560 }}>
        {pt
          ? "Adiciona o Steve Community Package a uma comunidade paga e a sala inteira partilha uma presença inteligente — no feed, nos grupos e nos chats."
          : "Add the Steve Community Package to a paid community and the whole room shares one intelligent presence — in the feed, groups, and chats."}
      </p>
    </div>
  );
}

function PlansPanels({ pt }: { pt: boolean }) {
  return (
    <div className="rl-grid-2 rl-border-t">
      <div
        data-reveal=""
        style={{
          padding: "88px var(--rl-gutter)",
          borderRight: pt ? "1px solid rgba(242,245,244,.13)" : "1px solid rgba(242,245,244,.06)",
          background: pt ? "rgba(77,182,172,.05)" : undefined,
        }}
      >
        <div className="rl-eyebrow" style={{ color: pt ? "rgba(242,245,244,.6)" : "rgba(242,245,244,.45)", marginBottom: 22 }}>
          {pt ? "Planos pagos de comunidade" : "Community paid tiers"}
        </div>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.78)" : "rgba(242,245,244,.65)", maxWidth: 400 }}>
          {pt
            ? "Mais membros, mais armazenamento de media, extras opcionais — do círculo próximo à organização inteira."
            : "Higher member caps, more media storage, optional add-ons — sized from a close circle to a full organisation."}
        </p>
      </div>
      <div data-reveal="" style={{ transitionDelay: ".15s", padding: "88px var(--rl-gutter)", background: pt ? "rgba(47,145,135,.08)" : "rgba(77,182,172,.04)" }}>
        <div className="rl-eyebrow" style={{ color: TEAL, marginBottom: 22 }}>{pt ? "Sempre atual" : "Always current"}</div>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.78)" : "rgba(242,245,244,.65)", maxWidth: 400 }}>
          {pt
            ? "Os planos que vês aqui são lidos da mesma fonte de verdade da app — e a faturação acontece sempre lá dentro."
            : "The plans you see here are read from the same source of truth as the app — and billing always happens in-app."}
        </p>
      </div>
    </div>
  );
}

function Cta({ pt }: { pt: boolean }) {
  const band: CSSProperties = pt
    ? { background: "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(77,182,172,.14), transparent), #0e1c19", color: "#eef4f2" }
    : { background: "radial-gradient(ellipse 60% 70% at 50% 110%, rgba(77,182,172,.14), transparent)" };
  return (
    <div className="rl-border-t" style={{ padding: "150px var(--rl-gutter) 44px", textAlign: "center", ...band }}>
      <h2 data-reveal="" style={{ margin: "0 0 48px", fontWeight: 600, fontSize: "clamp(36px, 5.4vw, 72px)", lineHeight: 1, letterSpacing: "-.025em" }}>
        {pt ? <>Traz as tuas pessoas<br /><span style={{ color: TEAL }}>para casa.</span></> : <>Bring your people<br /><span style={{ color: TEAL }}>home.</span></>}
      </h2>
      <div data-reveal="" style={{ transitionDelay: ".15s", display: "flex", gap: 14, justifyContent: "center", marginBottom: 130, flexWrap: "wrap" }}>
        <a href={TALK_HREF} className="rl-btn rl-btn--primary">{pt ? "Fala connosco" : "Talk to us"}</a>
        <Link to="/plans" className="rl-btn rl-btn--ghost">{pt ? "Ver planos" : "View plans"}</Link>
      </div>
      <SiteFooter />
    </div>
  );
}

/* ---------- EN layout ---------- */

function SplitEn({
  index, title, body, phones, list, textFirst = true, single,
}: {
  index: string;
  title: ReactNode;
  body: string;
  phones?: [{ src: string; alt: string }, { src: string; alt: string }];
  single?: { src: string; alt: string };
  list?: string[];
  textFirst?: boolean;
}) {
  const text = (
    <div className="rl-split-text">
      <Eyebrow color="rgba(242,245,244,.45)">{index}</Eyebrow>
      <SectionTitle>{title}</SectionTitle>
      <p data-reveal="" style={{ transitionDelay: ".2s", margin: list ? "0 0 40px" : 0, fontSize: 17, lineHeight: 1.7, color: "rgba(242,245,244,.55)", maxWidth: list ? 440 : undefined }}>
        {body}
      </p>
      {list && <AbcList items={list} pt={false} />}
    </div>
  );
  const media = (
    <div className="rl-phone-pair">
      {phones ? (
        <>
          <Phone src={phones[0].src} alt={phones[0].alt} />
          <Phone src={phones[1].src} alt={phones[1].alt} drop delay=".15s" />
        </>
      ) : single ? (
        <Phone src={single.src} alt={single.alt} />
      ) : null}
    </div>
  );
  return (
    <div className="rl-split rl-border-t" style={{ minHeight: "100vh" }}>
      {textFirst ? text : media}
      {textFirst ? media : text}
    </div>
  );
}

function PlatformEn() {
  return (
    <>
      <Hero pt={false} />
      <SplitEn
        index="01 — Structure"
        title={<>One umbrella.<br />Focused rooms.</>}
        body="Parent and sub-communities for chapters, committees, and projects — each with its own feed, calendar, and member management."
        list={[
          "Owners, admins, members — granular permissions at every level",
          "Invitation-only with approval controls — no strangers in the room",
          "A Home Timeline with the last 48 hours from every sub-community — members never miss what's happening without opening each room",
        ]}
        phones={[
          { src: subcommunities, alt: "C-Point — sub-communities under one umbrella" },
          { src: feedNetwork, alt: "C-Point — Home Timeline: the last 48 hours across all sub-communities" },
        ]}
      />
      <SplitEn
        index="02 — The feed"
        title={<>Where members<br />help each other.</>}
        body="Hiring threads, spare desks, introductions — the network's real value lives in the feed, threaded and findable. Key posts, polls, calendar, media, and forum sit one tap away, inside the community."
        phones={[
          { src: hiringThread, alt: "C-Point — alumni hiring thread" },
          { src: communityTools, alt: "C-Point — community tools: key posts, polls, calendar, media, forum" },
        ]}
        textFirst={false}
      />
      <SplitEn
        index="03 — Identity"
        title={<>One profile,<br /><span style={{ color: TEAL }}>two sides.</span></>}
        body="A personal side for close circles, a professional side for the network — career timeline, skills, education. Members decide what each community sees, and the organisation gets a real member directory out of it."
        phones={[
          { src: profilePersonal, alt: "C-Point — member profile" },
          { src: profileProfessional, alt: "C-Point — professional side with career timeline" },
        ]}
      />
      <SplitEn
        index="04 — Networking"
        title={<>The right people,<br />found for you.</>}
        body="The platform's most powerful feature: intelligent networking. Ask Steve who to meet — a mentor, a co-founder, someone nearby — or browse the member directory filtered by location, industry, and interests."
        phones={[
          { src: askSteveNetworking, alt: "C-Point — ask Steve who to meet" },
          { src: directoryFilters, alt: "C-Point — member directory by location and industry" },
        ]}
        textFirst={false}
      />
      <SplitEn
        index="05 — Events"
        title={<>Calendars where<br />the people are.</>}
        body="Events with RSVPs, reminders, and attendance — inside the community, next to the conversation, not in a detached tool nobody opens."
        single={{ src: eventDetails, alt: "C-Point — event details with RSVPs" }}
      />
      <SplitEn
        index="06 — Analytics"
        title={<>The pulse of the room,<br />at a glance.</>}
        body="Owner tools with Steve-narrated analytics — member growth, weekly activity, who's driving the conversation, and which spaces are alive — so owners know how the network is doing without reading every thread."
        single={{ src: ownerTools, alt: "C-Point — owner tools: Steve-narrated analytics, growth, and most active members" }}
        textFirst={false}
      />
      <SplitEn
        index="07 — Two interfaces"
        title={<>Light or dark.<br />Members choose.</>}
        body="The whole app ships in both interfaces — same communities, same tools, one tap apart. Every member picks the mode that suits them."
        phones={[
          { src: calendarLight, alt: "C-Point — calendar in light mode" },
          { src: calendarDark, alt: "C-Point — the same calendar in dark mode" },
        ]}
      />
      <StevePanel pt={false} index="08" />
      <PlansPanels pt={false} />
      <Cta pt={false} />
    </>
  );
}

/* ---------- PT layout ---------- */

function PlatformPt() {
  return (
    <>
      <Hero pt />
      {/* 01 — Estrutura */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden", background: "rgba(242,245,244,.03)" }}>
        <Phone src={subcommunities} alt="C-Point — subcomunidades" width={340} height={640} style={{ borderRadius: 44, boxShadow: PT_PHONE_SHADOW }} />
        <div className="rl-split-text">
          <Eyebrow color="rgba(242,245,244,.6)">01 — Estrutura</Eyebrow>
          <SectionTitle>Uma casa.<br />Salas focadas.</SectionTitle>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: "0 0 40px", fontSize: 17, lineHeight: 1.7, color: "rgba(242,245,244,.68)" }}>
            Comunidade-mãe e subcomunidades para capítulos, comissões e projetos — cada uma com o seu feed, calendário e gestão de membros.
          </p>
          <AbcList
            pt
            items={[
              "Owners, admins, membros — permissões granulares a todos os níveis",
              "Apenas por convite, com aprovação — sem estranhos na sala",
              "Eventos com RSVPs, sondagens, ficheiros e publicações afixadas",
            ]}
          />
        </div>
      </div>
      {/* 02 — O feed principal */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden", background: "radial-gradient(ellipse 50% 60% at 80% 50%, rgba(47,145,135,.12), transparent)" }}>
        <div className="rl-split-text">
          <Eyebrow color="rgba(242,245,244,.6)">02 — O feed principal</Eyebrow>
          <SectionTitle>Toda a rede,<br />num só feed.</SectionTitle>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: "0 0 40px", fontSize: 17, lineHeight: 1.7, color: "rgba(242,245,244,.68)" }}>
            O feed principal junta as últimas 48 horas de todas as subcomunidades num só sítio — o Capítulo de Lisboa, os Empreendedores &amp; Investidores e o resto da rede — para não perderes nada sem teres de entrar sala a sala.
          </p>
          <AbcList
            pt
            items={[
              "Cada publicação identifica a subcomunidade de origem",
              "Decisões e planos ficam no feed — pesquisáveis, não enterrados no chat",
              "Histórias, destaques e sugestões de pessoas a conhecer",
            ]}
          />
        </div>
        <Phone src={feedNetwork} alt="C-Point — feed principal" width={340} height={640} style={{ borderRadius: 44, boxShadow: PT_PHONE_SHADOW }} />
      </div>
      {/* 03 — Networking */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden" }}>
        <div className="rl-phone-pair" style={{ gap: 28 }}>
          <Phone src={directoryDarkPt} alt="C-Point — diretório de membros" width={280} height={520} style={{ boxShadow: PT_PHONE_SHADOW }} />
          <Phone src={askStevePt} alt="C-Point — pergunta ao Steve quem deves conhecer" width={280} height={520} drop delay=".15s" style={{ boxShadow: PT_PHONE_SHADOW }} />
        </div>
        <div className="rl-split-text">
          <Eyebrow color="rgba(242,245,244,.6)">03 — Networking</Eyebrow>
          <SectionTitle>Conhece quem<br />deves conhecer.</SectionTitle>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(242,245,244,.68)" }}>
            A funcionalidade mais poderosa da plataforma: networking inteligente. Pergunta ao Steve quem deves conhecer — um mentor, um co-fundador, alguém perto de ti — ou explora o diretório de membros por localização, setor e interesses.
          </p>
        </div>
      </div>
      {/* 04 — Analytics */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden", background: "rgba(242,245,244,.03)" }}>
        <div className="rl-split-text">
          <Eyebrow color="rgba(242,245,244,.6)">04 — Analytics</Eyebrow>
          <SectionTitle>O pulso da comunidade,<br />num relance.</SectionTitle>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(242,245,244,.68)" }}>
            Ferramentas de owner com análises narradas pelo Steve — crescimento de membros, atividade semanal, quem dinamiza a conversa e que espaços estão vivos — para saberes como está a rede sem leres todos os threads.
          </p>
        </div>
        <Phone src={ownerTools} alt="C-Point — ferramentas de owner: análises narradas pelo Steve" width={340} height={640} style={{ borderRadius: 44, boxShadow: PT_PHONE_SHADOW }} />
      </div>
      {/* 05 — Duas interfaces */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh" }}>
        <div className="rl-split-text">
          <Eyebrow color="rgba(242,245,244,.6)">05 — Duas interfaces</Eyebrow>
          <SectionTitle>Clara ou escura.<br />Cada membro escolhe.</SectionTitle>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(242,245,244,.68)" }}>
            A app existe nas duas interfaces — as mesmas comunidades, as mesmas ferramentas, a um toque de distância. Cada membro escolhe o modo que prefere.
          </p>
        </div>
        <div className="rl-phone-pair">
          <Phone src={directoryLightPt} alt="C-Point — diretório em modo claro" />
          <Phone src={directoryDarkPt} alt="C-Point — o mesmo diretório em modo escuro" drop delay=".15s" />
        </div>
      </div>
      <StevePanel pt index="06" />
      <PlansPanels pt />
      <Cta pt />
    </>
  );
}

export default function Platform() {
  const { lang } = useLang();
  const pt = lang === "pt";
  useReveal(lang);
  useScrollToTop();
  usePageTitle(pt ? "C-Point | A Plataforma" : "C-Point | Platform");

  return (
    <div className={pt ? "rl rl--pt" : "rl"} key={lang}>
      <SiteNav active="platform" />
      {pt ? <PlatformPt /> : <PlatformEn />}
    </div>
  );
}
