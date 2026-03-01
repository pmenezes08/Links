import { Apple, ArrowRight } from "lucide-react";
import heroBg from "@/assets/hero-community.jpg";

const APP_STORE_URL = "https://apps.apple.com/us/app/cpoint/id6755534074";

export const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Background image with teal overlay */}
      <div className="absolute inset-0 z-0">
        <img
          src={heroBg}
          alt="People connecting"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#4db6ac]/85" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        <div className="fade-in-up" style={{ animationDelay: "0.1s" }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/25 bg-white/10 backdrop-blur-sm text-white text-sm font-medium mb-8">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            AI-Powered Networking Platform
          </div>
        </div>

        <h1 className="heading-xl text-white mb-6 fade-in-up" style={{ animationDelay: "0.2s" }}>
          Enter the network where ideas{" "}
          <span className="text-white/90 italic">connect</span>{" "}
          people
        </h1>

        <p className="text-lg md:text-xl text-white/85 leading-relaxed max-w-2xl mx-auto mb-10 fade-in-up" style={{ animationDelay: "0.35s" }}>
          A high-signal networking platform designed for private communities to connect,
          collaborate, and grow.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center fade-in-up" style={{ animationDelay: "0.5s" }}>
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-white text-[#2a7a72] text-sm font-semibold hover:bg-white/95 transition-colors shadow-lg"
          >
            <Apple size={18} />
            Download for iOS
          </a>
          <a
            href="https://app.c-point.co/signup"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border-2 border-white/40 text-white text-sm font-semibold hover:bg-white/10 transition-colors backdrop-blur-sm"
          >
            Launch Your Community
            <ArrowRight size={16} />
          </a>
        </div>

        <p className="mt-16 text-sm text-white/60 fade-in-up" style={{ animationDelay: "0.65s" }}>
          Trusted by founders, alumni networks, and professional communities.
        </p>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce z-10">
        <div className="w-5 h-8 border-2 border-white/40 rounded-full flex items-start justify-center p-1.5">
          <div className="w-1 h-2 bg-white/40 rounded-full" />
        </div>
      </div>
    </section>
  );
};
