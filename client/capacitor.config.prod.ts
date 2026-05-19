import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#000000';

/** Production mobile release — API and SPA load from app.c-point.co (not staging). */
const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C-Point',
  webDir: 'dist',
  server: {
    url: 'https://app.c-point.co',
    cleartext: false,
    allowNavigation: [
      'app.c-point.co',
      'cpoint-app-739552904126.europe-west1.run.app',
      '*.c-point.co',
    ],
  },
  backgroundColor: appBackground,
  ios: {
    preferredContentMode: 'mobile',
    backgroundColor: appBackground,
    contentInset: 'always',
    scrollEnabled: true,
  },
  plugins: {
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
  },
};

export default config;
