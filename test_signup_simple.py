#!/usr/bin/env python3
"""
Simple Signup Test
Test the signup endpoint directly to identify network issues
"""

import os
import sys

def test_signup_direct():
    """Test signup functionality directly using the Flask app"""
    try:
        # Import the Flask app components
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        
        # Set environment to use MySQL
        os.environ['DB_BACKEND'] = 'mysql'
        if not os.environ.get('MYSQL_PASSWORD'):
            print("❌ Error: MYSQL_PASSWORD environment variable is required!")
            return False
        
        from bodybuilding_app import get_db_connection
        
        print("Direct Signup Test")
        print("=" * 20)
        
        # Test database connection first
        print("1. Testing database connection...")
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                print("   ✅ Database connection works")
        except Exception as e:
            print(f"   ❌ Database connection failed: {e}")
            return False
        
        # Test user creation process
        print("\n2. Testing user creation process...")
        
        test_email = "test_signup@example.com"
        test_first_name = "Test"
        test_last_name = "User"
        test_password = "testpass123"
        
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                
                # Clean up any existing test user
                cursor.execute("DELETE FROM users WHERE email = %s", (test_email,))
                conn.commit()
                
                # Check if email already exists (should be clean now)
                cursor.execute("SELECT 1 FROM users WHERE email = %s", (test_email,))
                if cursor.fetchone():
                    print("   ❌ Test email still exists after cleanup")
                    return False
                
                print("   ✅ Email availability check works")
                
                # Generate username
                base_username = test_email.split('@')[0].lower()
                import re
                base_username = re.sub(r'[^a-z0-9_]', '', base_username) or 'user'
                username = base_username
                
                # Check username uniqueness
                suffix = 1
                while True:
                    cursor.execute("SELECT 1 FROM users WHERE username = %s", (username,))
                    if not cursor.fetchone():
                        break
                    suffix += 1
                    username = f"{base_username}{suffix}"
                
                print(f"   ✅ Generated unique username: {username}")
                
                # Hash password
                from werkzeug.security import generate_password_hash
                hashed_password = generate_password_hash(test_password)
                print("   ✅ Password hashing works")
                
                # Insert user
                from datetime import datetime
                cursor.execute("""
                    INSERT INTO users (username, email, password, first_name, last_name, subscription, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'free', %s)
                """, (username, test_email, hashed_password, test_first_name, test_last_name, datetime.now().strftime('%m.%d.%y %H:%M')))
                
                user_id = cursor.lastrowid
                conn.commit()
                
                print(f"   ✅ User created successfully with ID: {user_id}")
                
                # Verify user was created
                cursor.execute("SELECT username, email, first_name, last_name FROM users WHERE id = %s", (user_id,))
                created_user = cursor.fetchone()
                
                if created_user:
                    print(f"   ✅ User verified: {created_user['username']} ({created_user['email']})")
                else:
                    print("   ❌ User creation verification failed")
                    return False
                
                # Clean up test user
                cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
                conn.commit()
                print("   ✅ Test user cleaned up")
                
        except Exception as e:
            print(f"   ❌ User creation failed: {e}")
            import traceback
            print(f"   Traceback: {traceback.format_exc()}")
            return False
        
        print("\n✅ All signup components work correctly!")
        print("\nThe network error might be due to:")
        print("1. Frontend JavaScript errors")
        print("2. CORS or request formatting issues")
        print("3. Session/cookie problems")
        print("4. Flask route not accessible")
        
        print("\n🔧 Next steps:")
        print("1. Check browser Developer Tools Console for JS errors")
        print("2. Check Network tab for failed requests")
        print("3. Try signup in incognito/private browsing mode")
        print("4. Check if /signup endpoint is accessible directly")
        
        return True
        
    except ImportError as e:
        print(f"❌ Could not import Flask app: {e}")
        return False
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

if __name__ == "__main__":
    success = test_signup_direct()
    sys.exit(0 if success else 1)