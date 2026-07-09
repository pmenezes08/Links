import {
  Calendar,
  BarChart3,
  FileText,
  Bell,
  ListChecks,
  Link2,
  Pin,
} from "lucide-react";
import { useLang } from "@/i18n/LanguageContext";

const icons = [Calendar, BarChart3, FileText, ListChecks, Link2, Pin, Bell];

export const Tools = () => {
  const { copy } = useLang();
  const c = copy.tools;

  return (
    <section id="tools" className="section-padding bg-white">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {c.cards.map((t, i) => {
            const Icon = icons[i] ?? Calendar;
            return (
              <div
                key={i}
                className="glass-card rounded-2xl p-6 hover:shadow-elegant transition-all duration-300 group"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-4 group-hover:bg-primary/[0.14] transition-colors">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-foreground font-semibold mb-2">{t.title}</h3>
                <p className="body-md text-sm">{t.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
