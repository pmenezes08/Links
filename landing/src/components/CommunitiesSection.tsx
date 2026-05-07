import { Lock, Layers, Users, FolderTree } from "lucide-react";

const capabilities = [
  {
    icon: Lock,
    title: "Private by Default",
    description:
      "Invite-only communities with approval controls. Each private network stands on its own — not a tab inside a global feed for strangers.",
  },
  {
    icon: Layers,
    title: "Nested Sub-Communities",
    description:
      "Create focused sub-groups under a parent community for committees, chapters, or projects — within your plan.",
  },
  {
    icon: Users,
    title: "Group Workspaces",
    description:
      "Each group gets its own feed, calendar, photos, and member management — its own durable memory and rituals.",
  },
  {
    icon: FolderTree,
    title: "Role-Based Access",
    description: "Owners, admins, and members — clear hierarchy with granular permissions at every level.",
  },
];

export const CommunitiesSection = () => {
  return (
    <section id="communities" className="section-padding bg-primary/[0.1] relative overflow-hidden">
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Community Infrastructure
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Own Your{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              Network.
            </span>
          </h2>
          <p className="body-lg">
            One global platform hosts many private networks. Structure yours with parent and sub-communities,
            each with its own discussion feed, calendars, and resources — so focus and history stay where they belong.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {capabilities.map((c, i) => (
            <div
              key={i}
              className="glass-card rounded-2xl p-6 text-center hover:shadow-elegant transition-all duration-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/[0.08] flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/[0.14] transition-colors">
                <c.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-foreground font-semibold mb-2">{c.title}</h3>
              <p className="body-md text-sm">{c.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
