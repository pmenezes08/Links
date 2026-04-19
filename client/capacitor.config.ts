import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#000000';

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C-Point',
  webDir: 'dist',
  server: {
    url: 'https://app.c-point.co',
    cleartext: false,
    allowNavigation: ['app.c-point.co', '*.c-point.co'],
  },
  backgroundColor: appBackground,
  ios: {
    preferredContentMode: 'mobile',
    backgroundColor: appBackground,
    contentInset: 'always',
    scrollEnabled: true,
  },
  plugins: {
    Keyboard: {
      resize: 'none',
      style: 'dark',
    },
    GoogleAuth: {
      // Used as fallback if JS initialize() omits clientId.
      clientId: '739552904126-ini3ms8voub380vij0cgq79k1dreul5h.apps.googleusercontent.com',
      // MUST be the Android OAuth Client ID (linked to SHA-1)
      androidClientId: '739552904126-mvkhoasgt3kt25uejlple989m3ph6dd4.apps.googleusercontent.com',
      // MUST be the iOS OAuth Client ID
      iosClientId: '739552904126-nb0l7j8d0p8q8q8rr84gatij5e0ip23p.apps.googleusercontent.com',
      // MUST be the Web OAuth Client ID
      serverClientId: '739552904126-ini3ms8voub380vij0cgq79k1dreul5h.apps.googleusercontent.com',
      scopes: ['profile', 'email'],
      forceCodeForRefreshToken: false,
    },
  },
};

export default config;
