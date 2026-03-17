import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#000000';

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point',
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
    GoogleAuth: {
      iosClientId: '739552904126-nb0l7j8d0p8q8q8rr84gatij5e0ip23p.apps.googleusercontent.com',
      scopes: ['profile', 'email'],
      forceCodeForRefreshToken: false,
    },
  },
};

export default config;

/*
 * UNIVERSAL LINKS SETUP (iOS)
 * 
 * To enable invite links to open in the iOS app instead of Safari:
 * 
 * 1. In Apple Developer Portal:
 *    - Go to Identifiers > App IDs > co.cpoint.app
 *    - Enable "Associated Domains" capability
 *    - Note your Team ID (visible in Membership section)
 * 
 * 2. Update the AASA file:
 *    - Edit /static/.well-known/apple-app-site-association
 *    - Replace "TEAM_ID" with your actual Apple Team ID
 *    - Example: "ABCD1234.co.cpoint.app"
 * 
 * 3. In Xcode:
 *    - Open the iOS project (client/ios/App/App.xcworkspace)
 *    - Select App target > Signing & Capabilities
 *    - Click "+ Capability" and add "Associated Domains"
 *    - Add: applinks:app.c-point.co
 *    - Add: applinks:www.c-point.co (for landing page links)
 * 
 * 4. Rebuild and deploy the iOS app
 * 
 * 5. Test by clicking an invite link - it should open the app
 */

