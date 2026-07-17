import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/i18n/LanguageContext";

export function ManifestoSection() {
  const [open, setOpen] = useState(false);
  const { copy } = useLang();
  const c = copy.manifesto;

  return (
    <section id="manifesto" className="section-padding bg-[#00CEC8]/10">
      <div className="max-w-3xl mx-auto px-6">
        <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3 text-center">
          {c.kicker}
        </p>
        <h2 className="heading-lg text-foreground mb-6 text-center">
          {c.h2Pre}{" "}
          <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
            {c.h2Highlight}
          </span>
        </h2>
        <div className="space-y-4 text-center sm:text-left">
          {c.paras.map((p, i) => (
            <p key={i} className="body-lg text-muted-foreground leading-relaxed">
              {p}
            </p>
          ))}
        </div>
        <div className="mt-8 text-center">
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() => setOpen(true)}
          >
            {c.readFull}
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{c.dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto pr-1 text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
            {c.full}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
