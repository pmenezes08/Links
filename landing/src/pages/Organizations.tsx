/**
 * For organisations (/organizations) — the revenue pitch page.
 *
 * Positions C-Point against the group chat most organisations run on today
 * (never named): threads, permanent shared memory, rich member identity,
 * events, Steve networking (flagship), Steve in the room, and — critically
 * for owners — the Steve-narrated analytics. Home stays B2C; this page is
 * where organisations and community owners convert.
 */
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";
import { usePageTitle, useReveal, useScrollToTop } from "@/redesign/hooks";
import { SiteNav } from "@/redesign/SiteNav";
import { SiteFooter } from "@/redesign/SiteFooter";
import { Phone } from "@/redesign/Phone";
import { SUPPORT_EMAIL } from "@/redesign/links";
import { signupUrlWithAttribution, trackLandingEvent } from "@/lib/track";
import steveLogo from "@/assets/steve-logo.png";
import askSteveNetworking from "@/assets/screens/ask-steve-networking.jpg";
import directoryFilters from "@/assets/screens/directory-filters.jpg";
import askStevePt from "@/assets/screens/ask-steve-pt.jpg";
import directoryDarkPt from "@/assets/screens/directory-dark-pt.jpg";
import ownerTools from "@/assets/screens/owner-tools.png";
import hiringThread from "@/assets/screens/hiring-thread.jpg";
import eventDetails from "@/assets/screens/event-details.jpg";

const TEAL = "#4db6ac";
const TALK_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("C-Point for our organisation")}`;

const COPY = {
  en: {
    title: "C-Point | For Organisations",
    eyebrow: "For organisations",
    h1: ["Your organisation deserves", "more than a group chat."],
    lead: "Alumni networks, clubs, associations, companies — most networks live in a group chat today. This is what changes when yours moves to C-Point.",
    talkToUs: "Talk to us",
    startFree: "Start free",
    problemEyebrow: "The problem",
    problemTitle: ["One endless scroll", "is not a network."],
    problemBody:
      "Right now, everything your network does drowns in a single thread. Decisions, dates, and documents sink under yesterday's messages. New members arrive as phone numbers. And the network's real value — who knows whom, who can help — stays locked in people's heads.",
    rowsEyebrow: "What changes",
    rowsTitle: ["Built like a network.", "Not a message queue."],
    rows: [
      { k: "Threads, not one scroll", v: "Every topic is its own conversation. The job opening, the event plan, and the debate each keep their thread — nothing drowns under last night's banter." },
      { k: "Nothing gets lost", v: "Posts, files, and decisions are permanent, pinned, and searchable. The feed is your network's shared memory — a member who was away for two weeks catches up in minutes." },
      { k: "You know who's in the room", v: "Rich member profiles — career, skills, interests — and a real directory. New members arrive as people, not phone numbers." },
      { k: "Events that actually happen", v: "A calendar with RSVPs and reminders, next to the conversation — not a date lost four hundred messages up." },
      { k: "Structure, not chaos", v: "Sub-communities for chapters, committees, and teams under one umbrella — each focused, with a Home Timeline so nobody misses what matters across the network." },
    ],
    startEyebrow: "How it starts",
    startTitle: ["You bring the people.", "We bring the place."],
    startBody:
      "Your community starts empty — by design. There's no public feed and no borrowed audience: you create the space, then bring in the members of your network — the alumni, the club, the association, the team. Send invite links or QR codes to people outside the platform; for people already on C-Point, just share your community's handle and they ask to join. Steve keeps the room warm once they arrive.",
    flagshipEyebrow: "The flagship — Networking",
    flagshipTitle: ["Steve finds", "the right people."],
    flagshipBody:
      "The most powerful thing a network can do is connect its members. Ask Steve who to meet — a mentor, a co-founder, a hire, someone in Lisbon next week — and he makes the introduction from real knowledge of every member's journey, skills, and interests. No group chat on earth does this.",
    steveEyebrow: "Always in the room — Steve",
    steveTitle: ["An intelligence that", "works for the room."],
    steveBody:
      "Steve isn't a bot with canned answers — he's a presence in the community. He answers questions, summarises what someone missed, transcribes voice notes, reads the documents and photos your community shares, and joins conversations when mentioned. Your network gets a concierge that never sleeps.",
    ownerEyebrow: "For owners — Analytics",
    ownerTitle: ["Know if your community", "is actually working."],
    ownerBody:
      "Owner tools with Steve-narrated analytics: member growth, weekly and monthly engagement, who's driving the conversation, which spaces are alive, and how your invites convert. A much deeper understanding of the community's health than any group chat could ever give you — so you steer with data, not gut feeling.",
    plansEyebrow: "Plans",
    plansTitle: ["Start free.", "Grow when the network does."],
    plansBody:
      "Every community starts free, up to 25 members. Paid tiers raise the cap as chapters grow, and the Steve Community Package adds one shared intelligence for the whole room.",
    viewPlans: "View plans",
    ctaTitle: ["Bring your organisation", "home."],
  },
  pt: {
    title: "C-Point | Para Organizações",
    eyebrow: "Para organizações",
    h1: ["A tua organização merece", "mais do que um chat de grupo."],
    lead: "Redes de alumni, clubes, associações, empresas — hoje, a maioria das redes vive num chat de grupo. Isto é o que muda quando a tua passa para o C-Point.",
    talkToUs: "Fala connosco",
    startFree: "Começar grátis",
    problemEyebrow: "O problema",
    problemTitle: ["Um scroll infinito", "não é uma rede."],
    problemBody:
      "Neste momento, tudo o que a tua rede faz afunda-se num único fio de mensagens. Decisões, datas e documentos desaparecem debaixo das mensagens de ontem. Os novos membros chegam como números de telefone. E o valor real da rede — quem conhece quem, quem pode ajudar — fica fechado na cabeça das pessoas.",
    rowsEyebrow: "O que muda",
    rowsTitle: ["Construído como uma rede.", "Não como uma fila de mensagens."],
    rows: [
      { k: "Threads, não um scroll único", v: "Cada tema é a sua própria conversa. A vaga de emprego, o plano do evento e o debate mantêm o seu thread — nada se afunda debaixo da conversa de ontem à noite." },
      { k: "Nada se perde", v: "Publicações, ficheiros e decisões são permanentes, afixados e pesquisáveis. O feed é a memória partilhada da rede — quem esteve fora duas semanas põe-se a par em minutos." },
      { k: "Sabes quem está na sala", v: "Perfis ricos — percurso, competências, interesses — e um diretório a sério. Os novos membros chegam como pessoas, não como números de telefone." },
      { k: "Eventos que acontecem mesmo", v: "Um calendário com RSVPs e lembretes, ao lado da conversa — não uma data perdida quatrocentas mensagens acima." },
      { k: "Estrutura, não caos", v: "Subcomunidades para capítulos, comissões e equipas sob o mesmo teto — cada uma focada, com um feed principal para ninguém perder o que importa na rede." },
    ],
    startEyebrow: "Como começa",
    startTitle: ["Tu trazes as pessoas.", "Nós trazemos o lugar."],
    startBody:
      "A tua comunidade começa vazia — de propósito. Não há feed público nem audiência emprestada: crias o espaço e trazes os membros da tua rede — os alumni, o clube, a associação, a equipa. Envia links de convite ou códigos QR a quem ainda não está na plataforma; a quem já está no C-Point, basta partilhares o handle da comunidade para pedirem entrada. O Steve mantém a sala viva depois de chegarem.",
    flagshipEyebrow: "O destaque — Networking",
    flagshipTitle: ["O Steve encontra", "as pessoas certas."],
    flagshipBody:
      "A coisa mais poderosa que uma rede pode fazer é ligar os seus membros. Pergunta ao Steve quem deves conhecer — um mentor, um co-fundador, uma contratação, alguém em Lisboa para a semana — e ele faz a apresentação com conhecimento real do percurso, competências e interesses de cada membro. Nenhum chat de grupo no mundo faz isto.",
    steveEyebrow: "Sempre na sala — Steve",
    steveTitle: ["Uma inteligência que", "trabalha para a sala."],
    steveBody:
      "O Steve não é um bot de respostas feitas — é uma presença na comunidade. Responde a perguntas, resume o que alguém perdeu, transcreve notas de voz, lê os documentos e fotos que a comunidade partilha, e entra na conversa quando é mencionado. A tua rede ganha um concierge que nunca dorme.",
    ownerEyebrow: "Para owners — Analytics",
    ownerTitle: ["Sabe se a tua comunidade", "está mesmo a funcionar."],
    ownerBody:
      "Ferramentas de owner com análises narradas pelo Steve: crescimento de membros, envolvimento semanal e mensal, quem dinamiza a conversa, que espaços estão vivos e como convertem os teus convites. Uma compreensão muito mais profunda da saúde da comunidade do que qualquer chat de grupo alguma vez te daria — para decidires com dados, não com intuição.",
    plansEyebrow: "Planos",
    plansTitle: ["Começa grátis.", "Cresce quando a rede crescer."],
    plansBody:
      "Todas as comunidades começam grátis, até 25 membros. Os planos pagos aumentam o limite à medida que os capítulos crescem, e o Steve Community Package acrescenta uma inteligência partilhada para a sala inteira.",
    viewPlans: "Ver planos",
    ctaTitle: ["Traz a tua organização", "para casa."],
  },
} as const;

function Eyebrow({ children, color = TEAL, mb = 26 }: { children: ReactNode; color?: string; mb?: number }) {
  return (
    <div data-reveal="" className="rl-eyebrow" style={{ color, marginBottom: mb }}>
      {children}
    </div>
  );
}

function TwoLine({ lines, teal = 1 }: { lines: readonly [string, string]; teal?: 0 | 1 }) {
  return (
    <>
      {teal === 0 ? <span style={{ color: TEAL }}>{lines[0]}</span> : lines[0]}
      <br />
      {teal === 1 ? <span style={{ color: TEAL }}>{lines[1]}</span> : lines[1]}
    </>
  );
}

export default function Organizations() {
  const { lang } = useLang();
  const pt = lang === "pt";
  const c = COPY[pt ? "pt" : "en"];
  useReveal(lang);
  useScrollToTop();
  usePageTitle(c.title);

  useEffect(() => {
    trackLandingEvent("lp_view", { page_path: "/organizations", lang });
  }, [lang]);

  const track = (cta: string) => () => trackLandingEvent("cta_click", { page: "organizations", cta });
  const signupUrl = signupUrlWithAttribution();
  const rowBorder = pt ? "1px solid rgba(242,245,244,.18)" : "1px solid rgba(242,245,244,.1)";
  const softInk = pt ? "rgba(242,245,244,.68)" : "rgba(242,245,244,.55)";
  const bandStyle = pt
    ? { background: "radial-gradient(ellipse 60% 55% at 50% 0%, rgba(77,182,172,.14), transparent), #0e1c19", color: "#eef4f2" }
    : {};

  return (
    <div className={pt ? "rl rl--pt" : "rl"} key={lang}>
      <SiteNav active="organizations" />

      {/* hero */}
      <div
        style={{
          minHeight: "88vh", display: "flex", flexDirection: "column", justifyContent: "flex-end",
          padding: "140px var(--rl-gutter) 88px", boxSizing: "border-box",
          background: pt
            ? "radial-gradient(ellipse 60% 50% at 80% 10%, rgba(47,145,135,.14), transparent)"
            : "radial-gradient(ellipse 60% 50% at 80% 10%, rgba(77,182,172,.08), transparent)",
        }}
      >
        <Eyebrow mb={30}>{c.eyebrow}</Eyebrow>
        <h1 data-reveal="" style={{ transitionDelay: ".12s", margin: "0 0 36px", fontWeight: 600, fontSize: "clamp(42px, 6.6vw, 88px)", lineHeight: 1.02, letterSpacing: "-.025em", maxWidth: 1060 }}>
          {c.h1[0]}
          <br />
          <span style={{ color: TEAL }}>{c.h1[1]}</span>
        </h1>
        <p data-reveal="" style={{ transitionDelay: ".22s", margin: "0 0 44px", fontSize: 19, lineHeight: 1.6, color: softInk, maxWidth: 620 }}>
          {c.lead}
        </p>
        <div data-reveal="" style={{ transitionDelay: ".3s", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a href={TALK_HREF} className="rl-btn rl-btn--md rl-btn--primary" onClick={track("talk_to_us")}>{c.talkToUs}</a>
          <a href={signupUrl} className="rl-btn rl-btn--md rl-btn--ghost" style={{ padding: "16px 38px" }} onClick={track("start_free")}>{c.startFree}</a>
        </div>
      </div>

      {/* the problem */}
      <div className="rl-border-t rl-section-pad">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <Eyebrow color={pt ? "rgba(242,245,244,.6)" : "rgba(242,245,244,.45)"}>{c.problemEyebrow}</Eyebrow>
          <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.4vw, 56px)", lineHeight: 1.06, letterSpacing: "-.02em", maxWidth: 860 }}>
            <TwoLine lines={c.problemTitle} />
          </h2>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 19, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.74)" : "rgba(242,245,244,.6)", maxWidth: 720 }}>
            {c.problemBody}
          </p>
        </div>
      </div>

      {/* contrast rows */}
      <div className="rl-border-t rl-section-pad">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <Eyebrow>{c.rowsEyebrow}</Eyebrow>
          <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 72px", fontWeight: 600, fontSize: "clamp(30px, 4.4vw, 56px)", lineHeight: 1.06, letterSpacing: "-.02em", maxWidth: 860 }}>
            <TwoLine lines={c.rowsTitle} />
          </h2>
          <div style={{ display: "flex", flexDirection: "column", borderTop: rowBorder }}>
            {c.rows.map((r, i) => (
              <div key={r.k} data-reveal="" className="rl-why-row" style={{ transitionDelay: `${Math.min(i * 0.08, 0.32)}s`, borderBottom: i < c.rows.length - 1 ? rowBorder : undefined }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: pt ? "rgba(242,245,244,.85)" : "rgba(242,245,244,.75)" }}>{r.k}</div>
                <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.78)" : "rgba(242,245,244,.65)" }}>{r.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* how it starts — the creator solves the cold start by inviting their network */}
      <div className="rl-border-t rl-section-pad" style={{ background: pt ? "rgba(77,182,172,.05)" : "rgba(77,182,172,.03)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <Eyebrow>{c.startEyebrow}</Eyebrow>
          <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.4vw, 56px)", lineHeight: 1.06, letterSpacing: "-.02em", maxWidth: 860 }}>
            <TwoLine lines={c.startTitle} />
          </h2>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 19, lineHeight: 1.7, color: pt ? "rgba(242,245,244,.74)" : "rgba(242,245,244,.6)", maxWidth: 720 }}>
            {c.startBody}
          </p>
        </div>
      </div>

      {/* flagship: Steve networking */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden", background: pt ? "rgba(242,245,244,.03)" : "radial-gradient(ellipse 50% 60% at 15% 50%, rgba(77,182,172,.08), transparent)" }}>
        <div className="rl-split-text">
          <Eyebrow mb={24}>{c.flagshipEyebrow}</Eyebrow>
          <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.2vw, 56px)", lineHeight: 1.02, letterSpacing: "-.02em" }}>
            <TwoLine lines={c.flagshipTitle} />
          </h2>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 17, lineHeight: 1.7, color: softInk }}>{c.flagshipBody}</p>
        </div>
        <div className="rl-phone-pair">
          <Phone src={pt ? askStevePt : askSteveNetworking} alt="C-Point — ask Steve who to meet" />
          <Phone src={pt ? directoryDarkPt : directoryFilters} alt="C-Point — member directory" drop delay=".15s" />
        </div>
      </div>

      {/* Steve in the room */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden" }}>
        <div className="rl-phone-pair">
          <Phone src={hiringThread} alt="C-Point — a thread where members help each other" />
          <Phone src={eventDetails} alt="C-Point — event with RSVPs" drop delay=".15s" />
        </div>
        <div className="rl-split-text">
          <img data-reveal="" src={steveLogo} alt="Steve" style={{ display: "block", width: 56, height: 56, borderRadius: "50%", marginBottom: 24, boxShadow: "0 0 40px rgba(77,182,172,.35)" }} />
          <Eyebrow mb={24} color={pt ? "rgba(242,245,244,.6)" : "rgba(242,245,244,.45)"}>{c.steveEyebrow}</Eyebrow>
          <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.2vw, 56px)", lineHeight: 1.02, letterSpacing: "-.02em" }}>
            <TwoLine lines={c.steveTitle} />
          </h2>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 17, lineHeight: 1.7, color: softInk }}>{c.steveBody}</p>
        </div>
      </div>

      {/* owner analytics — the founder-priority section */}
      <div className="rl-split rl-border-t" style={{ minHeight: "100vh", overflow: "hidden", ...bandStyle, background: pt ? (bandStyle as { background?: string }).background : "rgba(242,245,244,.02)" }}>
        <div className="rl-split-text">
          <Eyebrow mb={24}>{c.ownerEyebrow}</Eyebrow>
          <h2 data-reveal="" style={{ transitionDelay: ".1s", margin: "0 0 28px", fontWeight: 600, fontSize: "clamp(30px, 4.2vw, 56px)", lineHeight: 1.02, letterSpacing: "-.02em" }}>
            <TwoLine lines={c.ownerTitle} />
          </h2>
          <p data-reveal="" style={{ transitionDelay: ".2s", margin: 0, fontSize: 17, lineHeight: 1.7, color: pt ? "rgba(238,244,242,.72)" : softInk }}>{c.ownerBody}</p>
        </div>
        <Phone src={ownerTools} alt="C-Point — owner tools: Steve-narrated analytics" width={340} height={640} style={{ borderRadius: 44 }} />
      </div>

      {/* plans strip + CTA */}
      <div className="rl-border-t" style={{ padding: "150px var(--rl-gutter) 44px", textAlign: "center", background: "radial-gradient(ellipse 60% 70% at 50% 110%, rgba(77,182,172,.14), transparent)" }}>
        <Eyebrow>{c.plansEyebrow}</Eyebrow>
        <h2 data-reveal="" style={{ transitionDelay: ".08s", margin: "0 0 24px", fontWeight: 600, fontSize: "clamp(34px, 5vw, 64px)", lineHeight: 1.02, letterSpacing: "-.025em" }}>
          <TwoLine lines={c.plansTitle} />
        </h2>
        <p data-reveal="" style={{ transitionDelay: ".16s", margin: "0 auto 56px", fontSize: 17, lineHeight: 1.7, color: softInk, maxWidth: 620 }}>{c.plansBody}</p>
        <h2 data-reveal="" style={{ margin: "96px 0 44px", fontWeight: 600, fontSize: "clamp(36px, 5.4vw, 72px)", lineHeight: 1.02, letterSpacing: "-.025em" }}>
          <TwoLine lines={c.ctaTitle} />
        </h2>
        <div data-reveal="" style={{ transitionDelay: ".1s", display: "flex", gap: 14, justifyContent: "center", marginBottom: 130, flexWrap: "wrap" }}>
          <a href={TALK_HREF} className="rl-btn rl-btn--primary" onClick={track("talk_to_us_footer")}>{c.talkToUs}</a>
          <a href={signupUrl} className="rl-btn rl-btn--ghost" onClick={track("start_free_footer")}>{c.startFree}</a>
          <Link to="/plans" className="rl-btn rl-btn--ghost">{c.viewPlans}</Link>
        </div>
        <SiteFooter />
      </div>
    </div>
  );
}
