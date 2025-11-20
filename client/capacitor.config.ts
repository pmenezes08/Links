import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point',
  webDir: 'dist',
  server: {
    // Your production server URL - update this when deploying
    url: 'https://puntz08.pythonanywhere.com',
    cleartext: true
  },
  ios: {
    contentInset: 'always',
    // Enable hardware keyboard in simulator
    preferredContentMode: 'mobile'
  }
};

export default config;
