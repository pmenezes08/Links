import { useEffect, useState } from "react";

/**
 * Scroll-reveal for [data-reveal] / [data-reveal-scale] elements
 * (adds .rv-in once, IntersectionObserver threshold 0.12, one-shot).
 * prefers-reduced-motion users see everything immediately via CSS.
 */
export function useReveal(dep?: unknown): void {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("rv-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    const observe = () =>
      document
        .querySelectorAll("[data-reveal]:not(.rv-in),[data-reveal-scale]:not(.rv-in)")
        .forEach((el) => io.observe(el));
    observe();
    // late-mounting content (images, lazy sections) gets a second pass
    const retry = window.setTimeout(observe, 900);
    return () => {
      io.disconnect();
      window.clearTimeout(retry);
    };
  }, [dep]);
}

/** True once the page is scrolled past 60px (nav background swap). */
export function useScrolled(threshold = 60): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/** Hero parallax offset: min(120, scrollY * 0.25), 0 for reduced-motion users. */
export function useParallax(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setOffset(Math.min(120, window.scrollY * 0.25)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return offset;
}

/**
 * Overrides the document chrome colour (html/body background + theme-color
 * meta) while a page is mounted. The document defaults to the dark marketing
 * background (inline styles in index.html); the remaining light pages call
 * this with white so iOS/Android safe areas and overscroll match them.
 */
export function usePageChrome(color: string): void {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    html.style.background = color;
    body.style.background = color;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = meta?.content;
    if (meta) meta.content = color;
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
      if (meta && prevTheme !== undefined) meta.content = prevTheme;
    };
  }, [color]);
}

/** Sets document.title while the page is mounted. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** Scrolls to top when a redesigned page mounts (router keeps scroll otherwise). */
export function useScrollToTop(): void {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}
