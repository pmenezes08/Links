import { Mic, Brain, Shuffle, Globe } from "lucide-react";

const features = [
  {
    icon: Mic,
    title: "Instant Voice Summaries",
    tagline: "Never miss a beat, even when you're busy.",
    description:
      "Send or receive voice notes and let Steve do the heavy lifting. Steve automatically generates high-level summaries of every audio message, so you can stay in the loop without listening to every second.",
  },
  {
    icon: Brain,
    title: "Conversation Intelligence",
    tagline: "An AI that actually reads the room.",
    description:
      "Steve follows the flow of your group chats, understands context, and provides real-time inputs. Tag @Steve to settle a debate, pull live web data, or get a professional analysis on the topic at hand.",
  },
  {
    icon: Shuffle,
    title: "Proactive Matchmaking",
    tagline: "Networking on Autopilot.",
    description:
      "Steve studies member profiles — skills, roles, and interests — to proactively facilitate connections. He identifies synergies and introduces members who should be talking to each other.",
  },
  {
    icon: Globe,
    title: "Cross-Language Fluency",
    tagline: "Global Connectivity, Local Nuance.",
    description:
      "Steve is a polyglot. Whether your community speaks English, Portuguese, or Spanish, Steve adapts his tone and dialect to match the group's culture, ensuring nothing is lost in translation.",
  },
];

export const MeetSteve = () => {
  return (
    <section id="networking" className="section-padding relative overflow-hidden">
      {/* Background accent */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="max-w-2xl mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Meet Steve
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Networking that{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              Thinks.
            </span>
          </h2>
          <p className="body-lg">
            Most platforms give you a directory. C.Point gives you Steve — an advanced AI that lives
            inside your community to bridge gaps, summarize insights, and drive engagement.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="glass-card rounded-2xl p-8 hover:shadow-elegant transition-all duration-300 group"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-5 group-hover:bg-primary/[0.14] transition-colors">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="heading-md text-foreground mb-1">{f.title}</h3>
              <p className="text-sm text-primary font-medium mb-3">{f.tagline}</p>
              <p className="body-md">{f.description}</p>
            </div>
          ))}
        </div>

        {/* Tagline */}
        <div className="mt-16 text-center">
          <p className="text-lg italic text-muted-foreground">
            "Your community has a brain. His name is Steve."
          </p>
        </div>
      </div>
    </section>
  );
};
