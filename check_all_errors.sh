#!/bin/bash
# Check for ALL errors in server logs (not just push-related)

echo "🔍 Checking ALL Recent Server Errors"
echo "====================================="
echo ""

ERROR_LOG="/var/log/puntz08.pythonanywhere.com.error.log"

if [ ! -f "$ERROR_LOG" ]; then
    echo "❌ Error log not found"
    exit 1
fi

echo "📋 Last 50 errors (any type):"
echo "-----------------------------"
tail -50 "$ERROR_LOG"
echo ""
echo "====================================="
echo ""

echo "📋 Errors in the last hour (if any):"
echo "------------------------------------"
# Get current hour
current_hour=$(date +"%Y-%m-%d %H")

grep "$current_hour" "$ERROR_LOG" | tail -20

echo ""
echo "✅ Log check complete"
