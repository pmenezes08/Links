#!/bin/bash
# Check server error logs for push notification activity

echo "🔍 Checking Cloud Run Error Logs for Push Notification Activity"
echo "======================================================================="
echo ""

ERROR_LOG="/var/log/app.c-point.co.error.log"
SERVER_LOG="/var/log/app.c-point.co.server.log"

if [ ! -f "$ERROR_LOG" ]; then
    echo "❌ Error log not found: $ERROR_LOG"
    echo "   (This script must run on Cloud Run server)"
    exit 1
fi

echo "📋 Recent Firebase-related errors (last 50 lines):"
echo "---------------------------------------------------"
tail -200 "$ERROR_LOG" | grep -iE "firebase|fcm|push|token|notification" | tail -50
echo ""

echo "📋 Recent API calls to push endpoints:"
echo "---------------------------------------"
if [ -f "$SERVER_LOG" ]; then
    tail -200 "$SERVER_LOG" | grep -E "register_fcm|register_native|push" | tail -20
else
    echo "⚠️  Server log not accessible"
fi
echo ""

echo "📋 Recent general errors (last 20 lines):"
echo "------------------------------------------"
tail -20 "$ERROR_LOG"
echo ""

echo "✅ Log check complete"
echo ""
echo "💡 To monitor logs in real-time, run:"
echo "   tail -f $ERROR_LOG"
