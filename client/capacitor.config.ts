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
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    backgroundColor: appBackground,
    scrollEnabled: true,
  },
  plugins: {
    Keyboard: {
      // 'body' resizes the HTML body when keyboard opens - more stable than 'native'
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
