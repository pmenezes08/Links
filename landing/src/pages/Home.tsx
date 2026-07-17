/**
 * Home — dark, cinematic, B2B-first (design_handoff_landing_redesign).
 * The EN and PT designs intentionally differ in sections and order
 * (the PT page adds Produto/Perfil/Networking phone sections and uses
 * statement bands), so each language renders its own layout below.
 */
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";
import { useParallax, usePageTitle, useReveal, useScrollToTop } from "@/redesign/hooks";
import { SiteNav } from "@/redesign/SiteNav";
import { SiteFooter } from "@/redesign/SiteFooter";
import { Phone } from "@/redesign/Phone";
import { BrandFilm } from "@/redesign/BrandFilm";
import { ANDROID_URL, APP_URL, IOS_URL, SUPPORT_EMAIL } from "@/redesign/links";
import { signupUrlWithAttribution, trackLandingEvent } from "@/lib/track";
import heroImg from "@/assets/hero-community.jpg";
import steveLogo from "@/assets/steve-logo.png";
import feedNetwork from "@/assets/screens/feed-network.jpg";
import feedCommunityPt from "@/assets/screens/feed-community-pt.jpg";
import storiesPt from "@/assets/screens/stories-pt.jpg";
import profilePersonal from "@/assets/screens/profile-personal.jpg";
import profileProfessional from "@/assets/screens/profile-professional.jpg";
import directoryDarkPt from "@/assets/screens/directory-dark-pt.jpg";
import askStevePt from "@/assets/screens/ask-steve-pt.jpg";

const INK55 = "rgba(242,245,244,.55)";
const TEAL = "#4db6ac";

const track = (cta: string) => () => trackLandingEvent("cta_click", { page: "home", cta });

function Eyebrow({ children, color = TEAL, mb = 28 }: { children: ReactNode; color?: string; mb?: number }) {
  return (
    <div data-reveal="" className="rl-eyebrow" style={{ color, marginBottom: mb }}>
      {children}
    </div>
  );
}

function FilmSection() {
  return (
    <div style={{ position: "relative", height: "100vh", background: "#05080c" }}>
      <BrandFilm />
      <div className="rl-scroll-cue" />
    </div>
  );
}

function Hero({ pt }: { pt: boolean }) {
  const parallax = useParallax();
  return (
    <div style={{ position: "relative", height: "100vh", minHeight: 720, overflow: "hidden" }}>
      <img
        src={heroImg}
        alt=""
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
          filter: `saturate(${pt ? 0.3 : 0.35})`,
          transform: `translateY(${parallax}px) scale(1.08)`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(8,19,18,.98) 0%, rgba(11,35,32,.9) 45%, rgba(14,44,40,.85) 100%)" }} />
      <div style={{ position: "absolute", left: "var(--rl-gutter)", right: "var(--rl-gutter)", bottom: 72 }}>
        <Eyebrow mb={26}>{pt ? "Comunidades privadas para as tuas pessoas" : "Private communities for your people"}</Eyebrow>
        <h1
          data-reveal=""
          style={{ transitionDelay: ".12s", margin: "0 0 40px", fontWeight: 600, fontSize: "clamp(44px, 6.8vw, 92px)", lineHeight: 1.02, letterSpacing: "-.025em", maxWidth: 1000 }}
        >
          {pt ? <>As tuas pessoas.<br />Um mundo privado.</> : <>Your people.<br />One private world.</>}
        </h1>
        <div data-reveal="" style={{ transitionDelay: ".24s", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <a href={signupUrlWithAttribution()} className="rl-btn rl-btn--primary" onClick={track("create_community_hero")}>
            {pt ? "Criar a tua comunidade" : "Create your community"}
          </a>
          <a href={pt ? "#produto" : "#product"} className="rl-btn rl-btn--ghost rl-btn--ghost-strong">
            {pt ? "Explorar" : "Explore"}
          </a>
          <span className="rl-eyebrow" style={{ letterSpacing: ".25em", color: "rgba(242,245,244,.6)", padding: "18px 10px" }}>
            iOS · Android · Web
          </span>
        </div>
      </div>
      <div className="rl-scroll-cue" />
    </div>
  );
}

function WhatIs({ pt }: { pt: boolean }) {
  const cellBorder = pt ? "1px solid rgba(242,245,244,.18)" : "1px solid rgba(242,245,244,.1)";
  const bodyColor = pt ? "rgba(242,245,244,.68)" : INK55;
  const cols = pt
    ? [
        { title: "Privado por construção", body: "Salas apenas por convite, com aprovação. Sem feeds públicos, sem estranhos, sem algoritmos a decidir o que os membros veem." },
        { title: "Com espaço para cada círculo", body: "A viagem, a equipa, o capítulo — subcomunidades sob o mesmo teto, cada uma com o seu feed, calendário e permissões." },
        { title: "Inteligente por defeito", body: "O Steve vive dentro de cada comunidade — resumos, apresentações e respostas que mantêm a rede viva sem depender só dos admins." },
      ]
    : [
        { title: "Private by design", body: "Invitation-only rooms with approval controls. No public feeds, no strangers, no algorithm deciding what your people see." },
        { title: "Room for every circle", body: "The trip, the team, the chapter — sub-communities under one umbrella, each with its own feed, calendar, and roles." },
        { title: "Intelligent by default", body: "Steve lives inside every community — summaries, introductions, and answers that keep the network warm without an admin doing it all." },
      ];
  return (
    <div className="rl-border-t rl-section-pad">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Eyebrow>{pt ? "O que é o C-Point" : "What is C-Point"}</Eyebrow>
        <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.4vw, 56px)", lineHeight: 1.06, letterSpacing: "-.02em", maxWidth: 900 }}>
          {pt ? "Uma plataforma de redes privadas — não mais uma rede social." : "A private network platform — not another social app."}
        </h2>
        <p data-reveal="" style={{ transitionDelay: ".2s", margin: "0 0 88px", fontSize: 19, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.74)" : "rgba(242,245,244,.6)", maxWidth: 680 }}>
          {pt
            ? "O C-Point dá às tuas pessoas uma casa dedicada, apenas por convite — com a estrutura de software de comunidades e os hábitos diários de uma app de mensagens, num só sítio que elas abrem de facto."
            : "C-Point gives your people a dedicated, invitation-only home — with the structure of community software and the daily habits of a messaging app, in one place they actually open."}
        </p>
        <div data-reveal="" style={{ transitionDelay: ".25s", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 0, borderTop: cellBorder }}>
          {cols.map((c, i) => (
            <div key={i} className="rl-cell" style={{ padding: i === 0 ? "36px 40px 8px 0" : i === 2 ? "36px 0 8px 40px" : "36px 40px 8px", borderRight: i < 2 ? cellBorder : undefined }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".2em", color: TEAL, marginBottom: 14 }}>0{i + 1}</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 10 }}>{c.title}</div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: bodyColor }}>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * How it works — the intended journey, spelled out: create a community or
 * join one by invite, the exclusivity model (private by default, findable
 * via a handle if the creator chooses), and the app download.
 */
function HowItWorks({ pt }: { pt: boolean }) {
  const cellBorder = pt ? "1px solid rgba(242,245,244,.18)" : "1px solid rgba(242,245,244,.1)";
  const bodyColor = pt ? "rgba(242,245,244,.68)" : INK55;
  const signupUrl = signupUrlWithAttribution();
  const steps = pt
    ? [
        { title: "Cria a tua comunidade", body: "Uma comunidade existe para ser partilhada. Cria a tua em minutos — grátis até 25 membros — define as regras e convida as tuas pessoas desde o primeiro dia: amigos, o teu grupo de alumni, o teu clube, a tua empresa." },
        { title: "Ou entra por convite", body: "Os membros entram por convite — um link ou código QR de quem criou a comunidade. Sem feeds públicos, sem estranhos: só vês as comunidades a que pertences." },
        { title: "Privada, ou encontrável", body: "Todas as comunidades são 100% privadas e invisíveis por defeito. Quem cria pode dar-lhe um handle para que as pessoas a encontrem pelo nome e peçam para entrar — a exclusividade fica nas mãos do owner." },
      ]
    : [
        { title: "Create your community", body: "A community exists to be shared. Create yours in minutes — free up to 25 members — set the rules, and invite your people from day one: friends, your alumni group, your club, your company." },
        { title: "Or join by invite", body: "Members come in through an invitation — a link or QR code from whoever created the community. No public feeds, no strangers: you only see the communities you belong to." },
        { title: "Private, or findable", body: "Every community is 100% private and unlisted by default. Creators can give theirs a handle so people can find it by name and ask to join — exclusivity stays in the owner's hands." },
      ];
  return (
    <div className="rl-border-t rl-section-pad">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Eyebrow>{pt ? "Como funciona" : "How it works"}</Eyebrow>
        <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.4vw, 56px)", lineHeight: 1.06, letterSpacing: "-.02em", maxWidth: 900 }}>
          {pt ? <>Cria o teu mundo.<br /><span style={{ color: TEAL }}>Ou junta-te a um.</span></> : <>Create your world.<br /><span style={{ color: TEAL }}>Or join one.</span></>}
        </h2>
        <p data-reveal="" style={{ transitionDelay: ".2s", margin: "0 0 72px", fontSize: 19, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.74)" : "rgba(242,245,244,.6)", maxWidth: 680 }}>
          {pt
            ? "O C-Point funciona por convite: não há feed público nem audiência à espera lá dentro. Cada comunidade começa em quem a cria — constróis o teu mundo ao convidar as tuas pessoas: os amigos, a família, a tua rede."
            : "C-Point is invitation-first: there's no public feed and no audience waiting inside. Every community starts with the person who creates it — you build your world by inviting your people in: friends, family, your network."}
        </p>
        <div data-reveal="" style={{ transitionDelay: ".25s", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 0, borderTop: cellBorder, marginBottom: 64 }}>
          {steps.map((s, i) => (
            <div key={i} className="rl-cell" style={{ padding: i === 0 ? "36px 40px 8px 0" : i === 2 ? "36px 0 8px 40px" : "36px 40px 8px", borderRight: i < 2 ? cellBorder : undefined }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".2em", color: TEAL, marginBottom: 14 }}>0{i + 1}</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 10 }}>{s.title}</div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: bodyColor }}>{s.body}</p>
            </div>
          ))}
        </div>
        <div data-reveal="" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <a href={signupUrl} className="rl-btn rl-btn--primary" onClick={track("create_community")}>
            {pt ? "Criar a tua comunidade" : "Create your community"}
          </a>
          <a href={IOS_URL} target="_blank" rel="noopener" className="rl-btn rl-btn--ghost" onClick={track("ios")}>
            {pt ? "Descarregar para iOS" : "Download for iOS"}
          </a>
          <a href={ANDROID_URL} target="_blank" rel="noopener" className="rl-btn rl-btn--ghost" onClick={track("android")}>
            {pt ? "Descarregar para Android" : "Download for Android"}
          </a>
          <span className="rl-eyebrow" style={{ letterSpacing: ".25em", color: pt ? "rgba(242,245,244,.65)" : "rgba(242,245,244,.6)", padding: "18px 10px" }}>
            iOS · Android · Web
          </span>
        </div>
      </div>
    </div>
  );
}

function SteveChat({ pt }: { pt: boolean }) {
  const band: CSSProperties = pt
    ? { background: "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(77,182,172,.14), transparent), #0e1c19", color: "#eef4f2" }
    : {};
  return (
    <div
      className="rl-border-t"
      style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "120px var(--rl-gutter)", boxSizing: "border-box", ...band,
      }}
    >
      <Eyebrow color={pt ? "rgba(238,244,242,.55)" : "rgba(242,245,244,.45)"}>{pt ? "Inteligência, lá dentro" : "Intelligence, inside"}</Eyebrow>
      <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 56px", fontWeight: 600, fontSize: "clamp(36px, 5.5vw, 72px)", lineHeight: 1.02, letterSpacing: "-.015em" }}>
        {pt ? <>Cada comunidade tem um cérebro.<br /><span style={{ color: TEAL }}>Chama-se Steve.</span></> : <>Every community has a brain.<br /><span style={{ color: TEAL }}>His name is Steve.</span></>}
      </h2>
      <div data-reveal="" style={{ transitionDelay: ".2s", width: "100%", maxWidth: 620, textAlign: "left", display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            alignSelf: "flex-end", maxWidth: "70%",
            background: pt ? "rgba(47,145,135,.12)" : "rgba(77,182,172,.14)",
            border: pt ? undefined : "1px solid rgba(77,182,172,.25)",
            borderRadius: "16px 16px 4px 16px", padding: "14px 18px", fontSize: 15, lineHeight: 1.5,
            color: pt ? "#f2f5f4" : "rgba(242,245,244,.9)",
          }}
        >
          {pt ? "@Steve o que ficou decidido sobre as datas do offsite?" : "@Steve what did we decide on the offsite dates?"}
        </div>
        <div style={{ alignSelf: "flex-start", maxWidth: "82%", display: "flex", gap: 12 }}>
          <img src={steveLogo} alt="Steve" style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }} />
          <div
            style={{
              background: pt ? "rgba(238,244,242,.08)" : "rgba(242,245,244,.05)",
              border: pt ? undefined : "1px solid rgba(242,245,244,.08)",
              borderRadius: "16px 16px 16px 4px", padding: "14px 18px", fontSize: 15, lineHeight: 1.55,
              color: pt ? "rgba(238,244,242,.8)" : "rgba(242,245,244,.75)",
              boxShadow: pt ? "0 10px 30px -12px rgba(238,244,242,.22)" : undefined,
            }}
          >
            {pt
              ? "9–11 de outubro — ficou decidido na sondagem da Ana, 14 em 18 votaram. A lista de locais da Marta está afixada nos destaques."
              : "Oct 9–11 — settled in Ana's poll, 14 of 18 voted. The venue shortlist is pinned under Key Posts."}
          </div>
        </div>
      </div>
      <p data-reveal="" style={{ transitionDelay: ".3s", margin: "56px 0 0", fontSize: 14, color: pt ? "rgba(238,244,242,.55)" : "rgba(242,245,244,.4)", maxWidth: 460, lineHeight: 1.7 }}>
        {pt ? <>Resumos, transcrição de notas de voz, apresentações.<br />Português, inglês e espanhol.</> : <>Summaries, voice-note transcripts, introductions.<br />English, Portuguese, Spanish.</>}
      </p>
    </div>
  );
}

function DualPanel({ pt }: { pt: boolean }) {
  return (
    <div className="rl-grid-2 rl-border-t" style={{ minHeight: "88vh" }}>
      <div
        className={pt ? undefined : "rl-dual-left"}
        style={{
          position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end",
          padding: "64px var(--rl-gutter)",
          borderRight: pt ? undefined : "1px solid rgba(242,245,244,.06)",
          background: pt ? "rgba(77,182,172,.08)" : undefined,
        }}
      >
        <div data-reveal="">
          <div className="rl-eyebrow" style={{ color: pt ? "rgba(238,244,242,.7)" : "rgba(242,245,244,.45)", marginBottom: 20 }}>{pt ? "01 — Pessoal" : "01 — Personal"}</div>
          <h3 style={{ margin: "0 0 18px", fontWeight: 600, fontSize: "clamp(32px, 5vw, 44px)", lineHeight: 1.04, letterSpacing: "-.02em" }}>
            {pt ? "Para o teu círculo" : "For your circle"}
          </h3>
          <p style={{ margin: "0 0 36px", fontSize: 16, lineHeight: 1.65, color: pt ? "rgba(238,244,242,.7)" : INK55, maxWidth: 400 }}>
            {pt
              ? "Amigos, família, a viagem do grupo, as pessoas que te percebem. Apenas por convite — o feed é a vossa memória partilhada."
              : "Friends, family, the group trip, the people who get you. Invitation-only — the feed is your shared memory."}
          </p>
          <a href={signupUrlWithAttribution()} className={pt ? "rl-btn rl-btn--sm rl-btn--primary" : "rl-btn rl-btn--sm rl-btn--ghost"} style={pt ? { padding: "16px 34px" } : undefined} onClick={track("start_community")}>
            {pt ? "Criar uma comunidade" : "Start a community"}
          </a>
        </div>
      </div>
      <div className={pt ? undefined : "rl-dual-right"} style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "64px var(--rl-gutter)", background: pt ? "rgba(242,245,244,.03)" : undefined }}>
        <div data-reveal="" style={{ transitionDelay: ".15s" }}>
          <div className="rl-eyebrow" style={{ color: TEAL, marginBottom: 20 }}>{pt ? "02 — Organizações e owners" : "02 — Organisations & owners"}</div>
          <h3 style={{ margin: "0 0 18px", fontWeight: 600, fontSize: "clamp(32px, 5vw, 44px)", lineHeight: 1.04, letterSpacing: "-.02em" }}>
            {pt ? "Geres uma organização?" : "Run an organisation?"}
          </h3>
          <p style={{ margin: "0 0 36px", fontSize: 16, lineHeight: 1.65, color: pt ? "rgba(242,245,244,.68)" : INK55, maxWidth: 400 }}>
            {pt
              ? "Redes de alumni, clubes, associações, empresas — salas estruturadas, análises para owners, e o Steve para a sala inteira. Vê porque é que as redes trocam o chat de grupo pelo C-Point."
              : "Alumni networks, clubs, associations, companies — structured rooms, owner analytics, and Steve for the whole room. See why networks trade the group chat for C-Point."}
          </p>
          <Link to="/organizations" className="rl-btn rl-btn--sm rl-btn--primary" onClick={track("for_organizations")}>
            {pt ? "Para organizações →" : "For organisations →"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Why({ pt }: { pt: boolean }) {
  const rowBorder = pt ? "1px solid rgba(242,245,244,.18)" : "1px solid rgba(242,245,244,.1)";
  const rows = pt
    ? [
        { k: "Os chats de grupo enterram tudo", v: "Decisões, datas e documentos desaparecem debaixo das mensagens de ontem. No C-Point, o feed mantém-nos organizados, afixados e pesquisáveis — o chat fica para o dia-a-dia." },
        { k: "As redes sociais são donas da tua audiência", v: "No LinkedIn ou nos grupos de Facebook, há um algoritmo entre ti e as tuas pessoas. Aqui a rede é tua — as tuas pessoas, as tuas regras, os teus dados, sem publicidade." },
        { k: "Os portais de membros ficam por abrir", v: "Intranets e portais morrem porque ninguém volta. O C-Point comporta-se como as apps que os teus membros já usam todos os dias — feed, chat, eventos e o Steve num só sítio." },
      ]
    : [
        { k: "Group chats bury everything", v: "Decisions, dates, and documents disappear under yesterday's messages. On C-Point the feed keeps them threaded, pinned, and searchable — chat stays for the fast stuff." },
        { k: "Social networks own your audience", v: "On LinkedIn or Facebook groups, an algorithm sits between you and your people. Here the network is yours — your people, your rules, your data, no ads." },
        { k: "Community portals go unopened", v: "Intranets and member portals die because nobody visits twice. C-Point behaves like the apps your members already use daily — feed, chat, events, and Steve in one place." },
      ];
  return (
    <div className="rl-border-t rl-section-pad">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Eyebrow color={pt ? "rgba(242,245,244,.6)" : "rgba(242,245,244,.45)"}>{pt ? "Porquê o C-Point" : "Why C-Point"}</Eyebrow>
        <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 72px", fontWeight: 600, fontSize: "clamp(30px, 4.4vw, 56px)", lineHeight: 1.06, letterSpacing: "-.02em", maxWidth: 820 }}>
          {pt ? <>A tua rede já existe.<br />Só não tem casa.</> : <>Your network already exists.<br />It just has no home.</>}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", borderTop: rowBorder }}>
          {rows.map((r, i) => (
            <div key={i} data-reveal="" className="rl-why-row" style={{ transitionDelay: `${i * 0.1}s`, borderBottom: i < rows.length - 1 ? rowBorder : undefined }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: pt ? "rgba(242,245,244,.65)" : "rgba(242,245,244,.5)" }}>{r.k}</div>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.82)" : "rgba(242,245,244,.7)" }}>{r.v}</p>
            </div>
          ))}
        </div>
        <div data-reveal="" style={{ marginTop: 56 }}>
          <Link to="/platform" className="rl-btn rl-btn--primary" style={{ padding: "17px 40px" }}>
            {pt ? "Ver a plataforma" : "See the platform"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ManifestoTeaser({ pt }: { pt: boolean }) {
  const lines = pt
    ? [
        { text: "Sem feeds públicos.", color: "#f2f5f4" },
        { text: "Sem autopromoção.", color: "rgba(242,245,244,.74)" },
        { text: "Sem ruído de algoritmos.", color: "rgba(242,245,244,.5)" },
        { text: "Sem estranhos.", color: TEAL },
      ]
    : [
        { text: "No public feeds.", color: "rgba(242,245,244,.9)" },
        { text: "No self-promotion.", color: "rgba(242,245,244,.65)" },
        { text: "No algorithmic noise.", color: "rgba(242,245,244,.4)" },
        { text: "No strangers.", color: TEAL },
      ];
  return (
    <div
      className="rl-border-t"
      style={{
        minHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "120px var(--rl-gutter)", boxSizing: "border-box",
        background: pt ? "rgba(77,182,172,.05)" : undefined,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 64 }}>
        {lines.map((l, i) => (
          <div key={i} data-reveal="" style={{ transitionDelay: `${i * 0.12}s`, fontWeight: 600, fontSize: "clamp(29px, 4.2vw, 54px)", lineHeight: 1.12, letterSpacing: pt ? "-.02em" : "-.01em", color: l.color }}>
            {l.text}
          </div>
        ))}
      </div>
      <Link data-reveal="" to="/manifesto" className="rl-btn rl-btn--ghost" style={{ transitionDelay: ".45s", padding: "17px 40px" }}>
        {pt ? "Ler o manifesto" : "Read the manifesto"}
      </Link>
    </div>
  );
}

function Cta({ pt }: { pt: boolean }) {
  const band: CSSProperties = pt
    ? { background: "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(77,182,172,.14), transparent), #0e1c19", color: "#eef4f2" }
    : { background: "radial-gradient(ellipse 60% 70% at 50% 110%, rgba(77,182,172,.14), transparent)" };
  return (
    <div className="rl-border-t" style={{ position: "relative", padding: "160px var(--rl-gutter) 44px", textAlign: "center", ...band }}>
      <h2 data-reveal="" style={{ margin: "0 0 48px", fontWeight: 600, fontSize: "clamp(38px, 5.8vw, 76px)", lineHeight: 1.04, letterSpacing: "-.025em" }}>
        {pt ? <>O teu mundo.<br /><span style={{ color: TEAL }}>Vem ligar-te a ele.</span></> : <>Your world.<br /><span style={{ color: TEAL }}>Come connect with it.</span></>}
      </h2>
      <div data-reveal="" style={{ transitionDelay: ".15s", display: "flex", gap: 14, justifyContent: "center", marginBottom: 140, flexWrap: "wrap" }}>
        <a href={signupUrlWithAttribution()} className="rl-btn rl-btn--primary" onClick={track("create_community_footer")}>
          {pt ? "Criar a tua comunidade" : "Create your community"}
        </a>
        <a href={IOS_URL} target="_blank" rel="noopener" className={pt ? "rl-btn rl-btn--ghost" : "rl-btn rl-btn--light"} onClick={track("ios")}>
          {pt ? "Descarregar para iOS" : "Download for iOS"}
        </a>
        <a href={ANDROID_URL} target="_blank" rel="noopener" className="rl-btn rl-btn--ghost" onClick={track("android")}>
          {pt ? "Descarregar para Android" : "Download for Android"}
        </a>
        <a href={APP_URL} target="_blank" rel="noopener" className="rl-btn rl-btn--ghost" onClick={track("web_app")}>
          {pt ? "Abrir app web" : "Open web app"}
        </a>
      </div>
      <SiteFooter />
    </div>
  );
}

/* ---------- PT-only sections ---------- */

function ProdutoPt() {
  return (
    <div
      id="produto"
      style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
        textAlign: "center", padding: "140px var(--rl-gutter) 0", boxSizing: "border-box", overflow: "hidden",
        background: "rgba(242,245,244,.03)",
      }}
    >
      <Eyebrow color="rgba(242,245,244,.55)">O produto</Eyebrow>
      <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 24px", fontWeight: 600, fontSize: "clamp(36px, 5.5vw, 72px)", lineHeight: 1.02, letterSpacing: "-.025em" }}>
        Chat para a rapidez.<br /><span style={{ color: TEAL }}>Feed para a memória.</span>
      </h2>
      <p data-reveal="" style={{ transitionDelay: ".2s", margin: "0 0 36px", fontSize: 19, lineHeight: 1.6, color: "rgba(242,245,244,.68)", maxWidth: 560 }}>
        Cada comunidade mantém um feed a sério — publicações, decisões e planos continuam fáceis de encontrar, em vez de enterrados no scroll.
      </p>
      <div data-reveal="" style={{ transitionDelay: ".25s", marginBottom: 72 }}>
        <Link to="/platform" className="rl-btn rl-btn--md rl-btn--ghost">Explorar a plataforma</Link>
      </div>
      <div style={{ display: "flex", gap: 40, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "center" }}>
        <Phone src={feedCommunityPt} alt="C-Point — feed da comunidade" width={360} height={540} openTop delay=".25s" style={{ boxShadow: "0 -30px 90px -30px rgba(47,145,135,.5), 0 -8px 40px -10px rgba(242,245,244,.24)" }} />
        <Phone src={storiesPt} alt="C-Point — histórias da comunidade" width={300} height={440} openTop delay=".4s" style={{ borderRadius: "40px 40px 0 0", boxShadow: "0 -30px 90px -30px rgba(47,145,135,.4), 0 -8px 40px -10px rgba(242,245,244,.2)" }} />
      </div>
    </div>
  );
}

const PT_PHONE_SHADOW = "0 40px 100px -30px rgba(47,145,135,.45), 0 10px 40px -10px rgba(242,245,244,.18)";

function PerfilPt() {
  return (
    <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden" }}>
      <div className="rl-split-text">
        <Eyebrow color="rgba(242,245,244,.55)">Identidade</Eyebrow>
        <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 24px", fontWeight: 600, fontSize: "clamp(34px, 4.8vw, 64px)", lineHeight: 1.02, letterSpacing: "-.025em" }}>
          Um perfil,<br /><span style={{ color: TEAL }}>dois lados.</span>
        </h2>
        <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 18, lineHeight: 1.7, color: "rgba(242,245,244,.68)" }}>
          O lado pessoal para o teu círculo, o lado profissional para as tuas redes — percurso, competências e formação. Tu decides o que cada comunidade vê.
        </p>
      </div>
      <div className="rl-phone-pair" style={{ gap: 28 }}>
        <Phone src={profilePersonal} alt="C-Point — perfil pessoal" width={280} height={520} style={{ boxShadow: PT_PHONE_SHADOW }} />
        <Phone src={profileProfessional} alt="C-Point — perfil profissional" width={280} height={520} drop delay=".15s" style={{ boxShadow: PT_PHONE_SHADOW }} />
      </div>
    </div>
  );
}

function NetworkingPt() {
  return (
    <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden", background: "rgba(242,245,244,.03)" }}>
      <div className="rl-phone-pair" style={{ gap: 28 }}>
        <Phone src={directoryDarkPt} alt="C-Point — diretório de membros" width={280} height={520} style={{ boxShadow: PT_PHONE_SHADOW }} />
        <Phone src={askStevePt} alt="C-Point — pergunta ao Steve quem deves conhecer" width={280} height={520} drop delay=".15s" style={{ boxShadow: PT_PHONE_SHADOW }} />
      </div>
      <div className="rl-split-text">
        <Eyebrow color="rgba(242,245,244,.55)">Networking</Eyebrow>
        <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 24px", fontWeight: 600, fontSize: "clamp(34px, 4.8vw, 64px)", lineHeight: 1.02, letterSpacing: "-.025em" }}>
          Conhece quem<br /><span style={{ color: TEAL }}>deves conhecer.</span>
        </h2>
        <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 18, lineHeight: 1.7, color: "rgba(242,245,244,.68)" }}>
          Pergunta ao Steve quem deves conhecer — um mentor, um co-fundador, alguém perto de ti — ou explora o diretório de membros por localização e setor. E partilha o momento com histórias que vivem dentro da comunidade.
        </p>
      </div>
    </div>
  );
}

/* ---------- EN-only section ---------- */

function ProductEn() {
  return (
    <div
      id="product"
      style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
        textAlign: "center", padding: "140px var(--rl-gutter) 0", boxSizing: "border-box", overflow: "hidden",
      }}
    >
      <Eyebrow color="rgba(242,245,244,.45)">The product</Eyebrow>
      <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 24px", fontWeight: 600, fontSize: "clamp(36px, 5.5vw, 72px)", lineHeight: 1.02, letterSpacing: "-.015em" }}>
        Chat for speed.<br /><span style={{ color: TEAL }}>Feed for memory.</span>
      </h2>
      <p data-reveal="" style={{ transitionDelay: ".2s", margin: "0 0 36px", fontSize: 19, lineHeight: 1.6, color: INK55, maxWidth: 560 }}>
        Every community keeps a real feed — posts, decisions, and plans stay findable, not buried in the scroll.
      </p>
      <div data-reveal="" style={{ transitionDelay: ".25s", marginBottom: 72 }}>
        <Link to="/platform" className="rl-btn rl-btn--md rl-btn--ghost">Explore the platform</Link>
      </div>
      <Phone src={feedNetwork} alt="C-Point — home timeline across your network" width={380} height={560} openTop delay=".3s" />
    </div>
  );
}

/* ---------- page ---------- */

export default function Home() {
  const { lang } = useLang();
  const pt = lang === "pt";
  useReveal(lang);
  useScrollToTop();
  usePageTitle(
    pt
      ? "C-Point | As tuas pessoas. Um mundo privado."
      : "C-Point | Your people. One private world.",
  );

  return (
    <div className={pt ? "rl rl--pt" : "rl"} key={lang}>
      <SiteNav heroGradient={!pt} />
      <FilmSection />
      <Hero pt={pt} />
      <WhatIs pt={pt} />
      <HowItWorks pt={pt} />
      <DualPanel pt={pt} />
      {pt ? (
        <>
          <ProdutoPt />
          <PerfilPt />
          <SteveChat pt />
          <NetworkingPt />
          <Why pt />
          <ManifestoTeaser pt />
          <Cta pt />
        </>
      ) : (
        <>
          <ProductEn />
          <SteveChat pt={false} />
          <Why pt={false} />
          <ManifestoTeaser pt={false} />
          <Cta pt={false} />
        </>
      )}
    </div>
  );
}
