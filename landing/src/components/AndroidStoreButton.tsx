import { Smartphone } from "lucide-react";
import { androidStoreLabel, PLAY_STORE_URL } from "@/content/siteCopy";
import { cn } from "@/lib/utils";

type Props = {
  /** Hero: light border on teal. CTA: muted border. */
  variant?: "hero" | "muted";
  className?: string;
};

export function AndroidStoreButton({ variant = "muted", className }: Props) {
  const base =
    variant === "hero"
      ? "border-2 border-white bg-white/10 text-white hover:bg-white/20 shadow-lg"
      : "border border-black/15 text-foreground hover:bg-muted";

  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={androidStoreLabel}
      className={cn(
        "inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-semibold backdrop-blur-sm transition-colors",
        base,
        className,
      )}
    >
      <Smartphone size={18} />
      Get for Android
    </a>
  );
}
