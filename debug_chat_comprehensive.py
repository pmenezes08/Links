#!/usr/bin/env python3
"""
Comprehensive Chat Debug Script
Tests all aspects of chat functionality to identify issues
"""

import requests
import json
import time
import sys
from datetime import datetime

class ChatDebugger:
    def __init__(self, base_url="https://puntz08.pythonanywhere.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'ChatDebugger/1.0',
            'Accept': 'application/json, text/html, */*'
        })
        
    def log(self, message, level="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def test_connection(self):
        """Test if the app is accessible"""
        self.log("Testing connection to app...")
        try:
            response = self.session.get(self.base_url, timeout=10)
            if "Coming Soon" in response.text:
                self.log("❌ App shows 'Coming Soon' page - Flask app not running", "ERROR")
                return False
            elif response.status_code == 200:
                self.log("✅ App is accessible", "SUCCESS")
                return True
            else:
                self.log(f"❌ App returned status {response.status_code}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Connection failed: {e}", "ERROR")
            return False
    
    def test_login(self, username, password):
        """Test login functionality"""
        self.log(f"Testing login for user: {username}")
        try:
            login_data = {
                'username': username,
                'password': password
            }
            response = self.session.post(
                f"{self.base_url}/login", 
                data=login_data,
                timeout=10
            )
            
            if response.status_code == 200:
                if "dashboard" in response.url or "home" in response.url:
                    self.log("✅ Login successful", "SUCCESS")
                    return True
                else:
                    self.log("❌ Login failed - redirected to wrong page", "ERROR")
                    return False
            else:
                self.log(f"❌ Login failed with status {response.status_code}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Login error: {e}", "ERROR")
            return False
    
    def test_user_lookup(self, username):
        """Test user ID lookup"""
        self.log(f"Testing user lookup for: {username}")
        try:
            data = {'username': username}
            response = self.session.post(
                f"{self.base_url}/api/get_user_id_by_username",
                data=data,
                timeout=10
            )
            
            if response.status_code == 200:
                try:
                    result = response.json()
                    if result.get('success') and result.get('user_id'):
                        self.log(f"✅ Found user ID: {result['user_id']}", "SUCCESS")
                        return result['user_id']
                    else:
                        self.log(f"❌ User not found: {result}", "ERROR")
                        return None
                except json.JSONDecodeError:
                    self.log(f"❌ Invalid JSON response: {response.text[:200]}", "ERROR")
                    return None
            else:
                self.log(f"❌ User lookup failed with status {response.status_code}", "ERROR")
                return None
        except Exception as e:
            self.log(f"❌ User lookup error: {e}", "ERROR")
            return None
    
    def test_get_messages(self, other_user_id):
        """Test getting messages"""
        self.log(f"Testing get messages for user ID: {other_user_id}")
        try:
            data = {'other_user_id': str(other_user_id)}
            response = self.session.post(
                f"{self.base_url}/get_messages",
                data=data,
                timeout=10
            )
            
            if response.status_code == 200:
                try:
                    result = response.json()
                    if result.get('success'):
                        messages = result.get('messages', [])
                        self.log(f"✅ Retrieved {len(messages)} messages", "SUCCESS")
                        return messages
                    else:
                        self.log(f"❌ Get messages failed: {result}", "ERROR")
                        return []
                except json.JSONDecodeError:
                    self.log(f"❌ Invalid JSON response: {response.text[:200]}", "ERROR")
                    return []
            else:
                self.log(f"❌ Get messages failed with status {response.status_code}", "ERROR")
                return []
        except Exception as e:
            self.log(f"❌ Get messages error: {e}", "ERROR")
            return []
    
    def test_send_message(self, recipient_id, message_text):
        """Test sending a message"""
        self.log(f"Testing send message to user ID: {recipient_id}")
        try:
            data = {
                'recipient_id': str(recipient_id),
                'message': message_text
            }
            response = self.session.post(
                f"{self.base_url}/send_message",
                data=data,
                timeout=10
            )
            
            if response.status_code == 200:
                try:
                    result = response.json()
                    if result.get('success'):
                        self.log("✅ Message sent successfully", "SUCCESS")
                        return True
                    else:
                        self.log(f"❌ Send message failed: {result}", "ERROR")
                        return False
                except json.JSONDecodeError:
                    self.log(f"❌ Invalid JSON response: {response.text[:200]}", "ERROR")
                    return False
            else:
                self.log(f"❌ Send message failed with status {response.status_code}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Send message error: {e}", "ERROR")
            return False
    
    def test_message_flow(self, sender_username, recipient_username, message_text):
        """Test complete message flow"""
        self.log("=" * 60)
        self.log("TESTING COMPLETE MESSAGE FLOW")
        self.log("=" * 60)
        
        # Test 1: Connection
        if not self.test_connection():
            return False
        
        # Test 2: Login
        if not self.test_login(sender_username, "password123"):  # You'll need to provide actual password
            self.log("⚠️  Skipping login test - provide actual password", "WARNING")
        
        # Test 3: Get recipient user ID
        recipient_id = self.test_user_lookup(recipient_username)
        if not recipient_id:
            return False
        
        # Test 4: Get initial messages
        initial_messages = self.test_get_messages(recipient_id)
        initial_count = len(initial_messages)
        
        # Test 5: Send message
        test_message = f"Debug test message at {datetime.now().strftime('%H:%M:%S')}"
        if not self.test_send_message(recipient_id, test_message):
            return False
        
        # Test 6: Wait and check if message appears
        self.log("Waiting 3 seconds for message to be processed...")
        time.sleep(3)
        
        # Test 7: Get messages again
        new_messages = self.test_get_messages(recipient_id)
        new_count = len(new_messages)
        
        # Test 8: Verify message was added
        if new_count > initial_count:
            self.log(f"✅ Message flow successful! Count: {initial_count} → {new_count}", "SUCCESS")
            
            # Show the new message
            new_message = new_messages[-1]
            self.log(f"New message: '{new_message.get('text', 'N/A')}' at {new_message.get('time', 'N/A')}")
            return True
        else:
            self.log(f"❌ Message flow failed! Count unchanged: {initial_count} → {new_count}", "ERROR")
            return False
    
    def test_polling_simulation(self, other_user_id, duration=30):
        """Simulate the frontend polling behavior"""
        self.log(f"Testing polling simulation for {duration} seconds...")
        
        message_counts = []
        start_time = time.time()
        
        while time.time() - start_time < duration:
            messages = self.test_get_messages(other_user_id)
            count = len(messages)
            message_counts.append(count)
            
            self.log(f"Poll {len(message_counts)}: {count} messages")
            time.sleep(2)  # Poll every 2 seconds like the original code
        
        # Analyze polling results
        unique_counts = list(set(message_counts))
        if len(unique_counts) == 1:
            self.log(f"✅ Polling stable - consistent count: {unique_counts[0]}", "SUCCESS")
        else:
            self.log(f"⚠️  Polling inconsistent - counts: {unique_counts}", "WARNING")
            self.log("This might indicate the infinite loop issue!")
        
        return unique_counts

def main():
    print("🔍 Comprehensive Chat Debug Script")
    print("=" * 50)
    
    # Get user input
    sender_username = input("Enter sender username: ").strip()
    recipient_username = input("Enter recipient username: ").strip()
    app_url = input("Enter your app URL (or press Enter for default): ").strip()
    
    if not app_url:
        app_url = "https://puntz08.pythonanywhere.com"
    
    # Initialize debugger
    debugger = ChatDebugger(app_url)
    
    # Test complete flow
    success = debugger.test_message_flow(sender_username, recipient_username, "test message")
    
    if success:
        print("\n" + "=" * 60)
        print("✅ CHAT FUNCTIONALITY TEST PASSED")
        print("The issue might be in the frontend React code.")
        print("=" * 60)
    else:
        print("\n" + "=" * 60)
        print("❌ CHAT FUNCTIONALITY TEST FAILED")
        print("The issue is in the backend.")
        print("=" * 60)
    
    # Optional: Test polling behavior
    if success:
        test_polling = input("\nTest polling behavior? (y/n): ").strip().lower()
        if test_polling == 'y':
            recipient_id = debugger.test_user_lookup(recipient_username)
            if recipient_id:
                debugger.test_polling_simulation(recipient_id, 20)

if __name__ == "__main__":
    main()
