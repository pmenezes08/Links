import { Heart, Building2 } from "lucide-react";

const audiences = [
  {
    icon: Heart,
    label: "For your circle",
    subtitle: "Friends, family, hobbies — personal networks",
    bullets: [
      "Reconnect with your people without public feeds, algorithms, or strangers.",
      "Each community is invitation-only; the feed is shared memory for the group.",
      "Chat for day-to-day coordination; Steve when you want help with context.",
    ],
  },
  {
    icon: Building2,
    label: "For organisers & organisations",
    subtitle: "Alumni, members, staff, customers",
    bullets: [
      "Run private, invitation-only spaces for people who actually belong in the room.",
      "Structured feeds, polls, calendar-friendly workflows, and optional sub-groups under one umbrella — within your plan.",
      "Steve as the shared intelligent presence that keeps the community warm and connected.",
    ],
  },
];

export function AudiencesSection() {
  return (
    <section id="audiences" className="section-padding bg-primary/[0.02]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Who it's for
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            One platform,{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              two journeys.
            </span>
          </h2>
          <p className="body-lg">
            The same global platform hosts private networks for personal circles and for organisations that need a serious home for their people.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {audiences.map((a) => (
            <div key={a.label} className="glass-card rounded-2xl p-8 hover:shadow-elegant transition-all duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                  <a.icon className="w-5 h-5 text-primary" />
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
          ))}
        </div>
      </div>
    </section>
  );
}
