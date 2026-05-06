import { Apple, Laptop } from "lucide-react";
import heroBg from "@/assets/hero-community.jpg";
import { AndroidComingSoonButton } from "@/components/AndroidComingSoonButton";
import { APP_STORE_URL, APP_WEB_URL, PLATFORM_AVAILABILITY_LINE } from "@/content/siteCopy";

export const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
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
            A global platform of private networks
          </div>
        </div>

        <h1 className="heading-xl text-white mb-6 fade-in-up" style={{ animationDelay: "0.2s" }}>
          Your people.{" "}
          <span className="text-white/90 italic">Your</span> invite-only world.
        </h1>

        <p className="text-lg md:text-xl text-white/85 leading-relaxed max-w-2xl mx-auto mb-6 fade-in-up" style={{ animationDelay: "0.3s" }}>
          Stop losing decisions in chaotic group chats. C-Point gives each network its own memory — a durable feed alongside private messaging — with Steve inside every community.
        </p>

        <p className="text-sm text-white/70 max-w-xl mx-auto mb-10 fade-in-up" style={{ animationDelay: "0.38s" }}>
          {PLATFORM_AVAILABILITY_LINE}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center flex-wrap fade-in-up" style={{ animationDelay: "0.5s" }}>
          <a
            href={APP_WEB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-white text-[#2a7a72] text-sm font-semibold hover:bg-white/95 transition-colors shadow-lg"
          >
            <Laptop size={18} />
            Open web app
          </a>
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border-2 border-white bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors backdrop-blur-sm shadow-lg"
          >
            <Apple size={18} />
            Download for iOS
          </a>
          <AndroidComingSoonButton variant="hero" />
        </div>

        <p className="mt-16 text-sm text-white/60 fade-in-up" style={{ animationDelay: "0.65s" }}>
          Invitation-only communities — from alumni and associations to the circles that matter in your life.
        </p>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce z-10">
        <div className="w-5 h-8 border-2 border-white/40 rounded-full flex items-start justify-center p-1.5">
          <div className="w-1 h-2 bg-white/40 rounded-full" />
        </div>
      </div>
    </section>
  );
};
