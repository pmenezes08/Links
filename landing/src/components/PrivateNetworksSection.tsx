import { MessageCircle, Shield, Rss } from "lucide-react";
import { useLang } from "@/i18n/LanguageContext";

const icons = [MessageCircle, Rss, Shield];

export function PrivateNetworksSection() {
  const { copy } = useLang();
  const c = copy.privateNetworks;

  return (
    <section id="why-cpoint" className="section-padding bg-white relative overflow-hidden">
      <div className="absolute top-1/2 right-0 w-[380px] h-[380px] bg-primary/[0.04] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto mb-14">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {c.cards.map((item, i) => {
            const Icon = icons[i] ?? MessageCircle;
            return (
              <div
                key={i}
                className="glass-card rounded-2xl p-6 hover:shadow-elegant transition-all duration-300"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="heading-md text-foreground mb-2">{item.title}</h3>
                <p className="body-md text-sm text-muted-foreground">{item.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
