import { useState } from "react";
import { Apple, Smartphone, MessageCircle } from "lucide-react";
import { ContactForm } from "./ContactForm";
import heroBg from "@/assets/hero-community.jpg";

const APP_STORE_URL = "https://apps.apple.com/us/app/cpoint/id6755534074";

const audiences = [
  {
    label: "For Founders & Leaders",
    text: "Build a private home for your alumni, industry association, or mastermind group.",
  },
  {
    label: "For Professionals",
    text: "Connect with peers in a distraction-free environment where your profile actually represents your value.",
  },
];

export const CTA = () => {
  const [isFormOpen, setIsFormOpen] = useState(false);

  return (
    <section className="relative overflow-hidden">
      {/* Teal background image matching hero */}
      <div className="absolute inset-0 z-0">
        <img
          src={heroBg}
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#4db6ac]/88" />
      </div>

      <div className="relative z-10 section-padding">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-sm font-semibold text-white/70 uppercase tracking-widest mb-3">
            Get Started
          </p>
          <h2 className="heading-lg text-white mb-6">
            Ready to join the conversation?
          </h2>

          {/* Audience cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10 max-w-2xl mx-auto text-left">
            {audiences.map((a, i) => (
              <div key={i} className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-5">
                <div className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-1">
                  {a.label}
                </div>
                <p className="text-sm text-white/70">{a.text}</p>
              </div>
            ))}
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-white text-[#2a7a72] text-sm font-semibold hover:bg-white/95 transition-colors shadow-lg"
            >
              <Apple size={18} />
              Download for iOS
            </a>
            <button
              onClick={() => alert('Coming soon!')}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border-2 border-white/40 text-white text-sm font-semibold hover:bg-white/10 transition-colors backdrop-blur-sm cursor-pointer"
            >
              <Smartphone size={18} />
              Download for Android
            </button>
          </div>

          <button
            onClick={() => setIsFormOpen(true)}
            className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            <MessageCircle size={16} />
            Have questions? Contact us
          </button>

          {/* Trust signal */}
          <p className="mt-12 text-xs text-white/50">
            Available on iOS, Android, and Web. Secure, encrypted messaging with real-time push notifications.
          </p>
        </div>
      </div>

      <ContactForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </section>
  );
};
