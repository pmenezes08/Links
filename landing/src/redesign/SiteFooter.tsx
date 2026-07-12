import { Link } from "react-router-dom";
import { useLang } from "@/i18n/LanguageContext";
import { LangMenu } from "./SiteNav";

type Props = {
  /** Standalone footers carry their own gutter padding; embedded ones sit inside a CTA section. */
  standalone?: boolean;
  /** Route to the same page in the other locale (legal pages use path-based locales). */
  langSwitchTo?: string;
  /** Force the label language (legal pages are localised by route, not context). */
  langOverride?: "en" | "pt";
};

export function SiteFooter({ standalone = false, langSwitchTo, langOverride }: Props) {
  const { lang } = useLang();
  const pt = (langOverride ?? lang) === "pt";

  return (
    <div className={standalone ? "rl-footer rl-footer--standalone" : "rl-footer"}>
      <span>C-Point &copy; {new Date().getFullYear()}</span>
      <div className="rl-footer-links">
        <Link to="/">{pt ? "Início" : "Home"}</Link>
        <Link to="/manifesto">Manifesto</Link>
        <Link to="/plans">{pt ? "Planos" : "Plans"}</Link>
        <Link to={pt ? "/pt/privacy" : "/privacy"}>{pt ? "Privacidade" : "Privacy"}</Link>
        <Link to={pt ? "/pt/terms" : "/terms"}>{pt ? "Termos" : "Terms"}</Link>
        <Link to="/support">{pt ? "Apoio" : "Support"}</Link>
        <Link to={pt ? "/pt/safety" : "/safety"}>{pt ? "Segurança" : "Safety"}</Link>
        <LangMenu langSwitchTo={langSwitchTo} langOverride={langOverride} up />
      </div>
    </div>
  );
}
