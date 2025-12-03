import { Users, Lock, Lightbulb, Network, MessageSquare, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: Users,
    title: "Meaningful Connections",
    description: "Connect with like-minded people and expand your network through shared interests and ideas.",
  },
  {
    icon: Shield,
    title: "Privacy First",
    description: "Your conversations stay yours. Gold-standard end-to-end encryption ensures every message is protected—only you and your recipients can read them.",
  },
  {
    icon: Lock,
    title: "Exclusivity",
    description: "Build private networks tailored to your needs. Create nested communities within communities for focused, invite-only conversations.",
  },
  {
    icon: Lightbulb,
    title: "Share Ideas",
    description: "Transform your thoughts into conversations. Share insights and get valuable feedback from peers.",
  },
  {
    icon: Network,
    title: "Build Connections",
    description: "Foster relationships that matter. Network with purpose and grow your circle of connections.",
  },
  {
    icon: MessageSquare,
    title: "Engage & Collaborate",
    description: "Join discussions, collaborate on projects, and make meaningful contributions through your connections.",
  },
];

export const Features = () => {
  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Why C-Point?
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            A platform designed to facilitate genuine connections and collaborative growth through shared ideas
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card 
              key={index} 
              className="hover:shadow-elegant transition-all duration-300 hover:scale-105 animate-fade-in border-border/50"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-gradient-primary flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary-foreground" />
                </div>
                <CardTitle className="text-foreground">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-muted-foreground">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
