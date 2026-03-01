import { UserCircle, Briefcase, Target, Shield } from "lucide-react";

const points = [
  { icon: Briefcase, text: "Dedicated fields for role, company, and industry" },
  { icon: Target, text: "Professional interests that drive smart matchmaking" },
  { icon: UserCircle, text: "Rich bios visible across all community interactions" },
  { icon: Shield, text: "Privacy-first — you control what's shared" },
];

export const Identity = () => {
  return (
    <section className="section-padding bg-muted/40">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <div>
            <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
              Professional Identity
            </p>
            <h2 className="heading-lg text-foreground mb-4">
              Identity that{" "}
              <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Matters.
              </span>
            </h2>
            <p className="body-lg mb-8">
              Profiles built for business. Showcase your expertise with dedicated fields for your
              professional background, making it easy for members to find exactly who they need to
              talk to.
            </p>
            <div className="space-y-4">
              {points.map((p, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center flex-shrink-0">
                    <p.icon className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-foreground font-medium text-sm">{p.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: visual card */}
          <div className="glass-card rounded-2xl p-8 teal-glow">
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center text-white text-lg font-bold">
                  JP
                </div>
                <div>
                  <div className="text-foreground font-semibold">João Pereira</div>
                  <div className="text-sm text-muted-foreground">CTO · TechVentures · Lisbon</div>
                </div>
              </div>
              <div className="border-t border-black/[0.06] pt-4 space-y-3">
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Industry</div>
                  <div className="text-sm text-foreground font-medium">Technology & AI</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Interests</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {["AI/ML", "Startups", "Web3", "Leadership"].map(tag => (
                      <span key={tag} className="px-2.5 py-1 rounded-full bg-primary/[0.08] text-primary text-xs font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Bio</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Building the next generation of community tools. Previously scaled teams from 5 to 100+.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
