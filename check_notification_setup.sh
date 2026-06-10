#!/bin/bash
# Quick diagnostic script for iOS notifications setup

echo "=========================================="
echo "iOS Push Notifications Setup Check"
echo "=========================================="
echo ""

# Check 1: push_tokens table
echo "1️⃣ Checking if push_tokens table exists..."
mysql -u puntz08 -p -h YOUR_CLOUD_SQL_HOST 'puntz08$C-Point' -e "SHOW TABLES LIKE 'push_tokens';" 2>/dev/null | grep -q push_tokens

if [ $? -eq 0 ]; then
    echo "   ✅ push_tokens table exists"
    
    # Check for registered tokens
    echo ""
    echo "2️⃣ Checking for registered device tokens..."
    mysql -u puntz08 -p -h YOUR_CLOUD_SQL_HOST 'puntz08$C-Point' -e "SELECT username, platform, LEFT(token, 30) as token_preview, created_at FROM push_tokens ORDER BY created_at DESC LIMIT 5;" 2>/dev/null
    
else
    echo "   ❌ push_tokens table does NOT exist"
    echo ""
    echo "   🔧 Create it with:"
    echo "   Run the SQL commands I provided earlier in MySQL console"
fi

echo ""
echo "3️⃣ Checking apns2 library..."
if pip list 2>/dev/null | grep -q apns2; then
    echo "   ✅ apns2 library is installed"
    pip list | grep apns2
else
    echo "   ❌ apns2 library NOT installed"
    echo "   🔧 Install with: pip install apns2==0.8.0 --user"
fi

echo ""
echo "4️⃣ Backend logs check..."
echo "   Open Cloud Run Web tab → Error log"
echo "   Look for:"
echo "   - '📱 Registered new push token' = iOS app registered successfully"
echo "   - '📱 [APNs] Would send to iOS device' = Trying to send (APNs not configured)"
echo ""

echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "For iOS notifications to work, you need:"
echo "  1. ✅ iOS app requests permissions (already done)"
echo "  2. ⚠️  push_tokens table created (check above)"
echo "  3. ⚠️  Device token registered (check above)"
echo "  4. ❌ APNs credentials from Apple (NOT done yet)"
echo ""
echo "See IOS_APNS_SETUP_COMPLETE_GUIDE.md for APNs setup"
echo "=========================================="
