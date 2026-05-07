import {
  Calendar,
  BarChart3,
  FileText,
  Bell,
  ListChecks,
  Link2,
  Pin,
} from "lucide-react";
import { PLATFORM_AVAILABILITY_LINE } from "@/content/siteCopy";

const tools = [
  {
    icon: Calendar,
    title: "Event Calendar & RSVPs",
    description: "Schedule events, invite members, and track RSVPs — all within your community.",
  },
  {
    icon: BarChart3,
    title: "Community Polls",
    description: "Make decisions together. Create polls, vote, and see results in context.",
  },
  {
    icon: FileText,
    title: "Shared Documents & Resources",
    description: "Centralise files and resources your community needs — next to the conversation.",
  },
  {
    icon: ListChecks,
    title: "Tasks",
    description: "Track what needs doing inside a community so commitments don't vanish into chat.",
  },
  {
    icon: Link2,
    title: "Useful Links",
    description: "Curate links the group relies on — one place instead of re-pasting in threads.",
  },
  {
    icon: Pin,
    title: "Key Posts",
    description: "Surface important announcements or reference posts so new members land on what matters.",
  },
  {
    icon: Bell,
    title: "Notifications",
    description: `Stay in the loop with real-time alerts where supported. ${PLATFORM_AVAILABILITY_LINE}`,
  },
];

export const Tools = () => {
  return (
    <section id="tools" className="section-padding bg-primary/[0.05]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Tools for every micro-network
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Everything in{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              One Place.
            </span>
          </h2>
          <p className="body-lg">
            Fewer detached tools: events, polls, files, tasks, links, and highlights — alongside chat and your community feed.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
