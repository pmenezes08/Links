#!/bin/bash
# Quick fix script for APNs notifications on TestFlight

echo "=================================================="
echo "🔔 Quick Fix: TestFlight Push Notifications"
echo "=================================================="
echo ""

# Step 1: Install apns2
echo "Step 1: Installing apns2 library..."
pip install apns2==0.7.2 --user
if [ $? -eq 0 ]; then
    echo "✅ apns2 installed successfully"
else
    echo "❌ Failed to install apns2"
    exit 1
fi
echo ""

# Step 2: Check for .p8 file
echo "Step 2: Checking for .p8 key file..."
P8_PATH="/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8"

if [ -f "$P8_PATH" ]; then
    echo "✅ .p8 file found at: $P8_PATH"
    
    # Check permissions
    PERMS=$(stat -c "%a" "$P8_PATH" 2>/dev/null || stat -f "%A" "$P8_PATH" 2>/dev/null)
    echo "   Current permissions: $PERMS"
    
    if [ "$PERMS" != "600" ]; then
        echo "   ⚠️  Setting secure permissions..."
        chmod 600 "$P8_PATH"
        echo "   ✅ Permissions set to 600"
    fi
else
    echo "❌ .p8 file NOT FOUND at: $P8_PATH"
    echo ""
    echo "You need to:"
    echo "1. Download .p8 key from Apple Developer Portal:"
    echo "   https://developer.apple.com/account/resources/authkeys/list"
    echo ""
    echo "2. Create secrets directory:"
    echo "   mkdir -p /home/puntz08/secrets"
    echo ""
    echo "3. Upload your .p8 file to: /home/puntz08/secrets/"
    echo ""
    echo "4. Set permissions:"
    echo "   chmod 600 /home/puntz08/secrets/AuthKey_*.p8"
    echo ""
    exit 1
fi
echo ""

# Step 3: Check environment variables
echo "Step 3: Checking environment variables..."
if [ -z "$APNS_KEY_PATH" ]; then
    echo "⚠️  APNS_KEY_PATH not set (will be set in WSGI)"
else
    echo "✅ APNS_KEY_PATH: $APNS_KEY_PATH"
fi

if [ -z "$APNS_KEY_ID" ]; then
    echo "⚠️  APNS_KEY_ID not set (will be set in WSGI)"
else
    echo "✅ APNS_KEY_ID: $APNS_KEY_ID"
fi

if [ -z "$APNS_TEAM_ID" ]; then
    echo "⚠️  APNS_TEAM_ID not set (will be set in WSGI)"
else
    echo "✅ APNS_TEAM_ID: $APNS_TEAM_ID"
fi
echo ""

# Step 4: Run diagnostic
echo "Step 4: Running full diagnostic..."
echo ""
python test_apns_setup.py
echo ""

echo "=================================================="
echo "✅ Quick fix complete!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Make sure your WSGI file has all APNS_* variables"
echo "2. Reload your web app"
echo "3. Test with TestFlight app"
echo "4. Check logs for: '✅ APNs notification sent successfully'"
echo ""
echo "For detailed instructions, see: FIX_TESTFLIGHT_NOTIFICATIONS.md"
echo ""
