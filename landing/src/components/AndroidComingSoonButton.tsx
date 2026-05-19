import { Smartphone } from "lucide-react";
import { androidComingSoonLabel } from "@/content/siteCopy";
import { cn } from "@/lib/utils";

type Props = {
  /** Hero: light border on teal. CTA: muted border. */
  variant?: "hero" | "muted";
  className?: string;
};

/**
 * Android is not published on Google Play yet — non-interactive CTA with clear affordance.
 */
export function AndroidComingSoonButton({ variant = "muted", className }: Props) {
  const base =
    variant === "hero"
      ? "border-2 border-white/40 text-white/90 cursor-not-allowed opacity-90"
      : "border border-black/10 text-muted-foreground cursor-not-allowed opacity-90";

  return (
    <span
      role="button"
      aria-disabled="true"
      title={androidComingSoonLabel}
      className={cn(
        "inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-semibold backdrop-blur-sm select-none",
        base,
        className,
      )}
    >
      <Smartphone size={18} />
      Android — coming soon
    </span>
  );
}
