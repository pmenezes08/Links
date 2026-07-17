import type { CSSProperties } from "react";

type Props = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** Second phone of a pair: reveal delay + resting translateY(48px) offset. */
  drop?: boolean;
  delay?: string;
  /** Cropped at the bottom of a section (no bottom border, top radius only). */
  openTop?: boolean;
  style?: CSSProperties;
};

export function Phone({ src, alt, width = 300, height = 560, drop = false, delay, openTop = false, style }: Props) {
  return (
    <div
      data-reveal-scale=""
      className={["rl-phone", openTop ? "rl-phone--open-top" : "", drop ? "rl-phone-drop" : ""].filter(Boolean).join(" ")}
      style={{ width, transitionDelay: delay, ...style }}
    >
      <img src={src} alt={alt} style={{ height }} loading="lazy" />
    </div>
  );
}
