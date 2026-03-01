import { useState } from "react";
import { Apple, Smartphone, MessageCircle } from "lucide-react";
import { ContactForm } from "./ContactForm";

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
    <section className="section-padding relative overflow-hidden">
      {/* Teal glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] bg-primary/[0.05] rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
          Get Started
        </p>
        <h2 className="heading-lg text-foreground mb-6">
          Ready to join the{" "}
          <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
            conversation?
          </span>
        </h2>

        {/* Audience cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10 max-w-2xl mx-auto text-left">
          {audiences.map((a, i) => (
            <div key={i} className="glass-card rounded-xl p-5">
              <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                {a.label}
              </div>
              <p className="text-sm text-muted-foreground">{a.text}</p>
            </div>
          ))}
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity shadow-lg"
          >
            <Apple size={18} />
            Download for iOS
          </a>
          <button
            onClick={() => alert('Coming soon!')}
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border border-black/10 text-foreground text-sm font-medium hover:bg-muted transition-colors cursor-pointer"
          >
            <Smartphone size={18} />
            Download for Android
          </button>
        </div>

        <button
          onClick={() => setIsFormOpen(true)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle size={16} />
          Have questions? Contact us
        </button>

        {/* Trust signal */}
        <p className="mt-12 text-xs text-muted-foreground">
          Available on iOS, Android, and Web. Secure, encrypted messaging with real-time push notifications.
        </p>
      </div>

      <ContactForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </section>
  );
};
