import { Button } from "@/components/ui/button";
import { Apple, Play } from "lucide-react";
import heroImage from "@/assets/hero-community.jpg";

const APP_STORE_URL = "https://apps.apple.com/us/app/cpoint/id6755534074";

export const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img
          src={heroImage}
          alt="People connecting through ideas"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-hero" />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 py-20 text-center">
        <div className="max-w-4xl mx-auto animate-fade-in">
          <h1 className="text-5xl md:text-7xl font-bold text-primary-foreground mb-6 leading-tight">
            Enter the network where ideas connect people
          </h1>
          <p className="text-xl md:text-2xl text-primary-foreground/90 mb-8 max-w-2xl mx-auto">
            C-Point brings together your communities, interests, and conversations in one place. Share ideas, spark discussions, and grow together.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              variant="hero" 
              size="lg" 
              className="text-lg"
              asChild
            >
              <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
                <Apple className="mr-2" size={24} />
                Download App
              </a>
            </Button>
            <Button variant="secondary" size="lg" className="text-lg" asChild>
              <a href="https://app.c-point.co/signup">
                Open Web App
                <Play className="mr-2" size={24} />
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 animate-bounce">
        <div className="w-6 h-10 border-2 border-primary-foreground/50 rounded-full flex items-start justify-center p-2">
          <div className="w-1.5 h-3 bg-primary-foreground/50 rounded-full" />
        </div>
      </div>
    </section>
  );
};
