import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Apple, Play, X } from "lucide-react";
import heroImage from "@/assets/hero-community.jpg";

export const Hero = () => {
  const [showPopup, setShowPopup] = useState(false);

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
            Your communities, all in one place
          </h1>
          <p className="text-xl md:text-2xl text-primary-foreground/90 mb-8 max-w-2xl mx-auto">
            Join C-Point, the platform where you can build, organize, and engage with the communities that matter to you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              variant="hero" 
              size="lg" 
              className="text-lg"
              onClick={() => setShowPopup(true)}
            >
              <Apple className="mr-2" size={24} />
              Download App
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

      {/* iOS Coming Soon Popup */}
      {showPopup && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowPopup(false)}
        >
          <div 
            className="bg-white rounded-2xl p-8 mx-4 max-w-md text-center shadow-2xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setShowPopup(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={24} />
            </button>
            <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Apple className="text-white" size={32} />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              iOS App Coming Soon!
            </h3>
            <p className="text-gray-600 mb-6">
              We're putting the finishing touches on our iOS app. In the meantime, you can use our web app for the full C-Point experience.
            </p>
            <Button 
              variant="default" 
              size="lg" 
              className="w-full bg-black hover:bg-gray-800 text-white"
              asChild
            >
              <a href="https://app.c-point.co/signup">
                Open Web App Instead
              </a>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
