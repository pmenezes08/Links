#!/usr/bin/env python3
"""
Test Signup Endpoint
Test the signup functionality to debug network issues
"""

import requests
import json

def test_signup():
    """Test the signup endpoint"""
    
    print("Signup Endpoint Test")
    print("=" * 25)
    
    # Test data
    test_data = {
        'first_name': 'Test',
        'last_name': 'User',
        'email': 'test@example.com',
        'mobile': '+1234567890',
        'password': 'testpass123',
        'confirm_password': 'testpass123'
    }
    
    # Your app URL (adjust as needed)
    base_url = 'https://www.c-point.co'  # or your actual domain
    signup_url = f'{base_url}/signup'
    
    print(f"Testing signup at: {signup_url}")
    print(f"Test data: {test_data}")
    
    try:
        # Test GET request first
        print("\n1. Testing GET /signup...")
        headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
        }
        
        get_response = requests.get(signup_url, headers=headers)
        print(f"   GET Status: {get_response.status_code}")
        print(f"   Content-Type: {get_response.headers.get('Content-Type', 'Unknown')}")
        
        if get_response.status_code == 200:
            print("   ✅ GET request successful")
        else:
            print(f"   ❌ GET request failed: {get_response.text[:200]}")
            return False
        
        # Test POST request
        print("\n2. Testing POST /signup...")
        
        post_response = requests.post(
            signup_url, 
            data=test_data,
            headers=headers,
            allow_redirects=False
        )
        
        print(f"   POST Status: {post_response.status_code}")
        print(f"   Content-Type: {post_response.headers.get('Content-Type', 'Unknown')}")
        
        if post_response.status_code in [200, 302]:
            print("   ✅ POST request successful")
            
            # Try to parse JSON response
            try:
                json_response = post_response.json()
                print(f"   JSON Response: {json_response}")
            except:
                print(f"   HTML/Redirect Response: {post_response.text[:200]}")
                
        else:
            print(f"   ❌ POST request failed: {post_response.text[:200]}")
            return False
        
        print("\n✅ Signup endpoint appears to be working!")
        return True
        
    except requests.exceptions.ConnectionError:
        print("❌ Connection error - check if Flask app is running")
        return False
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

if __name__ == "__main__":
    print("Note: This test uses test@example.com - make sure this email isn't already registered")
    print("Adjust the base_url in the script to match your domain")
    print()
    success = test_signup()
    
    if not success:
        print("\n💡 Troubleshooting:")
        print("1. Check if Flask app is running")
        print("2. Verify the domain/URL is correct")
        print("3. Check Flask logs for errors")
        print("4. Ensure database is properly configured")