#!/bin/bash
# Check all push tokens to diagnose registration

export MYSQL_PASSWORD='5r4VN4Qq'

echo "============================================================"
echo "📊 Push Token Status"
echo "============================================================"
echo ""

echo "1️⃣ All tokens in database:"
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h YOUR_CLOUD_SQL_HOST "puntz08\$C-Point" -e "
SELECT 
  id, 
  username, 
  LEFT(token, 30) as token_preview,
  platform,
  created_at,
  updated_at,
  is_active
FROM push_tokens 
ORDER BY created_at DESC;
"

echo ""
echo "2️⃣ Anonymous tokens:"
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h YOUR_CLOUD_SQL_HOST "puntz08\$C-Point" -e "
SELECT COUNT(*) as anonymous_count
FROM push_tokens 
WHERE username LIKE 'anonymous_%';
"

echo ""
echo "3️⃣ Paulo's tokens:"
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h YOUR_CLOUD_SQL_HOST "puntz08\$C-Point" -e "
SELECT COUNT(*) as paulo_count
FROM push_tokens 
WHERE username = 'Paulo';
"

echo ""
echo "============================================================"
echo "📋 Analysis"
echo "============================================================"
echo ""

# Count anonymous tokens
ANON_COUNT=$(mysql -u puntz08 -p"$MYSQL_PASSWORD" -h YOUR_CLOUD_SQL_HOST "puntz08\$C-Point" -se "SELECT COUNT(*) FROM push_tokens WHERE username LIKE 'anonymous_%';" 2>/dev/null)

if [ "$ANON_COUNT" -gt 1 ]; then
    echo "✅ Found $ANON_COUNT anonymous token(s)"
    echo ""
    echo "📱 NEXT STEP: Log in as Paulo in the TestFlight app"
    echo "   The anonymous token will be automatically associated with Paulo"
    echo ""
elif [ "$ANON_COUNT" -eq 1 ]; then
    echo "✅ Found 1 anonymous token (probably the test token)"
    echo ""
    echo "📱 NEXT STEP: Open the TestFlight app on your iPhone"
    echo "   Wait 10 seconds for it to register"
    echo "   Then check database again"
    echo ""
else
    echo "❌ No tokens found (except test token)"
    echo ""
    echo "📱 TROUBLESHOOTING:"
    echo "   1. Check iPhone Settings → C-Point → Notifications (must be ON)"
    echo "   2. Force quit and reopen the TestFlight app"
    echo "   3. Check iOS console logs for errors (if you have Xcode)"
    echo "   4. Wait 30 seconds after opening the app"
    echo ""
fi

echo "============================================================"
