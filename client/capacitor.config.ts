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
    contentInset: 'always',
    // Let WKWebView have some scroll behavior for elastic scroll
    scrollEnabled: true,
  },
  plugins: {
    Keyboard: {
      // 'none' - we handle keyboard positioning manually via plugin events
      // This gives us full control and avoids double-offsetting
      resize: 'none',
      style: 'dark',
    },
  },
};

export default config;
