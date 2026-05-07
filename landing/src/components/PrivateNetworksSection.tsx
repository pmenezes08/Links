import { MessageCircle, Shield, Rss } from "lucide-react";

const painPoints = [
  {
    icon: MessageCircle,
    title: "Chat moves fast — context disappears",
    body: "Plans, links, and decisions get buried in noisy group threads. What mattered last week is hard to find today.",
  },
  {
    icon: Rss,
    title: "Noise without a memory",
    body: "Scroll-heavy feeds elsewhere mix you with the wider world. Important work inside your circle deserves its own durable layer.",
  },
  {
    icon: Shield,
    title: "Groups on someone else's map",
    body: "A private network is not the same as a group bolted onto a large public professional graph. C-Point is a global platform of invite-only networks — each with its own people, feed, and memory.",
  },
];

export function PrivateNetworksSection() {
  return (
    <section id="why-cpoint" className="section-padding bg-primary/[0.05] relative overflow-hidden">
      <div className="absolute top-1/2 right-0 w-[380px] h-[380px] bg-primary/[0.04] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Global platform of private micro-networks
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Chat for speed. Feed for{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              memory.
            </span>
          </h2>
          <p className="body-lg">
            C-Point still has direct messages and group chats for fast coordination — and a real community feed so posts, links, and decisions stay threaded and findable inside each invite-only network.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {painPoints.map((item, i) => (
            <div
              key={i}
              className="glass-card rounded-2xl p-6 hover:shadow-elegant transition-all duration-300"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-4">
                <item.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="heading-md text-foreground mb-2">{item.title}</h3>
              <p className="body-md text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
