#!/bin/bash
# Wrapper script that sets environment variables from WSGI, then runs the test

echo "🔧 Setting up environment from WSGI file..."
echo ""

# Set Firebase credentials (same as in your WSGI file)
export FIREBASE_CREDENTIALS='/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json'

echo "✅ FIREBASE_CREDENTIALS set to: $FIREBASE_CREDENTIALS"
echo ""

# Check if file exists
if [ -f "$FIREBASE_CREDENTIALS" ]; then
    echo "✅ Credentials file exists"
    echo ""
else
    echo "❌ Credentials file NOT FOUND: $FIREBASE_CREDENTIALS"
    echo ""
    echo "Please check:"
    echo "  1. Is the file path correct?"
    echo "  2. Does the file exist in /home/puntz08/secrets/?"
    echo ""
    exit 1
fi

# Run the test script
echo "🚀 Running push notification test..."
echo "======================================"
echo ""

python3.10 test_push_server_detailed.py
