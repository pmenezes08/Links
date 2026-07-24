/**
 * Support (/support) — design_handoff_landing_redesign, "C-Point Support"
 * prototypes. FAQ + contact form; the form submits via mailto to
 * support@c-point.co with the selected subject.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";
import { usePageTitle, useScrollToTop } from "@/redesign/hooks";
import { SiteNav } from "@/redesign/SiteNav";
import { SiteFooter } from "@/redesign/SiteFooter";
import { SUPPORT_EMAIL } from "@/redesign/links";

const TEAL = "#4db6ac";

const COPY = {
  en: {
    title: "C-Point | Support",
    eyebrow: "Help",
    h1: "Support",
    lead: "We're here to help. Get in touch with us.",
    contactTitle: "Contact us",
    email: "Email",
    emailNote: "We typically respond within 24 hours.",
    appIssues: "App issues",
    appIssuesNote: "For technical issues with the iOS app, please include your device model and iOS version.",
    safety: "Safety",
    safetyBefore: "Report content or safety concerns — see ",
    safetyLink: "Safety Standards",
    safetyPath: "/safety",
    faqTitle: "Frequently asked questions",
    faqs: [
      { q: "How do I create a community?", a: 'Tap the "+" button on the Communities tab, fill in your community details, and invite members using the QR code or share link.' },
      { q: "How do I delete my account?", a: "Go to Settings → Account → Delete Account. This will permanently delete your account and all associated data. This action cannot be undone." },
      { q: "How do I report inappropriate content?", a: 'Long-press on any post or message and select "Report" from the menu. Our team reviews all reports within 24 hours.' },
      { q: "Why am I not receiving notifications?", a: "Make sure notifications are enabled in your iPhone Settings → C-Point → Notifications. Also check that Do Not Disturb is turned off." },
      { q: "How do I change my username?", a: "Go to your Profile → Edit Profile → tap on your username to change it. Note: usernames must be unique." },
    ],
    formTitle: "Send us a message",
    name: "Name",
    namePh: "Your name",
    emailPh: "your@email.com",
    subject: "Subject",
    subjectPh: "Select a topic",
    subjects: ["Technical Issue", "Account Help", "Report Content", "Feature Request", "Privacy Concern", "Other"],
    message: "Message",
    messagePh: "Describe your issue or question...",
    send: "Send message",
    sent: "Message sent — opening your email app",
  },
  pt: {
    title: "C-Point | Apoio",
    eyebrow: "Ajuda",
    h1: "Apoio",
    lead: "Estamos aqui para ajudar. Fala connosco.",
    contactTitle: "Contacta-nos",
    email: "Email",
    emailNote: "Normalmente respondemos em 24 horas.",
    appIssues: "Problemas na app",
    appIssuesNote: "Para problemas técnicos com a app iOS, inclui o modelo do dispositivo e a versão de iOS.",
    safety: "Segurança",
    safetyBefore: "Reportar conteúdo ou preocupações de segurança — ver ",
    safetyLink: "Normas de Segurança",
    safetyPath: "/pt/safety",
    faqTitle: "Perguntas frequentes",
    faqs: [
      { q: "Como crio uma comunidade?", a: 'Toca no botão "+" no separador Comunidades, preenche os detalhes da tua comunidade e convida membros com o código QR ou o link de partilha.' },
      { q: "Como apago a minha conta?", a: "Vai a Definições → Conta → Apagar conta. Isto apaga permanentemente a tua conta e todos os dados associados. Esta ação não pode ser anulada." },
      { q: "Como denuncio conteúdo inadequado?", a: 'Mantém premida qualquer publicação ou mensagem e seleciona "Denunciar" no menu. A nossa equipa analisa todas as denúncias em 24 horas.' },
      { q: "Porque não recebo notificações?", a: "Confirma que as notificações estão ativas em Definições do iPhone → C-Point → Notificações. Verifica também que o modo Não Incomodar está desligado." },
      { q: "Como mudo o meu nome de utilizador?", a: "Vai ao teu Perfil → Editar perfil → toca no nome de utilizador para o alterar. Nota: os nomes de utilizador têm de ser únicos." },
    ],
    formTitle: "Envia-nos uma mensagem",
    name: "Nome",
    namePh: "O teu nome",
    emailPh: "o-teu@email.com",
    subject: "Assunto",
    subjectPh: "Escolhe um tema",
    subjects: ["Problema técnico", "Ajuda com a conta", "Denunciar conteúdo", "Sugestão de funcionalidade", "Questão de privacidade", "Outro"],
    message: "Mensagem",
    messagePh: "Descreve o teu problema ou questão...",
    send: "Enviar mensagem",
    sent: "Mensagem enviada — a abrir a tua app de email",
  },
} as const;

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8, color: "rgba(242,245,244,.7)" } as const;
const h2Style = { margin: "0 0 28px", fontWeight: 600, fontSize: 24, letterSpacing: "-.01em" } as const;

export default function Support() {
  const { lang } = useLang();
  const pt = lang === "pt";
  const c = COPY[pt ? "pt" : "en"];
  const [sent, setSent] = useState(false);
  useScrollToTop();
  usePageTitle(c.title);

  const rowBorder = `1px solid rgba(242,245,244,${pt ? ".18" : ".1"})`;
  const noteColor = pt ? "rgba(242,245,244,.78)" : "rgba(242,245,244,.65)";

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const body = `Name: ${data.get("name")}\nEmail: ${data.get("email")}\n\n${data.get("message")}`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(String(data.get("subject")))}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <div className={pt ? "rl rl--pt" : "rl"} key={lang}>
      <SiteNav variant="solid" />

      <div style={{ padding: "180px var(--rl-gutter) 120px", maxWidth: 1060, margin: "0 auto" }}>
        <div className="rl-eyebrow" style={{ color: TEAL, marginBottom: 28 }}>{c.eyebrow}</div>
        <h1 style={{ margin: "0 0 16px", fontWeight: 600, fontSize: "clamp(34px, 5.5vw, 64px)", lineHeight: 1.04, letterSpacing: "-.02em" }}>{c.h1}</h1>
        <p style={{ margin: "0 0 80px", fontSize: 17, lineHeight: 1.6, color: pt ? "rgba(242,245,244,.68)" : "rgba(242,245,244,.55)" }}>{c.lead}</p>

        <div className="rl-support-grid">
          <div>
            <h2 style={h2Style}>{c.contactTitle}</h2>
            <div style={{ display: "flex", flexDirection: "column", borderTop: rowBorder, marginBottom: 64 }}>
              <div className="rl-support-row" style={{ borderBottom: rowBorder }}>
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: TEAL }}>{c.email}</div>
                <div style={{ fontSize: 15.5, lineHeight: 1.65, color: noteColor }}>
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: TEAL }}>{SUPPORT_EMAIL}</a>
                  <br />
                  {c.emailNote}
                </div>
              </div>
              <div className="rl-support-row" style={{ borderBottom: rowBorder }}>
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: TEAL }}>{c.appIssues}</div>
                <div style={{ fontSize: 15.5, lineHeight: 1.65, color: noteColor }}>{c.appIssuesNote}</div>
              </div>
              <div className="rl-support-row">
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".2em", textTransform: "uppercase", color: TEAL }}>{c.safety}</div>
                <div style={{ fontSize: 15.5, lineHeight: 1.65, color: noteColor }}>
                  {c.safetyBefore}
                  <Link to={c.safetyPath} style={{ color: TEAL }}>{c.safetyLink}</Link>.
                </div>
              </div>
            </div>

            <h2 style={{ ...h2Style, marginBottom: 20 }}>{c.faqTitle}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {c.faqs.map((f) => (
                <details key={f.q} className="rl-faq">
                  <summary>{f.q}</summary>
                  <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: pt ? "rgba(242,245,244,.74)" : "rgba(242,245,244,.6)" }}>{f.a}</p>
                </details>
              ))}
            </div>
          </div>

          <div>
            <h2 style={h2Style}>{c.formTitle}</h2>
            {/* data-clarity-mask: never let session recordings capture typed contact details */}
            <form onSubmit={onSubmit} data-clarity-mask="true" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label htmlFor="sp-name" style={labelStyle}>{c.name}</label>
                <input id="sp-name" name="name" type="text" required placeholder={c.namePh} className="rl-field" autoComplete="name" />
              </div>
              <div>
                <label htmlFor="sp-email" style={labelStyle}>{c.email}</label>
                <input id="sp-email" name="email" type="email" required placeholder={c.emailPh} className="rl-field" autoComplete="email" inputMode="email" />
              </div>
              <div>
                <label htmlFor="sp-subject" style={labelStyle}>{c.subject}</label>
                <select id="sp-subject" name="subject" required defaultValue="" className="rl-field">
                  <option value="" disabled>{c.subjectPh}</option>
                  {c.subjects.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sp-message" style={labelStyle}>{c.message}</label>
                <textarea id="sp-message" name="message" required rows={5} placeholder={c.messagePh} className="rl-field" style={{ resize: "none" }} />
              </div>
              <button
                type="submit"
                style={{
                  fontSize: 12, fontWeight: 600, letterSpacing: ".25em", textTransform: "uppercase",
                  background: TEAL, color: "#0a0d0d", border: "none", padding: "17px 0",
                  borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {sent ? c.sent : c.send}
              </button>
            </form>
          </div>
        </div>
      </div>

      <SiteFooter standalone />
    </div>
  );
}
