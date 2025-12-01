# iOS Universal Links Setup

This guide explains how to enable Universal Links so that invite links open directly in the C.Point iOS app instead of Safari.

## Overview

When Universal Links are configured, clicking a link like `https://www.c-point.co/login?invite=abc123` will:
- Open the C.Point app if installed
- Fall back to Safari if the app is not installed

## Setup Steps

### 1. Get Your Apple Team ID

1. Log in to [Apple Developer Portal](https://developer.apple.com)
2. Go to **Membership** section
3. Note your **Team ID** (e.g., `ABCD123456`)

### 2. Update the Apple App Site Association (AASA) File

Edit the file `/static/.well-known/apple-app-site-association`:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "YOUR_TEAM_ID.co.cpoint.app",
        "paths": [
          "/login*",
          "/community_feed_react/*",
          "/post/*",
          "/communities_react",
          "/messages_react",
          "/notifications_react"
        ]
      }
    ]
  },
  "webcredentials": {
    "apps": [
      "YOUR_TEAM_ID.co.cpoint.app"
    ]
  }
}
```

Replace `YOUR_TEAM_ID` with your actual Apple Team ID.

### 3. Deploy the Server Changes

Make sure the Flask server is updated and restarted so it serves the AASA file at:
`https://www.c-point.co/.well-known/apple-app-site-association`

You can verify it's working by visiting that URL - it should return JSON.

### 4. Configure the iOS App in Xcode

1. Open the iOS project in Xcode:
   ```
   open client/ios/App/App.xcworkspace
   ```

2. Select the **App** target in the left sidebar

3. Go to **Signing & Capabilities** tab

4. Click **+ Capability** button

5. Search for and add **Associated Domains**

6. In the Associated Domains section, add:
   - `applinks:www.c-point.co`
   - `applinks:c-point.co` (if also using non-www)

### 5. Enable Associated Domains in Apple Developer Portal

1. Go to [Apple Developer Portal](https://developer.apple.com)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Identifiers** → Select your App ID (`co.cpoint.app`)
4. Enable **Associated Domains** capability
5. Save changes

### 6. Rebuild and Deploy the App

1. Build a new version of the iOS app in Xcode
2. Submit to TestFlight or App Store

## Testing

### Before App Store Submission (Development)
- Universal Links may not work in development builds
- Use TestFlight for testing

### After Deployment
1. Install the app from TestFlight or App Store
2. Send yourself an invite link
3. Tap the link - it should open the app directly

### Debugging
- Check the AASA file is accessible: `curl https://www.c-point.co/.well-known/apple-app-site-association`
- Validate your AASA file: [Apple's AASA Validator](https://branch.io/resources/aasa-validator/)
- Check device logs in Console.app for `swcd` process errors

## Supported Paths

The following URL paths will open in the app:
- `/login*` - Login page (including invite tokens)
- `/community_feed_react/*` - Community feeds
- `/post/*` - Individual posts
- `/communities_react` - Communities list
- `/messages_react` - Messages
- `/notifications_react` - Notifications

## Troubleshooting

### Links Still Open in Safari
- Ensure the app is installed from TestFlight/App Store (not Xcode debug)
- Check that Associated Domains capability is enabled in Xcode
- Verify the AASA file is served with `Content-Type: application/json`
- Wait a few minutes - iOS caches AASA files

### "Invalid AASA" Errors
- Make sure Team ID is correct (10 characters, alphanumeric)
- Ensure the AASA file is valid JSON
- Check there are no trailing commas in the JSON

### App Opens But Wrong Page
- The app loads the URL in the web view, so routing should work automatically
- Check that the React app handles the URL parameters correctly
