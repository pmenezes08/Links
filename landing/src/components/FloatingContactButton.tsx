import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { ContactForm } from "./ContactForm";
import { useLang } from "@/i18n/LanguageContext";

export const FloatingContactButton = () => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { copy } = useLang();

  return (
    <>
      <Button
        onClick={() => setIsFormOpen(true)}
        className="fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full shadow-elegant hover:shadow-soft transition-all hover:scale-110"
        size="icon"
        aria-label={copy.contact.floatingAria}
      >
        <MessageCircle className="w-6 h-6" />
      </Button>
      
      <ContactForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </>
  );
};
