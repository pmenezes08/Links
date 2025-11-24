#!/bin/bash
# Script to verify Firebase setup on Mac
# Run this from your Links project root on your Mac

echo "🔍 Firebase iOS Setup Verification"
echo "===================================="
echo ""

# Check if GoogleService-Info.plist exists
echo "1️⃣  Checking GoogleService-Info.plist..."
if [ -f "client/ios/App/App/GoogleService-Info.plist" ]; then
    echo "   ✅ File exists at: client/ios/App/App/GoogleService-Info.plist"
    
    # Check if it contains required keys
    echo ""
    echo "2️⃣  Validating file contents..."
    
    if grep -q "GOOGLE_APP_ID" "client/ios/App/App/GoogleService-Info.plist"; then
        echo "   ✅ Contains GOOGLE_APP_ID"
    else
        echo "   ❌ Missing GOOGLE_APP_ID - file might be corrupt!"
    fi
    
    if grep -q "GCM_SENDER_ID" "client/ios/App/App/GoogleService-Info.plist"; then
        echo "   ✅ Contains GCM_SENDER_ID"
    else
        echo "   ❌ Missing GCM_SENDER_ID"
    fi
    
    if grep -q "BUNDLE_ID" "client/ios/App/App/GoogleService-Info.plist"; then
        bundle_id=$(grep -A 1 "BUNDLE_ID" "client/ios/App/App/GoogleService-Info.plist" | tail -1 | sed 's/<[^>]*>//g' | xargs)
        echo "   ✅ Bundle ID: $bundle_id"
        
        if [ "$bundle_id" != "co.cpoint.app" ]; then
            echo "   ⚠️  WARNING: Bundle ID doesn't match 'co.cpoint.app'"
            echo "   This might be the wrong GoogleService-Info.plist file!"
        fi
    else
        echo "   ❌ Missing BUNDLE_ID"
    fi
    
    echo ""
    echo "3️⃣  Checking file size..."
    file_size=$(wc -c < "client/ios/App/App/GoogleService-Info.plist")
    if [ "$file_size" -lt 500 ]; then
        echo "   ❌ File is too small ($file_size bytes) - might be corrupt!"
    elif [ "$file_size" -gt 10000 ]; then
        echo "   ⚠️  File is unusually large ($file_size bytes)"
    else
        echo "   ✅ File size looks good ($file_size bytes)"
    fi
    
else
    echo "   ❌ GoogleService-Info.plist NOT FOUND"
    echo ""
    echo "📥 You need to download it from Firebase Console:"
    echo "   1. Go to: https://console.firebase.google.com/"
    echo "   2. Select project: cpoint-127c2"
    echo "   3. Click ⚙️ → Project Settings"
    echo "   4. Scroll to 'Your apps' → iOS app"
    echo "   5. Download GoogleService-Info.plist"
    echo "   6. Save to: client/ios/App/App/"
    echo ""
    exit 1
fi

echo ""
echo "4️⃣  Checking if Firebase pod is installed..."
if [ -f "client/ios/App/Podfile.lock" ]; then
    if grep -q "Firebase/Messaging" "client/ios/App/Podfile.lock"; then
        version=$(grep -A 2 "Firebase/Messaging" "client/ios/App/Podfile.lock" | grep "Firebase" | head -1 | awk '{print $2}' | tr -d '()')
        echo "   ✅ Firebase/Messaging installed (version: $version)"
    else
        echo "   ❌ Firebase/Messaging NOT installed!"
        echo "   Run: cd client/ios/App && pod install"
    fi
else
    echo "   ⚠️  Podfile.lock not found"
    echo "   Run: cd client/ios/App && pod install"
fi

echo ""
echo "5️⃣  Checking Xcode project (if you have xcodebuild)..."
if command -v xcodebuild &> /dev/null; then
    cd client/ios/App
    # List files in project
    if xcodebuild -list -project App.xcodeproj 2>/dev/null | grep -q "App"; then
        echo "   ✅ Xcode project exists"
        
        # Try to check if GoogleService-Info.plist is in the project
        if xcodebuild -project App.xcodeproj -target App -showBuildSettings 2>/dev/null | grep -q "GoogleService"; then
            echo "   ✅ GoogleService-Info.plist appears to be in Xcode project"
        else
            echo "   ⚠️  Cannot verify if GoogleService-Info.plist is in Xcode target"
            echo "   Make sure you added it with 'Add to targets: App' checked"
        fi
    fi
    cd ../../..
else
    echo "   ⚠️  xcodebuild not available (that's OK on non-Mac)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 NEXT STEPS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "client/ios/App/App/GoogleService-Info.plist" ]; then
    echo "✅ File exists - now verify in Xcode:"
    echo ""
    echo "1. Open Xcode: cd client/ios/App && open App.xcworkspace"
    echo "2. In left sidebar, look for: App/App/GoogleService-Info.plist"
    echo "3. Click on it"
    echo "4. In right sidebar (File Inspector), check:"
    echo "   - Target Membership → ✅ App must be checked"
    echo "5. Try building: Product → Build (Cmd+B)"
    echo "6. Look for errors related to Firebase"
    echo ""
    echo "If GoogleService-Info.plist is NOT visible in Xcode:"
    echo "   - Right-click App/App folder"
    echo "   - Add Files to App..."
    echo "   - Select GoogleService-Info.plist"
    echo "   - ✅ Check 'Copy items if needed'"
    echo "   - ✅ Check 'Add to targets: App'"
    echo ""
else
    echo "❌ File missing - download from Firebase Console first!"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
