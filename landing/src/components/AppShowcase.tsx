import { useLang } from "@/i18n/LanguageContext";

export const AppShowcase = () => {
  const { copy } = useLang();
  const c = copy.appShowcase;

  return (
    <section id="experience" className="section-padding bg-white overflow-hidden">
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

        <div className="flex justify-center items-end gap-4 md:gap-8">
          <div className="w-[160px] sm:w-[200px] md:w-[240px] flex-shrink-0 transform -rotate-3 hover:rotate-0 transition-transform duration-500">
            <div className="rounded-[24px] overflow-hidden shadow-2xl border border-black/10">
              <img
                src="/screenshots/Dashboard.png"
                alt={c.alts.communities}
                className="w-full h-auto"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground mt-3 font-medium">{c.captions.communities}</p>
          </div>

          <div className="w-[180px] sm:w-[220px] md:w-[260px] flex-shrink-0 transform hover:scale-105 transition-transform duration-500 z-10">
            <div className="rounded-[24px] overflow-hidden shadow-2xl border border-black/10">
              <img
                src="/screenshots/profile.png"
                alt={c.alts.profile}
                className="w-full h-auto"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground mt-3 font-medium">{c.captions.profile}</p>
          </div>

          <div className="w-[160px] sm:w-[200px] md:w-[240px] flex-shrink-0 transform rotate-3 hover:rotate-0 transition-transform duration-500">
            <div className="rounded-[24px] overflow-hidden shadow-2xl border border-black/10">
              <img
                src="/screenshots/chat.jpg"
                alt={c.alts.messaging}
                className="w-full h-auto"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground mt-3 font-medium">{c.captions.messaging}</p>
          </div>
        </div>
      </div>
    </section>
  );
};
