import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Send } from "lucide-react";
import { useLang } from "@/i18n/LanguageContext";

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Using Formsubmit.co - free email forwarding service
const CONTACT_EMAIL = "support@c-point.co";

export const ContactForm = ({ open, onOpenChange }: ContactFormProps) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { copy } = useLang();
  const c = copy.contact;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Validate form
    if (!name.trim() || !email.trim() || !message.trim()) {
      toast({
        title: c.errorTitle,
        description: c.fillAll,
        variant: "destructive",
      });
      setIsSubmitting(false);
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast({
        title: c.errorTitle,
        description: c.invalidEmail,
        variant: "destructive",
      });
      setIsSubmitting(false);
      return;
    }

    try {
      // Send via Formsubmit.co (free email forwarding)
      const response = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          message,
          _subject: `C-Point Contact Form: Message from ${name}`,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      toast({
        title: c.sentTitle,
        description: c.sentDescription,
      });

      // Reset form
      setName("");
      setEmail("");
      setMessage("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: c.errorTitle,
        description: c.genericError,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-2xl">{c.title}</DialogTitle>
          <DialogDescription>{c.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="name">{c.nameLabel}</Label>
            <Input
              id="name"
              placeholder={c.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{c.emailLabel}</Label>
            <Input
              id="email"
              type="email"
              placeholder={c.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">{c.messageLabel}</Label>
            <Textarea
              id="message"
              placeholder={c.messagePlaceholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              c.sending
            ) : (
              <>
                {c.submit}
                <Send className="ml-2 w-4 h-4" />
              </>
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
