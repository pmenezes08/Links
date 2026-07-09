import { Lock, Layers, Users, FolderTree } from "lucide-react";
import { useLang } from "@/i18n/LanguageContext";

const icons = [Lock, Layers, Users, FolderTree];

export const CommunitiesSection = () => {
  const { copy } = useLang();
  const c = copy.communities;

  return (
    <section id="communities" className="section-padding bg-[#4db6ac]/10 relative overflow-hidden">
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {c.cards.map((card, i) => {
            const Icon = icons[i] ?? Lock;
            return (
              <div
                key={i}
                className="glass-card rounded-2xl p-6 text-center hover:shadow-elegant transition-all duration-300 group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/[0.08] flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/[0.14] transition-colors">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-foreground font-semibold mb-2">{card.title}</h3>
                <p className="body-md text-sm">{card.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
