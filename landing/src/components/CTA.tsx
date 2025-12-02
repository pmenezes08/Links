import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export const CTA = () => {
  return (
    <section className="py-20 bg-gradient-primary relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-96 h-96 bg-primary-foreground rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-primary-foreground rounded-full blur-3xl" />
      </div>
      
      <div className="container mx-auto px-4 text-center relative z-10">
        <div className="max-w-3xl mx-auto animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-bold text-primary-foreground mb-6">
            Ready to join the conversation?
          </h2>
          <p className="text-xl text-primary-foreground/90 mb-8">
            Be part of a network where your ideas matter and connections lead to opportunities.
          </p>
          <Button variant="secondary" size="lg" className="text-lg shadow-soft" asChild>
            <a href="https://app.c-point.co/signup">
              Get Started Today
              <ArrowRight className="ml-2" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
};
