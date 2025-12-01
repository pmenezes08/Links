import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { ContactForm } from "./ContactForm";

export const FloatingContactButton = () => {
  const [isFormOpen, setIsFormOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsFormOpen(true)}
        className="fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full shadow-elegant hover:shadow-soft transition-all hover:scale-110"
        size="icon"
        aria-label="Contact us"
      >
        <MessageCircle className="w-6 h-6" />
      </Button>
      
      <ContactForm open={isFormOpen} onOpenChange={setIsFormOpen} />
    </>
  );
};
