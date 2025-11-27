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
      // 'body' resizes the webview body when keyboard opens (WhatsApp-like behavior)
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
