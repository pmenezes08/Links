import { Heart, Building2 } from "lucide-react";
import { useLang } from "@/i18n/LanguageContext";

const icons = [Heart, Building2];

export function AudiencesSection() {
  const { copy } = useLang();
  const c = copy.audiences;

  return (
    <section id="audiences" className="section-padding bg-[#4db6ac]/10">
      <div className="max-w-6xl mx-auto px-6">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {c.cards.map((a, idx) => {
            const Icon = icons[idx] ?? Heart;
            return (
              <div key={a.label} className="glass-card rounded-2xl p-8 hover:shadow-elegant transition-all duration-300">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-foreground font-semibold">{a.label}</h3>
                    <p className="text-xs text-primary font-medium">{a.subtitle}</p>
                  </div>
                </div>
                <ul className="space-y-3">
                  {a.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                      <span className="text-primary font-medium shrink-0">·</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
