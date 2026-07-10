import { Mic, MessagesSquare, ListTree, Shuffle, Globe } from "lucide-react";
import { useLang } from "@/i18n/LanguageContext";

const icons = [MessagesSquare, ListTree, Mic, Shuffle, Globe];

export const MeetSteve = () => {
  const { copy } = useLang();
  const c = copy.steve;

  return (
    <section id="steve" className="section-padding bg-[#00CEC8]/10 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl mb-16">
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {c.cards.map((f, i) => {
            const Icon = icons[i] ?? MessagesSquare;
            return (
              <div
                key={i}
                className="glass-card rounded-2xl p-8 hover:shadow-elegant transition-all duration-300 group"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-5 group-hover:bg-primary/[0.14] transition-colors">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="heading-md text-foreground mb-1">{f.title}</h3>
                <p className="text-sm text-primary font-medium mb-3">{f.tagline}</p>
                <p className="body-md">{f.description}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <p className="text-lg italic text-muted-foreground">{c.quote}</p>
        </div>
      </div>
    </section>
  );
};
