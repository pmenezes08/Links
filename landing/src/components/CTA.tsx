import { useState } from "react";
import { Apple, Laptop, MessageCircle } from "lucide-react";
import { ContactForm } from "./ContactForm";
import { AndroidStoreButton } from "@/components/AndroidStoreButton";
import { APP_STORE_URL, APP_WEB_URL } from "@/content/siteCopy";
import { useLang } from "@/i18n/LanguageContext";

export const CTA = () => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { copy } = useLang();
  const c = copy.cta;

  return (
    <section className="section-padding relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] bg-primary/[0.05] rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
          {c.kicker}
        </p>
        <h2 className="heading-lg text-foreground mb-6">
          {c.h2Pre}{" "}
          <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
            {c.h2Highlight}
          </span>
        </h2>

        <p className="text-sm text-muted-foreground mb-10 max-w-lg mx-auto">
          {c.availability}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center flex-wrap mb-8">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border border-black/15 text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <Apple size={18} />
            {c.downloadIos}
          </a>
          <AndroidStoreButton variant="muted" />
          <a
            href={APP_WEB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity shadow-lg"
          >
            <Laptop size={18} />
            {c.openWebApp}
          </a>
        </div>

        <button
          type="button"
          onClick={() => setIsFormOpen(true)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle size={16} />
          {c.contact}
        </button>

        <p className="mt-12 text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
          {c.push}
        </p>
      </div>

      <ContactForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </section>
  );
};
