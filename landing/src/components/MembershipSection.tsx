import { User, Users } from "lucide-react";
import { APP_WEB_URL, APP_SUBSCRIPTION_PATH } from "@/content/siteCopy";

const plansUrl = `${APP_WEB_URL}${APP_SUBSCRIPTION_PATH}`;

const items = [
  {
    icon: User,
    title: "Personal membership",
    body: "Premium on your account unlocks Steve for you across the private spaces you’re part of — deeper context and features tied to your membership. Current plans and allowances are always shown in the app.",
  },
  {
    icon: Users,
    title: "Community-level Steve",
    body: "Paid communities can add a shared Steve allowance so everyone in that space gets more from the same intelligent presence. Availability and billing details are configured in community settings in-app.",
  },
];

export function MembershipSection() {
  return (
    <section id="membership" className="section-padding bg-primary/[0.1] relative overflow-hidden">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/[0.04] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            Membership
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Plans for{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              people & communities.
            </span>
          </h2>
          <p className="body-lg">
            We don’t put stale prices on a static page — open the app for up-to-date plans, caps, and billing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-10">
          {items.map((item) => (
            <div key={item.title} className="glass-card rounded-2xl p-8">
              <div className="w-11 h-11 rounded-xl bg-primary/[0.08] flex items-center justify-center mb-4">
                <item.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="heading-md text-foreground mb-2">{item.title}</h3>
              <p className="body-md text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <a
            href={plansUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-6 py-3.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity shadow-lg"
          >
            View plans in the app
          </a>
        </div>
      </div>
    </section>
  );
}
