import { UserCircle, Briefcase, Target, Shield } from "lucide-react";
import { useLang } from "@/i18n/LanguageContext";

const pointIcons = [Briefcase, Target, UserCircle, Shield];

export const Identity = () => {
  const { copy } = useLang();
  const c = copy.identity;

  return (
    <section className="section-padding bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
              {c.kicker}
            </p>
            <h2 className="heading-lg text-foreground mb-4">
              {c.h2Pre}{" "}
              <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                {c.h2Highlight}
              </span>
            </h2>
            <p className="body-lg mb-8">{c.intro}</p>
            <div className="space-y-4">
              {c.points.map((text, i) => {
                const Icon = pointIcons[i] ?? Briefcase;
                return (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <p className="text-foreground font-medium text-sm">{text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-card rounded-2xl p-8 teal-glow">
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center text-white text-lg font-bold">
                  JP
                </div>
                <div>
                  <div className="text-foreground font-semibold">João Pereira</div>
                  <div className="text-sm text-muted-foreground">{c.profile.role}</div>
                </div>
              </div>
              <div className="border-t border-black/[0.06] pt-4 space-y-3">
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{c.profile.industryLabel}</div>
                  <div className="text-sm text-foreground font-medium">{c.profile.industry}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{c.profile.interestsLabel}</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {["AI/ML", "Startups", "Web3", "Leadership"].map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-1 rounded-full bg-primary/[0.08] text-primary text-xs font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{c.profile.bioLabel}</div>
                  <div className="text-sm text-muted-foreground mt-1">{c.profile.bio}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
