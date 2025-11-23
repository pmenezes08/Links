#!/bin/bash
# Quick manual test of push registration endpoint

echo "============================================================"
echo "🧪 Testing Push Registration Endpoint"
echo "============================================================"
echo ""

# Test 1: Endpoint exists and responds
echo "1️⃣ Testing if endpoint responds..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST https://puntz08.pythonanywhere.com/api/push/register_native \
  -H "Content-Type: application/json" \
  -d '{"token": "test_manual_token_123456789", "platform": "ios"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Endpoint is responding correctly!"
    echo ""
    echo "2️⃣ Checking if token was saved..."
    echo "Run this SQL query to check:"
    echo ""
    echo "SELECT * FROM push_tokens WHERE token LIKE '%test_manual_token%';"
    echo ""
else
    echo "❌ Endpoint returned error $HTTP_CODE"
    echo "This could mean:"
    echo "  - Backend code not reloaded"
    echo "  - Database connection issue"
    echo "  - push_tokens table missing"
fi

echo ""
echo "============================================================"
echo "📋 Next Steps"
echo "============================================================"
echo ""
echo "If endpoint works (200):"
echo "  1. Check database for the test token"
echo "  2. If token is there, iOS app needs to send token"
echo "  3. Check iOS console logs for errors"
echo ""
echo "If endpoint fails (not 200):"
echo "  1. Check server error logs"
echo "  2. Verify push_tokens table exists"
echo "  3. Reload web application"
echo ""
