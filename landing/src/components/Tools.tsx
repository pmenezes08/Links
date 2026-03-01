import { Calendar, BarChart3, FileText, Bell } from "lucide-react";

const tools = [
  {
    icon: Calendar,
    title: "Event Calendar & RSVPs",
    description: "Schedule events, invite members, and track RSVPs — all within your community.",
  },
  {
    icon: BarChart3,
    title: "Community Polls",
    description: "Make decisions together. Create polls, vote, and see real-time results.",
  },
  {
    icon: FileText,
    title: "Shared Documents & Links",
    description: "Centralise resources. Upload docs and curate links your community needs.",
  },
  {
    icon: Bell,
    title: "Smart Notifications",
    description: "Real-time push notifications on iOS, Android, and Web. Never miss what matters.",
  },
];

export const Tools = () => {
  return (
    <section id="tools" className="section-padding bg-muted/40">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Built-in Utility
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Everything in{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              One Place.
            </span>
          </h2>
          <p className="body-lg">
            Stop juggling multiple apps. C-Point includes integrated event RSVPs, document sharing,
            and community-wide polls to keep your network active and engaged.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {tools.map((t, i) => (
            <div
              key={i}
              className="glass-card rounded-2xl p-6 hover:shadow-elegant transition-all duration-300 group"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-4 group-hover:bg-primary/[0.14] transition-colors">
                <t.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-foreground font-semibold mb-2">{t.title}</h3>
              <p className="body-md text-sm">{t.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
