#!/usr/bin/env python3
"""
Test script to verify sub-community creation permissions for Mary
Run this on PythonAnywhere to simulate the exact request
"""

import os
import sys

# Setup path
sys.path.insert(0, '/home/puntz08/dev/Links')

# Set environment
os.environ['USE_MYSQL'] = '1'
os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
os.environ['MYSQL_USER'] = 'puntz08'
os.environ['MYSQL_PASSWORD'] = os.environ.get('MYSQL_PASSWORD', '')
os.environ['MYSQL_DATABASE'] = 'puntz08$C-Point'

from bodybuilding_app import get_db_connection, get_sql_placeholder, is_app_admin

def test_mary_permissions():
    username = 'mary'
    parent_community_id = 56  # ACME Corporation
    community_type = 'Business'
    
    print("=" * 70)
    print("TESTING SUB-COMMUNITY CREATION PERMISSIONS FOR MARY")
    print("=" * 70)
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            placeholder = get_sql_placeholder()
            
            # Test 1: Check email verification
            print("\n1. Checking email verification...")
            c.execute(f"SELECT email_verified, subscription FROM users WHERE username = {placeholder}", (username,))
            user_info = c.fetchone()
            if not user_info:
                print(f"❌ User {username} not found!")
                return
            
            email_verified = user_info['email_verified'] if hasattr(user_info, 'keys') else user_info[0]
            subscription = user_info['subscription'] if hasattr(user_info, 'keys') else user_info[1]
            
            print(f"   Email verified: {email_verified}")
            print(f"   Subscription: {subscription}")
            
            if not email_verified:
                print("   ❌ FAIL: Email not verified")
                return
            else:
                print("   ✅ PASS: Email is verified")
            
            # Test 2: Check premium requirement
            print("\n2. Checking premium/bypass logic...")
            print(f"   Username: {username}")
            print(f"   Is app admin: {is_app_admin(username)}")
            print(f"   Subscription: {subscription}")
            
            # Check if Business admin bypass applies
            c.execute(f"SELECT type, creator_username FROM communities WHERE id = {placeholder}", (parent_community_id,))
            parent_info = c.fetchone()
            
            if not parent_info:
                print(f"   ❌ Parent community {parent_community_id} not found!")
                return
            
            parent_type = parent_info['type'] if hasattr(parent_info, 'keys') else parent_info[0]
            parent_creator = parent_info['creator_username'] if hasattr(parent_info, 'keys') else parent_info[1]
            
            print(f"   Parent community type: {parent_type}")
            print(f"   Parent creator: {parent_creator}")
            
            # Check user's role in parent
            c.execute(f"""
                SELECT role FROM user_communities
                WHERE user_id = (SELECT id FROM users WHERE username = {placeholder})
                AND community_id = {placeholder}
            """, (username, parent_community_id))
            role_row = c.fetchone()
            user_role = role_row['role'] if (role_row and hasattr(role_row, 'keys')) else (role_row[0] if role_row else None)
            
            print(f"   User role in parent: {user_role}")
            
            is_business_admin_creating_sub = False
            if parent_type.lower() == 'business':
                if username == parent_creator:
                    is_business_admin_creating_sub = True
                    print(f"   ✅ User is parent owner - bypass applies")
                elif user_role == 'admin':
                    is_business_admin_creating_sub = True
                    print(f"   ✅ User is parent admin - bypass applies")
            
            print(f"   Business admin bypass active: {is_business_admin_creating_sub}")
            
            # Premium check
            if not is_business_admin_creating_sub and username.lower() != 'admin':
                if not subscription or str(subscription).lower() != 'premium':
                    print(f"   ❌ FAIL: Premium required (subscription: {subscription})")
                    return
                else:
                    print(f"   ✅ PASS: Has premium subscription")
            else:
                print(f"   ✅ PASS: Premium check bypassed")
            
            # Test 3: Business community permission check
            print("\n3. Checking Business community permissions...")
            
            if community_type.lower() == 'business':
                print(f"   Creating Business sub-community under parent {parent_community_id}")
                
                if parent_type.lower() != 'business':
                    print(f"   ❌ FAIL: Parent is not Business type (is {parent_type})")
                    return
                else:
                    print(f"   ✅ PASS: Parent is Business type")
                
                # Check if user can create
                if username == parent_creator:
                    print(f"   ✅ PASS: User is parent owner")
                elif is_app_admin(username):
                    print(f"   ✅ PASS: User is app admin")
                elif user_role == 'admin':
                    print(f"   ✅ PASS: User is parent admin")
                else:
                    print(f"   ❌ FAIL: User role is '{user_role}' (not owner, admin, or app admin)")
                    return
            
            print("\n" + "=" * 70)
            print("🎉 ALL CHECKS PASSED - SUB-COMMUNITY CREATION SHOULD WORK!")
            print("=" * 70)
            
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    test_mary_permissions()
