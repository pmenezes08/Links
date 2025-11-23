#!/usr/bin/env python3
"""
Send a quick APNs notification to a user using stored native tokens.

Usage:
    python3 test_send_apns.py username --title "Hello" --body "Test message"
"""

import argparse
import os
import sys

from backend.services.native_push import send_native_push_notification


def main():
    parser = argparse.ArgumentParser(description="Send a native (APNs) push notification to a user.")
    parser.add_argument("username", help="Target username (must have registered native tokens)")
    parser.add_argument("--title", default="Test Notification")
    parser.add_argument("--body", default="If you see this, native push is working!")
    parser.add_argument("--url", default=None, help="Optional deep-link URL")
    parser.add_argument("--priority", type=int, default=10, help="APNs priority (10=immediate, 5=background)")
    parser.add_argument("--ttl", type=int, default=3600, help="Time-to-live in seconds")
    args = parser.parse_args()

    payload = {
        "title": args.title,
        "body": args.body,
        "url": args.url,
        "priority": args.priority,
        "ttl": args.ttl,
    }

    print(f"📣 Sending APNs notification to {args.username}...")
    send_native_push_notification(args.username, payload)
    print("✅ Dispatch complete. Check device logs or Notifications.")


if __name__ == "__main__":
    sys.exit(main())
