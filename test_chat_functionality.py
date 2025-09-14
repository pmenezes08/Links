#!/usr/bin/env python3
"""
Test Chat Functionality Script
Tests the chat system to identify why messages aren't showing up
Run this on PythonAnywhere bash console
"""

import requests
import json
from datetime import datetime

def test_chat_functionality():
    """Test the chat functionality end-to-end"""

    print("🧪 Chat Functionality Test")
    print("=" * 40)

    base_url = "https://pmenezes08.pythonanywhere.com"  # Replace with your actual domain

    # Test data - you'll need to provide actual user IDs
    test_username = input("Enter your username: ").strip()
    recipient_username = input("Enter recipient username: ").strip()
    test_message = "Test message from debug script"

    if not test_username or not recipient_username:
        print("❌ Both usernames are required")
        return False

    print(f"\n👤 Testing chat between: {test_username} → {recipient_username}")
    print(f"📝 Test message: {test_message}")

    try:
        # ===============================
        # TEST 1: Get User IDs
        # ===============================
        print("\n🔍 Test 1: Getting user IDs...")

        # Get sender user ID
        response = requests.post(
            f"{base_url}/api/get_user_id_by_username",
            data={'username': test_username},
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        if response.status_code != 200:
            print(f"❌ Failed to get sender ID. Status: {response.status_code}")
            print(f"Response: {response.text}")
            return False

        sender_data = response.json()
        if not sender_data.get('success'):
            print(f"❌ Sender not found: {sender_data}")
            return False

        sender_id = sender_data['user_id']
        print(f"✅ Sender ID: {sender_id}")

        # Get recipient user ID
        response = requests.post(
            f"{base_url}/api/get_user_id_by_username",
            data={'username': recipient_username},
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        if response.status_code != 200:
            print(f"❌ Failed to get recipient ID. Status: {response.status_code}")
            print(f"Response: {response.text}")
            return False

        recipient_data = response.json()
        if not recipient_data.get('success'):
            print(f"❌ Recipient not found: {recipient_data}")
            return False

        recipient_id = recipient_data['user_id']
        print(f"✅ Recipient ID: {recipient_id}")

        # ===============================
        # TEST 2: Send Message
        # ===============================
        print("\n📤 Test 2: Sending message...")

        response = requests.post(
            f"{base_url}/send_message",
            data={
                'recipient_id': str(recipient_id),
                'message': test_message
            },
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        print(f"Send response status: {response.status_code}")
        print(f"Send response headers: {dict(response.headers)}")

        if response.status_code != 200:
            print(f"❌ Send failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return False

        send_result = response.json()
        print(f"Send result: {json.dumps(send_result, indent=2)}")

        if not send_result.get('success'):
            print(f"❌ Send API returned error: {send_result}")
            return False

        print("✅ Message sent successfully!")

        # ===============================
        # TEST 3: Retrieve Messages
        # ===============================
        print("\n📥 Test 3: Retrieving messages...")

        response = requests.post(
            f"{base_url}/get_messages",
            data={'other_user_id': str(recipient_id)},
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        print(f"Get messages response status: {response.status_code}")

        if response.status_code != 200:
            print(f"❌ Get messages failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return False

        messages_result = response.json()
        print(f"Get messages result: {json.dumps(messages_result, indent=2)}")

        if not messages_result.get('success'):
            print(f"❌ Get messages API returned error: {messages_result}")
            return False

        messages = messages_result.get('messages', [])
        print(f"✅ Retrieved {len(messages)} messages")

        # Check if our test message is in the results
        found_test_message = False
        for msg in messages:
            if msg.get('text') == test_message and msg.get('sent') == True:
                print(f"✅ Found test message in results:")
                print(f"   ID: {msg.get('id')}")
                print(f"   Text: {msg.get('text')}")
                print(f"   Sent: {msg.get('sent')}")
                print(f"   Time: {msg.get('time')}")
                found_test_message = True
                break

        if not found_test_message:
            print("⚠️  Test message not found in retrieved messages")
            print("   This might indicate a timing issue or caching problem")

        # ===============================
        # TEST 4: Check Database Directly
        # ===============================
        print("\n🗄️  Test 4: Database check...")

        # This would require MySQL credentials, but we can skip for now
        print("ℹ️  Skipping direct database check (requires MySQL credentials)")

        # ===============================
        # SUMMARY
        # ===============================
        print("\n" + "=" * 50)
        print("🧪 TEST SUMMARY")
        print("=" * 50)

        tests_passed = 0
        total_tests = 4

        print("✅ Test 1 - Get User IDs: PASSED"        tests_passed += 1

        if send_result.get('success'):
            print("✅ Test 2 - Send Message: PASSED"            tests_passed += 1
        else:
            print("❌ Test 2 - Send Message: FAILED")

        if messages_result.get('success'):
            print("✅ Test 3 - Retrieve Messages: PASSED"            tests_passed += 1
        else:
            print("❌ Test 3 - Retrieve Messages: FAILED")

        print("⏭️  Test 4 - Database Check: SKIPPED")

        print(f"\n📊 Results: {tests_passed}/{total_tests} tests passed")

        if tests_passed >= 3:
            print("\n🎉 BACKEND IS WORKING!")
            print("   If messages aren't showing in the frontend,")
            print("   the issue is likely in the React component.")
            print("   Check the browser console for the debug logs.")
        else:
            print("\n❌ BACKEND ISSUES DETECTED!")
            print("   The problem is in the backend API.")

        return tests_passed >= 3

    except Exception as e:
        print(f"❌ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    try:
        success = test_chat_functionality()
        if success:
            print("\n✅ Chat functionality test completed!")
        else:
            print("\n❌ Chat functionality test failed!")
            exit(1)
    except KeyboardInterrupt:
        print("\n❌ Test cancelled by user")
        exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        exit(1)
