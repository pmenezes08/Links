#!/bin/bash
# Check if iOS app has push notification entitlements

echo "🔍 Checking iOS Push Notification Entitlements"
echo "==============================================="
echo ""

ENTITLEMENTS_FILE="client/ios/App/App/App.entitlements"

echo "1️⃣  Looking for entitlements file..."
if [ -f "$ENTITLEMENTS_FILE" ]; then
    echo "   ✅ File exists: $ENTITLEMENTS_FILE"
    echo ""
    echo "2️⃣  Checking contents..."
    cat "$ENTITLEMENTS_FILE"
    echo ""
    
    if grep -q "aps-environment" "$ENTITLEMENTS_FILE"; then
        echo "   ✅ Contains aps-environment (push notifications enabled)"
        
        # Check if it's development or production
        if grep -q "<string>development</string>" "$ENTITLEMENTS_FILE"; then
            echo "   📋 Environment: development (for TestFlight/Debug)"
        elif grep -q "<string>production</string>" "$ENTITLEMENTS_FILE"; then
            echo "   📋 Environment: production (for App Store)"
        fi
    else
        echo "   ❌ Missing aps-environment key!"
        echo ""
        echo "   This is REQUIRED for push notifications!"
        echo "   You need to add this to App.entitlements:"
        echo ""
        echo "   <key>aps-environment</key>"
        echo "   <string>development</string>"
    fi
else
    echo "   ❌ App.entitlements file NOT FOUND!"
    echo ""
    echo "   You need to create this file in Xcode:"
    echo "   1. Select App target in Xcode"
    echo "   2. Signing & Capabilities tab"
    echo "   3. Click + Capability"
    echo "   4. Add 'Push Notifications'"
    echo "   5. This creates App.entitlements automatically"
fi

echo ""
echo "====================================="
