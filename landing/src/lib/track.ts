declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

type LandingEvent = "lp_view" | "cta_click";

export function trackLandingEvent(
  event: LandingEvent,
  params: Record<string, string>,
): void {
  try {
    window.gtag?.("event", event, params);
  } catch {
    // Acquisition analytics must never interrupt navigation.
  }
}

/**
 * Route through www so the existing Flask /signup redirect forwards the
 * complete Google Ads query string to app.c-point.co.
 */
export function signupUrlWithAttribution(): string {
  try {
    return `/signup${window.location.search}`;
  } catch {
    return "/signup";
  }
}
