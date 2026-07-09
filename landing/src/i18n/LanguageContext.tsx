/**
 * Site-wide EN/PT language state for the marketing pages.
 *
 * Initial language resolution order:
 *   1. `?lang=pt|pt-PT|en` URL param (lets ad final URLs force Portuguese)
 *   2. saved choice in localStorage (`cp_lang`)
 *   3. browser language (pt* → Portuguese)
 *   4. English
 *
 * The legal pages keep their own locale system (src/legal) — stable
 * App Store URLs must not depend on this context.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COPY, type Lang, type SiteCopy } from "./copy";

const STORAGE_KEY = "cp_lang";

function resolveInitialLang(): Lang {
  try {
    const param = new URLSearchParams(window.location.search).get("lang");
    if (param) {
      const p = param.toLowerCase();
      if (p === "pt" || p === "pt-pt") return "pt";
      if (p === "en") return "en";
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "pt" || saved === "en") return saved;
    if ((navigator.language || "").toLowerCase().startsWith("pt")) return "pt";
  } catch {
    /* no window/storage: default below */
  }
  return "en";
}

type LanguageValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  copy: SiteCopy;
};

const LanguageContext = createContext<LanguageValue>({
  lang: "en",
  setLang: () => {},
  copy: COPY.en,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(resolveInitialLang);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-PT" : "en";
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, copy: COPY[lang] }), [lang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Current language + the full copy tree for it. */
export function useLang(): LanguageValue {
  return useContext(LanguageContext);
}
