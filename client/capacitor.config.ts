import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#000000';

const remoteServerUrl = process.env.CAP_SERVER_URL?.trim()
const serverConfig = remoteServerUrl
  ? {
      server: {
        url: remoteServerUrl,
        cleartext: remoteServerUrl.startsWith('http://'),
      },
    }
  : {}

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point',
  webDir: 'dist',
  ...serverConfig,
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
