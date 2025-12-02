import type { CapacitorConfig } from '@capacitor/cli';

const appBackground = '#000000';

const config: CapacitorConfig = {
  appId: 'co.cpoint.app',
  appName: 'C.Point',
  webDir: 'dist',
  server: {
    url: 'https://app.c-point.co',
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

