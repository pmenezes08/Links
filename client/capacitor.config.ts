import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#0b0f10';

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
    contentInset: 'always',
    // Enable hardware keyboard in simulator
    preferredContentMode: 'mobile',
    backgroundColor: appBackground,
  },
};

export default config;
