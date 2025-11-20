import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point',
  webDir: 'dist',
  server: {
    url: 'https://www.c-point.co',
    cleartext: false
  },
  ios: {
    contentInset: 'always',
    // Enable hardware keyboard in simulator
    preferredContentMode: 'mobile'
  }
};

export default config;
