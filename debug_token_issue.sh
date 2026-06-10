#!/bin/bash
# Debug script for FCM token registration issues

echo "🔍 FCM Token Registration Debugging"
echo "===================================="
echo ""

# 1. Check if FCMPlugin.swift was added to Xcode
echo "1️⃣  Checking if FCMPlugin.swift exists in Xcode project..."
if [ -f "client/ios/App/App/FCMPlugin.swift" ]; then
    echo "   ✅ FCMPlugin.swift file exists"
    echo "   ⚠️  But is it added to Xcode project? Check Xcode left sidebar!"
else
    echo "   ❌ FCMPlugin.swift file NOT FOUND"
    echo "   Run: git pull origin main"
fi
echo ""

# 2. Check if GoogleService-Info.plist exists
echo "2️⃣  Checking if GoogleService-Info.plist exists..."
if [ -f "client/ios/App/App/GoogleService-Info.plist" ]; then
    echo "   ✅ GoogleService-Info.plist exists"
    # Check if it has content
    if grep -q "GOOGLE_APP_ID" "client/ios/App/App/GoogleService-Info.plist" 2>/dev/null; then
        echo "   ✅ File appears valid (contains GOOGLE_APP_ID)"
    else
        echo "   ⚠️  File might be invalid or empty"
    fi
else
    echo "   ❌ GoogleService-Info.plist NOT FOUND"
    echo "   📥 Download from: https://console.firebase.google.com/"
    echo "   Then drag into Xcode under App/App/ folder"
fi
echo ""

# 3. Check if React build was copied to iOS
echo "3️⃣  Checking if React build is in iOS app..."
if [ -d "client/ios/App/App/public" ]; then
    file_count=$(find client/ios/App/App/public -type f | wc -l)
    echo "   ✅ public folder exists with $file_count files"
    if [ -f "client/ios/App/App/public/index.html" ]; then
        echo "   ✅ index.html found"
    else
        echo "   ❌ index.html NOT FOUND - build might be incomplete"
    fi
else
    echo "   ❌ public folder NOT FOUND"
    echo "   Run: cd client && npm run build && cp -r dist ios/App/App/public"
fi
echo ""

# 4. Check server database
echo "4️⃣  Checking server database for FCM tokens..."
python3.10 << 'PYEOF'
import sys
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

try:
    from backend.services.database import get_db_connection
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check table exists
    cursor.execute("SHOW TABLES LIKE 'fcm_tokens'")
    if cursor.fetchone():
        print("   ✅ fcm_tokens table exists")
        
        # Check for Paulo's tokens
        cursor.execute("SELECT COUNT(*) as count FROM fcm_tokens WHERE username = 'Paulo'")
        result = cursor.fetchone()
        count = result['count'] if isinstance(result, dict) else result[0]
        
        if count > 0:
            print(f"   ✅ Found {count} token(s) for Paulo")
            cursor.execute("SELECT token, platform, created_at FROM fcm_tokens WHERE username = 'Paulo' ORDER BY created_at DESC LIMIT 1")
            row = cursor.fetchone()
            if isinstance(row, dict):
                print(f"      Latest: {row['token'][:30]}... | {row['platform']} | {row['created_at']}")
            else:
                print(f"      Latest: {row[0][:30]}... | {row[1]} | {row[2]}")
        else:
            print("   ❌ No tokens found for Paulo")
            
            # Check if ANY tokens exist (maybe registered before login?)
            cursor.execute("SELECT COUNT(*) as count FROM fcm_tokens WHERE username IS NULL")
            result = cursor.fetchone()
            null_count = result['count'] if isinstance(result, dict) else result[0]
            
            if null_count > 0:
                print(f"   ⚠️  Found {null_count} token(s) with NULL username (registered before login)")
                print("   💡 User might need to log in first, then reopen app")
    else:
        print("   ❌ fcm_tokens table doesn't exist!")
        print("   Run: python3.10 add_fcm_tokens_table.py")
    
    cursor.close()
    conn.close()
except Exception as e:
    print(f"   ❌ Error: {e}")
PYEOF
echo ""

# 5. Check recent server logs
echo "5️⃣  Checking recent server logs for registration attempts..."
if [ -f "/var/log/app.c-point.co.error.log" ]; then
    echo "   Last 10 lines with 'fcm' or 'register':"
    tail -100 /var/log/app.c-point.co.error.log | grep -iE "fcm|register_fcm|push.*token" | tail -10 || echo "   (No recent FCM activity in logs)"
else
    echo "   ⚠️  Can't access server logs (run this on Cloud Run)"
fi
echo ""

# 6. Test endpoint directly
echo "6️⃣  Testing FCM registration endpoint..."
python3.10 << 'PYEOF'
import sys
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

try:
    # Test the endpoint logic
    from backend.services.database import get_db_connection, get_sql_placeholder
    
    test_token = "test_debug_token_12345"
    
    conn = get_db_connection()
    cursor = conn.cursor()
    ph = get_sql_placeholder()
    
    # Try inserting a test token
    try:
        cursor.execute(f"""
            INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
            VALUES ({ph}, {ph}, {ph}, {ph}, NOW(), 1)
            ON DUPLICATE KEY UPDATE last_seen=NOW()
        """, (test_token, None, "ios", "test", ))
        conn.commit()
        print("   ✅ Endpoint logic works - can insert tokens")
        
        # Clean up test token
        cursor.execute(f"DELETE FROM fcm_tokens WHERE token = {ph}", (test_token,))
        conn.commit()
    except Exception as e:
        print(f"   ❌ Database insert failed: {e}")
    
    cursor.close()
    conn.close()
except Exception as e:
    print(f"   ❌ Error: {e}")
PYEOF
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 NEXT STEPS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "If GoogleService-Info.plist or FCMPlugin.swift are missing:"
echo "  1. Open Xcode: cd client/ios/App && open App.xcworkspace"
echo "  2. Verify both files appear in left sidebar under App/App/"
echo "  3. If not, drag them in from Finder"
echo "  4. Clean: Product → Clean Build Folder"
echo "  5. Archive: Product → Archive"
echo ""
echo "If files are there but no tokens:"
echo "  1. Connect iPhone to Mac with cable"
echo "  2. Open Xcode → Window → Devices and Simulators"
echo "  3. Select iPhone → Open Console"
echo "  4. Run app and look for:"
echo "     - '🔥 Firebase token: ...' (means Firebase works)"
echo "     - 'FCMPlugin: Returning token' (means plugin works)"
echo ""
echo "If you see Firebase token but no plugin message:"
echo "  FCMPlugin.swift not added to Xcode target correctly"
echo ""
echo "If you see neither:"
echo "  GoogleService-Info.plist not added correctly"
echo ""
