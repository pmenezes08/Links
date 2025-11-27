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
    contentInset: 'always',
    // Enable hardware keyboard in simulator
    preferredContentMode: 'mobile',
    backgroundColor: appBackground,
    // iOS keyboard behavior - let iOS handle keyboard avoidance
    scrollEnabled: true,
  },
  plugins: {
    Keyboard: {
      // 'none' - we handle keyboard positioning ourselves via the plugin events
      resize: 'none',
      style: 'dark',
      resizeOnFullScreen: false,
    },
  },
};

export default config;
