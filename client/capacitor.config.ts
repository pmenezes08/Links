import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor profile (set before `npx cap sync`):
 *   production — app.c-point.co (store release; see capacitor.config.prod.ts)
 *   staging    — staging Cloud Run (internal QA)
 *   development — bundled webDir only (local Vite + `cap run`)
 *
 * npm scripts: cap:sync:prod | cap:sync:staging
 */
const profile = (process.env.CPOINT_CAPACITOR_PROFILE || 'staging').toLowerCase();

const appBackground = '#000000';

const stagingServer = {
  url: 'https://cpoint-app-staging-739552904126.europe-west1.run.app',
  cleartext: false,
  allowNavigation: [
    'cpoint-app-staging-739552904126.europe-west1.run.app',
    'app.c-point.co',
    '*.c-point.co',
  ],
};

const productionServer = {
  url: 'https://app.c-point.co',
  cleartext: false,
  allowNavigation: [
    'app.c-point.co',
    'cpoint-app-739552904126.europe-west1.run.app',
    '*.c-point.co',
  ],
};

const sharedPlugins: CapacitorConfig['plugins'] = {
  // Hold the (white, logo) launch splash until the web view paints its first
  // frame, then hide it from JS (main.tsx). Without this the splash auto-hides
  // before the remote SPA has loaded, exposing the bare WebView background as a
  // black flash on cold open. showSpinner:false — the in-app loader owns the
  // spinner; the splash art already carries the logo.
  SplashScreen: {
    launchAutoHide: false,
    backgroundColor: '#ffffff',
    showSpinner: false,
    launchFadeOutDuration: 250,
    androidScaleType: 'CENTER_CROP',
    splashImmersive: false,
  },
  PushNotifications: {
    presentationOptions: ['badge', 'sound', 'alert'],
  },
  Keyboard: {
    resize: 'none',
    style: 'dark',
  },
  GoogleAuth: {
    clientId: '739552904126-ini3ms8voub380vij0cgq79k1dreul5h.apps.googleusercontent.com',
    androidClientId: '739552904126-ini3ms8voub380vij0cgq79k1dreul5h.apps.googleusercontent.com',
    iosClientId: '739552904126-nb0l7j8d0p8q8q8rr84gatij5e0ip23p.apps.googleusercontent.com',
    serverClientId: '739552904126-ini3ms8voub380vij0cgq79k1dreul5h.apps.googleusercontent.com',
    scopes: ['profile', 'email'],
    forceCodeForRefreshToken: false,
  },
  Network: {},
  Filesystem: {},
};

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: profile === 'staging' ? 'C-Point (Staging)' : 'C-Point',
  webDir: 'dist',
  ...(profile === 'production'
    ? { server: productionServer }
    : profile === 'staging'
      ? { server: stagingServer }
      : {}),
  backgroundColor: appBackground,
  ios: {
    preferredContentMode: 'mobile',
    backgroundColor: appBackground,
    contentInset: 'never',
    scrollEnabled: true,
  },
  plugins: sharedPlugins,
};

export default config;
