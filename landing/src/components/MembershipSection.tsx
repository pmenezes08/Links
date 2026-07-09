import { User, Users } from "lucide-react";
import { APP_WEB_URL, APP_SUBSCRIPTION_PATH } from "@/content/siteCopy";
import { useLang } from "@/i18n/LanguageContext";

const plansUrl = `${APP_WEB_URL}${APP_SUBSCRIPTION_PATH}`;
const icons = [User, Users];

export function MembershipSection() {
  const { copy } = useLang();
  const c = copy.membership;

  return (
    <section id="membership" className="section-padding bg-[#4db6ac]/10 relative overflow-hidden">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/[0.04] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            {c.kicker}
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            {c.h2Pre}{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              {c.h2Highlight}
            </span>
          </h2>
          <p className="body-lg">{c.intro}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-10">
          {c.cards.map((item, i) => {
            const Icon = icons[i] ?? User;
            return (
              <div key={item.title} className="glass-card rounded-2xl p-8">
                <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="heading-md text-foreground mb-2">{item.title}</h3>
                <p className="body-md text-sm text-muted-foreground">{item.body}</p>
              </div>
            );
          })}
        </div>

        <div className="text-center">
          <a
            href={plansUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-6 py-3.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity shadow-lg"
          >
            {c.cta}
          </a>
        </div>
      </div>
    </section>
  );
}
