#!/bin/bash
# Firebase iOS Setup Script
# Run this on your Mac: bash setup_ios_firebase.sh

set -e

echo "============================================================"
echo "🔥 Firebase iOS Setup Script"
echo "============================================================"
echo ""

# Check if we're in the right directory
if [ ! -d "client" ]; then
    echo "❌ Error: client folder not found"
    echo "Please run this script from your project root (Links folder)"
    exit 1
fi

echo "✅ Found client folder"
echo ""

# Step 1: Install Capacitor iOS
echo "📱 Step 1/7: Installing Capacitor iOS..."
cd client
npm install @capacitor/ios
echo "✅ Capacitor iOS installed"
echo ""

# Step 2: Add iOS platform
echo "📱 Step 2/7: Adding iOS platform..."
npx cap add ios 2>/dev/null || echo "iOS platform already exists"
echo "✅ iOS platform ready"
echo ""

# Step 3: Update Podfile
echo "📱 Step 3/7: Updating Podfile..."
cd ios/App

# Backup original Podfile
cp Podfile Podfile.backup

# Add Firebase/Messaging to Podfile
if grep -q "Firebase/Messaging" Podfile; then
    echo "✅ Firebase already in Podfile"
else
    # Add Firebase pod before the last 'end'
    sed -i.bak '/^target.*App.*do$/,/^end$/ {
        /^end$/i\
  pod '"'"'Firebase/Messaging'"'"'
    }' Podfile
    echo "✅ Added Firebase to Podfile"
fi
echo ""

# Step 4: Install Pods
echo "📱 Step 4/7: Installing CocoaPods (this takes 2-3 minutes)..."
pod install
echo "✅ Pods installed"
echo ""

# Step 5: Create TypeScript service
echo "📱 Step 5/7: Creating FCM TypeScript service..."
cd ../../../
mkdir -p client/src/services

cat > client/src/services/fcmNotifications.ts << 'EOF'
import { Capacitor } from '@capacitor/core';

export const FCMNotifications = {
  async getToken(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    
    return new Promise((resolve) => {
      const listener = (event: any) => {
        if (event && event.token) {
          resolve(event.token);
          window.removeEventListener('FCMTokenRefresh', listener);
        }
      };
      
      window.addEventListener('FCMTokenRefresh', listener);
      
      setTimeout(() => {
        resolve(null);
        window.removeEventListener('FCMTokenRefresh', listener);
      }, 5000);
    });
  }
};
EOF

echo "✅ Created fcmNotifications.ts"
echo ""

# Step 6: Build React app
echo "📱 Step 6/7: Building React app..."
cd client
npm run build
echo "✅ React app built"
echo ""

# Step 7: Sync to iOS
echo "📱 Step 7/7: Syncing to iOS..."
npx cap sync ios
echo "✅ Synced to iOS"
echo ""

echo "============================================================"
echo "✅ Automated setup complete!"
echo "============================================================"
echo ""
echo "⚠️  Manual steps required:"
echo ""
echo "1. Add GoogleService-Info.plist to Xcode:"
echo "   - Download from Firebase Console"
echo "   - Run: open client/ios/App/App.xcworkspace"
echo "   - Drag GoogleService-Info.plist into App folder"
echo "   - Check 'Copy items if needed'"
echo ""
echo "2. Update AppDelegate.swift:"
echo "   - File is at: client/ios/App/App/AppDelegate.swift"
echo "   - Copy code from FIREBASE_MIGRATION_GUIDE.md"
echo ""
echo "3. Update NativePushInit.tsx:"
echo "   - File is at: client/src/components/NativePushInit.tsx"
echo "   - Copy code from FIREBASE_MIGRATION_GUIDE.md"
echo ""
echo "4. Build in Xcode:"
echo "   - Product → Archive"
echo "   - Distribute to TestFlight"
echo ""
echo "============================================================"
