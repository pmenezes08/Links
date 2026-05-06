import { Mic, MessagesSquare, ListTree, Shuffle, Globe } from "lucide-react";

const features = [
  {
    icon: MessagesSquare,
    title: "Steve in DMs & group chats",
    tagline: "Where you already talk.",
    description:
      "Message Steve one-to-one for product help or a second opinion, and bring him into group chats when the room wants context — including tagging @Steve when your plan allows.",
  },
  {
    icon: ListTree,
    title: "Steve in the feed",
    tagline: "Threads that stay readable.",
    description:
      "Use Steve on community posts and long threads so ideas stay summarised and searchable — not lost under yesterday's scroll.",
  },
  {
    icon: Mic,
    title: "Voice summaries",
    tagline: "Catch up without hitting play on everything.",
    description:
      "Voice notes can be transcribed and summarised so busy members stay in the loop when listening isn't an option.",
  },
  {
    icon: Shuffle,
    title: "Networking matches",
    tagline: "Introductions across your networks.",
    description:
      "Steve can help surface people you should meet based on roles, skills, and interests — inside the private networks you already trust.",
  },
  {
    icon: Globe,
    title: "Cross-language tone",
    tagline: "Many languages, one community spirit.",
    description:
      "Steve adapts across languages such as English, Portuguese, and Spanish so tone and nuance fit your group's culture.",
  },
];

export const MeetSteve = () => {
  return (
    <section id="steve" className="section-padding relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Meet Steve
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Intelligent presence in{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              every community.
            </span>
          </h2>
          <p className="body-lg">
            Steve isn't bolted-on support — he lives inside each private network to bridge gaps, summarise what matters, and help members connect when it makes sense.
          </p>
        </div>

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

        <div className="mt-16 text-center">
          <p className="text-lg italic text-muted-foreground">
            "Your community has a brain. His name is Steve."
          </p>
        </div>
      </div>
    </section>
  );
};
