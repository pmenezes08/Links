#!/bin/bash
# Check if the invitation verification endpoint is public

echo "Checking line 281 of bodybuilding_app.py..."
sed -n '281p' ~/dev/Links/bodybuilding_app.py

echo ""
echo "Expected to see:"
echo "public_api_endpoints = ['/api/poll_notification_check', '/api/event_notification_check', '/api/email_verified_status', '/api/invitation/verify']"
