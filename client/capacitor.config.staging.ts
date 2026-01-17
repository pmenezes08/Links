import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#000000';

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point (Staging)',  // Different name to identify on device
  webDir: 'dist',
  server: {
    url: 'https://cpoint-app-staging-739552904126.europe-west1.run.app',
    cleartext: false,
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
      resize: 'native',
      style: 'dark',
    },
  },
};

export default config;
