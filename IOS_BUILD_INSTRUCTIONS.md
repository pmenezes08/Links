# iOS Build Instructions for C.Point

## Prerequisites

You need a **Mac computer** with:
- macOS (latest version recommended)
- Xcode (download from Mac App Store)
- CocoaPods (`sudo gem install cocoapods`)
- Node.js and npm (already installed)

## Building for iOS

### 1. Install Dependencies (Already Done ✅)
```bash
cd client
npm install
```

### 2. Build React App
```bash
cd client
npm run build
```

### 3. Sync to iOS
```bash
cd client
npm run ios:sync
```

This will:
- Copy your React build to the iOS app
- Update native dependencies
- Prepare the Xcode project

### 4. Open in Xcode
```bash
cd client
npm run ios:open
```

Or manually open: `client/ios/App/App.xcworkspace` (use .xcworkspace, NOT .xcodeproj!)

### 5. Configure in Xcode

**First time setup:**
1. Select the "App" project in left sidebar
2. Go to "Signing & Capabilities" tab
3. Set your Team (need Apple Developer account)
4. Change Bundle Identifier if needed (currently: `co.cpoint.app`)
5. Select a target device or simulator

**Build Settings:**
- iOS Deployment Target: iOS 13.0 or higher
- Supported devices: iPhone and iPad

### 6. Run the App

**In Simulator:**
1. Select a simulator from the device menu (e.g., "iPhone 15 Pro")
2. Click the ▶ Play button in Xcode
3. App will launch in simulator

**On Real Device:**
1. Connect your iPhone via USB
2. Select your device from device menu
3. Click ▶ Play button
4. First time: Trust the developer on your iPhone (Settings → General → VPN & Device Management)

## Quick Commands

```bash
# Build React and sync to iOS
npm run ios:build

# Open Xcode
npm run ios:open

# Full workflow: build + sync + open Xcode
npm run ios:run
```

## App Configuration

The app is configured to connect to: `https://puntz08.pythonanywhere.com`

To change the server URL, edit `client/capacitor.config.ts`:
```typescript
server: {
  url: 'https://your-server.com'
}
```

## App Store Submission

When ready to submit to App Store:

1. **Create App Icons:**
   - Need 1024x1024px icon
   - Use https://www.appicon.co to generate all sizes
   - Place in `ios/App/App/Assets.xcassets/AppIcon.appiconset/`

2. **Create Launch Screen:**
   - Edit `ios/App/App/Base.lproj/LaunchScreen.storyboard`
   - Or use an image-based splash screen

3. **Build for Release:**
   - In Xcode: Product → Scheme → Edit Scheme → Run → Build Configuration → Release
   - Product → Archive
   - Follow Apple's submission process

4. **App Store Connect:**
   - Create app listing at https://appstoreconnect.apple.com
   - Add screenshots, description, keywords
   - Submit for review

## Troubleshooting

**"CocoaPods not installed" warning:**
```bash
sudo gem install cocoapods
cd client/ios/App
pod install
```

**Build errors in Xcode:**
- Try: Product → Clean Build Folder (Cmd+Shift+K)
- Ensure iOS deployment target matches (13.0+)

**App shows blank screen:**
- Check capacitor.config.ts server URL is correct
- Ensure you ran `npm run build` before syncing
- Check browser console in Xcode (View → Debug Area → Activate Console)

**Session/login issues:**
- iOS uses its own cookie storage
- Make sure SESSION_COOKIE_SECURE is False (already set)
- Sessions should work the same as mobile web

## What's Included

✅ Full React app compiled for iOS
✅ All 41 React pages
✅ Login, signup, dashboard, communities
✅ Messaging, notifications, profiles
✅ Admin panel
✅ Mobile-optimized layout
✅ PWA features (works offline with service worker)

## Next Steps

1. Run `npm run ios:open` on your Mac
2. Select iPhone simulator
3. Click Play ▶ in Xcode
4. Test the app!

Your app is ready for iOS! 🎉📱
