import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#000000';

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point',
  webDir: 'dist',
  server: {
    url: 'https://www.c-point.co',
    cleartext: false,
  },
  backgroundColor: appBackground,
  ios: {
    preferredContentMode: 'mobile',
    backgroundColor: appBackground,
  },
  plugins: {
    Keyboard: {
      // CRITICAL: 'none' disables native resize - we handle keyboard with visualViewport
      resize: 'none',
      style: 'dark',
    },
  },
};

export default config;
